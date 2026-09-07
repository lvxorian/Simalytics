#!/usr/bin/env node
/**
 * Aplikuje db/schema.sql na databázi z DATABASE_URL.
 *
 * Použití:
 *   npm run db:schema
 *
 * Skript je idempotentní (schema.sql používá create if not exists),
 * takže ho můžeš spustit opakovaně bez poškození dat.
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";

// Nahraj .env.local, pokud skript neběží v CI (tam stačí process.env)
function loadEnvFile() {
  try {
    const content = readFileSync(
      new URL("../.env.local", import.meta.url),
      "utf8"
    );
    for (const line of content.split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env.local nemusí existovat (CI) – stačí process.env
  }
}

loadEnvFile();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "❌ Chybí DATABASE_URL – doplň .env.local (viz .env.example)."
  );
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  max: 1,
  prepare: false, // kompatibilita s Neon pooled connection (PgBouncer)
  connect_timeout: 15,
});

try {
  await sql.file(new URL("../db/schema.sql", import.meta.url));
  console.log("✅ db/schema.sql aplikováno.");

  const [{ count }] = await sql`select count(*)::int as count from items`;
  console.log(`✅ Ověření: v tabulce items je ${count} položek.`);
  console.log("🎉 Databáze je připravená – spusť npm run fetch:market");
} catch (err) {
  console.error("❌ Chyba při aplikaci schématu:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
