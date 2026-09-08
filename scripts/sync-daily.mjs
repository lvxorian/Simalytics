#!/usr/bin/env node
/**
 * Denní sync pro Signal Engine (fáze 1) – stejná logika jako
 * /api/cron/daily, ale pro lokální spuštění a GitHub Actions:
 *
 *   1. market/vwaps    → market_vwap_daily (celý trh v 1 requestu)
 *   2. contests        → contests (historie od 2019)
 *   3. certificates    → cert_kinds (referenční data)
 *
 * Spouštěj 1× denně. Použití: npm run sync:daily
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
const LANGUAGE = process.env.SIMCOTOOLS_LANGUAGE ?? "cs";
const BASE = "https://api.simcotools.com";
const sql = postgres(DATABASE_URL, { max: 1, prepare: false, connect_timeout: 15 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "Accept-Language": LANGUAGE },
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

const today = new Date().toISOString().slice(0, 10);

try {
  const items = await sql`select id from items`;
  const known = new Set(items.map((r) => r.id));

  // ── 1) VWAP – celý trh v jednom requestu ─────────────────────────
  const vwapData = await fetchJson(`${BASE}/v1/realms/${REALM}/market/vwaps`);
  const vwapRows = (vwapData.vwaps ?? [])
    .filter(
      (v) =>
        known.has(v.resourceId) && v.quality >= 0 && v.quality <= 7 && v.vwap > 0
    )
    .map((v) => ({
      resource_id: v.resourceId,
      quality: v.quality,
      day: v.datetime.slice(0, 10),
      vwap: v.vwap,
    }));

  let vwapCount = 0;
  if (vwapRows.length > 0) {
    const result = await sql`
      insert into market_vwap_daily ${sql(vwapRows, "resource_id", "quality", "day", "vwap")}
      on conflict (resource_id, quality, day) do update set vwap = excluded.vwap
    `;
    vwapCount = result.count;
  }
  console.log(`✔ VWAP: ${vwapCount} řádků (z ${vwapRows.length} nových)`);

  await sleep(600);

  // ── 2) Contests ──────────────────────────────────────────────────
  const contestData = await fetchJson(
    `${BASE}/v1/realms/${REALM}/contests?disable_pagination=true`
  );
  const contestRows = (contestData.contests ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    resource_id:
      c.resourceId !== undefined && known.has(c.resourceId) ? c.resourceId : null,
    building_id: c.buildingId ?? null,
    start_date: c.startDate.slice(0, 10),
    end_date: c.endDate.slice(0, 10),
    is_active: c.startDate.slice(0, 10) <= today && today <= c.endDate.slice(0, 10),
  }));

  let contestCount = 0;
  if (contestRows.length > 0) {
    const result = await sql`
      insert into contests ${sql(
        contestRows,
        "id",
        "name",
        "resource_id",
        "building_id",
        "start_date",
        "end_date",
        "is_active"
      )}
      on conflict (id) do update set
        name = excluded.name,
        resource_id = excluded.resource_id,
        building_id = excluded.building_id,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        is_active = excluded.is_active,
        synced_at = now()
    `;
    contestCount = result.count;
  }
  const active = contestRows.filter((c) => c.is_active).length;
  console.log(`✔ Contests: ${contestCount} uloženo (${active} aktivních)`);

  await sleep(600);

  // ── 3) Cert kinds ────────────────────────────────────────────────
  const certData = await fetchJson(`${BASE}/v1/realms/${REALM}/certificates`);
  const certRows = (certData.certificates_kinds ?? []).map((k) => ({
    kind: k.kind,
    relevant: k.relevant,
    resource_ids: k.resources ?? [],
  }));

  let certCount = 0;
  if (certRows.length > 0) {
    const result = await sql`
      insert into cert_kinds ${sql(certRows, "kind", "relevant", "resource_ids")}
      on conflict (kind) do update set
        relevant = excluded.relevant,
        resource_ids = excluded.resource_ids,
        synced_at = now()
    `;
    certCount = result.count;
  }
  console.log(`✔ Cert kinds: ${certCount} uloženo`);

  console.log(`\n🏁 Denní sync hotový.`);
} catch (err) {
  console.error("❌ Chyba:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
