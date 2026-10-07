/**
 * Klient pro veřejné Simco Tools API (https://api.simcotools.com).
 * Limit: 2 requesty/s. Datum v UTC. Server-side only.
 */

const BASE = "https://api.simcotools.com";

export const REALM_ID = Number(process.env.SIMCOTOOLS_REALM ?? 0); // 0 = Magnates

const ACCEPT_LANGUAGE = process.env.SIMCOTOOLS_LANGUAGE ?? "cs";

export async function simcoFetch<T>(
  path: string,
  revalidateSeconds = 0
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Accept-Language": ACCEPT_LANGUAGE,
      Accept: "application/json",
    },
    // fetch cache na Vercelu – můžeme šetřit ratelimit
    next: { revalidate: revalidateSeconds },
  });

  if (!res.ok) {
    throw new Error(`SimcoTools ${path} → HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

// ── Typy ────────────────────────────────────────────────────────────

export type SimcoCandlestick = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
};

export type SimcoTradeTick = {
  resourceId: number;
  quality: number;
  datetime: string;
  price: number;
};

/** Market summary jedné položky z batch endpointu market/followed. */
export type SimcoFollowedSummary = {
  resourceId: number;
  resourceName?: string;
  quality: number;
  timestamp: string;
  price: number;
  /** Objem za posledních 5 minut (reálné obchody). */
  volume?: number;
  fiveMinutesCandlestick?: { volume?: number } | null;
  lastDayCandlestick?: { volume?: number; vwap?: number } | null;
};

export type SimcoEvent = {
  id: number;
  resource: number;
  resourceName: string;
  speedModifier: number;
  since: string;
  until: string;
  producedAt: string;
  producedAtName: string;
};

export type SimcoGovernmentOrder = {
  id: number;
  daysToFulfill: number;
  resources: { resourceId: number; quality: number; resourceName: string }[];
  created: string;
  projectName: string;
};

export type SimcoPhaseRange = {
  phase: "normal" | "boom" | "recession";
  start: string;
  end: string;
  days: number;
  weeks: number;
};

export type SimcoResource = {
  id: number;
  name: string;
  isResearch: boolean;
  transportation: number;
  producedAnHour: number | null;
  wages: number | null;
};

/** Denní summary realmu – makro ukazatele ekonomiky. */
export type SimcoRealmSummary = {
  date: string;
  activeCompanies: number;
  companiesValue: number;
  // API doplňuje až u dokončených dní (completed: true) – dnes tedy undefined
  totalBuildings?: number;
  bondsSold?: number;
  phase: "normal" | "boom" | "recession";
  completed: boolean;
};

/** Market summary jednoho resource+kvality – kompletní obraz trhu. */
export type SimcoMarketSummary = {
  resourceId: number;
  resourceName: string;
  quality: number;
  timestamp: string;
  price: number;
  volume: number;
  priceDifference: number;
  pricePercentChange: number;
  fiveMinutesCandlestick: {
    date: string;
    open: number;
    low: number;
    high: number;
    close: number;
    volume: number;
    previousCloseDifference: number;
    previousClosePercentageChange: number;
  };
  lastDayCandlestick: {
    date: string;
    open: number;
    low: number;
    high: number;
    close: number;
    volume: number;
    vwap: number;
    previousCloseDifference: number;
    previousClosePercentageChange: number;
    previousVWAPDifference: number;
    previousVWAPPercentageChange: number;
  };
  latestClosePrices: { datetime: string; closePrice: number }[];
};

/** Denní VWAP pro všechny resource+kvality (1 request!). */
export type SimcoVwap = {
  resourceId: number;
  quality: number;
  datetime: string;
  vwap: number;
};

/** Soutěž (contest) – boost poptávky po jedné komoditě/budově. */
export type SimcoContest = {
  id: number;
  name: string;
  resourceId?: number;
  resourceName?: string;
  buildingId?: string;
  buildingName?: string;
  startDate: string;
  endDate: string;
};

/** Druh certifikátu + mapování na resources. */
export type SimcoCertificateKind = {
  kind: number;
  relevant: boolean;
  resources?: number[];
};

/** Řádek žebříčku firem realmu (denní valuace). */
export type SimcoRankingEntry = {
  companyId: number;
  companyName: string;
  rank: number;
  rankDiff: number; // pohyb oproti včerejšku (+ = posun nahoru)
  evaRank: number;
  evaRankDiff: number;
  companyValue: number;
  companyValueDiff: number;
  companyValuePctChange: number; // podíl (0.002 = 0,2 %)
  buildingsValue: number;
  patentsValue: number;
  workers: number;
  bondsSold: number;
  isDeleted: boolean;
};

/** Statistika jedné země (firmy + top-3 firmy v zemi). */
export type SimcoCountryStat = {
  countryCode: string;
  totalCompanies: number;
  totalCompaniesValue: number;
  rank: {
    id: number;
    name: string;
    value: number;
  }[];
};

/** Certifikát konkrétního druhu (držitel + objem). */
export type SimcoCertificate = {
  id: number;
  companyId: number;
  companyName: string;
  resourceKind: number; // resource id, ke kterému se cert váže
  certInfo: {
    amount: number;
    datetime: string;
  };
  date: {
    week?: number;
    month: number;
    year: number;
  };
};

/** Počty budov v realmu (aktualizováno denně). */
export type SimcoBuildingCount = {
  id: string;
  name: string;
  count: number;
  proportion: number;
};

// ── Endpointy ───────────────────────────────────────────────────────

/**
 * Denní svíčky (OHLC + objem + VWAP) pro resource a kvalitu.
 *
 * POZOR: bez parametrů vrací endpoint jen ~posledních 91 dní! Pro hlubší
 * historii je potřeba `start`/`end` (unix milisekundy) – retence je ~365 dní.
 * Granularita se poskytuje kvůli dokumentaci chyb (must be one of:
 * 1M, 1W, 1d, 4h, 1h, 5m).
 */
export async function getCandlesticks(
  resourceId: number,
  quality = 0
): Promise<SimcoCandlestick[]> {
  const data = await simcoFetch<{ candlesticks: SimcoCandlestick[] }>(
    `/v1/realms/${REALM_ID}/market/resources/${resourceId}/${quality}/candlesticks?granularity=1d`
  );
  return data.candlesticks ?? [];
}

/**
 * Svíčky s parametry granularity + časového okna (unix ms) – plná síla
 * endpointu, kterou používá i web simcotools.com:
 *   - `1d`: retence ~365 dní (když se dotáže po 180denních oknech),
 *   - `1W`: ARCHIV od 2022 + recent okno (zvlášť, viz archivSimcoCandles),
 *   - `1M`: ARCHIV od 2022 až po aktuální měsíc (v jednom volání),
 *   - `1h`/`4h`/`5m`: krátká retence (~7 dní / ~1 den).
 *
 * Okno může být libovolně široké (API vrátí co má v rozsahu) – stránkování
 * řeší volající rozdělením na menší okna, pokud potřebuje jistotu.
 */
export type SimcoGranularity = "1M" | "1W" | "1d" | "4h" | "1h" | "5m";

export async function getCandlesticksRange(
  resourceId: number,
  quality: number,
  granularity: SimcoGranularity,
  startMs: number,
  endMs: number
): Promise<SimcoCandlestick[]> {
  const data = await simcoFetch<{ candlesticks: SimcoCandlestick[] }>(
    `/v1/realms/${REALM_ID}/market/resources/${resourceId}/${quality}/candlesticks?granularity=${granularity}&start=${Math.floor(
      startMs
    )}&end=${Math.floor(endMs)}`
  );
  return data.candlesticks ?? [];
}

/**
 * Úplná dostupná historie denních svíček (~365 dní) – endpoint dotáže
 * po 180denních oknech od `daysBack` do minulosti a deduplikuje dle data.
 * Vrací svíčky rostoucí dle času (od nejstarší).
 */
export async function getCandlesticksDeep(
  resourceId: number,
  quality = 0,
  daysBack = 365
): Promise<SimcoCandlestick[]> {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const WINDOW_MS = 180 * DAY_MS;
  const now = Date.now();
  const from = now - daysBack * DAY_MS;

  const byDate = new Map<string, SimcoCandlestick>();
  for (let start = from; start < now; start += WINDOW_MS) {
    const end = Math.min(start + WINDOW_MS, now);
    try {
      const candles = await getCandlesticksRange(
        resourceId,
        quality,
        "1d",
        start,
        end
      );
      for (const c of candles) {
        // dedupe dle data – okna se mohou překrývat
        byDate.set(c.date.slice(0, 10), c);
      }
    } catch {
      // jedno okno selhalo (ratelimit apod.) – zbytek historie zůstává
    }
  }

  return [...byDate.values()].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
}

/** Poslední skutečný obchod pro všechny resource+kvality (1 request!).
 *  Cache 5 s – /api/live polluje každých 10 s; sdílená cache drží
 *  součet požadavků (všichni diváci + cron) hluboko pod limitem 2 req/s.
 */
export async function getMarketPrices(): Promise<SimcoTradeTick[]> {
  const data = await simcoFetch<{ prices: SimcoTradeTick[] }>(
    `/v1/realms/${REALM_ID}/market/prices`,
    5
  );
  return data.prices ?? [];
}

/**
 * Batch market summary pro konkrétní resource+quality páry (1 request).
 * Format parametru: "9q0,8q0,…" – vrací fiveMinutesCandlestick.volume
 * = SKUTEČNÝ obchodovaný objem za posledních 5 minut.
 */
export async function getFollowedSummaries(
  pairs: { resourceId: number; quality: number }[]
): Promise<SimcoFollowedSummary[]> {
  if (pairs.length === 0) return [];
  const resources = pairs.map((p) => `${p.resourceId}q${p.quality}`).join(",");
  const data = await simcoFetch<{ summaries: SimcoFollowedSummary[] }>(
    `/v1/realms/${REALM_ID}/market/followed?resources=${encodeURIComponent(
      resources
    )}`
  );
  return data.summaries ?? [];
}

/** Kompletní market summary (5m svíčka, denní svíčka, VWAP, změny).
 *  Cache 30 s – data jde na market page MiniStats; živé ceny dorážejí
 *  přes SSE, takže krátká cache neublíží a šetří ratelimit. */
export async function getMarketSummary(
  resourceId: number,
  quality = 0
): Promise<SimcoMarketSummary | null> {
  try {
    const data = await simcoFetch<{ summary: SimcoMarketSummary }>(
      `/v1/realms/${REALM_ID}/market/resources/${resourceId}/${quality}`,
      30
    );
    return data.summary ?? null;
  } catch {
    return null;
  }
}

/** Ekonomické eventy (random events) ovlivňující produkci.
 *  Cache 60 s – eventy přibývají/bývají v hodinovém rytmu. */
export async function getEvents(): Promise<SimcoEvent[]> {
  const data = await simcoFetch<{ events: SimcoEvent[] }>(
    `/v1/realms/${REALM_ID}/events`,
    60
  );
  return data.events ?? [];
}

/** Vládní zakázky (stránkované) – obrovský poptávkový signál.
 *  Cache 5 min – zakázky se vypisují v řádu dní. */
export async function getGovernmentOrders(pageSize = 25): Promise<
  SimcoGovernmentOrder[]
> {
  const data = await simcoFetch<{
    orders: SimcoGovernmentOrder[];
  }>(`/v1/realms/${REALM_ID}/government-orders?page_size=${pageSize}`, 300);
  return data.orders ?? [];
}

/** Historie fází ekonomiky (normal/boom/recession) – první řádek = aktuální.
 *  Cache 15 min – fáze se mění jednou za ~7 dní. */
export async function getPhaseRanges(): Promise<SimcoPhaseRange[]> {
  const data = await simcoFetch<{ ranges: SimcoPhaseRange[] }>(
    `/v1/realms/${REALM_ID}/phases`,
    900
  );
  return data.ranges ?? [];
}

/** Kompletní katalog zdrojů realmu (jména v požadovaném jazyce).
 *  Cache 1 h – katalog je prakticky neměnný (transportation poměry,
 *  mzdy se mění výjimečně); volá se i per-položka z datové vrstvy. */
export async function getResources(): Promise<SimcoResource[]> {
  const data = await simcoFetch<{ resources: SimcoResource[] }>(
    `/v1/realms/${REALM_ID}/resources?disable_pagination=true`,
    3600
  );
  return data.resources ?? [];
}

/** Denní makro summary realmu (historie ~481 dní, stránkované).
 *  Cache 15 min – nový řádek přibývá jednou denně. */
export async function getRealmSummaries(
  pageSize = 30
): Promise<SimcoRealmSummary[]> {
  const data = await simcoFetch<{
    summaries: SimcoRealmSummary[];
  }>(`/v1/realms/${REALM_ID}/summaries?page_size=${pageSize}`, 900);
  return data.summaries ?? [];
}

/** Denní VWAP pro VŠECHNY resource+kvality – jeden request za den. */
export async function getVwaps(): Promise<SimcoVwap[]> {
  const data = await simcoFetch<{ vwaps: SimcoVwap[] }>(
    `/v1/realms/${REALM_ID}/market/vwaps`
  );
  return data.vwaps ?? [];
}

/** Soutěže realmu (historie od 2019). */
export async function getContests(): Promise<SimcoContest[]> {
  const data = await simcoFetch<{ contests: SimcoContest[] }>(
    `/v1/realms/${REALM_ID}/contests?disable_pagination=true`
  );
  return data.contests ?? [];
}

/** Druhy certifikátů v realmu (relevant flag + resource mapping). */
export async function getCertificateKinds(): Promise<SimcoCertificateKind[]> {
  const data = await simcoFetch<{ certificates_kinds: SimcoCertificateKind[] }>(
    `/v1/realms/${REALM_ID}/certificates`
  );
  return data.certificates_kinds ?? [];
}

/**
 * Žebříček firem realmu (25 905 firem, stránkované).
 * Denní valuace – hodnota, patenty, pracovníci, bondy, pohyby v žebříčku.
 * Cache 15 min – valuace se přepočítává jednou denně.
 */
export async function getRanking(pageSize = 50): Promise<SimcoRankingEntry[]> {
  const data = await simcoFetch<{
    ranking: SimcoRankingEntry[];
  }>(`/v1/realms/${REALM_ID}/ranking?page_size=${pageSize}`, 900);
  return data.ranking ?? [];
}

/**
 * Statistiky zemí – počty firem, hodnota a top-3 firmy v každé zemi.
 * Cache 15 min – denní agregace.
 * Odpověď je mapa { CC: stat } → převedeme na pole.
 */
export async function getCountryStats(): Promise<SimcoCountryStat[]> {
  const data = await simcoFetch<{
    countries: Record<string, Omit<SimcoCountryStat, "countryCode">>;
  }>(`/v1/realms/${REALM_ID}/stats/countries`, 900);

  return Object.entries(data.countries ?? {}).map(([code, stat]) => ({
    countryCode: code,
    totalCompanies: stat.totalCompanies ?? 0,
    totalCompaniesValue: stat.totalCompaniesValue ?? 0,
    rank: stat.rank ?? [],
  }));
}

/** Certifikáty jednoho druhu (držitelé + objemy).
 *  Cache 15 min – cert demand se mění pomalu; bez cache stála sekce
 *  „Cert demand“ 5 × (600 ms pauza + request) ≈ 8 s při každém načtení
 *  /statistiky. */
export async function getCertificatesByKind(
  kind: number
): Promise<SimcoCertificate[]> {
  const data = await simcoFetch<{ certificates: SimcoCertificate[] }>(
    `/v1/realms/${REALM_ID}/certificates/${kind}`,
    900
  );
  return data.certificates ?? [];
}

/** Počty budov v realmu dle typu (production/sales/recreation/research).
 *  Cache 15 min – denní agregace. */
export async function getBuildingCounts(
  type: "all" | "production" | "sales" | "recreation" | "research" = "all"
): Promise<{ buildings: SimcoBuildingCount[]; total: number }> {
  const data = await simcoFetch<{
    buildings: SimcoBuildingCount[];
    total_buildings: number;
  }>(
    `/v1/realms/${REALM_ID}/stats/buildings?type=${type}&disable_pagination=true`,
    900
  );
  return { buildings: data.buildings ?? [], total: data.total_buildings ?? 0 };
}
