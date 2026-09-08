/**
 * Signal Engine – jádro „revolučního" nástroje Simalytics.
 *
 * Skládá čistě technický skóre (−100…+100) pro každou komoditu z:
 *   1. Event radar      – random eventy mění rychlost výroby ⇒ nabídkový šok
 *   2. Contest radar    – soutěže zvyšují poptávku po jedné komoditě
 *   3. VWAP divergence  – cena vs. denní VWAP = „fair value" odchylka
 *   4. Momentum         – 24h změna ceny
 *
 * Funkce jsou pure (žádný I/O) ⇒ snadno testovatelné a znovupoužitelné.
 * Všechny vstupy jsou už zkonvertované na number (data.ts hranice).
 */

// ── Vstupní typy ───────────────────────────────────────────────────

/** Aktivní event ovlivňující rychlost výroby komodity. */
export type EventSignal = {
  resourceId: number;
  speedModifier: number; // % změna rychlosti výroby (−30…+30)
  until: string; // ISO datum konce eventu
};

/** Aktivní soutěž (contest) pro komoditu. */
export type ContestSignal = {
  resourceId: number;
  name: string;
  endDate: string;
};

/** Vstup pro výpočet skóre jedné komodity. */
export type SignalInput = {
  itemId: number;
  price: number | null;
  vwap: number | null; // denní VWAP (včera / poslední dostupný)
  events: EventSignal[];
  contest: ContestSignal | null;
  change24h: number | null;
};

/** Výstup skórování – vše, co skener zobrazuje. */
export type SignalResult = {
  itemId: number;
  score: number; // −100…+100
  direction: "BUY" | "SELL" | "NEUTRAL";
  reasons: SignalReason[];
};

export type SignalReason = {
  label: string; // krátký popis pro UI
  points: number; // příspěvek ke skóre
  kind: "event" | "contest" | "vwap" | "momentum";
};

// ── Konstanty skórování ────────────────────────────────────────────

/** Silný event (≥ 20 % změna rychlosti) = významný nabídkový šok. */
const EVENT_STRONG_THRESHOLD = 20;
/** Eventy do 14 dní do konce se počítají plně, pak lineárně odeznívají. */
const EVENT_DECAY_DAYS = 14;
const EVENT_MAX_POINTS = 35;

/** Contest = poptávkový spike, platí jen když běží. */
const CONTEST_MAX_POINTS = 30;

/** VWAP divergence: |cena − VWAP| / VWAP. Práh pro signál = 5 %. */
const VWAP_DIVERGENCE_STRONG = 0.05;
const VWAP_MAX_POINTS = 25;

/** Momentum: 24h změna v %. */
const MOMENTUM_MAX_POINTS = 20;
const MOMENTUM_STRONG = 5; // % změny pro plné skóre

// ── Jednotlivé signály ─────────────────────────────────────────────

/**
 * Event radar: snížení rychlosti výroby (negativní modifier) ⇒ méně
 * nabídky ⇒ cenový tlak VZHORU (bullish). Zvýšení rychlosti ⇒ více
 * nabídky ⇒ tlak DOLŮ (bearish). Síla lineárně klesá s blížícím se
 * koncem eventu.
 */
export function eventPoints(
  events: EventSignal[],
  now = new Date()
): SignalReason[] {
  const out: SignalReason[] = [];

  for (const event of events) {
    const daysLeft = Math.max(
      0,
      (new Date(event.until).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
    );
    // Dekaj: plná síla po prvních 14 dní, pak lineárně k nule
    const decay = Math.min(1, daysLeft / EVENT_DECAY_DAYS);
    const magnitude = Math.min(
      1,
      Math.abs(event.speedModifier) / EVENT_STRONG_THRESHOLD
    );
    const raw = magnitude * decay * EVENT_MAX_POINTS;

    if (raw < 1) continue; // zanedbatelné

    const points = event.speedModifier < 0 ? raw : -raw;
    out.push({
      label: `Event: ${
        event.speedModifier < 0 ? "méně" : "víc"
      } produkce (${event.speedModifier > 0 ? "+" : ""}${
        event.speedModifier
      } %, ${Math.ceil(daysLeft)} dní do konce)`,
      points: Math.round(points),
      kind: "event",
    });
  }

  return out;
}

/** Contest radar: aktivní soutěž = poptávkový spike = bullish. */
export function contestPoints(
  contest: ContestSignal | null,
  now = new Date()
): SignalReason[] {
  if (!contest) return [];

  const daysLeft = Math.max(
    0,
    (new Date(contest.endDate).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
  );
  // Contest na konci ztrácí sílu (hráči už nakoupili)
  const decay = Math.min(1, daysLeft / 7);
  const points = Math.round(CONTEST_MAX_POINTS * decay);

  if (points < 2) return [];

  return [
    {
      label: `Soutěž „${contest.name}" – poptávkový spike (${Math.ceil(
        daysLeft
      )} dní do konce)`,
      points,
      kind: "contest",
    },
  ];
}

/**
 * VWAP divergence: cena nad denním VWAPem = draho vs. reálný obrat
 * (bearish, mean-reversion), pod VWAPem = levno (bullish).
 */
export function vwapPoints(
  price: number | null,
  vwap: number | null
): SignalReason[] {
  if (price === null || vwap === null || vwap <= 0) return [];

  const divergence = (price - vwap) / vwap; // + = draho, − = levno

  // Lineární mapování: ±5 % divergence = plné ±VWAP_MAX_POINTS
  const raw =
    (Math.min(Math.abs(divergence), VWAP_DIVERGENCE_STRONG) /
      VWAP_DIVERGENCE_STRONG) *
    VWAP_MAX_POINTS;

  if (raw < 2) return [];

  return [
    {
      label: `VWAP divergence ${divergence > 0 ? "+" : ""}${(
        divergence * 100
      ).toFixed(1)} % vs. denní VWAP`,
      points: divergence > 0 ? -Math.round(raw) : Math.round(raw),
      kind: "vwap",
    },
  ];
}

/** Momentum: krátkodobý trend (pokračování) – 24h změna. */
export function momentumPoints(change24h: number | null): SignalReason[] {
  if (change24h === null) return [];

  const raw =
    (Math.min(Math.abs(change24h), MOMENTUM_STRONG) / MOMENTUM_STRONG) *
    MOMENTUM_MAX_POINTS;

  if (raw < 2) return [];

  return [
    {
      label: `Momentum ${change24h > 0 ? "+" : ""}${change24h.toFixed(2)} % / 24h`,
      points: change24h > 0 ? Math.round(raw) : -Math.round(raw),
      kind: "momentum",
    },
  ];
}

// ── Celkové skóre ──────────────────────────────────────────────────

/** Složí všechna dílčí skóre do finálního výsledku. */
export function computeSignal(input: SignalInput): SignalResult {
  const reasons = [
    ...eventPoints(input.events),
    ...contestPoints(input.contest),
    ...vwapPoints(input.price, input.vwap),
    ...momentumPoints(input.change24h),
  ];

  const total = reasons.reduce((sum, r) => sum + r.points, 0);
  const score = Math.max(-100, Math.min(100, total));

  const direction: SignalResult["direction"] =
    score >= 25 ? "BUY" : score <= -25 ? "SELL" : "NEUTRAL";

  return { itemId: input.itemId, score, direction, reasons };
}

// ── Pomocné pro UI ─────────────────────────────────────────────────

/** Barva skóre – konzistentní s design systémem (text-up / text-down). */
export function scoreColorClass(score: number): string {
  if (score >= 25) return "text-up";
  if (score <= -25) return "text-down";
  return "text-muted-foreground";
}

/** Popis směru v češtině. */
export const DIRECTION_LABELS: Record<SignalResult["direction"], string> = {
  BUY: "Nákupní signál",
  SELL: "Prodejní signál",
  NEUTRAL: "Bez signálu",
};
