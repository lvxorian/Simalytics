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
  deleteAlert,
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
import { getDb } from "@/lib/db";

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
    getEvents().catch((err) => {
      // Konvence projektu: tiché catch u SQL/API dotazů zakazuje – chyba
      // viditelná jen jako prázdná data bývala zdrojem latentních bugů.
      console.error("[alerts] getEvents failed", err);
      return [];
    }),
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

/**
 * Podmínka splněná? Pro 'cross' je potřeba PŘEDCHOZÍ hodnota (crossover =
 * přechod přes práh) – volající ji dodá pro kind='price' z price_history.
 */
function conditionMet(
  alert: AlertRow,
  value: number,
  prevValue: number | null
): boolean {
  if (alert.direction === "cross") {
    if (prevValue === null) return false;
    return (
      (prevValue < alert.threshold && value >= alert.threshold) ||
      (prevValue > alert.threshold && value <= alert.threshold)
    );
  }
  return alert.direction === "above"
    ? value >= alert.threshold
    : value <= alert.threshold;
}

/** Popis alertu pro notifikaci. */
function describeAlert(alert: AlertRow, itemName: string, value: number): string {
  if (alert.kind === "limit_sell") {
    return `Limitní prodej ${itemName} Q${alert.quality}: cena je teď ${formatPrice(value)} – dosáhla tvého limitu ${formatPrice(alert.threshold)}. Prodáváš-li ve hře, odklepni to v portfoliu.`;
  }
  if (alert.kind === "price") {
    if (alert.direction === "cross") {
      return `Cena ${itemName} PŘEKŘÍCILA práh ${formatPrice(alert.threshold)} – teď je ${formatPrice(value)}${alert.one_shot ? " (jednorázový alert – po této aktivaci se maže)" : ""}.`;
    }
    return `Cena ${itemName} je teď ${formatPrice(value)} – ${alert.direction === "above" ? "překročila" : "propadla pod"} práh ${formatPrice(alert.threshold)}${alert.one_shot ? " (jednorázový)" : ""}.`;
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

    // Ceny + jména: JEDEN batch dotaz místo 2N per-alert dotazů (N+1).
    // Lateral join vezme 2 nejnovější ticky per (položka, kvalita) –
    // druhý nejnovější = předchozí cena pro CROSS alert.
    const db = getDb();
    const priceRows = (await db`
      select a.id as alert_id, a.item_id, a.quality, i.name as item_name,
             ph.price, ph.rn
      from alerts a
      join items i on i.id = a.item_id
      left join lateral (
        select price, row_number() over () as rn
        from price_history
        where price_history.item_id = a.item_id
          and price_history.quality = a.quality
        order by recorded_at desc
        limit 2
      ) ph on true
      where a.active = true
    `) as unknown as {
      alert_id: string;
      item_name: string;
      price: string | null;
      rn: number;
    }[];

    const priceByAlert = new Map<string, { value: number | null; prev: number | null }>();
    for (const r of priceRows) {
      const cur = priceByAlert.get(r.alert_id) ?? { value: null, prev: null };
      const p = r.price === null ? null : Number(r.price);
      if (r.rn === 1) cur.value = p;
      else if (r.rn === 2) cur.prev = p;
      priceByAlert.set(r.alert_id, cur);
    }
    const nameByAlert = new Map<string, string>();
    for (const r of priceRows) {
      if (!nameByAlert.has(r.alert_id)) nameByAlert.set(r.alert_id, r.item_name);
    }

    for (const alert of alerts) {
      try {
        let value: number | null = null;
        let prevValue: number | null = null;

        if (alert.kind === "price") {
          const prices = priceByAlert.get(alert.id);
          value = prices?.value ?? null;
          prevValue = prices?.prev ?? null;
        } else {
          value = scores.get(alert.item_id) ?? null;
        }

        if (value === null) continue;
        if (!conditionMet(alert, value, prevValue)) continue;

        // Cooldown guard – atomický update, vrátí true jen při prvním
        // triggeru v rámci cooldownu (anti-spam)
        const shouldNotify = await markAlertTriggered(alert.id);
        if (!shouldNotify) continue;

        result.triggered++;

        // One-shot: po první aktivaci se alert SMAŽE – ale jen když
        // notifikace REÁLNĚ dorazila (notifyAlert níže se čeká, vrací
        // false při selhání webhooku i e-mailu; jinak by výpadek kanálu
        // ztratil alert navždy). Při selhání alert zůstává – příští
        // evaluaci to zkusí znovu (cooldown 60 min).
        const itemName = nameByAlert.get(alert.id) ?? `#${alert.item_id}`;

        const notified = await notifyAlert(
          {
            title:
              alert.kind === "limit_sell"
                ? `🏷️ Limitní prodej dosažen: ${itemName}`
                : alert.kind === "price"
                  ? `💰 Cenový alert: ${itemName}`
                  : `🎯 Signálový alert: ${itemName}`,
            body: describeAlert(alert, itemName, value),
            url: `${appUrl}/portfolio`,
            kind: alert.kind,
          },
          process.env.ALERT_EMAIL_TO ?? null
        );

        if (notified) result.notified++;
        if (alert.one_shot && notified) {
          await deleteAlert(alert.id);
        }
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
