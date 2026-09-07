/**
 * Agregace cenových bodů (ticků z price_history) na OHLC svíčky
 * + technické indikátory (SMA, EMA, Bollinger Bands, RSI).
 *
 * Tick přichází každých 5 minut ⇒ svíčka "1h" = 12 ticků, "1d" = 288 ticků.
 * Čas svíčky = začátek bucketu v unixových sekundách (UTC),
 * což je přesný formát, který Lightweight Charts očekává.
 */

export type Candle = {
  time: number; // unix seconds (UTC) – začátek bucketu
  open: number;
  high: number;
  low: number;
  close: number;
};

export type PriceTick = { recorded_at: string; price: number };

export function toCandles(
  ticks: PriceTick[],
  intervalSeconds: number
): Candle[] {
  const sorted = [...ticks].sort(
    (a, b) =>
      new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  const buckets = new Map<number, Candle>();

  for (const tick of sorted) {
    const timeSec = Math.floor(new Date(tick.recorded_at).getTime() / 1000);
    const bucketStart = Math.floor(timeSec / intervalSeconds) * intervalSeconds;
    const price = Number(tick.price);

    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, {
        time: bucketStart,
        open: price,
        high: price,
        low: price,
        close: price,
      });
    } else {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price; // poslední tick v bucketu = close
    }
  }

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

// ── Weekly / monthly agregace z denních svíček ──────────────────────

/**
 * Sloučí denní svíčky na týdenní (ISO týden, začátek pondělí) nebo
 * měsíční (1. den měsíce). `mode` určuje velikost bucketu.
 */
export function aggregateDaily(
  daily: Candle[],
  mode: "1w" | "1M"
): Candle[] {
  const sorted = [...daily].sort((a, b) => a.time - b.time);
  const buckets = new Map<number, Candle>();

  for (const c of sorted) {
    const d = new Date(c.time * 1000);
    let bucketStart: number;

    if (mode === "1w") {
      // pondělí daného ISO týdne (UTC)
      const day = d.getUTCDay(); // 0 = nedele
      const diffToMonday = (day + 6) % 7; // 0 pro pondeli
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - diffToMonday);
      monday.setUTCHours(0, 0, 0, 0);
      bucketStart = Math.floor(monday.getTime() / 1000);
    } else {
      // první den měsíce (UTC)
      bucketStart = Math.floor(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
      );
    }

    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, { ...c, time: bucketStart });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close; // poslední den = close
    }
  }

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

// ── Technické indikátory ────────────────────────────────────────────

export type LinePoint = { time: number; value: number };

/** Jednoduchý klouzavý průměr. */
export function sma(candles: Candle[], period: number): LinePoint[] {
  if (candles.length < period) return [];
  const out: LinePoint[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) {
      out.push({ time: candles[i].time, value: sum / period });
    }
  }
  return out;
}

/** Exponenciální klouzavý průměr. */
export function ema(candles: Candle[], period: number): LinePoint[] {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  const out: LinePoint[] = [];
  let prev = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  out.push({ time: candles[period - 1].time, value: prev });
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

/** Bollinger Bands (střed = SMA, pásky = ±2σ). */
export function bollingerBands(
  candles: Candle[],
  period = 20,
  mult = 2
): { middle: LinePoint[]; upper: LinePoint[]; lower: LinePoint[] } {
  if (candles.length < period) return { middle: [], upper: [], lower: [] };
  const middle: LinePoint[] = [];
  const upper: LinePoint[] = [];
  const lower: LinePoint[] = [];

  for (let i = period - 1; i < candles.length; i++) {
    const window = candles.slice(i - period + 1, i + 1);
    const mean = window.reduce((s, c) => s + c.close, 0) / period;
    const variance =
      window.reduce((s, c) => s + (c.close - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    middle.push({ time: candles[i].time, value: mean });
    upper.push({ time: candles[i].time, value: mean + mult * sd });
    lower.push({ time: candles[i].time, value: mean - mult * sd });
  }
  return { middle, upper, lower };
}

/** RSI (Wilder) – 0–100, >70 překoupeno, <30 přeprodáno. */
export function rsi(candles: Candle[], period = 14): LinePoint[] {
  if (candles.length <= period) return [];
  const out: LinePoint[] = [];

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out.push({
    time: candles[period].time,
    value: avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss),
  });

  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push({
      time: candles[i].time,
      value: avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss),
    });
  }
  return out;
}

/**
 * Intervalové volby pro přepínač na stránce grafu.
 * `days` = jak hlubokou historii ticků tahat pro daný TF
 * (minimální TF = interval polleru – ticky sbíráme každých 5 min).
 * `1w`/`1M` se agregují z denních svíček (Simco Tools, ~3 měsíce).
 */
export const INTERVAL_OPTIONS = [
  { key: "5m", label: "5m", seconds: 5 * 60, days: 2 },
  { key: "15m", label: "15m", seconds: 15 * 60, days: 7 },
  { key: "1h", label: "1H", seconds: 60 * 60, days: 30 },
  { key: "4h", label: "4H", seconds: 4 * 60 * 60, days: 90 },
  { key: "1d", label: "1D", seconds: 24 * 60 * 60, days: 95 },
  { key: "1w", label: "1W", seconds: 7 * 24 * 60 * 60, days: 0 },
  { key: "1M", label: "1M", seconds: 30 * 24 * 60 * 60, days: 0 },
] as const;

export type IntervalKey = (typeof INTERVAL_OPTIONS)[number]["key"];

export function resolveIntervalOption(key: string | undefined) {
  return INTERVAL_OPTIONS.find((o) => o.key === key) ?? INTERVAL_OPTIONS[4];
}
