#!/usr/bin/env node
/**
 * Test latence live alertů (Fáze 3) – spouštěj jen proti DEV serveru.
 *
 * Postup:
 *  1. Načte DB URL z .env.local (nebo DATABASE_URL env).
 *  2. Vloží testovací alert: item 1 (Energie), kind 'price', direction
 *     'above', threshold = aktuální cena (spustí se hned při prvním
 *     evaluaci, protože cena >= práh).
 *  3. Otevře SSE /api/live/stream a měří čas do event 'alert'.
 *  4. Smaže testovací alert (konečně, i při chybě/timeoutu).
 *
 * Použití: node scripts/test-live-alert.mjs [http://localhost:3100]
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";

const BASE = process.argv[2] ?? "http://localhost:3100";
const ITEM_ID = 1;

// ── .env.local ──────────────────────────────────────────────────────
let DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim();
  } catch {
    // ignore
  }
}
if (!DATABASE_URL) {
  console.error("❌ Chybí DATABASE_URL (.env.local nebo env)");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });
let alertId = null;

function now() {
  return Date.now();
}

async function main() {
  // ── 1. Aktuální cena položky (z DB, tak jako SSR) ──────────────────
  const priceRow = await sql`
    select price from price_history
    where item_id = ${ITEM_ID} and quality = 0 and price > 0
    order by recorded_at desc limit 1
  `;
  const current = Number(priceRow[0]?.price);
  if (!(current > 0)) {
    console.error("❌ Nemám aktuální cenu itemu 1");
    process.exit(1);
  }
  // Práh = aktuální cena (direction 'above' → podmínka price >= threshold
  // je hned splněná → spustí se při PŘÍŠTÍ evaluaci hubu, kterou stejně
  // vyvolají změny na jiných položkách). Tak testujeme pipeline, ne trh.
  const threshold = current;
  console.log(
    `▸ Aktuální cena itemu ${ITEM_ID}: ${current} → alert threshold ${threshold} (above, roven ceně = spustí se hned)`
  );

  // ── 2. Vložení testovacího alertu ──────────────────────────────────
  const [alert] = await sql`
    insert into alerts (item_id, quality, kind, direction, threshold, active, note)
    values (${ITEM_ID}, 0, 'price', 'above', ${threshold}, true, 'TEST – smaž mě')
    returning id
  `;
  alertId = alert.id;
  console.log(`▸ Alert vložen: ${alertId}`);

  // ── 3. SSE posluchač + měření latence ─────────────────────────────
  const t0 = now();
  let gotAlert = null;
  let gotTick = null;

  const res = await fetch(`${BASE}/api/live/stream`);
  if (!res.ok || !res.body) {
    throw new Error(`SSE HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve("timeout"), 45_000)
  );

  const readLoop = (async () => {
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
          const data = /data: (.+)/.exec(chunk)?.[1];
          if (!ev || !data) continue;
          const parsed = JSON.parse(data);
          if (ev === "tick" && !gotTick) {
            gotTick = now();
            console.log(
              `▸ tick event  +${gotTick - t0} ms (${parsed.items?.length ?? 0} změn)`
            );
          }
          if (ev === "alert") {
            gotAlert = now();
            const a = parsed.alerts?.[0];
            console.log(
              `▸ ALERT event +${gotAlert - t0} ms → ${a?.item_name} ${a?.direction} ${a?.threshold} (cena ${a?.price})`
            );
            reader.cancel().catch(() => {});
            return;
          }
        }
      }
    } catch {
      // stream ukončen
    }
  })();

  const result = await Promise.race([readLoop.then(() => "done"), timeout]);

  if (result === "timeout" || !gotAlert) {
    console.log(
      "⚠ Timeout 45 s – alert nespustil se. Zkusím evaluaci RESTem…"
    );
    reader.cancel().catch(() => {});
    // REST fallback evaluace (okamžitá)
    const r = await fetch(`${BASE}/api/live`);
    const d = await r.json();
    if (d.alerts?.length > 0) {
      const a = d.alerts[0];
      console.log(
        `▸ REST ALERT → ${a.item_name} ${a.direction} ${a.threshold} (cena ${a.price})`
      );
    } else {
      console.log("▸ REST: žádný alert – evaluace nedorazila.");
    }
  } else {
    const lat = gotAlert - t0;
    console.log(
      `\n✅ Latence alertu od připojení SSE: ${lat} ms` +
        (gotTick ? ` (první tick za ${gotTick - t0} ms)` : "")
    );
  }
}

try {
  await main();
} finally {
  // ── 4. Úklid ───────────────────────────────────────────────────────
  if (alertId) {
    await sql`delete from alerts where id = ${alertId}`;
    console.log("▸ Testovací alert smazán");
  }
  await sql.end();
  // SSE spojení drží event loop živý – ukončíme explicitně
  process.exit(0);
}
