import { getOrderbookAsks } from "@/lib/simco-official";

export const dynamic = "force-dynamic";

/**
 * Orderbook jedné položky (ofiko SimCompanies v3 API, Fáze 3C):
 *  - `ask`   = nejnižší aktivní nabídka (za kolik lze koupit HNED)
 *  - `asks`  = top 5 nejnižších nabídek s objemy (hloubka trhu)
 *
 * Volání: GET /api/live/ask?item=1&quality=0&depth=5
 *
 * Rate limit: ofiko API 1 req/s – throttle v simco-official.ts serializuje
 * requesty s min. odstupem 1,1 s. Cache 3 s per (item, quality) drží
 * provoz i při víc divácích na stejné položce nízko.
 */

// Per-instance cache: klíč `${item}:${quality}` → { ask, asks, atMs }
const CACHE_TTL_MS = 3_000;
type AskEntry = { price: number; quantity: number; npc: boolean; sellerName?: string };
const cache = new Map<
  string,
  { ask: number | null; asks: AskEntry[]; atMs: number }
>();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const item = Number(url.searchParams.get("item"));
  const quality = Number(url.searchParams.get("quality") ?? "0");
  const depth = Math.min(
    10,
    Math.max(1, Number(url.searchParams.get("depth") ?? "5") || 5)
  );

  if (!Number.isInteger(item) || item <= 0) {
    return Response.json({ error: "Neplatný parametr item" }, { status: 400 });
  }

  const key = `${item}:${Number.isInteger(quality) ? quality : 0}`;
  const hit = cache.get(key);
  const now = Date.now();

  if (hit && now - hit.atMs < CACHE_TTL_MS) {
    return Response.json(
      {
        ask: hit.ask,
        asks: hit.asks.slice(0, depth),
        cachedMsAgo: Math.round(now - hit.atMs),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const asks = await getOrderbookAsks(item, quality, depth, true);
    const ask = asks.length > 0 ? asks[0].price : null;
    cache.set(key, { ask, asks, atMs: now });
    // Pojistka proti neomezenému růstu
    if (cache.size > 200) {
      for (const [k, v] of cache) {
        if (now - v.atMs > 60_000) cache.delete(k);
      }
    }
    return Response.json(
      { ask, asks },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    // Selhání nesmí shodit hero – vrátíme poslední známou hodnotu
    return Response.json(
      {
        ask: hit?.ask ?? null,
        asks: hit?.asks ?? [],
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }
}
