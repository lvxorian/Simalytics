import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";

import { PriceChart } from "@/components/price-chart";
import { StarButton } from "@/components/star-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  INTERVAL_OPTIONS,
  resolveIntervalOption,
  toCandles,
  type Candle,
} from "@/lib/candles";
import {
  getDailyCandles,
  getItem,
  getPriceHistory,
  getPricesAround24hAgo,
  getWatchedIds,
  isTracked,
} from "@/lib/data";
import { formatPrice, itemImageUrl } from "@/lib/format";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ resourceId: string }>;
  searchParams: Promise<{ interval?: string; mode?: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ resourceId: string }>;
}): Promise<Metadata> {
  const { resourceId } = await params;
  const item = await getItem(Number(resourceId)).catch(() => null);
  return { title: item ? item.name : "Graf položky" };
}

function buildQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Unix sekundy dne (YYYY-MM-DD v UTC). */
const dayToUnix = (day: string) =>
  Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);

export default async function MarketItemPage({
  params,
  searchParams,
}: PageProps) {
  const { resourceId } = await params;
  const { interval, mode } = await searchParams;
  const id = Number(resourceId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const item = await getItem(id);
  if (!item) notFound();

  const opt = resolveIntervalOption(interval);
  const watchedIds = await getWatchedIds();
  const tracked = await isTracked(id);

  // ── Data pro graf ─────────────────────────────────────────────────
  let candles: Candle[] = [];
  let volume: { time: number; value: number }[] | undefined;
  let vwap: { time: number; value: number }[] | undefined;
  let dataSource = "";

  if (opt.key === "1d") {
    // Denní svíčky z backfillu (Simco Tools, ~3 měsíce, s objemem a VWAP)
    const daily = await getDailyCandles(id);
    candles = daily.map((c) => ({
      time: dayToUnix(c.day),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    volume = daily
      .filter((c) => c.volume !== null)
      .map((c) => ({ time: dayToUnix(c.day), value: c.volume! }));
    vwap = daily
      .filter((c) => c.vwap !== null)
      .map((c) => ({ time: dayToUnix(c.day), value: c.vwap! }));
    dataSource = "denní svíčky · Simco Tools";

    // Dnešní (rozpracovaná) svíčka z našich ticků – Simco Tools ji
    // publikuje až po skončení dne
    const ticks = await getPriceHistory(id, 0, 2);
    const todayStart = Math.floor(
      new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime() /
        1000
    );
    const todayCandles = toCandles(
      ticks.filter(
        (t) => Math.floor(new Date(t.recorded_at).getTime() / 1000) >= todayStart
      ),
      86400
    );
    const lastStored = candles[candles.length - 1]?.time ?? 0;
    const today = todayCandles[todayCandles.length - 1];
    if (today && today.time > lastStored) {
      candles.push(today);
      dataSource = "denní svíčky + dnešní ticky";
    }
  } else {
    // Intraday TF agregované z našich ticků (poller každých 5 minut)
    const ticks = await getPriceHistory(id, 0, opt.days);
    candles = toCandles(ticks, opt.seconds);
    dataSource = `ticky · posledních ${opt.days} dní`;
  }

  const lastTick =
    candles.length > 0 ? candles[candles.length - 1].close : null;
  const dayAgo = await getPricesAround24hAgo([id]);
  const base = dayAgo.get(id);
  const change24h =
    lastTick !== null && base && base > 0
      ? ((lastTick - base) / base) * 100
      : null;

  const periodHigh = candles.length ? Math.max(...candles.map((c) => c.high)) : null;
  const periodLow = candles.length ? Math.min(...candles.map((c) => c.low)) : null;
  const periodAvg = candles.length
    ? candles.reduce((sum, c) => sum + c.close, 0) / candles.length
    : null;

  const img = itemImageUrl(item.image_url);
  const up = (change24h ?? 0) > 0;
  const down = (change24h ?? 0) < 0;
  const chartMode = mode === "area" ? "area" : "candles";

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={60_000} />

      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Zpět na trh
      </Link>

      {/* Hlavička položky */}
      <div className="flex flex-wrap items-center gap-4">
        {img && (
          <Image
            src={img}
            alt={item.name}
            width={48}
            height={48}
            className="rounded bg-secondary p-1"
          />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{item.name}</h1>
            {item.db_letter && (
              <Badge variant="outline" className="font-mono">
                {item.db_letter}
              </Badge>
            )}
            <Badge variant="outline" className="font-mono">
              Q0
            </Badge>
            <StarButton itemId={id} watched={watchedIds.has(id)} />
          </div>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-3xl font-semibold text-primary">
              {formatPrice(lastTick)}
            </span>
            <span
              className={cn(
                "font-mono text-sm",
                up && "text-emerald-400",
                down && "text-red-400",
                !up && !down && "text-muted-foreground"
              )}
            >
              24h: {change24h === null ? "–" : `${change24h > 0 ? "+" : ""}${change24h.toFixed(2)} %`}
            </span>
          </div>
        </div>
      </div>

      {/* Přepínače intervalu a typu grafu */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          {INTERVAL_OPTIONS.map((o) => {
            const active = o.key === opt.key;
            return (
              <Link
                key={o.key}
                href={`/market/${id}${buildQuery({ interval: o.key, mode })}`}
                className={cn(
                  "rounded-md px-3 py-1.5 font-mono text-xs transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {o.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          {(
            [
              { key: "candles", label: "Svíčky" },
              { key: "area", label: "Linie" },
            ] as const
          ).map((o) => {
            const active = o.key === chartMode;
            const href =
              o.key === "candles"
                ? `/market/${id}${buildQuery({ interval })}`
                : `/market/${id}${buildQuery({ interval, mode: "area" })}`;
            return (
              <Link
                key={o.key}
                href={href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs transition-colors",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {o.label}
              </Link>
            );
          })}
        </div>
      </div>

      {!tracked && opt.key !== "1d" && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <p>
            Intraday ticky se sbírají každých 5 minut jen pro sledované
            položky – přidej komoditu do watchlistu (hvězdička), aby se
            začala zaznamenávat.
          </p>
        </div>
      )}

      {/* Graf */}
      <Card className="py-2">
        <CardContent className="px-2">
          {candles.length > 0 ? (
            <PriceChart
              candles={candles}
              mode={chartMode}
              volume={opt.key === "1d" ? volume : undefined}
              vwap={opt.key === "1d" ? vwap : undefined}
            />
          ) : (
            <div className="flex h-72 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <p>Zatím tu nejsou žádná data pro tento interval.</p>
              <p className="text-xs">
                Data se sbírají postupně – poller ukládá ticky každých 5 minut,
                denní svíčky taháme ze Simco Tools.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Statistiky období */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MiniStat label="Max. období" value={formatPrice(periodHigh)} />
        <MiniStat label="Min. období" value={formatPrice(periodLow)} />
        <MiniStat label="Průměr" value={formatPrice(periodAvg)} />
        <MiniStat label="Zdroj dat" value={dataSource} small />
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  small,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("font-mono", small ? "text-sm" : "text-lg")}>
        {value}
      </div>
    </div>
  );
}
