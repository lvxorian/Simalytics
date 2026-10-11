#!/usr/bin/env node
/**
 * LOKÁLNÍ BACKUP svíček z Neonu → CSV soubory u tebe na PC.
 *
 * Proč: druhý, nezávislý zdroj dat. Neon je managed DB – kdyby zkončila
 * (delete, limit free tieru, corrupt, ztráta přístupu), historie denních
 * a weekly/monthly svíček je bez tohoto exportu NA TRVALO pryč (Simco
 * Tools ji nemá hlubší než ~1 rok denně / ~2022 weekly).
 *
 * Co exportuje (per granularita, celé tabulky – jsou malé, ~85k řádků):
 *   1) market_candles_daily    → backups/candles-daily-<date>.csv
 *   2) market_candles_archive  → backups/candles-archive-<date>.csv
 *
 * CSV = nejjednodušší formát, importovatelný do čehkoliv (Excel, Postgres
 * COPY, Python/pandas). Full backup každého běhu (žádné delta) – tabulky
 * jsou malé (nejvýš pár MB), jednoduchost vyhrává nad chytrým diffem.
 * Starší soubory se NEmažou (držíš si historii snapshotů; ať si je
 * dokryješ ručně).
 *
 * Použití: npm run backup:candles
 * (lokálně na PC – CRON na serveru to nechci, backup mimo stroj DB
 * je proti smyslu dvou zdrojů)
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
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

/** CSV escape: uvozovky uvnitř zdvojí, text v uvozovkách, numeric as-is. */
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(header, rows) {
  const lines = [header.join(",")];
  // postgres.js může vracet řádky jako pole i objekty dle konfigurace —
  // normalizujeme vždy na objekty a čteme dle názvů sloupců.
  for (const r of rows) {
    const o = Array.isArray(r)
      ? Object.fromEntries(header.map((k, i) => [k, r[i]]))
      : r;
    lines.push(header.map((k) => csvCell(o[k])).join(","));
  }
  return lines.join("\n") + "\n";
}

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, connect_timeout: 15 });

try {
  const outDir = new URL("../backups/", import.meta.url).pathname
    .replace(/^\/([A-Za-z]:)/, "$1"); // Windows path fix (git bash /c/ → C:/)
  mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // ── 1) Denní svíčky ─────────────────────────────────────────────────
  const daily = await sql`
    select resource_id, quality, day::text as day, open, high, low, close,
           volume, vwap
    from market_candles_daily
    order by resource_id, quality, day
  `;
  const dailyCsv = rowsToCsv(
    ["resource_id", "quality", "day", "open", "high", "low", "close", "volume", "vwap"],
    daily
  );
  const dailyPath = `${outDir}/candles-daily-${stamp}.csv`;
  writeFileSync(dailyPath, dailyCsv);
  console.log(`✔ denní: ${daily.length} řádků → candles-daily-${stamp}.csv`);

  // ── 2) Archivní (1W/1M) svíčky ──────────────────────────────────────
  const archive = await sql`
    select resource_id, quality, granularity, bucket_start::text as bucket_start,
           open, high, low, close, volume
    from market_candles_archive
    order by resource_id, quality, granularity, bucket_start
  `;
  const archiveCsv = rowsToCsv(
    ["resource_id", "quality", "granularity", "bucket_start", "open", "high", "low", "close", "volume"],
    archive
  );
  const archivePath = `${outDir}/candles-archive-${stamp}.csv`;
  writeFileSync(archivePath, archiveCsv);
  console.log(`✔ archiv: ${archive.length} řádků → candles-archive-${stamp}.csv`);

  console.log(`\n🏁 Backup hotový (${stamp}) – adresář backups/`);
} catch (err) {
  console.error("❌ Chyba:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
