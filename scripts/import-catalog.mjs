#!/usr/bin/env node
/**
 * Import kompletního katalogu zdrojů ze Simco Tools
 * (/v1/realms/0/resources, české názvy) do tabulky items.
 *
 * – Nové položky: track_ticks = false (ticky sbíráme jen pro sledované).
 * – Existující položky: přepíše pouze název (český), kategorie,
 *   ikony a track_ticks zůstávají.
 *
 * Použití: npm run import:catalog
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

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, connect_timeout: 15 });

try {
  const res = await fetch(
    `https://api.simcotools.com/v1/realms/${REALM}/resources?disable_pagination=true`,
    { headers: { "Accept-Language": LANGUAGE, Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`SimcoTools HTTP ${res.status}`);
  const data = await res.json();
  const resources = data.resources ?? [];
  if (resources.length === 0) throw new Error("Katalog je prázdný.");

  const rows = resources.map((r) => ({ id: r.id, name: r.name }));

  await sql`
    insert into items ${sql(rows, "id", "name")}
    on conflict (id) do update set name = excluded.name
  `;

  const [{ count: tracked }] =
    await sql`select count(*)::int as count from items where track_ticks = true`;
  console.log(`✅ Katalog synchronizován: ${rows.length} položek, ${tracked} sleduje ticky.`);
} catch (err) {
  console.error("❌ Chyba:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
