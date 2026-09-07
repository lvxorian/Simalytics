#!/usr/bin/env node
/**
 * Aplikuje všechny migrační soubory z db/upgrades/*.sql (v abecedním
 * pořadí) na databázi z DATABASE_URL. Všechny migrace musí být
 * idempotentní (if not exists / or replace).
 *
 * Použití: npm run db:upgrade
 */

import { readdirSync, readFileSync } from "node:fs";
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
  // .env.local nemusí existovat (CI)
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ Chybí DATABASE_URL – doplň .env.local.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, connect_timeout: 15 });

const upgradesDir = new URL("../db/upgrades/", import.meta.url);
const files = readdirSync(upgradesDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

try {
  for (const file of files) {
    process.stdout.write(`⏳ ${file} … `);
    await sql.file(new URL(`../db/upgrades/${file}`, import.meta.url));
    console.log("✅");
  }
  console.log(`🎉 Hotovo (${files.length} migrací).`);
} catch (err) {
  console.error("❌ Chyba:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
