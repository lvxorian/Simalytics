import { getOrderbookAsks } from "@/lib/simco-official";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Orderbook jedné položky a KVALITY (ofiko SimCompanies v3 API, Fáze 3C):
 *  - `ask`   = nejnižší aktivní nabídka (za kolik lze koupit HNED)
 *  - `asks`  = top N nejnižších nabídek s objemy (hloubka trhu)
 *  - `trade` = poslední obchod TÉTO KVALITY z price_history (fallback,
 *    když burza nemá aktivní nabídky – kalkulačka kontraktů potřebuje
 *    referenci i pro řídké kvality, kde ask často neexistuje)
 *
 * Volání: GET /api/live/ask?item=63&quality=3&depth=5
 *
 * Rate limit: ofiko API 1 req/s – throttle v simco-official.ts serializuje
 * requesty s min. odstupem 1,1 s. Cache 3 s per (item, quality) drží
 * provoz i při víc divácích na stejné položce nízko.
 */

// Per-instance cache: klíč `${item}:${quality}` → { ask, asks, trade, atMs }
const CACHE_TTL_MS = 3_000;
type AskEntry = { price: number; quantity: number; npc: boolean };
const cache = new Map<
  string,
  { ask: number | null; asks: AskEntry[]; trade: number | null; atMs: number }
>();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const item = Number(url.searchParams.get("item"));
  const qualityRaw = Number(url.searchParams.get("quality") ?? "0");
  const quality =
    Number.isInteger(qualityRaw) && qualityRaw >= 0 && qualityRaw <= 7
      ? qualityRaw
      : 0;
  const depth = Math.min(
    10,
    Math.max(1, Number(url.searchParams.get("depth") ?? "5") || 5)
  );

  if (!Number.isInteger(item) || item <= 0) {
    return Response.json({ error: "Neplatný parametr item" }, { status: 400 });
  }

  const key = `${item}:${quality}`;
  const hit = cache.get(key);
  const now = Date.now();

  if (hit && now - hit.atMs < CACHE_TTL_MS) {
    return Response.json(
      {
        ask: hit.ask,
        asks: hit.asks.slice(0, depth),
        trade: hit.trade,
        cachedMsAgo: Math.round(now - hit.atMs),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const [asks, tradeRows] = await Promise.all([
      getOrderbookAsks(item, quality, depth),
      (async () => {
        const db = getDb();
        const rows = (await db`
          select price from price_history
          where item_id = ${item} and quality = ${quality}
          order by recorded_at desc
          limit 1
        `) as unknown as { price: string | null }[];
        const p = rows[0]?.price;
        return p === undefined || p === null ? null : Number(p);
      })(),
    ]);
    const ask = asks.length > 0 ? asks[0].price : null;
    const entry = { ask, asks, trade: tradeRows, atMs: now };
    cache.set(key, entry);
    // Pojistka proti neomezenému růstu
    if (cache.size > 200) {
      for (const [k, v] of cache) {
        if (now - v.atMs > 60_000) cache.delete(k);
      }
    }
    return Response.json(
      { ask, asks, trade: tradeRows },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    // HTTP 404 = kvalita nemá žádné aktivní nabídky (hra tak odpovídá
    // na prázdný orderbook) – normální stav, ne chyba.
    if (err instanceof Error && err.message.includes("404")) {
      return Response.json(
        { ask: null, asks: [], trade: hit?.trade ?? null },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    // Ostatní selhání nesmí shodit volající stránku – vrátíme poslední
    // známou hodnotu.
    return Response.json(
      {
        ask: hit?.ask ?? null,
        asks: hit?.asks ?? [],
        trade: hit?.trade ?? null,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }
}
