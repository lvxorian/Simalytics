/**
 * SEZONALITA – výpočetní vrstva (Seasonax / TradingView styl).
 *
 * Vstup: měsíční uzávěry (getMonthlyCloses – archiv 1M od 2022-02 +
 * čerstvý měsíc z denních svíček). Výstup: monthly returns heatmapa,
 * průměr/medián per měsíc, % pozitivních let, roční rozpad.
 *
 * Konvence vypočtu (shodná s broker/trading nástroji):
 *   - výnos měsíce M = close(M) / close(M−1) − 1 (logický závěr
 *     předchozího měsíce, NIKDY první dostupný měsíc bez předchůdce),
 *   - rok bez plných 12 výnosů se do ročního součtu nepočítá
 *     (compounding jen z kompletních let),
 *   - průměr/medián per měsíc počítá ze všech dostupných let (min. 2
 *     pozorování, jinak statistika nemá význam a vrací se null).
 */

import type { MonthlyClose } from "@/lib/data";
import type { SimcoPhaseRange } from "@/lib/simcotools";

export const MONTH_LABELS = [
  "Led",
  "Úno",
  "Bře",
  "Dub",
  "Kvě",
  "Čer",
  "Čvc",
  "Srp",
  "Září",
  "Říj",
  "Lis",
  "Pro",
] as const;

const MONTHS_COUNT = 12;

export type SeasonalityRow = {
  year: number;
  /** Výnos per měsíc (1 = leden) – null = data nejsou. */
  returns: (number | null)[];
  /** Celoroční výnos (compounding) – jen kompletní rok (12 výnosů). */
  yearReturn: number | null;
};

export type SeasonalityStats = {
  /** Průměr výnosu per měsíc (1–12), null při < 2 pozorováních. */
  avg: (number | null)[];
  /** Medián výnosu per měsíc, null při < 2 pozorováních. */
  median: (number | null)[];
  /** % let, kdy byl měsíc pozitivní (0–100), null při < 2 pozorováních. */
  positivePct: (number | null)[];
  /** Kolik let dat je k dispozici per měsíc. */
  years: number[];
  /** Kolik měsíců historie celkem (vstupních uzávěrů). */
  monthsOfData: number;
  /** Rozsah dat (první–poslední měsíc, YYYY-MM). */
  rangeFrom: string | null;
  rangeTo: string | null;
};

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Vypočte monthly returns + statistiky z měsíčních uzávěrů.
 * Očekává VZESTUPNĚ seřazené uzávěry (jak vrací getMonthlyCloses).
 */
export function computeSeasonality(
  closes: MonthlyClose[]
): { rows: SeasonalityRow[]; stats: SeasonalityStats } {
  // Výnosy per rok → pole 1–12.
  const byYear = new Map<number, (number | null)[]>();
  let rangeFrom: string | null = null;
  let rangeTo: string | null = null;

  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    // Kontinuita měsíců: výnos jen mezi sousedními měsíci (YYYY-MM).
    const expected = nextMonthKey(prev.month);
    if (cur.month !== expected) continue; // mezera v datech → přeskočit

    const year = Number(cur.month.slice(0, 4));
    const m = Number(cur.month.slice(5, 7));
    if (!Number.isFinite(prev.close) || !Number.isFinite(cur.close) || prev.close <= 0) {
      continue;
    }
    const r = cur.close / prev.close - 1;
    let arr = byYear.get(year);
    if (!arr) {
      arr = new Array(MONTHS_COUNT).fill(null);
      byYear.set(year, arr);
    }
    arr[m - 1] = r;
  }

  const rows: SeasonalityRow[] = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, returns]) => {
      const complete = returns.every((r) => r !== null);
      const yearReturn = complete
        ? returns.reduce((acc, r) => acc * (1 + (r as number)), 1) - 1
        : null;
      return { year, returns, yearReturn };
    });

  // Statistiky per měsíc.
  const avg: (number | null)[] = new Array(MONTHS_COUNT).fill(null);
  const med: (number | null)[] = new Array(MONTHS_COUNT).fill(null);
  const pos: (number | null)[] = new Array(MONTHS_COUNT).fill(null);
  const years: number[] = new Array(MONTHS_COUNT).fill(0);

  for (let m = 1; m <= MONTHS_COUNT; m++) {
    const vals: number[] = [];
    for (const [, arr] of byYear) {
      const v = arr[m - 1];
      if (v !== null) vals.push(v);
    }
    years[m - 1] = vals.length;
    if (vals.length < 2) continue;
    avg[m - 1] = vals.reduce((s, v) => s + v, 0) / vals.length;
    med[m - 1] = median([...vals].sort((a, b) => a - b));
    pos[m - 1] = (vals.filter((v) => v > 0).length / vals.length) * 100;
  }

  if (closes.length > 0) {
    rangeFrom = closes[0].month;
    rangeTo = closes[closes.length - 1].month;
  }

  return {
    rows,
    stats: {
      avg,
      median: med,
      positivePct: pos,
      years,
      monthsOfData: closes.length,
      rangeFrom,
      rangeTo,
    },
  };
}

/** YYYY-MM → následující měsíc (pro kontrolu kontinuity). */
function nextMonthKey(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return `${nextY}-${String(nextM).padStart(2, "0")}`;
}

// ── HERNÍ FÁZE (overlay heatmapy) ───────────────────────────────

/**
 * Dominantní herní fáze per (rok, měsíc) – pro overlay heatmapy.
 *
 * Fáze ekonomiky (normal/boom/recession) trvají v průměru ~16 dní, takže
 * měsíc může překrývat 2–3 fáze. Dominantní = fáze s NAJVÍCE DNY
 * pokrytí v daném měsíci (hraniční dny se počítají dle polovičních
 * intervalů – start fáze je inkluzivní, end exkluzivní).
 *
 * Klíč `YYYY-MM`. Hodnota: fáze + podíl dní (0–1) pro tooltip.
 */
export function computeMonthlyPhases(
  ranges: SimcoPhaseRange[]
): Map<string, { phase: "normal" | "boom" | "recession"; share: number; days: Record<string, number> }> {
  const byMonth = new Map<
    string,
    { days: Record<string, number>; total: number }
  >();

  const pushDay = (monthKey: string, phase: string, days: number) => {
    let entry = byMonth.get(monthKey);
    if (!entry) {
      entry = { days: {}, total: 0 };
      byMonth.set(monthKey, entry);
    }
    entry.days[phase] = (entry.days[phase] ?? 0) + days;
    entry.total += days;
  };

  for (const r of ranges) {
    const start = new Date(r.start);
    const end = new Date(r.end); // end exkluzivní (další fáze tím začíná)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (end <= start) continue;

    // Projdi měsíce, které fáze překrývá (stride po měsíci od startu).
    const cursor = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
    );
    while (cursor < end) {
      const monthEnd = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1)
      );
      const overlapStart = start > cursor ? start : cursor;
      const overlapEnd = end < monthEnd ? end : monthEnd;
      const overlapDays =
        (overlapEnd.getTime() - overlapStart.getTime()) / 86_400_000;
      if (overlapDays > 0) {
        pushDay(
          `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`,
          r.phase,
          overlapDays
        );
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }

  const result = new Map<
    string,
    { phase: "normal" | "boom" | "recession"; share: number; days: Record<string, number> }
  >();
  for (const [key, entry] of byMonth) {
    if (entry.total <= 0) continue;
    // Dominantní fáze = nejvíce dní (remíza: boom > normal > recession –
    // řazení dle herní vlivnosti na ceny).
    const order: Record<string, number> = { boom: 0, normal: 1, recession: 2 };
    const sorted = Object.entries(entry.days).sort(
      (a, b) => b[1] - a[1] || order[a[0]] - order[b[0]]
    );
    const [phase, days] = sorted[0];
    result.set(key, {
      phase: phase as "normal" | "boom" | "recession",
      share: days / entry.total,
      days: entry.days,
    });
  }
  return result;
}

// ── DAY-OF-WEEK SEZONALITA ────────────────────────────────────────

export const DOW_LABELS = [
  "Po",
  "Út",
  "St",
  "Čt",
  "Pá",
  "So",
  "Ne",
] as const;

export type DowStats = {
  /** Průměrný denní výnos per den (0 = pondělí), null při < 5 pozorováních. */
  avg: (number | null)[];
  /** Medián denního výnosu per den, null při < 5 pozorováních. */
  median: (number | null)[];
  /** % dní s pozitivním výnosem (0–100), null při < 5 pozorováních. */
  positivePct: (number | null)[];
  /** Počet pozorování per den. */
  n: number[];
  /** Celkový počet denních výnosů ve vstupu. */
  totalReturns: number;
  /** Rozsah dat (YYYY-MM-DD první/poslední den). */
  rangeFrom: string | null;
  rangeTo: string | null;
};

/**
 * Day-of-week sezonalita z denních uzávěrů.
 *
 * Vstup: denní svíčky (getDailyCandles – backfill ~365 dní). Výnos dne
 * = close(d) / close(předchozího obchodního dne) − 1; každý výnos se
 * připíše DNI TOHO DNE, KTERÝ HO DĚLAL (tzn. pondělní výnos = rozdíl
 * proti pátečnímu uzávěru – přes víkend se nepočítá nic, hra jede i
 * o víkendu, ale data mohou mít mezery).
 *
 * Min. 5 pozorování na den (z ~52 týdnů = 51 možných) – pod tím se
 * statistika nevypisuje.
 */
export function computeDowSeasonality(dailyCloses: { day: string; close: number }[]): DowStats {
  const byDow: number[][] = [[], [], [], [], [], [], []];
  let rangeFrom: string | null = null;
  let rangeTo: string | null = null;
  let total = 0;

  for (let i = 1; i < dailyCloses.length; i++) {
    const prev = dailyCloses[i - 1];
    const cur = dailyCloses[i];
    if (!Number.isFinite(prev.close) || !Number.isFinite(cur.close) || prev.close <= 0) {
      continue;
    }
    // Kontinuita: jen sousední dny (sousedé v poli = sousední obchodní dny,
    // pole je seřazené dle `day`). Bez kontroly kalendářní vzdálenosti –
    // víkendová mezera je OK (pondělí se měří proti pátku).
    const r = cur.close / prev.close - 1;
    // Den v týdnu z YYYY-MM-DD – Date v UTC (dny v DB jsou UTC bucket).
    const dow = new Date(`${cur.day}T00:00:00Z`).getUTCDay(); // 0=Ne
    const idx = dow === 0 ? 6 : dow - 1; // 0=Po … 6=Ne
    byDow[idx].push(r);
    if (rangeFrom === null) rangeFrom = cur.day;
    rangeTo = cur.day;
    total++;
  }

  const avg: (number | null)[] = new Array(7).fill(null);
  const med: (number | null)[] = new Array(7).fill(null);
  const pos: (number | null)[] = new Array(7).fill(null);
  const n: number[] = byDow.map((arr) => arr.length);

  for (let d = 0; d < 7; d++) {
    const vals = byDow[d];
    if (vals.length < 5) continue;
    avg[d] = vals.reduce((s, v) => s + v, 0) / vals.length;
    med[d] = median([...vals].sort((a, b) => a - b));
    pos[d] = (vals.filter((v) => v > 0).length / vals.length) * 100;
  }

  return {
    avg,
    median: med,
    positivePct: pos,
    n,
    totalReturns: total,
    rangeFrom,
    rangeTo,
  };
}
