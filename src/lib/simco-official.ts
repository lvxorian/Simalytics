/**
 * Klient OFICIÁLNÍHO SimCompanies API (www.simcompanies.com/api/v3,
 * pravidla dle simcompanies.com/articles/api):
 *   - jen GET,
 *   - respektujeme 1 req/s (bezpečně: min. 1 100 ms mezi requesty),
 *   - User-Agent dle konvence ze scripts/fetch-market.mjs.
 *
 * Používá se k tomu, co Simco Tools nemá: AKTIVNÍ nabídky (orderbook),
 * nejnižší ask = co reálně stojí koupit hned (Fáze 3C).
 */

const BASE = "https://www.simcompanies.com/api/v3";
const USER_AGENT = "Simalytics/1.0 (osobní portfolio tracker)";
const MIN_GAP_MS = 1_100;

let chain: Promise<unknown> = Promise.resolve();
let lastRequestMs = 0;

/** Serializuje requesty a drží min. odstup 1,1 s (1 req/s + rezerva). */
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = Math.max(0, lastRequestMs + MIN_GAP_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestMs = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run as Promise<T>;
}

export type OfficialOrder = {
  price: number;
  quantity: number;
  quality: number;
  posted: string;
  seller: { company?: string; npc?: boolean } | null;
};

/**
 * Aktivní nabídky (ask strana orderbooku) pro resource+kvalitu.
 * Odpověď = pole orderů (nejlevnější dole v UI hry; my si seřadíme sami).
 */
export async function getOfficialOrders(
  resourceId: number,
  quality = 0
): Promise<OfficialOrder[]> {
  return throttled(async () => {
    const res = await fetch(`${BASE}/market/${quality}/${resourceId}/`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`SimCompanies v3 HTTP ${res.status}`);
    const data = (await res.json()) as Array<{
      quantity?: number;
      price?: number;
      quality?: number;
      posted?: string;
      seller?: { company?: string; npc?: boolean } | null;
    }>;
    return (Array.isArray(data) ? data : [])
      .filter((o) => Number(o?.quantity) > 0 && Number(o?.price) > 0)
      .map((o) => ({
        price: Number(o.price),
        quantity: Number(o.quantity),
        quality: Number(o.quality ?? quality),
        posted: o.posted ?? "",
        seller: o.seller ?? null,
      }));
  });
}

/** Nejnižší aktivní nabídka – co stojí koupit hned. */
export async function getLowestAsk(
  resourceId: number,
  quality = 0
): Promise<{ price: number; quantity: number } | null> {
  const orders = await getOfficialOrders(resourceId, quality);
  if (orders.length === 0) return null;
  const best = orders.reduce((a, b) => (b.price < a.price ? b : a));
  return { price: best.price, quantity: best.quantity };
}

/**
 * Top N nejnižších nabídek (ask strana orderbooku) seřazené vzestupně –
 * hloubka trhu na straně nákupu (Fáze 3C: mini orderbook).
 */
export async function getOrderbookAsks(
  resourceId: number,
  quality = 0,
  topN = 5
): Promise<{ price: number; quantity: number; npc: boolean }[]> {
  const orders = await getOfficialOrders(resourceId, quality);
  return orders
    .sort((a, b) => a.price - b.price)
    .slice(0, topN)
    .map((o) => ({
      price: o.price,
      quantity: o.quantity,
      npc: o.seller?.npc ?? false,
    }));
}
