/**
 * Evaluace alertů – volá se po každém polleru ticků (5 min).
 *
 * Pro každý aktivní alert:
 *   1. Načte aktuální hodnotu (cena z price_history / skóre ze Signal Engine)
 *   2. Zkontroluje podmínku (above/below threshold)
 *   3. Při splnění pošle notifikaci – ale jen pokud uplynul cooldown
 *      (markAlertTriggered je atomický guard proti duplicitním notifikacím)
 *
 * Chyby jednotlivých alertů nesmí shodit celý běh.
 */

import {
  getActiveAlerts,
  markAlertTriggered,
  type AlertRow,
} from "@/lib/data";
import { notifyAlert } from "@/lib/notifier";
import { computeSignal, type EventSignal } from "@/lib/signals";
import { getEvents } from "@/lib/simcotools";
import {
  getActiveContests,
  getLatestVwaps,
  getPricesAround24hAgo,
} from "@/lib/data";
import { formatPrice } from "@/lib/format";

/** Výsledek jednoho běhu evaluace (pro odpověď cronu). */
export type AlertRunResult = {
  evaluated: number;
  triggered: number;
  notified: number;
  errors: string[];
};

/** Skóre pro sadu položek – sdílená logika se skenerem. */
async function getScores(
  itemIds: number[]
): Promise<Map<number, number>> {
  const scores = new Map<number, number>();
  if (itemIds.length === 0) return scores;

  const [dayAgo, vwaps, events, contests] = await Promise.all([
    getPricesAround24hAgo(itemIds),
    getLatestVwaps(itemIds),
    getEvents().catch(() => []),
    getActiveContests(),
  ]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const eventsByItem = new Map<number, EventSignal[]>();
  for (const e of events.filter((e) => e.until.slice(0, 10) >= todayStr)) {
    const list = eventsByItem.get(e.resource) ?? [];
    list.push({
      resourceId: e.resource,
      speedModifier: e.speedModifier,
      until: e.until,
    });
    eventsByItem.set(e.resource, list);
  }

  // Ceny k datu potřebujeme pro skóre – poller je právě uložil
  const { getLatestPrices } = await import("@/lib/data");
  const latest = await getLatestPrices(0);
  const priceById = new Map(latest.map((r) => [r.item_id, r.price]));

  for (const id of itemIds) {
    const price = priceById.get(id) ?? null;
    const base = dayAgo.get(id);
    const change24h =
      price !== null && base && base > 0
        ? ((price - base) / base) * 100
        : null;

    const contest = contests.get(id);
    const signal = computeSignal({
      itemId: id,
      price,
      vwap: vwaps.get(id) ?? null,
      events: eventsByItem.get(id) ?? [],
      contest: contest
        ? { resourceId: id, name: contest.name, endDate: contest.endDate }
        : null,
      change24h,
    });

    scores.set(id, signal.score);
  }

  return scores;
}

/** Podmínka splněná? */
function conditionMet(
  alert: AlertRow,
  value: number
): boolean {
  return alert.direction === "above"
    ? value >= alert.threshold
    : value <= alert.threshold;
}

/** Popis alertu pro notifikaci. */
function describeAlert(alert: AlertRow, itemName: string, value: number): string {
  if (alert.kind === "price") {
    return `Cena ${itemName} je teď ${formatPrice(value)} – ${alert.direction === "above" ? "překročila" : "propadla pod"} práh ${formatPrice(alert.threshold)}.`;
  }
  return `Signal Engine skóre ${itemName} je ${value > 0 ? "+" : ""}${value} – ${alert.direction === "above" ? "dosáhlo" : "kleslo pod"} práh ${alert.direction === "above" ? "+" : ""}${alert.threshold}.`;
}

/**
 * Projde všechny aktivní alerty a notifikuje splněné.
 * `appUrl` – základní URL pro odkazy (např. https://simalytics.vercel.app).
 */
export async function evaluateAlerts(appUrl: string): Promise<AlertRunResult> {
  const result: AlertRunResult = {
    evaluated: 0,
    triggered: 0,
    notified: 0,
    errors: [],
  };

  try {
    const alerts = await getActiveAlerts();
    result.evaluated = alerts.length;
    if (alerts.length === 0) return result;

    // Skóre potřebujeme jen pro score alerty – šetříme requesty
    const scoreAlerts = alerts.filter((a) => a.kind === "score");
    const scoreItemIds = [...new Set(scoreAlerts.map((a) => a.item_id))];
    const scores =
      scoreItemIds.length > 0 ? await getScores(scoreItemIds) : new Map<number, number>();

    // Ceny: poslední tick per item (dotaz per alert – počet alertů je malý)
    const { getDb } = await import("@/lib/db");
    const db = getDb();

    for (const alert of alerts) {
      try {
        let value: number | null = null;

        if (alert.kind === "price") {
          const rows = (await db`
            select price from price_history
            where item_id = ${alert.item_id} and quality = ${alert.quality}
            order by recorded_at desc limit 1
          `) as unknown as { price: string }[];
          value = rows[0] ? Number(rows[0].price) : null;
        } else {
          value = scores.get(alert.item_id) ?? null;
        }

        if (value === null) continue;
        if (!conditionMet(alert, value)) continue;

        // Cooldown guard – atomický update, vrátí true jen při prvním
        // triggeru v rámci cooldownu (anti-spam)
        const shouldNotify = await markAlertTriggered(alert.id);
        if (!shouldNotify) continue;

        result.triggered++;

        const itemNameRows = (await db`
          select name from items where id = ${alert.item_id} limit 1
        `) as unknown as { name: string }[];
        const itemName = itemNameRows[0]?.name ?? `#${alert.item_id}`;

        const notified = await notifyAlert(
          {
            title:
              alert.kind === "price"
                ? `💰 Cenový alert: ${itemName}`
                : `🎯 Signálový alert: ${itemName}`,
            body: describeAlert(alert, itemName, value),
            url: `${appUrl}/market/${alert.item_id}`,
            kind: alert.kind,
          },
          process.env.ALERT_EMAIL_TO ?? null
        );

        if (notified) result.notified++;
      } catch (err) {
        result.errors.push(
          `alert ${alert.id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } catch (err) {
    result.errors.push(
      `evaluace: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return result;
}
