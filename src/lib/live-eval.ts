import { getDb } from "@/lib/db";
import { notifyAlert, type AlertNotification } from "@/lib/notifier";
import { formatPrice } from "@/lib/format";

/**
 * Sdílená serverová logika pro LIVE ceny (Fáze 3):
 *  - evaluace cenových + limitních alertů proti čerstvým tickům,
 *  - idempotentní ukládání ticků do price_history.
 *
 * Používá ji price hub (lib/price-hub) i REST fallback (/api/live).
 * Cooldown guard je atomický UPDATE sdílený s 5min cron evaluací,
 * takže notifikace nikdy neodejde dvakrát.
 */

export type LiveAlertRow = {
  id: string;
  item_id: number;
  quality: number;
  kind: "price" | "limit_sell";
  direction: "above" | "below";
  threshold: number;
  item_name: string;
  image_url: string | null;
};

export type LiveTrigger = {
  id: string;
  item_id: number;
  item_name: string;
  kind: "price" | "limit_sell";
  direction: "above" | "below";
  threshold: number;
  price: number;
  image_url: string | null;
  /** True = trigger přes AKTIVNÍ NABÍDKU (ask), ne přes poslední obchod. */
  viaAsk?: boolean;
};

/**
 * Rychlá evaluace cenových + limitních alertů proti čerstvým tickům.
 *
 * Ask-aware (Fáze 3): pro BUY podmínky (price 'below') se kromě posledního
 * obchodu porovnává i NEJNIŽŠÍ AKTIVNÍ NABÍDKA (askByItem) – když někdo
 * položí nabídku na úroveň prahu, alert spustí hned ("můžeš jít koupit"),
 * nemusí čekat, až obchod proběhne (a někdo jiný příležitost sebere).
 * Sell strana (limitní prodeje, 'above') zůstává na posledním obchodě –
 * prodej se řídí bidem, který API nevidí.
 *
 * Notifikace (webhook/e-mail) jde přes notifyAlert fire-and-forget.
 */
export async function evaluateLiveAlerts(
  priceByItem: Map<number, number>,
  askByItem?: Map<number, number>
): Promise<LiveTrigger[]> {
  const triggered: LiveTrigger[] = [];

  const db = getDb();
  const alerts = (await db`
    select a.id, a.item_id, a.quality, a.kind, a.direction, a.threshold,
           i.name as item_name, i.image_url
    from alerts a
    join items i on i.id = a.item_id
    where a.active = true and a.kind in ('price', 'limit_sell')
  `) as unknown as LiveAlertRow[];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? null;

  for (const a of alerts) {
    const price = priceByItem.get(a.item_id);
    if (price === undefined || price <= 0) continue;
    const ask = askByItem?.get(a.item_id) ?? null;

    // limit_sell je vždy 'above'; price alert dle direction.
    // BUY podmínky ('below' price): trigger i přes ask – nabídka na úrovni
    // prahu = příležitost k nákupu už existuje.
    let met = false;
    let viaAsk = false;
    if (a.kind === "limit_sell") {
      met = price >= a.threshold;
    } else if (a.direction === "above") {
      met = price >= a.threshold;
    } else {
      met = price <= a.threshold;
      if (
        !met &&
        ask !== null &&
        ask > 0 &&
        ask <= a.threshold &&
        ask < price
      ) {
        met = true;
        viaAsk = true;
      }
    }
    if (!met) continue;

    // Cooldown guard – atomický update (anti-spam + anti-duplicita
    // proti 5min cron evaluaci, která sdílí stejný guard).
    const ok = (await db`
      update alerts
      set last_triggered_at = now(),
          trigger_count = trigger_count + 1,
          seen_at = null
      where id = ${a.id}::uuid
        and (last_triggered_at is null
             or last_triggered_at < now() - interval '60 minutes')
      returning id
    `) as unknown as { id: string }[];
    if (ok.length === 0) continue; // v cooldownu – už notifikováno

    const url = appUrl ? `${appUrl}/market/${a.item_id}` : null;
    const title =
      a.kind === "limit_sell"
        ? `🏷️ Limitní prodej dosažen: ${a.item_name}`
        : viaAsk
          ? `🛒 Nákupní příležitost: ${a.item_name}`
          : `💰 Cenový alert: ${a.item_name}`;
    const body =
      a.kind === "limit_sell"
        ? `Limitní prodej ${a.item_name} Q${a.quality}: cena je teď ${formatPrice(price)} – dosáhla tvého limitu ${formatPrice(a.threshold)}. Prodáváš-li ve hře, odklepni to v portfoliu.`
        : viaAsk
          ? `Na burze je aktivní nabídka ${a.item_name} Q${a.quality} za ${formatPrice(ask!)} – pod tvým prahem ${formatPrice(a.threshold)}. Poslední obchod ${formatPrice(price)}. Můžeš jít koupit.`
          : `Cena ${a.item_name} je teď ${formatPrice(price)} – ${a.direction === "above" ? "překročila" : "propadla pod"} práh ${formatPrice(a.threshold)}.`;

    const notification: AlertNotification = {
      title,
      body,
      url,
      kind: a.kind,
    };

    // Fire-and-forget – nesmí zpomalit evaluaci
    notifyAlert(notification, process.env.ALERT_EMAIL_TO ?? null).catch(
      () => {}
    );

    triggered.push({
      id: a.id,
      item_id: a.item_id,
      item_name: a.item_name,
      kind: a.kind,
      direction: a.direction,
      threshold: a.threshold,
      price: viaAsk ? ask! : price,
      image_url: a.image_url,
      viaAsk,
    });
  }

  return triggered;
}

/**
 * Uloží nové ticky do price_history (idempotentní přes unique index).
 * Jen sledované položky (track_ticks) – stejný filtr jako 5min poller.
 */
export async function persistTicks(
  ticks: {
    resourceId: number;
    quality: number;
    datetime: string;
    price: number;
  }[],
  trackedIds: Set<number>
): Promise<number> {
  const rows = ticks
    .filter((t) => t.quality === 0 && trackedIds.has(t.resourceId) && t.price > 0)
    .map((t) => ({
      item_id: t.resourceId,
      quality: 0,
      price: t.price,
      quantity: null,
      volume: null,
      recorded_at: t.datetime,
      source: "live",
    }));
  if (rows.length === 0) return 0;

  const db = getDb();
  const result = await db`
    insert into price_history ${db(rows, "item_id", "quality", "price", "quantity", "volume", "recorded_at", "source")}
    on conflict (item_id, quality, recorded_at) do nothing
  `;
  return result.count;
}
