/**
 * Stáhne ikony všech komodit z oficiálního CDN SimCompanies
 * (https://www.simcompanies.com/static/images/resources/{slug}.png)
 * do public/icons/{id}.png – pak se servírují lokálně (rychle, bez hotlinku).
 *
 * Mapování id → slug je uložené v scripts/resource-slugs.json
 * (array {slug, id} extrahovaný z herního JS bundle).
 * Po stažení přepíše items.image_url na lokální cestu /icons/{id}.png.
 *
 * Použití: npm run icons:download [-- --force]
 */
import { readFileSync } from "node:fs";
import { mkdir, access, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { readEnvLocal } from "./lib/env.mjs";

const FORCE = process.argv.includes("--force");
const OUT_DIR = path.resolve("public/icons");
const CDN = "https://www.simcompanies.com/static/images/resources";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

const dbUrl = readEnvLocal("DATABASE_URL");
if (!dbUrl) {
  console.error("Chybí DATABASE_URL v .env.local");
  process.exit(1);
}

const slugList = JSON.parse(
  await readFileSync(path.resolve("scripts/resource-slugs.json"), "utf8")
);
// resource-slugs.json je array záznamů {slug, id} → normalizujeme na mapu id → slug
const slugs = Object.fromEntries(
  slugList.map((e) => [String(e.id), typeof e === "string" ? e : e.slug])
);

const sql = postgres(dbUrl, { prepare: false, max: 1 });

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(slug, target) {
  const res = await fetch(`${CDN}/${slug}.png`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100 || buf[0] !== 0x89 || buf[1] !== 0x50) {
    throw new Error("není PNG");
  }
  await writeFile(target, buf);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const items = await sql`select id, name from items order by id`;

  let ok = 0;
  let skipped = 0;
  const failed = [];

  for (const item of items) {
    const target = path.join(OUT_DIR, `${item.id}.png`);
    if (!FORCE && (await fileExists(target))) {
      skipped++;
      continue;
    }

    const slug = slugs[String(item.id)];
    if (!slug) {
      failed.push([item.id, item.name, "chybí slug v resource-slugs.json"]);
      continue;
    }

    try {
      await download(slug, target);
      ok++;
      process.stdout.write(`\rStaženo ${ok + skipped}/${items.length}   `);
    } catch (err) {
      failed.push([item.id, item.name, `${slug}.png: ${err.message}`]);
    }
  }

  console.log(`\nHotovo: ${ok} staženo, ${skipped} přeskočeno, ${failed.length} selhalo.`);
  for (const [id, name, why] of failed) {
    console.log(`  ✗ #${id} ${name}: ${why}`);
  }

  // image_url → lokální cesta pro všechny položky, které mají ikonu na disku
  const localIds = new Set(
    (await readdir(OUT_DIR))
      .filter((f) => /^\d+\.png$/.test(f))
      .map((f) => Number(f.replace(".png", "")))
  );
  if (localIds.size > 0) {
    // jednorozměrný text parametr – pole posílaná přes pooler (PgBouncer) selhávala
    const idsText = [...localIds].sort((a, b) => a - b).join(",");
    const updated =
      await sql`update items
                  set image_url = '/icons/' || id || '.png'
                where id = any(string_to_array(${idsText}::text, ',')::int[])
                  and image_url is distinct from ('/icons/' || id || '.png')`;
    console.log(`✅ DB: image_url nastaveno na lokální ikony pro ${updated.count} položek.`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error("Fatální chyba:", err.message);
  process.exit(1);
});
