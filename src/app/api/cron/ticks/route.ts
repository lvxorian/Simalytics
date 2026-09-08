import { getDb } from "@/lib/db";
import { getMarketPrices, getFollowedSummaries } from "@/lib/simcotools";
import { evaluateAlerts } from "@/lib/alerts";

export const dynamic = "force-dynamic";

/**
 * Poller ticků – volá externí cron (cron-job.org) každých 5 minut.
 *
 * 1 request do Simco Tools = poslední skutečný obchod pro VŠECHNY
 * resource+kvality. Ukládáme jen kvalitu 0 položek s track_ticks=true.
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

    const rows = ticks
      .filter(
        (t) => t.quality === 0 && trackedIds.has(t.resourceId) && t.price > 0
      )
      .map((t) => ({
        item_id: t.resourceId,
        quality: 0,
        price: t.price,
        quantity: null,
        volume: volumeByItem.get(t.resourceId) ?? null,
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
