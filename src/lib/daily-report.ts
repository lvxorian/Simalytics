/**
 * Denní investorský souhrn – čistě rule-based (žádný AI model).
 *
 * Staví na datech, která už aplikace má:
 *  - ceny + 24h změny (price_history),
 *  - denní VWAP = „fair value“ (market_vwap_daily, denní sync),
 *  - eventy = nabídkové šoky (Simco Tools),
 *  - soutěže = poptávkové spiky (contests, denní sync),
 *  - skóre Signal Engine (lib/signals),
 *  - vlastní otevřené pozice (P/L).
 *
 * Výstup: strukturovaný report se sekcemi (souhrn, pohyby, doporučení,
 * rizika, kontext pozic) – UI jen renderuje, logika je tady a je
 * deterministická (stejná data ⇒ stejný text).
 */

import { formatCompact, formatPrice } from "@/lib/format";
import { getResourceProfile } from "@/lib/resource-profiles";
import { computeSignal, type EventSignal } from "@/lib/signals";

// ── Vstupní typy ───────────────────────────────────────────────────

/** Řádek trhu pro report (subset MarketRow). */
export type ReportMarketRow = {
  item_id: number;
  name: string;
  image_url: string | null;
  category: string | null;
  price: number;
  quantity: number | null;
  change24h: number | null;
};

/** Aktivní event ve tvaru ze skeneru. */
export type ReportEvent = EventSignal;

/** Otevřená pozice ve tvaru z getPositionsWithPnl. */
export type ReportPosition = {
  item_id: number;
  item_name: string;
  quantity: number;
  buy_price: number;
  current_price: number | null;
  unrealized_pl: number | null;
  unrealized_pl_pct: number | null;
};

/** Data potřebná pro sestavení reportu. */
export type DailyReportInput = {
  rows: ReportMarketRow[];
  vwap: Map<number, number>;
  events: ReportEvent[];
  contests: Map<number, { name: string; endDate: string }>;
  positions: ReportPosition[];
  /** Čas generování (testovatelnost; default now). */
  now?: Date;
};

// ── Výstupní typy ──────────────────────────────────────────────────

export type ReportPick = {
  itemId: number;
  name: string;
  imageUrl: string | null;
  price: number | null;
  change24h: number | null;
  score: number;
  direction: "BUY" | "SELL" | "NEUTRAL";
  /** argumenty proč (krátké řádky s body) */
  reasons: { label: string; points: number }[];
  /** jedna věta „co s tím“ – rule-based dle skóre a VWAP divergence */
  action: string;
};

export type ReportRisk = {
  itemId: number;
  name: string;
  reason: string;
};

export type DailyReport = {
  generatedAt: string;
  /** Nadpis typu „Trh v plusu: průměr +1,2 %“ */
  headline: string;
  /** Hodnocení dne: up | down | flat */
  tone: "up" | "down" | "flat";
  /** 1–2 věty: co se na trhu dělo. */
  summary: string;
  breadth: {
    total: number;
    gainers: number;
    losers: number;
    flat: number;
    avgChange: number | null;
    medianChange: number | null;
  };
  /** Největší pohyby s kontextem (event/contest, když existuje). */
  movers: {
    itemId: number;
    name: string;
    imageUrl: string | null;
    price: number | null;
    change24h: number | null;
    /** rule-based vysvětlení pohybu (event/contest/momentum), nebo null */
    context: string | null;
  }[];
  topGainersCount: number;
  topLosersCount: number;
  /** Doporučení BUY i SELL seřazená dle |skóre|. */
  picks: ReportPick[];
  /** Pozor na… (přehřáté vs. VWAP, expirace eventů apod.) */
  risks: ReportRisk[];
  /** Kontext vlastních pozic – co dělat s otevřenými. */
  positionsNote: {
    openCount: number;
    items: {
      itemId: number;
      name: string;
      plPct: number | null;
      pl: number | null;
      action: string;
    }[];
  } | null;
};

// ── Konstanty prahů (sdílená logika se skenerem) ───────────────────

const PICK_MIN_SCORE = 25; // stejné jako BUY/SELL práh ve signals.ts
const PICK_MAX = 6; // max doporučení v reportu
const MOVER_MIN_CHANGE = 3; // % za 24h, aby to byl „pohyb“
const OVERHEAT_VS_VWAP = 0.08; // +8 % nad denní VWAP = přehřáté
const OVERSOLD_VS_VWAP = -0.08; // −8 % pod VWAP = přeprodané
const POSITION_TAKE_PROFIT = 15; // % zisk ⇒ doporučit realizaci
const POSITION_STOP_LOSS = -10; // % ztráta ⇒ doporučit revidovat

// ── Pomocné ────────────────────────────────────────────────────────

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmtPct(v: number | null): string {
  if (v === null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)} %`;
}

/** Kategória suroviny z profilu (Zemědělství, Důl, …) pro akci. */
function categoryLabel(itemId: number): string | null {
  const p = getResourceProfile(itemId);
  return p?.producedAtName ?? null;
}

// ── Hlavní generátor ───────────────────────────────────────────────

/**
 * Sestaví denní report. Pure vůči vstupům (now jde zvenku) – stejná
 * data vždy dají stejný výstup, žádný AI model, jen pravidla.
 */
export function buildDailyReport(input: DailyReportInput): DailyReport {
  const now = input.now ?? new Date();
  const { rows, vwap, contests, positions } = input;

  // Eventy per item
  const eventsByItem = new Map<number, ReportEvent[]>();
  for (const ev of input.events) {
    const list = eventsByItem.get(ev.resourceId) ?? [];
    list.push(ev);
    eventsByItem.set(ev.resourceId, list);
  }

  // ── Breadth ──────────────────────────────────────────────────
  const withChange = rows.filter((r) => r.change24h !== null);
  const gainers = withChange.filter((r) => (r.change24h ?? 0) > 0.05);
  const losers = withChange.filter((r) => (r.change24h ?? 0) < -0.05);
  const flat = rows.length - gainers.length - losers.length;
  const changes = withChange.map((r) => r.change24h as number);
  const avgChange =
    changes.length > 0
      ? changes.reduce((s, v) => s + v, 0) / changes.length
      : null;
  const medianChange = median(changes);

  // ── Tone + headline + summary ────────────────────────────────
  const avg = avgChange ?? 0;
  const tone: DailyReport["tone"] =
    avg > 0.4 ? "up" : avg < -0.4 ? "down" : "flat";
  const toneWord =
    tone === "up" ? "Trh v plusu" : tone === "down" ? "Trh v minusu" : "Trh bez směru";

  const leadersUp = [...withChange]
    .sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0))
    .slice(0, 3)
    .filter((r) => (r.change24h ?? 0) > MOVER_MIN_CHANGE);
  const leadersDown = [...withChange]
    .sort((a, b) => (a.change24h ?? 0) - (b.change24h ?? 0))
    .slice(0, 3)
    .filter((r) => (r.change24h ?? 0) < -MOVER_MIN_CHANGE);

  const parts: string[] = [];
  parts.push(
    tone === "up"
      ? `Většina trhu roste – ${gainers.length} z ${withChange.length} komodit si připsalo za 24 h.`
      : tone === "down"
        ? `Převažuje prodejní nálada – ${losers.length} z ${withChange.length} komodit kleslo.`
        : `Trh je vyrovnaný – ${gainers.length} roste proti ${losers.length} klesajícím.`
  );
  if (leadersUp.length > 0) {
    parts.push(
      `Nejvíc táhnou ${leadersUp
        .map((r) => `${r.name} ${fmtPct(r.change24h)}`)
        .join(", ")}.`
    );
  }
  if (leadersDown.length > 0) {
    parts.push(
      `Největší poklesy ${leadersDown
        .map((r) => `${r.name} ${fmtPct(r.change24h)}`)
        .join(", ")}.`
    );
  }
  const activeEvents = input.events.length;
  if (activeEvents > 0) {
    parts.push(
      `Aktivních eventů ovlivňujících výrobu: ${activeEvents}${
        contests.size > 0 ? `, běžících soutěží: ${contests.size}` : ""
      }.`
    );
  } else if (contests.size > 0) {
    parts.push(`Běžících soutěží: ${contests.size}.`);
  }

  const summary = parts.join(" ");

  // ── Movers + rule-based kontext pohybu ───────────────────────
  const sortedByChange = [...withChange].sort(
    (a, b) => (b.change24h ?? 0) - (a.change24h ?? 0)
  );
  const moversRaw = [
    ...sortedByChange.slice(0, 4),
    ...sortedByChange.slice(-4).reverse(),
  ];
  const seenMover = new Set<number>();
  const movers = moversRaw
    .filter((r) => {
      if (seenMover.has(r.item_id)) return false;
      seenMover.add(r.item_id);
      return Math.abs(r.change24h ?? 0) >= MOVER_MIN_CHANGE;
    })
    .slice(0, 6)
    .map((r) => ({
      itemId: r.item_id,
      name: r.name,
      imageUrl: r.image_url,
      price: r.price,
      change24h: r.change24h,
      context: moverContext(r, eventsByItem.get(r.item_id) ?? [], contests.get(r.item_id) ?? null),
    }));

  // ── Signály pro všechna aktiva ───────────────────────────────
  const scored = rows.map((r) => {
    const signal = computeSignal({
      itemId: r.item_id,
      price: r.price,
      vwap: vwap.get(r.item_id) ?? null,
      events: eventsByItem.get(r.item_id) ?? [],
      contest: contests.get(r.item_id)
        ? {
            resourceId: r.item_id,
            name: contests.get(r.item_id)!.name,
            endDate: contests.get(r.item_id)!.endDate,
          }
        : null,
      change24h: r.change24h,
    });
    return { row: r, signal };
  });

  // ── Doporučení (BUY i SELL dle |skóre|) ──────────────────────
  const picksRaw = scored
    .filter(({ signal }) => Math.abs(signal.score) >= PICK_MIN_SCORE)
    .sort((a, b) => Math.abs(b.signal.score) - Math.abs(a.signal.score))
    .slice(0, PICK_MAX);

  const picks: ReportPick[] = picksRaw.map(({ row, signal }) => ({
    itemId: row.item_id,
    name: row.name,
    imageUrl: row.image_url,
    price: row.price,
    change24h: row.change24h,
    score: signal.score,
    direction: signal.direction,
    reasons: signal.reasons
      .slice()
      .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
      .map((r) => ({ label: r.label, points: r.points })),
    action: pickAction(row, signal.score, vwap.get(row.item_id) ?? null),
  }));

  // ── Rizika ───────────────────────────────────────────────────
  const risks: ReportRisk[] = [];

  // 1) Přehřáté vs. fair value (moc nad VWAP ⇒ riziko návratu)
  const overheated = scored
    .filter(({ row }) => {
      const v = vwap.get(row.item_id);
      return v != null && v > 0 && row.price / v - 1 > OVERHEAT_VS_VWAP;
    })
    .sort(
      (a, b) =>
        b.row.price / vwap.get(b.row.item_id)! -
        a.row.price / vwap.get(a.row.item_id)!
    )
    .slice(0, 3);
  for (const { row } of overheated) {
    const v = vwap.get(row.item_id)!;
    risks.push({
      itemId: row.item_id,
      name: row.name,
      reason: `Cena ${((row.price / v - 1) * 100).toFixed(0)} % nad denním VWAPem – nadhodnoceno vs. reálný obrat, hrozí návrat k fair value.`,
    });
  }

  // 2) Eventy brzy končí ⇒ efekty odezní (inverze doháněných pohybů)
  const expiring = input.events
    .filter((e) => {
      const days = daysUntil(e.until, now);
      return days >= 0 && days <= 2;
    })
    .slice(0, 3);
  for (const ev of expiring) {
    const name = rows.find((r) => r.item_id === ev.resourceId)?.name;
    if (!name) continue;
    risks.push({
      itemId: ev.resourceId,
      name,
      reason: `Event (${ev.speedModifier > 0 ? "+" : ""}${ev.speedModifier} % produkce) končí za ${Math.max(0, Math.ceil(daysUntil(ev.until, now)))} d – efekt na nabídku odezní.`,
    });
  }

  // 3) Klesající trend bez podpory eventů = czystý momentum pokles
  const falling = scored
    .filter(({ row, signal }) => (row.change24h ?? 0) < -MOVER_MIN_CHANGE && signal.reasons.every((r) => r.kind !== "event" && r.kind !== "contest"))
    .sort((a, b) => (a.row.change24h ?? 0) - (b.row.change24h ?? 0))
    .slice(0, 3);
  for (const { row } of falling) {
    risks.push({
      itemId: row.item_id,
      name: row.name,
      reason: `Pokles ${fmtPct(row.change24h)} bez eventového nebo soutěžního katalyzátoru – čistý momentum, kontra-trend je spekulace.`,
    });
  }

  // ── Kontext pozic ────────────────────────────────────────────
  const positionsNote =
    positions.length > 0
      ? {
          openCount: positions.length,
          items: positions
            .slice()
            .sort((a, b) => (b.unrealized_pl_pct ?? -999) - (a.unrealized_pl_pct ?? -999))
            .slice(0, 5)
            .map((p) => ({
              itemId: p.item_id,
              name: p.item_name,
              plPct: p.unrealized_pl_pct,
              pl: p.unrealized_pl,
              action: positionAction(p),
            })),
        }
      : null;

  return {
    generatedAt: now.toISOString(),
    headline: `${toneWord}: průměr ${fmtPct(avgChange === null ? null : avgChange)}`,
    tone,
    summary,
    breadth: {
      total: rows.length,
      gainers: gainers.length,
      losers: losers.length,
      flat,
      avgChange,
      medianChange,
    },
    movers,
    topGainersCount: gainers.length,
    topLosersCount: losers.length,
    picks,
    risks,
    positionsNote,
  };
}

// ── Rule-based texty ───────────────────────────────────────────────

function daysUntil(dateStr: string, now: Date): number {
  return (
    (new Date(dateStr).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
  );
}

/** Kontext pohybu: event / contest / čistý momentum. */
function moverContext(
  row: ReportMarketRow,
  events: ReportEvent[],
  contest: { name: string } | null
): string | null {
  if (events.length > 0) {
    const ev = events[0];
    const bullish = ev.speedModifier < 0; // méně produkce ⇒ cena vzhůru
    const matches = bullish === (row.change24h ?? 0) > 0;
    return matches
      ? `Event mění produkci o ${ev.speedModifier > 0 ? "+" : ""}${ev.speedModifier} % – nabídka vysvětluje pohyb.`
      : `Event mění produkci o ${ev.speedModifier > 0 ? "+" : ""}${ev.speedModifier} %, ale pohyb jde proti němu – pozor na prohození směru.`;
  }
  if (contest) {
    return `Běží soutěž „${contest.name}“ – poptávkový spike může pohyb držet.`;
  }
  if ((row.change24h ?? 0) > MOVER_MIN_CHANGE) {
    return "Silný nákupní momentum bez viditelného katalyzátoru – sleduj, jestli se potvrdí objemem.";
  }
  if ((row.change24h ?? 0) < -MOVER_MIN_CHANGE) {
    return "Prodejní tlak bez viditelného katalyzátoru – sleduj, jestli se cena ustálí u denního VWAPu.";
  }
  return null;
}

/** Akce pro doporučení: jedna věta dle směru + vzdálenosti od VWAP. */
function pickAction(
  row: ReportMarketRow,
  score: number,
  vwap: number | null
): string {
  const building = categoryLabel(row.item_id);
  const where = building ? ` (výroba: ${building})` : "";
  const diverg =
    vwap != null && vwap > 0 ? row.price / vwap - 1 : null;

  if (score >= PICK_MIN_SCORE) {
    if (diverg != null && diverg > OVERHEAT_VS_VWAP) {
      return `Silný nákupní signál, ale cena už je ${fmtPct(diverg * 100)} nad denním VWAPem${where} – vstup po korekci, ne do růstu.`;
    }
    return `Nákupní set-up${where} – vstupovat po kusech, referenční cena ${formatPrice(row.price)}.`;
  }
  if (score <= -PICK_MIN_SCORE) {
    if (diverg != null && diverg < OVERSOLD_VS_VWAP) {
      return `Silný prodejní signál, ale cena je ${fmtPct(diverg * 100)} pod denním VWAPem${where} – prodej po odrazu, ne do propadu.`;
    }
    return `Prodejní set-up${where} – odprodej po kusech, referenční cena ${formatPrice(row.price)}.`;
  }
  return "Bez jasné akce – sleduj potvrzení signálu.";
}

/** Akce pro vlastní pozici dle P/L. */
function positionAction(p: ReportPosition): string {
  const pl = p.unrealized_pl_pct;
  if (pl === null) return "Cena nedostupná – nemohu vyhodnotit.";
  if (pl >= POSITION_TAKE_PROFIT) {
    return `V zisku ${fmtPct(pl)} – zvaž částečnou realizaci.`;
  }
  if (pl <= POSITION_STOP_LOSS) {
    return `V ztrátě ${fmtPct(pl)} – reviduj tezi; padá-li bez katalyzátoru, zvaž odkoupení.`;
  }
  return `V korekci ${fmtPct(pl)} – drž, dokud platí původní teze.`;
}

/** Kompaktní souhrn breadth pro tickery/OG apod. (utilita navíc). */
export function reportBreadthLine(report: DailyReport): string {
  const b = report.breadth;
  return `${b.gainers}▲ / ${b.losers}▼ z ${b.total} · průměr ${fmtPct(b.avgChange)}`;
}

/** Formátovaný obrat/objem pro UI – wrapper kvůli konvenci cen. */
export function formatQuantity(q: number | null): string {
  return q === null ? "–" : `${formatCompact(q)} ks`;
}
