import { getDb } from "@/lib/db";
import { getMarketPrices, getFollowedSummaries } from "@/lib/simcotools";
import { evaluateAlerts } from "@/lib/alerts";

export const dynamic = "force-dynamic";

/**
 * Poller ticků – volá externí cron (cron-job.org) každých 5 minut.
 *
 * 1 request do Simco Tools = poslední skutečný obchod pro VŠECHNY
 * resource+kvality. Ukládáme:
 *  - kvalitu 0 položek s track_ticks=true (hlavní sběr – tabulky, grafy),
 *  - KVality > 0, na které portfolio drží pozice nebo visí limitka
 *    (limit_sell) – jinak by držba Q6 neměla cenu a P/L by bylo null.
 * Chráněno hlavičkou Authorization: Bearer CRON_SECRET.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const ticks = await getMarketPrices();

    const db = getDb();
    const tracked = await db`select id from items where track_ticks = true`;
    const trackedIds = new Set(tracked.map((r) => r.id as number));

    // Reálné obchodované objemy (5min bucket, shodný s naším pollerem):
    // market/followed v jednom requestu pro všechny sledované položky
    let volumeByItem = new Map<number, number>();
    try {
      const summaries = await getFollowedSummaries(
        [...trackedIds].map((id) => ({ resourceId: id, quality: 0 }))
      );
      volumeByItem = new Map(
        summaries.map((s) => [
          s.resourceId,
          s.fiveMinutesCandlestick?.volume ?? s.volume ?? 0,
        ])
      );
    } catch {
      // Objemy jsou bonus – výpadek nesmí zablokovat ukládání cen
    }

    // Per-kvalitní hlídky: otevřené pozice s Q>0 + limitky (limit_sell)
    // s Q>0 – jejich ceny se ukládají taky (jinak držba Q6 nemá cenu).
    const heldQRows = await db`
      select distinct item_id, quality from positions
      where closed_at is null and quality > 0
      union
      select distinct item_id, quality from alerts
      where active = true and kind = 'limit_sell' and quality > 0
    `;
    const heldPairs = new Set(
      heldQRows.map((r) => `${r.item_id}#${r.quality}`)
    );

    const rows = ticks
      .filter((t) => {
        if (!(t.price > 0)) return false;
        if (t.quality === 0) return trackedIds.has(t.resourceId);
        return heldPairs.has(`${t.resourceId}#${t.quality}`);
      })
      .map((t) => ({
        item_id: t.resourceId,
        quality: t.quality,
        price: t.price,
        quantity: null,
        volume: t.quality === 0 ? (volumeByItem.get(t.resourceId) ?? null) : null,
        recorded_at: t.datetime,
        source: "simcotools",
      }));

    let inserted = 0;
    if (rows.length > 0) {
      const result = await db`
        insert into price_history ${db(
          rows,
          "item_id",
          "quality",
          "price",
          "quantity",
          "volume",
          "recorded_at",
          "source"
        )}
        on conflict (item_id, quality, recorded_at) do nothing
      `;
      inserted = result.count;
    }

    // ── Evaluace alertů (fáze 4) – po uložení čerstvých ticků ──
    let alerts: Awaited<ReturnType<typeof evaluateAlerts>> | null = null;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? null;
    if (appUrl) {
      try {
        alerts = await evaluateAlerts(appUrl);
      } catch {
        // evaluace nesmí rozbít poller
      }
    }

    return Response.json({
      ok: true,
      received: ticks.length,
      inserted,
      tracked: trackedIds.size,
      volumes: volumeByItem.size,
      alerts,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
