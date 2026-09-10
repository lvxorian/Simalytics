#!/usr/bin/env node
/**
 * End-to-end test Fáze 4 – LIMITKY NA BURZE.
 *
 * Simuluje userscript push (source 'market_orders') na /api/import/sync
 * a ověří celý tok:
 *   1. stav DB PŘED (otevřené game pozice, nabídky, hlídky),
 *   2. POST nabídky (cena = poslední tick Q0 × 1.05, reálný scénář),
 *   3. DB PO: game_market_orders řádek + hlídka alerts kind='limit_sell'
 *      (threshold = cena nabídky) + NOTE v condition_logu,
 *   4. UI: GET /portfolio obsahuje sekci „Limitky na burze" + položku,
 *   5. Úklid: prázdný snapshot (jako když uživatel limitky zruší) →
 *      nabídky i hlídka zmizí (NOTE v logu zůstává – dedupe dle textu).
 *
 * Použití:
 *   node scripts/test-market-orders.mjs [baseUrl] [--keep]
 *   baseUrl  default https://simalytics.vercel.app
 *   --keep   nemaž testovací data (bez úklidu)
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

// ── env (.env.local nemusí existovat v CI) ──────────────────────────
try {
  const content = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // bez .env.local
}

const DATABASE_URL = process.env.DATABASE_URL;
const GAME_SYNC_SECRET = process.env.GAME_SYNC_SECRET;
if (!DATABASE_URL || !GAME_SYNC_SECRET) {
  console.error("❌ Chybí DATABASE_URL nebo GAME_SYNC_SECRET v .env.local.");
  process.exit(1);
}

const args = process.argv.slice(2);
const KEEP = args.includes("--keep");
const BASE =
  args.find((a) => !a.startsWith("--")) ?? "https://simalytics.vercel.app";

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, connect_timeout: 15 });
const ok = (cond, label) =>
  console.log(`${cond ? "✅" : "❌"} ${label}`);

// ── 1) Stav PŘED ────────────────────────────────────────────────────
console.log(`\n═══ 1) STAV PŘED (base: ${BASE}${KEEP ? ", --keep" : ""}) ═══`);

const gameLots = (await sql`
  select p.item_id, i.name, sum(p.quantity)::int as qty, count(*)::int as lots
  from positions p join items i on i.id = p.item_id
  where p.closed_at is null and p.source = 'game'
  group by p.item_id, i.name
  order by qty desc
`);
console.log(
  `  Otevřené game pozice: ${gameLots.length} položek → ` +
    gameLots.slice(0, 5).map((g) => `${g.name} ${g.qty.toLocaleString("cs-CZ")} ks`).join(", ")
);
if (gameLots.length === 0) {
  console.error("❌ Žádné otevřené game pozice – test nemá smysl (NOTE + hlídka se nevytvoří).");
  process.exit(1);
}

const ordersBefore = (await sql`select count(*)::int as n from game_market_orders`)[0].n;
const alertsBefore = (await sql`select count(*)::int as n from alerts where kind = 'limit_sell'`)[0].n;
console.log(`  game_market_orders: ${ordersBefore} řádků, hlídky limit_sell: ${alertsBefore}`);

// Položka testu: první game pozice (největší držba)
const target = gameLots[0];
const [tick] = (await sql`
  select price from price_history
  where item_id = ${target.item_id} and quality = 0 and price is not null
  order by recorded_at desc limit 1
`);
if (!tick) {
  console.error(`❌ Položka ${target.name} nemá tick s cenou – nelze odhadnout limit.`);
  process.exit(1);
}
const lastPrice = Number(tick.price);
const limitPrice = Math.round(lastPrice * 1.05 * 1000) / 1000; // +5 % nad trh
console.log(
  `  Cíl: ${target.name} (${target.item_id}) – poslední obchod ${lastPrice} $, testovací limit ${limitPrice} $ (+5 %)`
);

// ── 2) POST jako userscript ─────────────────────────────────────────
console.log(`\n═══ 2) PUSH source='market_orders' ═══`);
const orderId = 9_900_000_000 + Math.floor(Math.random() * 99_999_999); // izolované id
const payload = {
  source: "market_orders",
  orders: [
    {
      id: orderId,
      kind: target.item_id, // ve hře = ID komodity
      quantity: Math.min(100, target.qty),
      quality: 0,
      price: limitPrice,
      posted: new Date().toISOString(),
      fees: 0,
    },
  ],
};
const res = await fetch(`${BASE}/api/import/sync`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${GAME_SYNC_SECRET}`,
  },
  body: JSON.stringify(payload),
});
const body = await res.json();
ok(res.ok, `POST /api/import/sync → ${res.status} ${JSON.stringify(body)}`);
if (!res.ok) process.exit(1);

// ── 3) DB PO pushi ──────────────────────────────────────────────────
console.log(`\n═══ 3) DB PO PUSHI ═══`);
const [order] = (await sql`
  select id, item_id, quantity, price from game_market_orders where id = ${orderId}
`);
ok(!!order && Number(order.price) === limitPrice && order.item_id === target.item_id,
  `game_market_orders řádek (id ${orderId}, item ${target.item_id}, cena ${order?.price})`);

const [alert] = (await sql`
  select threshold, active from alerts
  where item_id = ${target.item_id} and kind = 'limit_sell'
`);
ok(!!alert && Number(alert.threshold) === limitPrice && alert.active,
  `hlídka alerts kind='limit_sell' (threshold ${alert?.threshold}, active ${alert?.active})`);

const [note] = (await sql`
  select condition_text from condition_log cl
  join positions p on p.id = cl.position_id
  where p.item_id = ${target.item_id} and p.closed_at is null and p.source = 'game'
    and cl.event_type = 'NOTE' and cl.condition_text like 'Limitka na burze%'
  order by cl.created_at desc limit 1
`);
ok(!!note, `NOTE v logu obchodů: „${note?.condition_text.slice(0, 60)}…"`);
ok(body.skipped === 0 && body.order_count === 1,
  `API report: order_count=${body.order_count}, skipped=${body.skipped}` +
    ` (logged=${body.logged}, watch_updated=${body.watch_updated} – při rerunu\n` +
    `   s identickými daty správně 0: dedupe dle textu/thresholdu)`);

// ── 4) UI /portfolio ────────────────────────────────────────────────
console.log(`\n═══ 4) UI /PRODUKCI ═══`);
const html = await (await fetch(`${BASE}/portfolio`)).text();
ok(html.includes("Limitky na burze"), "sekce „Limitky na burze“ se renderuje");
ok(html.includes(target.name), `badge/řádek obsahuje položku ${target.name}`);

// ── 5) Úklid (prázdný snapshot = zrušené limitky) ───────────────────
if (!KEEP) {
  console.log(`\n═══ 5) ÚKLID (prázdný snapshot) ═══`);
  const res2 = await fetch(`${BASE}/api/import/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${GAME_SYNC_SECRET}`,
    },
    body: JSON.stringify({ source: "market_orders", orders: [] }),
  });
  ok(res2.ok, `prázdný snapshot → ${res2.status} ${JSON.stringify(await res2.json())}`);

  const ordersAfter = (await sql`select count(*)::int as n from game_market_orders`)[0].n;
  const alertAfter = (await sql`
    select count(*)::int as n from alerts
    where item_id = ${target.item_id} and kind = 'limit_sell'
  `)[0].n;
  ok(ordersAfter === 0, `game_market_orders po úklidu: ${ordersAfter} (očekáváno 0)`);
  ok(alertAfter === 0, `hlídka limit_sell po úklidu: ${alertAfter} (očekáváno 0)`);
  console.log("  (NOTE v logu obchodů zůstává – historie, dedupe dle textu)");
} else {
  console.log(`\n⏭  --keep: testovací data zůstávají (order id ${orderId}).`);
}

await sql.end();
console.log("\n═══ HOTOVO ═══");
