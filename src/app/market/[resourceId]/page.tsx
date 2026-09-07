import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PriceChart } from "@/components/price-chart";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { INTERVAL_OPTIONS, resolveInterval, toCandles } from "@/lib/candles";
import { getItem, getPriceHistory, getPricesAround24hAgo } from "@/lib/data";
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

  const bucketSeconds = resolveInterval(interval);
  const ticks = await getPriceHistory(id, 0, 90);
  const candles = toCandles(ticks, bucketSeconds);

  const lastTick = ticks.length > 0 ? Number(ticks[ticks.length - 1].price) : null;
  const dayAgo = await getPricesAround24hAgo([id]);
  const base = dayAgo.get(id);
  const change24h =
    lastTick !== null && base && base > 0 ? ((lastTick - base) / base) * 100 : null;

  // Statistiky z aktuálního intervalu
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
          {INTERVAL_OPTIONS.map((opt) => {
            const active = opt.seconds === bucketSeconds;
            return (
              <Link
                key={opt.key}
                href={`/market/${id}${buildQuery({ interval: opt.key, mode })}`}
                className={cn(
                  "rounded-md px-3 py-1.5 font-mono text-xs transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
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
          ).map((opt) => {
            const active = opt.key === chartMode;
            const href =
              opt.key === "candles"
                ? `/market/${id}${buildQuery({ interval })}`
                : `/market/${id}${buildQuery({ interval, mode: "area" })}`;
            return (
              <Link
                key={opt.key}
                href={href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs transition-colors",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Graf */}
      <Card className="py-2">
        <CardContent className="px-2">
          {candles.length > 0 ? (
            <PriceChart candles={candles} mode={chartMode} />
          ) : (
            <div className="flex h-72 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <p>Zatím tu nejsou žádná data pro tento interval.</p>
              <p className="text-xs">
                Cron skript data doplňuje každých 15 minut – zkus to za chvíli.
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
        <MiniStat label="Počet svíček" value={String(candles.length)} />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-lg">{value}</div>
    </div>
  );
}
