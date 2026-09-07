#!/usr/bin/env node
/**
 * Backfill denních svíček (OHLC + objem + VWAP) ze Simco Tools
 * do tabulky market_candles_daily – pro všechny položky, kvalita 0.
 *
 * Simco Tools limit je 2 req/s ⇒ ~150 položek za ~75 s.
 * Idempotentní (upsert per den). Spouštěj pravidelně (např. týdně),
 * pro dnešní částečnou svíčku doplňuje poller/grafová vrstva ticky.
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

try {
  const items = await sql`select id, name from items order by id`;
  console.log(`🕯️  Backfill denních svíček pro ${items.length} položek…`);

  let total = 0;
  for (const item of items) {
    try {
      const data = await fetchJson(
        `https://api.simcotools.com/v1/realms/${REALM}/market/resources/${item.id}/0/candlesticks`
      );
      const candles = data.candlesticks ?? [];
      if (candles.length === 0) {
        console.log(`  ⚠️  ${item.name}: žádné svíčky`);
        continue;
      }

      const rows = candles.map((c) => ({
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

      total += rows.length;
      console.log(`  ✔ ${item.name}: ${rows.length} svíček`);
    } catch (err) {
      console.error(`  ✖ ${item.name}: ${err.message}`);
    }
    await sleep(600); // slušnost vůči 2 req/s limitu
  }

  console.log(`\n🏁 Hotovo – ${total} svíček uloženo.`);
} catch (err) {
  console.error("❌ Chyba:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
