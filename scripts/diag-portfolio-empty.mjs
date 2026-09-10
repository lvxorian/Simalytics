#!/usr/bin/env node
/**
 * Read-only diagnostika: proč je portfolio prázdné?
 * – game_warehouse snapshot (co si Simalytics myslí, že je na skladu)
 * – otevřené pozice source='game' per (item, quality)
 * – game_market_orders (jednotky na burze)
 * – poslední eventy z condition_log (co reconcile dělal)
 * – poslední importy (game_imports) – co přišlo ze hry
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
} catch {
  // .env.local nemusí existovat
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ Chybí DATABASE_URL – doplň .env.local.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, connect_timeout: 15 });

console.log("\n═══ 1) SNAPSHOT SKLADU (game_warehouse, quantity > 0) ═══");
const warehouse = await sql`
  select g.item_id, i.name, g.quality, g.quantity, g.unit_cost, g.updated_at
  from game_warehouse g join items i on i.id = g.item_id
  where g.quantity > 0
  order by g.quantity desc
`;
if (warehouse.length === 0) console.log("  (prázdné!)");
for (const r of warehouse) {
  console.log(
    `  ${String(r.item_id).padStart(4)} ${String(r.name).slice(0, 22).padEnd(22)} Q${r.quality}  ${String(r.quantity).padStart(7)} ks  cost=${r.unit_cost ?? "?"}  @ ${new Date(r.updated_at).toISOString()}`
  );
}

console.log("\n═══ 2) OTEVŘENÉ GAME POZICE (source='game', closed_at is null) ═══");
const positions = await sql`
  select p.item_id, i.name, p.quality, sum(p.quantity)::int as qty,
         count(*)::int as lots, min(p.opened_at) as first_opened
  from positions p join items i on i.id = p.item_id
  where p.source = 'game' and p.closed_at is null
  group by p.item_id, i.name, p.quality
  order by qty desc
`;
if (positions.length === 0) console.log("  (prázdné!)");
for (const r of positions) {
  console.log(
    `  ${String(r.item_id).padStart(4)} ${String(r.name).slice(0, 22).padEnd(22)} Q${r.quality}  ${String(r.qty).padStart(7)} ks  (${r.lots} lotů, od ${new Date(r.first_opened).toISOString()})`
  );
}

console.log("\n═══ 2b) VŠECHNY POZICE (i manuál + uzavřené, posledních 15) ═══");
const allPos = await sql`
  select p.id, p.item_id, i.name, p.quality, p.quantity, p.source,
         p.opened_at, p.closed_at
  from positions p join items i on i.id = p.item_id
  order by coalesce(p.closed_at, p.opened_at) desc
  limit 15
`;
for (const r of allPos) {
  console.log(
    `  ${r.source?.padEnd(6)} ${String(r.item_id).padStart(4)} ${String(r.name).slice(0, 18).padEnd(18)} Q${r.quality} ${String(r.quantity).padStart(6)} ks  otevř ${new Date(r.opened_at).toISOString().slice(0, 16)} ${r.closed_at ? `UZAVŘ ${new Date(r.closed_at).toISOString().slice(0, 16)}` : ""}`
  );
}

console.log("\n═══ 3) LIMITKY NA BURZE (game_market_orders) ═══");
const orders = await sql`
  select g.item_id, i.name, g.quality, g.quantity, g.price, g.posted_at
  from game_market_orders g join items i on i.id = g.item_id
  order by g.posted_at desc
`;
if (orders.length === 0) console.log("  (prázdné – žádné limitky v DB)");
for (const r of orders) {
  console.log(
    `  ${String(r.item_id).padStart(4)} ${String(r.name).slice(0, 22).padEnd(22)} Q${r.quality}  ${String(r.quantity).padStart(7)} ks @ ${r.price}  (vloženo ${new Date(r.posted_at).toISOString().slice(0, 16)})`
  );
}

console.log("\n═══ 4) POSLEDNÍ EVENTY LOGU (condition_log, posledních 20) ═══");
const logs = await sql`
  select l.created_at, l.event_type, l.condition_text, p.item_id, i.name, p.source
  from condition_log l
  join positions p on p.id = l.position_id
  join items i on i.id = p.item_id
  order by l.created_at desc
  limit 20
`;
for (const r of logs) {
  console.log(
    `  ${new Date(r.created_at).toISOString().slice(5, 16)} [${r.event_type}] ${String(r.name).slice(0, 18).padEnd(18)} (${r.source}): ${String(r.condition_text).slice(0, 90)}`
  );
}

console.log("\n═══ 5) POSLEDNÍ IMPORTY (game_imports, posledních 10) ═══");
const imports = await sql`
  select received_at, source from game_imports order by received_at desc limit 10
`;
for (const r of imports) {
  console.log(`  ${new Date(r.received_at).toISOString().slice(5, 16)} ${r.source}`);
}

console.log("\n═══ 6) PENDING CASHFLOW (applied_at is null, sum per kind) ═══");
const pending = await sql`
  select kind, count(*)::int as rows, sum(units_unapplied)::int as units
  from game_cashflow
  where applied_at is null and units_unapplied > 0
  group by kind
`;
for (const r of pending) {
  console.log(`  ${r.kind.padEnd(15)} ${String(r.rows).padStart(4)} řádků  ${String(r.units).padStart(8)} ks pending`);
}
if (pending.length === 0) console.log("  (nic pending)");

await sql.end();
console.log("\n✅ Diagnostika dokončena (read-only).\n");
