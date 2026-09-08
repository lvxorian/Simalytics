/**
 * Metriky likvidity a volatility aktiva.
 *
 * Likvidita = jak moc se aktivum obchoduje. Nemáme order book, takže
 * pracujeme s proxy:
 *  - frekvence obchodů: počet DISTINCT časů obchodů za den z našich ticků
 *    (poller ukládá `datetime` ze Simco Tools = čas posledního obchodu),
 *  - obrat: průměrný denní objem (denní svíčky ze Simco Tools) × cena.
 *
 * Volatilita = směrodatná odchylka výnosů mezi svíčkami (close-to-close).
 * Pro srovnatelnost mezi TF se normalizuje na roční období (√počet svíček
 * za rok) – klasická "annualized volatility" z finančních trhů.
 */

import type { Candle } from "@/lib/candles";
import { formatCompact, formatPrice } from "@/lib/format";

// ── Likvidita ──────────────────────────────────────────────────────

/**
 * Frekvence obchodů za posledních 24 h: počet DISTINCT `datetime` hodnot
 * (skutečné obchody) / 24 h. Ticky polling každých 5 min → max 288 vzorků,
 * distinct je nižší, pokud se cena mezi polly nezměnila.
 */
export function tradeFrequencyPerDay(
  ticks: { recorded_at: string; price: number }[]
): number | null {
  if (ticks.length === 0) return null;
  const dayAgoMs = Date.now() - 24 * 3600_000;
  const times = new Set<number>();
  for (const t of ticks) {
    const ms = new Date(t.recorded_at).getTime();
    if (ms >= dayAgoMs) times.add(ms);
  }
  return times.size;
}

/**
 * Průměrný denní obrat (avg daily volume × cena) z denních svíček s objemem.
 * Vrací null, pokud objemy chybí (intraday proxy).
 */
export function averageDailyTurnover(candles: Candle[]): number | null {
  const withVol = candles.filter((c) => c.volume != null && c.volume > 0);
  if (withVol.length === 0) return null;
  const sum = withVol.reduce((acc, c) => acc + c.volume! * c.close, 0);
  return sum / withVol.length;
}

/** Jednotlivé složky likvidity pro UI. */
export type LiquidityResult = {
  /** Obchody za 24 h (distinct časy) – 0 = nikdo neobchodoval. */
  tradesPerDay: number | null;
  /** Průměrný denní obrat v $ (objem × cena), null bez denních svíček. */
  turnover: number | null;
  /** Klasifikace 0–4 s popisem. */
  grade: 0 | 1 | 2 | 3 | 4;
  label: string;
  description: string;
};

/**
 * Klasifikace likvidity podle počtu obchodů za den (primární),
 * obrat jen doplňuje popisek.
 *
 * grades:
 *  0 = mrtvé (0 obchodů / den)
 *  1 = velmi nízká (1–12 obchodů – málo.Ticků 5 min = max 288, takže
 *      12 = ~1 hodina aktivních obchodů za celý den)
 *  2 = nízká (13–48 obchodů)
 *  3 = střední (49–144 obchodů)
 *  4 = vysoká (145+ – aktivní obchodování přes 12 h dne)
 */
export function computeLiquidity(
  ticks: { recorded_at: string; price: number }[],
  dailyCandles: Candle[]
): LiquidityResult {
  const tradesPerDay = tradeFrequencyPerDay(ticks);
  const turnover = averageDailyTurnover(dailyCandles);

  const { grade, label, description } = gradeLiquidity(tradesPerDay);
  const desc =
    turnover != null ? `${description} Obrat ${formatPrice(turnover)} / den.` : description;

  return { tradesPerDay, turnover, grade, label, description: desc };
}

/**
 * Klasifikace (0–4) podle počtu obchodů za den – pure, bez I/O, aby ji
 * šlo použít i v batch průměrech (dashboard) a ne jen na market page.
 */
export function gradeLiquidity(tradesPerDay: number | null): {
  grade: 0 | 1 | 2 | 3 | 4;
  label: string;
  description: string;
} {
  if (tradesPerDay === null || tradesPerDay === 0) {
    return {
      grade: 0,
      label: "Mrtvá",
      description: "Za 24 h žádné obchody – cena nereaguje na trh.",
    };
  }
  if (tradesPerDay <= 12) {
    return {
      grade: 1,
      label: "Velmi nízká",
      description:
        "Obchoduje se jen ojediněle – ceny se mění zřídka, těžko se odhaduje správný okamžik vstupu.",
    };
  }
  if (tradesPerDay <= 48) {
    return {
      grade: 2,
      label: "Nízká",
      description:
        "Nízká aktivita – delší rozpětí mezi obchody, pozor na klouzání ceny.",
    };
  }
  if (tradesPerDay <= 144) {
    return {
      grade: 3,
      label: "Střední",
      description: "Pravidelný obchodní ruch – vstup/výstup bez problémů.",
    };
  }
  return {
    grade: 4,
    label: "Vysoká",
    description:
      "Aktivní trh – cena reaguje okamžitě, spread zanedbatelný.",
  };
}

// ── Volatilita ─────────────────────────────────────────────────────

/**
 * Annualizovaná (nebo per-interval) volatilita: směrodatná odchylka
 * log-výnosů close-to-close × √(svíček za rok).
 *
 * @param candles svíčky daného TF (poslední rozpracovaná se hodí taky –
 *                reálná data, jen kratší interval)
 * @param intervalSeconds délka jednoho bucketu v sekundách
 * @param annualize true = normalizace na rok (srovnatelné mezi TF),
 *                  false = za jednu svíčku daného TF
 */
export function computeVolatility(
  candles: Candle[],
  intervalSeconds: number,
  annualize = true
): number | null {
  if (candles.length < 2) return null;

  // log-výnosy close-to-close
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const cur = candles[i].close;
    if (prev > 0 && cur > 0) {
      returns.push(Math.log(cur / prev));
    }
  }
  if (returns.length < 2) return null;

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) * (r - mean), 0) /
    (returns.length - 1);
  const perBar = Math.sqrt(variance);

  if (!annualize) return perBar;

  // svíček za rok: 365 dní (SimCompanies běží non-stop)
  const barsPerYear = (365 * 24 * 3600) / intervalSeconds;
  return perBar * Math.sqrt(barsPerYear);
}

/** Jednotlivé složky volatility pro UI. */
export type VolatilityResult = {
  /** Annualizovaná volatilita v % (např. 45 = ±45 % ročně). */
  annualizedPct: number | null;
  /** Očekávaný pohyb za jednu svíčku daného TF v %. */
  perBarPct: number | null;
  /** Klasifikace 0–4. */
  grade: 0 | 1 | 2 | 3 | 4;
  label: string;
  description: string;
};

/**
 * Klasifikace volatility (0–4) z annualizované hodnoty – pure, bez I/O,
 * sdílená market page i batch variantou pro dashboard.
 *
 *  0 = mrtvá (< 5 %)  – cena se skoro nehne
 *  1 = nízká (5–15 %)
 *  2 = střední (15–40 %)
 *  3 = vysoká (40–80 %)
 *  4 = extrémní (80 %+) – divoké výkyvy
 */
export function gradeVolatility(annualizedPct: number | null): {
  grade: 0 | 1 | 2 | 3 | 4;
  label: string;
  description: string;
} {
  if (annualizedPct === null) {
    return {
      grade: 0,
      label: "–",
      description: "Málo dat pro výpočet.",
    };
  }
  if (annualizedPct < 5) {
    return {
      grade: 0,
      label: "Mrtvá",
      description: "Cena skoro stagnuje – pohyby zanedbatelné.",
    };
  }
  if (annualizedPct < 15) {
    return {
      grade: 1,
      label: "Nízká",
      description: "Cena drží klid, pohyby jsou malé.",
    };
  }
  if (annualizedPct < 40) {
    return {
      grade: 2,
      label: "Střední",
      description: "Normální kolísání – pohyby po jednotkách procent.",
    };
  }
  if (annualizedPct < 80) {
    return {
      grade: 3,
      label: "Vysoká",
      description: "Výrazné výkyvy – pozor na timing vstupu/výstupu.",
    };
  }
  return {
    grade: 4,
    label: "Extrémní",
    description: "Divoké výkyvy – vysoké riziko i vysoká příležitost.",
  };
}

/**
 * Klasifikace podle annualizované volatility (čísla kalibrovaná na
 * SimCompanies – tyto komodity jsou volatilnější než reálné trhy):
 *  0 = mrtvá (< 5 %)  – cena se skoro nehne
 *  1 = nízká (5–15 %)
 *  2 = střední (15–40 %)
 *  3 = vysoká (40–80 %)
 *  4 = extrémní (80 %+) – divoké výkyvy
 */
export function volatilityProfile(
  candles: Candle[],
  intervalSeconds: number
): VolatilityResult {
  const annualized = computeVolatility(candles, intervalSeconds, true);
  const perBar = computeVolatility(candles, intervalSeconds, false);

  const { grade, label, description } = gradeVolatility(
    annualized === null ? null : annualized * 100
  );

  return {
    annualizedPct: annualized === null ? null : annualized * 100,
    perBarPct: perBar === null ? null : perBar * 100,
    grade,
    label,
    description,
  };
}

/** Vizuální "bublinky" 0–4 pro MiniStat (barvy dle intenzity). */
export function gradeColorClass(grade: 0 | 1 | 2 | 3 | 4): string {
  switch (grade) {
    case 0:
      return "text-muted-foreground";
    case 1:
      return "text-up/70";
    case 2:
      return "text-up";
    case 3:
      return "text-down/80";
    case 4:
      return "text-down";
  }
}

/** Řetězec ●●●●● s vyplněnými kruhy podle grade (0–4). */
export function gradeDots(grade: 0 | 1 | 2 | 3 | 4): string {
  return "●".repeat(grade) + "○".repeat(4 - grade);
}

export { formatCompact };
