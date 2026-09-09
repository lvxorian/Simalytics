#!/usr/bin/env node
/**
 * Ověření cooldown guardu (anti-duplicita alertů):
 *  1. Vloží test alert (threshold = aktuální cena → hned spustitelný).
 *  2. Otevře SSE na 12 s – hub evaluuje a spustí alert (1×).
 *  3. Přečte z DB last_triggered_at / trigger_count / seen_at.
 *  4. Maže test alert.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

const BASE = process.argv[2] ?? "http://localhost:3100";
const ITEM_ID = 1;

let DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim();
}

const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });
let alertId = null;

const priceRow = await sql`
  select price from price_history
  where item_id = ${ITEM_ID} and quality = 0 and price > 0
  order by recorded_at desc limit 1
`;
const current = Number(priceRow[0].price);

const [alert] = await sql`
  insert into alerts (item_id, quality, kind, direction, threshold, active, note)
  values (${ITEM_ID}, 0, 'price', 'above', ${current}, true, 'TEST cooldown')
  returning id
`;
alertId = alert.id;
console.log(`▸ Alert vložen (${alertId}), threshold = ${current}`);

// SSE 12 s – hub musí běžet, aby evaluoval
const ac = new AbortController();
let alertEvents = 0;
const sse = fetch(`${BASE}/api/live/stream`, { signal: ac.signal }).then(
  async (res) => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (/event: alert/.test(chunk)) {
            alertEvents++;
            console.log(`▸ SSE alert event #${alertEvents}`);
          }
        }
      }
    } catch {
      // aborted
    }
  }
);

await new Promise((r) => setTimeout(r, 12_000));
ac.abort();
await sse.catch(() => {});

const [row] = await sql`
  select trigger_count, last_triggered_at, seen_at from alerts where id = ${alertId}
`;
console.log(
  `▸ DB po 12 s: trigger_count=${row.trigger_count}, last_triggered_at=${row.last_triggered_at?.toISOString?.() ?? row.last_triggered_at}, seen_at=${row.seen_at}`
);
console.log(
  row.trigger_count === 1 && row.last_triggered_at && row.seen_at === null
    ? "✅ Cooldown guard OK: přesně 1 trigger, seen_at resetováno (zvonek ukáže „nové“)"
    : "❌ Cooldown guard: neočekávaný stav"
);

await sql`delete from alerts where id = ${alertId}`;
console.log("▸ Test alert smazán");
await sql.end();
process.exit(0);
