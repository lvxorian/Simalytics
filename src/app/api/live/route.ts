import { getDb } from "@/lib/db";
import { getMarketPrices } from "@/lib/simcotools";
import { evaluateLiveAlerts, persistTicks } from "@/lib/live-eval";

export const dynamic = "force-dynamic";

/**
 * LIVE cenový endpoint (Fáze 3) – REST fallback k SSE streamu.
 *
 * Primární cesta je /api/live/stream (EventSource + price hub). Tento
 * endpoint zůstává pro:
 *  - fallback, když SSE nejde (proxy, starší prohlížeč),
 *  - „studené" instance (první dotaz po spánku, hub ještě nemá snapshot).
 *
 * Vrací poslední obchody Q0 + serverTime + čerstvě evaluované alerty
 * (stejný sdílený cooldown guard jako hub i 5min cron → notifikace
 * nikdy neodejde dvakrát). Throttle side-effects 30 s per instance
 * chrání Neon i Simco Tools.
 *
 * Volání: GET /api/live?items=1,64,71  (bez items = všechny Q0 ticky)
 */

// ── Throttle stavu evaluace (per serverless instance) ────────────────
const EVAL_INTERVAL_MS = 30_000;
const state = {
  lastEval: 0,
  busy: false,
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const itemsParam = url.searchParams.get("items");
    const requestedIds =
      itemsParam
        ?.split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 60) ?? null; // pojistka proti obřím dotazům

    const ticks = await getMarketPrices();

    // Poslední obchod per Q0 položka
    const latest = new Map<number, { price: number; datetime: string }>();
    for (const t of ticks) {
      if (t.quality !== 0 || t.price <= 0) continue;
      if (requestedIds && !requestedIds.includes(t.resourceId)) continue;
      const prev = latest.get(t.resourceId);
      if (!prev || t.datetime > prev.datetime) {
        latest.set(t.resourceId, { price: t.price, datetime: t.datetime });
      }
    }

    // ── Throttled side-effects (per instance; fetch cache zbytek sdílí) ──
    let alerts = [] as Awaited<ReturnType<typeof evaluateLiveAlerts>>;
    let inserted = 0;
    const now = Date.now();
    if (!state.busy && now - state.lastEval >= EVAL_INTERVAL_MS) {
      state.busy = true;
      state.lastEval = now;
      try {
        // Cena pro alert evaluaci: všechny Q0 (alerty můžou mířit i na
        // položky, které klient explicitně neposlal v ?items=)
        const allLatest = new Map<number, number>();
        for (const t of ticks) {
          if (t.quality !== 0 || t.price <= 0) continue;
          const prev = allLatest.get(t.resourceId);
          if (prev === undefined || t.datetime > (latest.get(t.resourceId)?.datetime ?? "")) {
            allLatest.set(t.resourceId, t.price);
          }
        }
        alerts = await evaluateLiveAlerts(allLatest);

        // Insert ticků jen pro sledované položky (stejný filtr jako poller)
        const db = getDb();
        const tracked = (await db`select id from items where track_ticks = true`) as unknown as {
          id: number;
        }[];
        inserted = await persistTicks(ticks, new Set(tracked.map((r) => r.id)));
      } catch {
        // side-effects nesmí shodit live endpoint
      } finally {
        state.busy = false;
      }
    }

    const items = [...latest.entries()].map(([id, v]) => ({
      id,
      price: v.price,
      datetime: v.datetime,
    }));

    return Response.json(
      {
        serverTime: new Date().toISOString(),
        items,
        alerts,
        inserted,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 }
    );
  }
}
