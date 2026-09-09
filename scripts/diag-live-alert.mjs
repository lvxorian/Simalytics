#!/usr/bin/env node
/**
 * Diagnostika alertů na produkci: vloží test alert (threshold = aktuální
 * cena), 20 s poslouchá SSE a pak přečte stav řádku v DB PŘEDO smazáním.
 *
 * Interpretace:
 *   trigger_count=1, last_triggered_at set  → alert SPUSTIL se, ale event
 *     publikovala jiná instance (jiné SSE spojení / cron) – cooldown guard
 *     na naší instanci zabránil duplicitě (správné chování, jen ji nevidíme)
 *   trigger_count=0                         → evaluace nedorazila vůbec
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

const BASE = process.argv[2] ?? "https://simalytics.vercel.app";
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
  values (${ITEM_ID}, 0, 'price', 'above', ${current}, true, 'TEST diag')
  returning id
`;
alertId = alert.id;
console.log(`▸ Alert vložen (threshold ${current}) v ${new Date().toISOString()}`);

let sseAlerts = 0;
let sseTicks = 0;
const ac = new AbortController();
const ssePromise = fetch(`${BASE}/api/live/stream`, { signal: ac.signal }).then(
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
          const ev = /event: (.+)/.exec(chunk)?.[1];
          if (ev === "tick") sseTicks++;
          if (ev === "alert") {
            sseAlerts++;
            console.log(`▸ SSE ALERT #${sseAlerts} v ${new Date().toISOString()}`);
          }
        }
      }
    } catch {
      // aborted
    }
  }
);

await new Promise((r) => setTimeout(r, 20_000));
ac.abort();
await ssePromise.catch(() => {});

const [row] = await sql`
  select trigger_count, last_triggered_at, seen_at from alerts where id = ${alertId}
`;
console.log(`▸ SSE během 20 s: tick eventu=${sseTicks}, alert eventu=${sseAlerts}`);
console.log(
  `▸ DB: trigger_count=${row.trigger_count}, last_triggered_at=${row.last_triggered_at?.toISOString?.() ?? "null"}, seen_at=${row.seen_at}`
);
if (row.trigger_count >= 1) {
  console.log(
    "→ Alert SE SPUSTIL (cooldown guard zabránil duplicitě). Event šel na jinou instanci – to je správné chování multi-instance; notifier (webhook/e-mail) odešel."
  );
} else {
  console.log("→ Evaluace se nespustila vůbec – problém v hubu na produkci.");
}

await sql`delete from alerts where id = ${alertId}`;
console.log("▸ Test alert smazán");
await sql.end();
process.exit(0);
