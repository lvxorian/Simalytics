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
  totalBuildings: number;
  bondsSold: number;
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

/** Počty budov v realmu (aktualizováno denně). */
export type SimcoBuildingCount = {
  id: string;
  name: string;
  count: number;
  proportion: number;
};

// ── Endpointy ───────────────────────────────────────────────────────

/** Denní svíčky (OHLC + objem + VWAP) pro resource a kvalitu. */
export async function getCandlesticks(
  resourceId: number,
  quality = 0
): Promise<SimcoCandlestick[]> {
  const data = await simcoFetch<{ candlesticks: SimcoCandlestick[] }>(
    `/v1/realms/${REALM_ID}/market/resources/${resourceId}/${quality}/candlesticks`
  );
  return data.candlesticks ?? [];
}

/** Poslední skutečný obchod pro všechny resource+kvality (1 request!). */
export async function getMarketPrices(): Promise<SimcoTradeTick[]> {
  const data = await simcoFetch<{ prices: SimcoTradeTick[] }>(
    `/v1/realms/${REALM_ID}/market/prices`
  );
  return data.prices ?? [];
}

/** Poslední obchod pro konkrétní resource a kvalitu. */
export async function getMarketPrice(
  resourceId: number,
  quality = 0
): Promise<SimcoTradeTick[]> {
  const data = await simcoFetch<{ prices: SimcoTradeTick[] }>(
    `/v1/realms/${REALM_ID}/market/prices/${resourceId}/${quality}`
  );
  return data.prices ?? [];
}

/** Kompletní market summary (5m svíčka, denní svíčka, VWAP, změny). */
export async function getMarketSummary(
  resourceId: number,
  quality = 0
): Promise<SimcoMarketSummary | null> {
  try {
    const data = await simcoFetch<{ summary: SimcoMarketSummary }>(
      `/v1/realms/${REALM_ID}/market/resources/${resourceId}/${quality}`
    );
    return data.summary ?? null;
  } catch {
    return null;
  }
}

/** Ekonomické eventy (random events) ovlivňující produkci. */
export async function getEvents(): Promise<SimcoEvent[]> {
  const data = await simcoFetch<{ events: SimcoEvent[] }>(
    `/v1/realms/${REALM_ID}/events`
  );
  return data.events ?? [];
}

/** Vládní zakázky (stránkované) – obrovský poptávkový signál. */
export async function getGovernmentOrders(pageSize = 25): Promise<
  SimcoGovernmentOrder[]
> {
  const data = await simcoFetch<{
    orders: SimcoGovernmentOrder[];
  }>(`/v1/realms/${REALM_ID}/government-orders?page_size=${pageSize}`);
  return data.orders ?? [];
}

/** Historie fází ekonomiky (normal/boom/recession) – první řádek = aktuální. */
export async function getPhaseRanges(): Promise<SimcoPhaseRange[]> {
  const data = await simcoFetch<{ ranges: SimcoPhaseRange[] }>(
    `/v1/realms/${REALM_ID}/phases`
  );
  return data.ranges ?? [];
}

/** Kompletní katalog zdrojů realmu (jména v požadovaném jazyce). */
export async function getResources(): Promise<SimcoResource[]> {
  const data = await simcoFetch<{ resources: SimcoResource[] }>(
    `/v1/realms/${REALM_ID}/resources?disable_pagination=true`
  );
  return data.resources ?? [];
}

/** Denní makro summary realmu (historie ~481 dní, stránkované). */
export async function getRealmSummaries(
  pageSize = 30
): Promise<SimcoRealmSummary[]> {
  const data = await simcoFetch<{
    summaries: SimcoRealmSummary[];
  }>(`/v1/realms/${REALM_ID}/summaries?page_size=${pageSize}`);
  return data.summaries ?? [];
}

/** Počty budov v realmu dle typu (production/sales/recreation/research). */
export async function getBuildingCounts(
  type: "all" | "production" | "sales" | "recreation" | "research" = "all"
): Promise<{ buildings: SimcoBuildingCount[]; total: number }> {
  const data = await simcoFetch<{
    buildings: SimcoBuildingCount[];
    total_buildings: number;
  }>(
    `/v1/realms/${REALM_ID}/stats/buildings?type=${type}&disable_pagination=true`
  );
  return { buildings: data.buildings ?? [], total: data.total_buildings ?? 0 };
}
