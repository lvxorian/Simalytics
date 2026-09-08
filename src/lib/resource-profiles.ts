/**
 * Statické profily surovin – „firemní profil“ à la akcie na market page.
 *
 * Data generuje `scripts/generate-resource-profiles.mjs` z oficiální
 * encyclopedia API hry (producedAt/producedFrom/neededFor) a Simco Tools
 * (české názvy, budovy). Regenerace: `node scripts/generate-resource-profiles.mjs`
 * (resume – stahuje jen chybějící; celý běh ~13 min kvůli limitu 1 req/5 s).
 */
import rawProfiles from "./resource-profiles.json";

export type ProfileRef = { id: number; name: string };

export type ResourceProfile = {
  /** Název z encyclopedia API (EN výchozí). */
  name: string | null;
  /** ID výrobní budovy (db_letter, např. „P“ = Farm). */
  producedAt: string | null;
  /** Český název výrobní budovy (ze Simco Tools). */
  producedAtName: string | null;
  /** Recept: vstupy a množství na 1 ks výstupu. */
  producedFrom: { id: number; name: string; amount: number; nameCs: string | null }[];
  /** Co se z této suroviny dále vyrábí. */
  neededFor: ProfileRef[];
  producedAnHour: number | null;
  baseSalary: number | null;
  /** Český název ze Simco Tools katalogu (primární pro UI). */
  nameCs: string | null;
};

const profiles = rawProfiles as Record<string, ResourceProfile>;

export function getResourceProfile(id: number): ResourceProfile | null {
  return profiles[String(id)] ?? null;
}

/** Všech 151 surovin (pro skener/nežluté využití). */
export function getAllResourceProfiles(): Record<string, ResourceProfile> {
  return profiles;
}

// ── Kategorie dle budovy výrobcem (pro badget v profilu) ───────────

/** Budovy primárního výrobu surovin → kategorie. */
const BUILDING_CATEGORY: Record<string, string> = {
  P: "Zemědělství",
  F: "Chov",
  M: "Důl",
  Q: "Kámen",
  O: "Ropa",
  W: "Voda",
  E: "Energie",
  v: "Lesnictví",
  R: "Rafinérie",
  Y: "Výroba",
  L: "Elektronika",
  k: "Potraviny",
  i: "Mlýn",
  j: "Pekárna",
  q: "Kuchyně",
  c: "Chemie",
  h: "Výzkum",
  b: "Šlechtění",
  p: "Rostliny",
  s: "Software",
  a: "Automobily",
  "8": "Aerospace",
  "7": "Aerospace",
  D: "Motory",
  "9": "Integrace",
  "0": "Hangár",
  S: "Doprava",
  o: "Stavebniny",
  x: "Stavebniny",
  g: "Stavebniny",
  f: "Móda",
  T: "Móda",
  m: "Gastro",
  e: "Jatka",
  "6": "Nápoje",
  "1": "Automobily",
};

export function profileCategory(profile: ResourceProfile): string | null {
  if (!profile.producedAt) return null;
  return BUILDING_CATEGORY[profile.producedAt] ?? null;
}

// ── Třída dle počtu vstupů receptu (sandbox → složitá výroba) ──────

export type RecipeClass = {
  label: string;
  /** Barva textu dle konvencí (text-up = jednoduchá/levná výroba). */
  tone: "up" | "neutral" | "down";
};

export function recipeClass(profile: ResourceProfile): RecipeClass {
  const n = profile.producedFrom.length;
  if (n === 0)
    return { label: "Těžená / primární surovina", tone: "up" };
  if (n <= 1) return { label: "Jednoduchá výroba", tone: "up" };
  if (n <= 3) return { label: "Středně složitá výroba", tone: "neutral" };
  return { label: "Složitá výroba (řetězec)", tone: "down" };
}

// ── Czech popis výroby („jak se surovina získává“) ─────────────────

/**
 * Vygeneruje krátký český popis výroby suroviny (bez skloňování názvů –
 * názvy jsou „štítky“, ne větné členy).
 */
export function productionDescription(profile: ResourceProfile): string | null {
  if (!profile.producedAtName) return null;
  if (profile.producedFrom.length === 0) {
    return `Získává se přímo v budově ${profile.producedAtName} – těžba/výroba bez vstupních surovin.`;
  }
  const recipe = profile.producedFrom
    .map((i) => `${i.amount}× ${i.nameCs ?? i.name}`)
    .join(", ");
  return `Vyrábí se v budově ${profile.producedAtName}. Na 1 kus: ${recipe}.`;
}

/** Lokální ikona dle ID (konvence public/icons/{id}.png). */
export function profileIconUrl(id: number): string {
  return `/icons/${id}.png`;
}
