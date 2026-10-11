#!/usr/bin/env node
/**
 * Backfill svíček ze Simco Tools → DB (deep historie).
 *
 * Co dělá (idempotentně, upsert per bucket):
 *   1) DENNÍ svíčky (granularity=1d, rolling okno ~365 dní po 180denních
 *      oknech) → market_candles_daily
 *      – Simco Tools drží denní data jen ~1 rok (start dřívější data
 *        API ignoruje a vrací rolling okno). Skript proto vždy táhne
 *        celé dostupné okno → DB nashromažďuje historii trvale.
 *   2) TÝDENNÍ archiv (granularity=1W, celá dostupná hloubka ~2022)
 *      → market_candles_archive
 *      – pozn.: Simco Tools 1W/1M mají VLASTNÍ horní hranici (aktuálně
 *        ~2026-04 u 1W, ~2026-09 u 1M); čerstvější weekly/monthly
 *        buckety se agregují za běhu z denních svíček (market page).
 *   3) MĚSÍČNÍ archiv (granularity=1M, start 2022) → market_candles_archive
 *
 * Simco Tools limit je 2 req/s ⇒ mezi requesty 600 ms.
 * Spouštěj pravidelně (1× denně/týdně): denní část je INKREMENTÁLNÍ –
 * dotahuje jen dny po posledním uloženém dni (+ bezpečnostní přepis
 * posledních 2 dní, ať se doběhne uzavření svíček). Historie se do DB
 * kumuluje, první běh (nebo roční pauza) táhne celé 1d okno API.
 * 1W/1M archiv se dotahuje vždy celý (1 request per granularitu).
 *
 * Použití: npm run backfill:candles
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";

try {
  const content = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ Chybí DATABASE_URL – doplň .env.local.");
  process.exit(1);
}

const REALM = process.env.SIMCOTOOLS_REALM ?? 0;
const sql = postgres(DATABASE_URL, { max: 1, prepare: false, connect_timeout: 15 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start archivu – Simco Tools má weekly/monthly data od ~2022-02. */
const ARCHIVE_START_MS = Date.UTC(2022, 0, 1);
/** Denní retence API ~365 dní (rolling) – táhneme plné okno. */
const DAILY_DAYS_BACK = 365;
/** Velikost okna pro denní stránkování. */
const DAILY_WINDOW_DAYS = 180;

async function fetchJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "Accept-Language": "cs" },
    });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      await sleep(2000 * attempt);
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
  throw new Error("vyčerpané pokusy");
}

const candlesUrl = (id, gran, startMs, endMs) =>
  `https://api.simcotools.com/v1/realms/${REALM}/market/resources/${id}/0/candlesticks` +
  `?granularity=${gran}&start=${Math.floor(startMs)}${endMs ? `&end=${Math.floor(endMs)}` : ""}`;

const DAY_MS = 24 * 60 * 60 * 1000;

try {
  const items = await sql`select id, name from items order by id`;
  console.log(`🕯️  Backfill svíček pro ${items.length} položek…`);

  let totalDaily = 0;
  let totalArchive = 0;

  for (const item of items) {
    try {
      // ── 1) DENNÍ svíčky – INKREMENTÁLNÍ: jen dny po posledním
      //      uloženém dni (−2 d přepis pro bezpečné uzavření svíček).
      //      První běh = celé 365d okno API. ──────────────────────────
      const dailyByDay = new Map();
      const nowMs = Date.now();
      const dailyFloor = nowMs - DAILY_DAYS_BACK * DAY_MS; // rolling retence API
      let dailyFrom = dailyFloor;
      try {
        const lastRow = await sql`
          select max(day) as last_day from market_candles_daily
          where resource_id = ${item.id}
        `;
        const lastMs = lastRow[0]?.last_day
          ? new Date(lastRow[0].last_day).getTime()
          : 0;
        if (lastMs > 0) {
          dailyFrom = Math.max(lastMs - 2 * DAY_MS, dailyFloor);
        }
      } catch (err) {
        console.error(`  ✖ ${item.name} (last_day query): ${err.message}`);
      }
      for (let s = dailyFrom; s < nowMs; s += DAILY_WINDOW_DAYS * DAY_MS) {
        const e = Math.min(s + DAILY_WINDOW_DAYS * DAY_MS, nowMs);
        try {
          const data = await fetchJson(candlesUrl(item.id, "1d", s, e));
          for (const c of data.candlesticks ?? []) {
            dailyByDay.set(c.date.slice(0, 10), c); // dedupe dle dne
          }
        } catch (err) {
          console.error(`  ✖ ${item.name} (1d okno): ${err.message}`);
        }
        await sleep(600); // slušnost vůči 2 req/s limitu
      }

      if (dailyByDay.size > 0) {
        const rows = [...dailyByDay.values()].map((c) => ({
          resource_id: item.id,
          quality: 0,
          day: c.date.slice(0, 10),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume ?? null,
          vwap: c.vwap ?? null,
        }));
        await sql`
          insert into market_candles_daily ${sql(
            rows,
            "resource_id",
            "quality",
            "day",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "vwap"
          )}
          on conflict (resource_id, quality, day) do update set
            open = excluded.open, high = excluded.high, low = excluded.low,
            close = excluded.close, volume = excluded.volume, vwap = excluded.vwap
        `;
        totalDaily += rows.length;
        console.log(`  ✔ ${item.name}: ${rows.length} denních svíček`);
      } else {
        console.log(`  ⚠️  ${item.name}: denní svíčky aktuální (nic nového)`);
      }

      // ── 2) TÝDENNÍ archiv (celá dostupná hloubka od 2022, bez end –
      //      API 1W/1M tříbí vlastní horní hranici; recent agreguje page) ─
      try {
        const data = await fetchJson(
          candlesUrl(item.id, "1W", ARCHIVE_START_MS)
        );
        const candles = data.candlesticks ?? [];
        if (candles.length > 0) {
          const rows = candles.map((c) => ({
            resource_id: item.id,
            quality: 0,
            granularity: "1w",
            bucket_start: c.date.slice(0, 10), // API vrací pondělí
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume ?? null,
          }));
          await sql`
            insert into market_candles_archive ${sql(
              rows,
              "resource_id",
              "quality",
              "granularity",
              "bucket_start",
              "open",
              "high",
              "low",
              "close",
              "volume"
            )}
            on conflict (resource_id, quality, granularity, bucket_start) do update set
              open = excluded.open, high = excluded.high, low = excluded.low,
              close = excluded.close,
              volume = coalesce(excluded.volume, market_candles_archive.volume)
          `;
          totalArchive += rows.length;
          console.log(`  ✔ ${item.name}: ${rows.length} týdenních (archiv)`);
        }
      } catch (err) {
        console.error(`  ✖ ${item.name} (1W archiv): ${err.message}`);
      }
      await sleep(600);

      // ── 3) MĚSÍČNÍ archiv (od 2022, bez end) ────────────────────────
      try {
        const data = await fetchJson(
          candlesUrl(item.id, "1M", ARCHIVE_START_MS)
        );
        const candles = data.candlesticks ?? [];
        if (candles.length > 0) {
          const rows = candles.map((c) => ({
            resource_id: item.id,
            quality: 0,
            granularity: "1M",
            bucket_start: c.date.slice(0, 10), // API vrací 1. den měsíce
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume ?? null,
          }));
          await sql`
            insert into market_candles_archive ${sql(
              rows,
              "resource_id",
              "quality",
              "granularity",
              "bucket_start",
              "open",
              "high",
              "low",
              "close",
              "volume"
            )}
            on conflict (resource_id, quality, granularity, bucket_start) do update set
              open = excluded.open, high = excluded.high, low = excluded.low,
              close = excluded.close,
              volume = coalesce(excluded.volume, market_candles_archive.volume)
          `;
          totalArchive += rows.length;
          console.log(`  ✔ ${item.name}: ${rows.length} měsíčních (archiv)`);
        }
      } catch (err) {
        console.error(`  ✖ ${item.name} (1M archiv): ${err.message}`);
      }
      await sleep(600);
    } catch (err) {
      console.error(`  ✖ ${item.name}: ${err.message}`);
    }
  }

  console.log(
    `\n🏁 Hotovo – ${totalDaily} denních + ${totalArchive} archivních svíček uloženo.`
  );
} catch (err) {
  console.error("❌ Chyba:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
