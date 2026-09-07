import { getDb } from "@/lib/db";
import { getMarketPrices } from "@/lib/simcotools";

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

    const rows = ticks
      .filter(
        (t) => t.quality === 0 && trackedIds.has(t.resourceId) && t.price > 0
      )
      .map((t) => ({
        item_id: t.resourceId,
        quality: 0,
        price: t.price,
        quantity: null,
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
          "recorded_at",
          "source"
        )}
        on conflict (item_id, quality, recorded_at) do nothing
      `;
      inserted = result.count;
    }

    return Response.json({
      ok: true,
      received: ticks.length,
      inserted,
      tracked: trackedIds.size,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
