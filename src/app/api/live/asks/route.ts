import {
  getOfficialOrdersAllQualities,
  aggregateQualityAsks,
  type QualityAskSummary,
} from "@/lib/simco-official";

export const dynamic = "force-dynamic";

/**
 * Žebříček asků VŠECH kvalit položky (market page: „Kvality na burze“):
 *  - `qualities` = [{ quality, price, quantity, offers }] vzestupně dle
 *    kvality (price = nejnižší ask, quantity = Σ nabízených ks,
 *    offers = počet aktivních nabídek).
 *
 * Živá cesta je SSE ('orderbook' event z hubu nese i qualities) – tento
 * endpoint se volá jen v REST fallback režimu (SSE nedostupné), cache 5 s
 * per položka. Upstream: ofiko v3 vrací kompletní knihu VŠECH kvalit
 * jedním requestem (quirk z 2026-10-06; throttle 1,1 s v simco-official).
 *
 * Volání: GET /api/live/asks?item=63
 */

// Per-instance cache: item → { qualities, atMs }
const CACHE_TTL_MS = 5_000;
const cache = new Map<number, { qualities: QualityAskSummary[]; atMs: number }>();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const item = Number(url.searchParams.get("item"));

  if (!Number.isInteger(item) || item <= 0) {
    return Response.json({ error: "Neplatný parametr item" }, { status: 400 });
  }

  const now = Date.now();
  const hit = cache.get(item);

  if (hit && now - hit.atMs < CACHE_TTL_MS) {
    return Response.json(
      {
        qualities: hit.qualities,
        cachedMsAgo: Math.round(now - hit.atMs),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const orders = await getOfficialOrdersAllQualities(item);
    const qualities = aggregateQualityAsks(orders);
    cache.set(item, { qualities, atMs: now });
    // Pojistka proti neomezenému růstu
    if (cache.size > 200) {
      for (const [k, v] of cache) {
        if (now - v.atMs > 60_000) cache.delete(k);
      }
    }
    return Response.json(
      { qualities },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    // Selhání nesmí shodit volající panel – vrátíme poslední známou hodnotu.
    return Response.json(
      {
        qualities: hit?.qualities ?? [],
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }
}
