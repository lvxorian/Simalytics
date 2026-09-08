#!/usr/bin/env node
/**
 * Generuje statické profily surovin pro market page („firemní profil“ à la akcie).
 *
 * Zdroje (jen GET, 1 req / 5 s dle oficiálních pravidel):
 *  1. https://www.simcompanies.com/api/v4/en/0/encyclopedia/resources/{quality}/{id}
 *     → producedAt (budova), producedFrom (recept), neededFor (co se z toho vyrábí)
 *  2. Simco Tools /v1/realms/0/resources (cs názvy) – soubor už existuje v DB,
 *     zde jen pro doplnění chybějících jmen.
 *  3. Simco Tools /v1/realms/0/buildings?type=production – mapování id → český název budovy.
 *
 * Výstup: src/lib/resource-profiles.json (import v resource-profiles.ts)
 * Použití: node scripts/generate-resource-profiles.mjs
 */

const SLEEP_MS = 5200; // oficiální pravidlo: max 1 request / 5 s

// Časový rozpočet běhu (s) – po vypršení se stav uloží a skript skončí,
// další spuštění pokračuje tam, kde skončilo (resume).
const BUDGET_S = Number(process.argv[2] ?? 500);

// ── Mapování budov (id → název) ze Simco Tools (36 produkčních budov) ──
async function fetchBuildings() {
  const realm = process.env.SIMCOTOOLS_REALM ?? 0;
  const lang = process.env.SIMCOTOOLS_LANGUAGE ?? "cs";
  const res = await fetch(
    `https://api.simcotools.com/v1/realms/${realm}/buildings?type=production&disable_pagination=true`,
    { headers: { "Accept-Language": lang, Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`SimcoTools buildings HTTP ${res.status}`);
  const data = await res.json();
  const map = {};
  for (const b of data.buildings ?? []) map[b.id] = b.name;
  return map;
}

async function fetchResource(id, quality = 0) {
  const res = await fetch(
    `https://www.simcompanies.com/api/v4/en/0/encyclopedia/resources/${quality}/${id}`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Encyclopedia ${id} HTTP ${res.status}`);
  return res.json();
}

async function main() {
  console.log("1/3 Budovy (Simco Tools, cs)…");
  const buildings = await fetchBuildings();
  console.log(`   ${Object.keys(buildings).length} budov`);

  // Katalog ID: vezmeme z lokální ikon (public/icons/*.png) – 151 souborů
  const { readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const iconsDir = join(process.cwd(), "public", "icons");
  const ids = readdirSync(iconsDir)
    .filter((f) => f.endsWith(".png"))
    .map((f) => Number(f.replace(".png", "")))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
  console.log(`2/3 Encyclopedia API pro ${ids.length} surovin (trvá ~${Math.round((ids.length * SLEEP_MS) / 60000)} min)…`);

  // Resume: existující profily se přeskočí (nově se přepíšou jen chybné null záznamy)
  const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
  const outPath = join(process.cwd(), "src", "lib", "resource-profiles.json");
  const profiles = existsSync(outPath)
    ? JSON.parse(readFileSync(outPath, "utf8"))
    : {};

  const save = () =>
    writeFileSync(outPath, JSON.stringify(profiles, null, 2) + "\n");

  const startedAt = Date.now();
  const remaining = ids.filter(
    (id) => !profiles[id] || profiles[id].name === null
  );
  console.log(
    `   zbývá ${remaining.length} z ${ids.length} (rozpočet ${BUDGET_S}s…`
  );

  let done = 0;
  for (const id of remaining) {
    if ((Date.now() - startedAt) / 1000 > BUDGET_S) {
      save();
      console.log(`⏸ Rozpočet vypršel – uloženo, spusť skript znovu pro pokračování.`);
      process.exit(2);
    }
    let r = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        r = await fetchResource(id);
        break;
      } catch (e) {
        if (attempt === 2) {
          console.warn(`   ⚠ ${id}: ${e.message}`);
        } else {
          await new Promise((s) => setTimeout(s, 15000));
        }
      }
    }
    if (r) {
      profiles[id] = {
        name: r.name ?? null,
        producedAt: r.producedAt ?? null,
        producedAtName: r.producedAt ? buildings[r.producedAt] ?? null : null,
        producedFrom: (r.producedFrom ?? []).map((i) => ({
          id: i.resource.db_letter,
          name: i.resource.name,
          amount: i.amount,
        })),
        neededFor: (r.neededFor ?? []).map((i) => ({
          id: i.db_letter,
          name: i.name,
        })),
        producedAnHour: r.producedAnHour ?? null,
        baseSalary: r.baseSalary ?? null,
      };
      save(); // přírůstkové ukládání po každé položce
    }
    done++;
    if (done % 10 === 0) console.log(`   ${done}/${remaining.length}…`);
    await new Promise((s) => setTimeout(s, SLEEP_MS));
  }

  // ── Doplnění českých názvů z Simco Tools katalogu ──
  console.log("3/3 Doplnění českých názvů (Simco Tools)…");
  const realm = process.env.SIMCOTOOLS_REALM ?? 0;
  const lang = process.env.SIMCOTOOLS_LANGUAGE ?? "cs";
  const res = await fetch(
    `https://api.simcotools.com/v1/realms/${realm}/resources?disable_pagination=true`,
    { headers: { "Accept-Language": lang, Accept: "application/json" } }
  );
  if (res.ok) {
    const data = await res.json();
    const catalog = new Map((data.resources ?? []).map((r) => [r.id, r.name]));
    for (const [id, p] of Object.entries(profiles)) {
      p.nameCs = catalog.get(Number(id)) ?? null;
      for (const inp of p.producedFrom) {
        inp.nameCs = catalog.get(inp.id) ?? null;
      }
      for (const out of p.neededFor) {
        out.nameCs = catalog.get(out.id) ?? null;
        out.name = catalog.get(out.id) ?? out.name;
      }
      // U neededFor přepíšeme i EN název číslem ID (UI si přeloží z DB/CS mapy)
    }
  }

  save();
  console.log(`✅ Uloženo: ${outPath} (${Object.keys(profiles).length} surovin)`);
}

main().catch((e) => {
  console.error("❌ Chyba:", e.message);
  process.exit(1);
});
