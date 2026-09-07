#!/usr/bin/env node
/**
 * Aplikuje db/seed-names.sql (skutečné názvy/kategorie/ikony komodit)
 * na databázi z DATABASE_URL. Idempotentní.
 *
 * Použití: npm run db:names
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
  // .env.local nemusí existovat (CI) – stačí process.env
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ Chybí DATABASE_URL – doplň .env.local.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, connect_timeout: 15 });

try {
  await sql.file(new URL("../db/seed-names.sql", import.meta.url));

  const items = await sql`select id, name, category from items order by id`;
  console.log(`✅ Katalog komodit aktualizován (${items.length} položek):`);
  for (const item of items) {
    console.log(`   ${String(item.id).padEnd(4)} ${item.name}${item.category ? " · " + item.category : ""}`);
  }
} catch (err) {
  console.error("❌ Chyba:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
