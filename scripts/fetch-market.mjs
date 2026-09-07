#!/usr/bin/env node
/**
 * SIMALYTICS – fetch skript pro GitHub Actions cron (každých 15 min).
 *
 * Co dělá:
 *  1. Načte seznam sledovaných ID buď z env SIMCOMPANIES_ITEMS
 *     ("1,2,3,…"), nebo z tabulky `items` (Neon PostgreSQL).
 *  2. Pro každé ID zavolá veřejný endpoint hry
 *        GET https://www.simcompanies.com/api/v3/market/{quality}/{id}/
 *     (ověřeno – vrací pole aktivních nabídek, nejlevnější dole).
 *  3. Nejnižší nabídku (ask) hromadně upsertuje do `price_history`.
 *
 * Respektuje pravidla hry (simcompanies.com/articles/api):
 *   – pouze GET requesty
 *   – rozumná frekvence: 1 request / 5 s + celý run jednou za 15 min
 *
 * Proměnné prostředí:
 *   DATABASE_URL              – connection string do Neonu (pooled)
 *   SIMCOMPANIES_ITEMS        – volitelné: "1,2,3,4" (jinak tabulka items)
 *   SIMCOMPANIES_QUALITIES    – volitelné, default "0"
 *
 * Spuštění:  npm run fetch:market
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";

// Nahraj .env.local, pokud skript neběží v CI (tam stačí process.env)
try {
  const envFile = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of envFile.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // .env.local nemusí existovat (CI)
}

// ── Konfigurace ─────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    "❌ Chybí DATABASE_URL. Nastav ji v .env.local (lokalně) " +
      "nebo v GitHub Secrets (CI)."
  );
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  max: 1,
  prepare: false, // kompatibilita s Neon pooled connection (PgBouncer)
});

const API_BASE = "https://www.simcompanies.com/api/v3";
const QUALITIES = (process.env.SIMCOMPANIES_QUALITIES || "0")
  .split(",")
  .map((q) => parseInt(q.trim(), 10))
  .filter((q) => !Number.isNaN(q));

const REQUEST_DELAY_MS = 5_000; // 1 request / 5 s ⇒ ~30 položek za 2,5 min
const USER_AGENT = "Simalytics/1.0 (osobní portfolio tracker)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Fetch jedné položky ─────────────────────────────────────────────
async function fetchJson(url) {
  // 429 (rate limit) a 5xx řešíme opakovaným pokusem s rostoucím odstupem
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });

    if (res.ok) return res.json();

    if (res.status === 429 || res.status >= 500) {
      const waitMs = 30_000 * attempt;
      console.warn(
        `  ⏳ HTTP ${res.status} – čekám ${waitMs / 1000}s a zkouším znovu (${attempt}/3)…`
      );
      await sleep(waitMs);
      continue;
    }

    throw new Error(`HTTP ${res.status}`);
  }

  throw new Error("vyčerpané pokusy (rate limit?)");
}

/** Nejnižší aktivní nabídka (ask) z pole orderů. */
function extractLowestAsk(payload) {
  const orders = (Array.isArray(payload) ? payload : [])
    .filter((o) => Number(o?.quantity) > 0 && Number(o?.price) > 0)
    .sort((a, b) => Number(a.price) - Number(b.price));

  if (orders.length === 0) return null;
  const best = orders[0];
  return { price: Number(best.price), quantity: Number(best.quantity) };
}

// ── Seznam sledovaných ID ───────────────────────────────────────────
async function getTrackedItems() {
  const fromEnv = (process.env.SIMCOMPANIES_ITEMS || "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));

  if (fromEnv.length > 0) {
    console.log(`📋 Sledovaná ID z env: ${fromEnv.join(", ")}`);
    return fromEnv.map((id) => ({ id, name: `#${id}` }));
  }

  const items = await sql`select id, name from items order by id`;
  return items;
}

// ── Hromadný upsert cenových bodů ───────────────────────────────────
async function upsertPricePoints(points) {
  if (points.length === 0) return;

  await sql`
    insert into price_history
      ${sql(
        points,
        "item_id",
        "quality",
        "price",
        "quantity",
        "recorded_at"
      )}
    on conflict (item_id, quality, recorded_at)
    do update set price = excluded.price, quantity = excluded.quantity
  `;
}

// ── Stažení cen ─────────────────────────────────────────────────────
async function fetchAndStorePrices(items) {
  // Jeden timestamp pro celý run ⇒ čisté candlestick agregace
  const recordedAt = new Date();
  let inserted = 0;
  let failed = 0;

  for (const quality of QUALITIES) {
    console.log(`\n💱 Kvalita ${quality} – ${items.length} položek…`);
    const pending = [];

    for (const item of items) {
      const url = `${API_BASE}/market/${quality}/${item.id}/`;
      try {
        const payload = await fetchJson(url);
        const best = extractLowestAsk(payload);

        if (!best) {
          console.warn(`  ⚠️  ${item.name} (q${quality}): žádná aktivní nabídka.`);
          continue;
        }

        pending.push({
          item_id: item.id,
          quality,
          price: best.price,
          quantity: best.quantity,
          recorded_at: recordedAt,
        });
        inserted++;
        console.log(
          `  ✔ ${item.name} (q${quality}): ${best.price} × ${best.quantity}`
        );
      } catch (err) {
        failed++;
        console.error(`  ✖ ${item.name} (q${quality}): ${err.message}`);
      }

      await sleep(REQUEST_DELAY_MS);
    }

    // Flush po každé kvalitě – částečná data přežijí i případný timeout
    await upsertPricePoints(pending);
  }

  return { inserted, failed };
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const startedAt = Date.now();
  console.log(`🚀 Simalytics fetch – ${new Date(startedAt).toISOString()}`);

  let items;
  try {
    items = await getTrackedItems();
  } catch (err) {
    console.error(`❌ Nepodařilo se připojit k databázi: ${err.message}`);
    process.exit(1);
  }

  if (items.length === 0) {
    console.error(
      "❌ Nic ke stažení – vyplň tabulku items (db/schema.sql seed) " +
        "nebo nastav SIMCOMPANIES_ITEMS."
    );
    process.exit(1);
  }

  const { inserted, failed } = await fetchAndStorePrices(items);

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n🏁 Hotovo za ${seconds}s – vloženo ${inserted}, selhalo ${failed}.`);

  await sql.end();

  if (failed > items.length * QUALITIES.length * 0.5) {
    console.error("❌ Příliš mnoho chyb – exit 1 (GitHub Actions oznámí failure).");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ Fatal:", err);
  process.exit(1);
});
