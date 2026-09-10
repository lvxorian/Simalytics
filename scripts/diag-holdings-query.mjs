#!/usr/bin/env node
/**
 * Read-only: spustí PŘESNÝ SQL dotaz z getPortfolioHoldings() a ukáže,
 * jestli padá (tj. .catch(() => []) na stránce = prázdné portfolio)
 * nebo vrací řádky. Plus obsah game_sync_ignored.
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

console.log("\n═══ A) IGNORE-LIST (game_sync_ignored) ═══");
const ignored = await sql`select item_id, i.name from game_sync_ignored g join items i on i.id = g.item_id order by item_id`;
if (ignored.length === 0) console.log("  (prázdný)");
for (const r of ignored) {
  console.log(`  ${String(r.item_id).padStart(4)} ${r.name}`);
}

console.log("\n═══ B) PŘESNÝ DOTAZ z getPortfolioHoldings() ═══");
try {
  const rows = (await sql`
    select p.item_id,
           i.name,
           i.db_letter,
           i.image_url,
           sum(p.quantity)::int                 as quantity,
           (sum(p.buy_price * p.quantity) / sum(p.quantity))::float8 as avg_buy_price,
           latest.price                         as current_price,
           count(p.id)::int                     as position_count,
           min(p.opened_at)                     as first_opened_at,
           max(p.opened_at)                     as last_bought_at,
           (array_agg(p.note) filter (where p.note like 'limit %'))[1] as limit_note,
           gmo.limit_price                        as game_limit_price
    from positions p
    join items i on i.id = p.item_id
    left join lateral (
      select min(price) as limit_price
      from game_market_orders g
      where g.item_id = p.item_id
    ) gmo on true
    left join lateral (
      select price
      from price_history ph
      where ph.item_id = p.item_id and ph.quality = 0
      order by ph.recorded_at desc
      limit 1
    ) latest on true
    where p.closed_at is null
      and not exists (
        select 1 from game_sync_ignored g where g.item_id = p.item_id
      )
    group by p.item_id, i.name, i.db_letter, i.image_url, latest.price,
             gmo.limit_price
    order by (sum(p.buy_price * p.quantity)) desc
    limit 500
  `);
  console.log(`  ✅ Dotaz prošel, řádků: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `  ${String(r.item_id).padStart(4)} ${String(r.name).slice(0, 22).padEnd(22)} Q0 ${String(r.quantity).padStart(7)} ks  avg=${Number(r.avg_buy_price).toFixed(3)}  cur=${r.current_price}  limit=${r.game_limit_price}`
    );
  }
} catch (err) {
  console.log("  ❌ DOTAZ PADÁ – to je příčina prázdného portfolia (.catch(() => []) stránky):");
  console.log(`  ${err.message}`);
}

console.log("\n═══ C) DOTAZ z getPositionLots() (první aktivum) ═══");
try {
  const [first] = await sql`
    select item_id from positions
    where closed_at is null and source = 'game'
    group by item_id order by sum(quantity) desc limit 1
  `;
  if (first) {
    const lots = (await sql`
      select id, quantity, buy_price, opened_at, note
      from positions
      where item_id = ${first.item_id} and closed_at is null
      order by opened_at asc
    `);
    console.log(`  ✅ getPositionLots(${first.item_id}): ${lots.length} lotů`);
  } else {
    console.log("  (žádné otevřené game pozice)");
  }
} catch (err) {
  console.log(`  ❌ getPositionLots PADÁ: ${err.message}`);
}

console.log("\n═══ D) OSTATní dotazy stránky (zdravotní check) ═══");
const checks = [
  ["getGameMarketOrders", sql`select g.id, g.item_id, i.name, g.quality, g.quantity, g.price, g.fees, g.posted_at from game_market_orders g join items i on i.id = g.item_id order by g.posted_at desc`],
  ["getGameSyncIgnored", sql`select item_id from game_sync_ignored`],
];
for (const [name, q] of checks) {
  try {
    const rows = await q;
    console.log(`  ✅ ${name}: ${rows.length} řádků`);
  } catch (err) {
    console.log(`  ❌ ${name} PADÁ: ${err.message}`);
  }
}

await sql.end();
console.log("\n✅ Hotovo (read-only).\n");
