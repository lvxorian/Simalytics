import { getLowestAsk } from "@/lib/simco-official";

export const dynamic = "force-dynamic";

/**
 * Nejnižší aktivní nabídka (ask) jedné položky – orderbook z ofiko
 * SimCompanies v3 API (Fáze 3C). Slouží hero ceně na market page:
 * „za kolik lze koupit HNED“ (poslední trade ≠ aktuální nabídka).
 *
 * Volání: GET /api/live/ask?item=1&quality=0
 *
 * Rate limit: ofiko API 1 req/s – throttle v simco-official.ts serializuje
 * requesty s min. odstupem 1,1 s. Cache 3 s per (item, quality) drží
 * provoz i při víc divácích na stejné položce nízko.
 */

// Per-instance cache: klíč `${item}:${quality}` → { ask, atMs }
const CACHE_TTL_MS = 3_000;
const cache = new Map<string, { ask: number | null; atMs: number }>();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const item = Number(url.searchParams.get("item"));
  const quality = Number(url.searchParams.get("quality") ?? "0");

  if (!Number.isInteger(item) || item <= 0) {
    return Response.json({ error: "Neplatný parametr item" }, { status: 400 });
  }

  const key = `${item}:${Number.isInteger(quality) ? quality : 0}`;
  const hit = cache.get(key);
  const now = Date.now();

  if (hit && now - hit.atMs < CACHE_TTL_MS) {
    return Response.json(
      { ask: hit.ask, cachedMsAgo: Math.round(now - hit.atMs) },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const lowest = await getLowestAsk(item, quality);
    const ask = lowest ? lowest.price : null;
    cache.set(key, { ask, atMs: now });
    // Pojistka proti neomezenému růstu
    if (cache.size > 200) {
      for (const [k, v] of cache) {
        if (now - v.atMs > 60_000) cache.delete(k);
      }
    }
    return Response.json(
      { ask },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    // Selhání nesmí shodit hero – vrátíme poslední známou hodnotu
    const fallback = hit?.ask ?? null;
    return Response.json(
      { ask: fallback, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }
}
