/**
 * Agregace cenových bodů (ticků z price_history) na OHLC svíčky.
 *
 * Tick přichází každých 15 minut ⇒ svíčka "1h" = 4 ticky, "1d" = 96 ticků.
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

/** Intervalové volby pro přepínač na stránce grafu. */
export const INTERVAL_OPTIONS = [
  { key: "1h", label: "1H", seconds: 60 * 60 },
  { key: "6h", label: "6H", seconds: 6 * 60 * 60 },
  { key: "1d", label: "1D", seconds: 24 * 60 * 60 },
  { key: "7d", label: "1W", seconds: 7 * 24 * 60 * 60 },
] as const;

export type IntervalKey = (typeof INTERVAL_OPTIONS)[number]["key"];

export function resolveInterval(key: string | undefined): number {
  return (
    INTERVAL_OPTIONS.find((o) => o.key === key)?.seconds ?? 24 * 60 * 60
  );
}
