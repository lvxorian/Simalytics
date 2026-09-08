import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";

import { PriceChart } from "@/components/price-chart";
import { ItemAlertsTable } from "@/components/item-alerts-table";
import { ItemProfile } from "@/components/item-profile";
import { getLatestVwaps } from "@/lib/data";
import { StarButton } from "@/components/star-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { ChangeBadge } from "@/components/change-badge";
import { ItemIcon } from "@/components/item-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  aggregateDaily,
  aggregateDailyWithVolume,
  aggregateVolumePoints,
  applyContinuity,
  resolveIntervalOption,
  toCandles,
  type Candle,
} from "@/lib/candles";
import {
  getActiveContests,
  getAlertsForItem,
  getDailyCandles,
  getItem,
  getPriceHistory,
  getPricesAround24hAgo,
  getWatchedIds,
  isTracked,
} from "@/lib/data";
import { getEvents, getMarketSummary } from "@/lib/simcotools";
import { computeSignal } from "@/lib/signals";
import {
  computeLiquidity,
  gradeDots,
  volatilityProfile,
} from "@/lib/metrics";
import { formatCompact, formatPrice, formatRelativeAge } from "@/lib/format";

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
  const itemAlerts = await getAlertsForItem(id);

  // ── Data pro graf ─────────────────────────────────────────────────
  let candles: Candle[] = [];
  let volume: { time: number; value: number }[] | undefined;
  let vwap: { time: number; value: number }[] | undefined;
  let dataSource = "";
  // Raw ticky (intraday i dnešek u 1D) – čas posledního obchodu
  let ticks: { recorded_at: string; price: number }[] = [];
  // Zdroj svíček pro Fixed Range Volume Profile (s objemy, kde existují)
  let vpCandles: Candle[] = [];

  if (opt.key === "1d" || opt.key === "1w" || opt.key === "1M") {
    // Denní svíčky z backfillu (Simco Tools, ~3 měsíce, s objemem a VWAP)
    const daily = await getDailyCandles(id);
    const dailyCandles: Candle[] = daily.map((c) => ({
      time: dayToUnix(c.day),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume ?? undefined,
    }));

    // Dnešní (rozpracovaná) svíčka z našich ticků – Simco Tools ji
    // publikuje až po skončení dne
    ticks = await getPriceHistory(id, 0, 2);
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
    const lastStored = dailyCandles[dailyCandles.length - 1]?.time ?? 0;
    const today = todayCandles[todayCandles.length - 1];
    if (today && today.time > lastStored) {
      dailyCandles.push(today);
    }
    // Kontinuita i pro denní svíčky (open = prev close) – jinak vypadají
    // denní/TW grafy „odtržené“ oproti reálným burzovním grafům
    candles = applyContinuity(dailyCandles);
    vpCandles = dailyCandles; // denní svíčky mají reálný objem
    dataSource = "denní svíčky · Simco Tools";

    if (opt.key === "1d") {
      candles = dailyCandles;
      volume = daily
        .filter((c) => c.volume !== null)
        .map((c) => ({ time: dayToUnix(c.day), value: c.volume! }));
      vwap = daily
        .filter((c) => c.vwap !== null)
        .map((c) => ({ time: dayToUnix(c.day), value: c.vwap! }));
      if (today) dataSource = "denní svíčky + dnešní ticky";
    } else {
      // weekly / monthly agregace (aggregateDaily už vrací svíčky s kontinuitou)
      candles = aggregateDaily(dailyCandles, opt.key);
      dataSource =
        opt.key === "1w" ? "týdenní svíčky · agregace z denních" : "měsíční svíčky · agregace z denních";
    }
  } else {
    ticks = await getPriceHistory(id, 0, opt.days);
    candles = toCandles(ticks, opt.seconds);
    // „Živý pravý okraj“: pokud od posledního obchodu uběhlo víc, protáhneme
    // graf plochou rozpracovanou svíčkou až do aktuálního bucketu (jako na
    // burze – klidný trh = vodorovná linka, ne díra na konci grafu).
    // Bez toho působí graf „zastarale“, i když je to jen klid na trhu.
    if (candles.length > 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      const curStart = Math.floor(nowSec / opt.seconds) * opt.seconds;
      const last = candles[candles.length - 1];
      for (let t = last.time + opt.seconds; t <= curStart; t += opt.seconds) {
        candles.push({
          time: t,
          open: last.close,
          high: last.close,
          low: last.close,
          close: last.close,
        });
      }
    }
    vpCandles = candles; // intraday: proxy objem = 1 tick (spočítá klient)
    dataSource = `ticky · posledních ${opt.days} dní`;
  }

  // Čas posledního obchodu (z raw ticků, rostoucí řazení) –
  // ukazuje se v hero, aby byl jasný rozdíl mezi „klidným trhem“
  // a „zastaralými daty“
  const lastTradeMs =
    ticks.length > 0
      ? new Date(ticks[ticks.length - 1].recorded_at).getTime()
      : null;

  // Objemy pro 1W/1M (agregace denních objemů)
  let displayVolume = volume;
  if ((opt.key === "1w" || opt.key === "1M") && volume) {
    displayVolume = aggregateVolumePoints(volume, opt.key);
  }

  // Intraday: reálné obchodované objemy z ticků (poller je ukládá od
  // migrace 004 z market/followed – fiveMinutesCandlestick.volume)
  const intradayVolume = candles.some((c) => c.volume != null)
    ? candles
        .filter((c) => c.volume != null)
        .map((c) => ({ time: c.time, value: c.volume! }))
    : undefined;

  const lastTick =
    candles.length > 0 ? candles[candles.length - 1].close : null;
  const dayAgo = await getPricesAround24hAgo([id]);
  const base = dayAgo.get(id);
  const change24h =
    lastTick !== null && base && base > 0
      ? ((lastTick - base) / base) * 100
      : null;

  // ── Market summary ze Simco Tools (objem, 5m svíčka, denní VWAP) ──
  const summary = await getMarketSummary(id, 0);

  // ── Signal Engine badge (eventy / soutěž / VWAP divergence) ──────
  const [contests, events, latestVwap] = await Promise.all([
    getActiveContests(),
    getEvents().catch(() => []),
    getLatestVwaps([id]),
  ]);
  const todayStr = new Date().toISOString().slice(0, 10);
  const signal = computeSignal({
    itemId: id,
    price: lastTick,
    vwap: latestVwap.get(id) ?? null,
    events: events
      .filter((e) => e.resource === id && e.until.slice(0, 10) >= todayStr)
      .map((e) => ({
        resourceId: e.resource,
        speedModifier: e.speedModifier,
        until: e.until,
      })),
    contest: contests.get(id)
      ? {
          resourceId: id,
          name: contests.get(id)!.name,
          endDate: contests.get(id)!.endDate,
        }
      : null,
    change24h,
  });

  const periodHigh = candles.length ? Math.max(...candles.map((c) => c.high)) : null;
  const periodLow = candles.length ? Math.min(...candles.map((c) => c.low)) : null;
  const periodAvg = candles.length
    ? candles.reduce((sum, c) => sum + c.close, 0) / candles.length
    : null;

  // ── Metriky likvidity a volatility ──────────────────────────
  // Likvidita: frekvence obchodů z ticků + obrat z denních svíček
  // Volatilita: annualizovaná σ log-výnosů z grafu (aktuální TF)
  // Denní svíčky pro obrat: vezmou se z denní větve, jinak se dotáhnou
  const dailyCandlesForMetrics =
    opt.key === "1d" || opt.key === "1w" || opt.key === "1M"
      ? candles.filter((c) => c.volume != null)
      : (await getDailyCandles(id)).map((c) => ({
          time: dayToUnix(c.day),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume ?? undefined,
        }));
  const liquidity = computeLiquidity(ticks, dailyCandlesForMetrics);
  const volatility = volatilityProfile(candles, opt.seconds);

  const img = item.image_url;
  const up = (change24h ?? 0) > 0;
  const down = (change24h ?? 0) < 0;
  const chartMode = mode === "area" ? "area" : "candles";

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={20_000} />

      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Zpět na trh
      </Link>

      {/* ── Hero: ikona + cena + 24h + profil suroviny vpravo ── */}
      <div className="flex flex-wrap items-start gap-5">
        <ItemIcon
          url={img}
          name={item.name}
          size={72}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {item.name}
            </h1>
            {item.db_letter && (
              <Badge variant="outline" className="font-mono text-[10px]">
                {item.db_letter}
              </Badge>
            )}
            <Badge variant="outline" className="font-mono text-[10px]">
              Q0
            </Badge>
            <StarButton itemId={id} watched={watchedIds.has(id)} />
            {signal.direction !== "NEUTRAL" && (
              <Badge
                className={cn(
                  "gap-1 font-mono",
                  signal.direction === "BUY"
                    ? "border-up/30 bg-up/10 text-up"
                    : "border-down/30 bg-down/10 text-down"
                )}
                title={signal.reasons.map((r) => r.label).join(" · ")}
              >
                {signal.direction === "BUY" ? "BUY" : "SELL"} {signal.score > 0 ? "+" : ""}
                {signal.score}
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span className="font-mono text-3xl font-semibold tabular-nums text-foreground">
              {formatPrice(lastTick)}
            </span>
            <ChangeBadge value={change24h} />
            <span className="text-xs text-muted-foreground">24h změna</span>
            {lastTradeMs != null && (
              <span
                className="text-xs text-muted-foreground"
                title="Čas posledního obchodu této komodity. Na klidném trhu cena dlouho nezmizí – není to zastaralá data."
              >
                · poslední obchod {formatRelativeAge(lastTradeMs)}
              </span>
            )}
          </div>
        </div>

        {/* „Firemní profil“ suroviny – výroba, receptura, navazující výroba */}
        <ItemProfile itemId={id} className="ml-auto" />
      </div>

      {/* ── Přepínače intervalu a typu grafu ─────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-full border border-border/80 bg-card p-1">
          {(
            [
              { key: "5m", label: "5m" },
              { key: "15m", label: "15m" },
              { key: "1h", label: "1H" },
              { key: "4h", label: "4H" },
              { key: "1d", label: "1D" },
              { key: "1w", label: "1W" },
              { key: "1M", label: "1M" },
            ] as const
          ).map((o) => {
            const active = o.key === opt.key;
            return (
              <Link
                key={o.key}
                href={`/market/${id}${buildQuery({ interval: o.key, mode })}`}
                className={cn(
                  "shrink-0 rounded-full px-3.5 py-1.5 font-mono text-xs transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
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

        <div className="flex items-center gap-1 rounded-full border border-border/80 bg-card p-1">
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
                  "rounded-full px-3.5 py-1.5 text-xs transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
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

      {!tracked && opt.key !== "1d" && opt.key !== "1w" && opt.key !== "1M" && (
        <div className="flex items-start gap-2 rounded-xl border border-border/80 bg-card px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            Intraday ticky se sbírají každých 5 minut jen pro sledované
            položky – přidej komoditu do watchlistu (hvězdička), aby se
            začala zaznamenávat.
          </p>
        </div>
      )}

      {/* ── Graf ─────────────────────────────────────────────── */}
      <Card className="overflow-hidden rounded-xl border-border/80 py-2">
        <CardContent className="px-2">
          {candles.length > 0 ? (
            <PriceChart
              candles={candles}
              mode={chartMode}
              intervalKey={opt.key}
              itemId={id}
              itemName={item.name}
              itemImageUrl={img}
              currentPrice={lastTick}
              change24h={change24h}
              itemTicker={item.db_letter}
              alerts={itemAlerts.map((a) => ({
                id: a.id,
                kind: a.kind,
                direction: a.direction,
                threshold: a.threshold,
                active: a.active,
              }))}
              intervalSwitches={(
                [
                  { key: "5m", label: "5m" },
                  { key: "15m", label: "15m" },
                  { key: "1h", label: "1H" },
                  { key: "4h", label: "4H" },
                  { key: "1d", label: "1D" },
                  { key: "1w", label: "1W" },
                  { key: "1M", label: "1M" },
                ] as const
              ).map((o) => ({
                key: o.key,
                label: o.label,
                href: `/market/${id}${buildQuery({ interval: o.key, mode })}`,
              }))}
              modeSwitches={([
                { key: "candles", label: "Svíčky" },
                { key: "area", label: "Linie" },
              ] as const).map((o) => ({
                key: o.key,
                label: o.label,
                href:
                  o.key === "candles"
                    ? `/market/${id}${buildQuery({ interval })}`
                    : `/market/${id}${buildQuery({ interval, mode: "area" })}`,
              }))}
              extras={{
                volume:
                  opt.key === "1d" || opt.key === "1w" || opt.key === "1M"
                    ? displayVolume
                    : intradayVolume,
                vwap: opt.key === "1d" ? vwap : undefined,
                high: periodHigh ?? undefined,
                low: periodLow ?? undefined,
                average: periodAvg ?? undefined,
              }}
              volumeProfile={
                opt.key === "1w" || opt.key === "1M"
                  ? aggregateDailyWithVolume(vpCandles, opt.key)
                  : vpCandles
              }
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

      {/* ── Statistiky období + live summary ─────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Max. období" value={formatPrice(periodHigh)} />
        <MiniStat label="Min. období" value={formatPrice(periodLow)} />
        <MiniStat label="Průměr" value={formatPrice(periodAvg)} />
        <MiniStat
          label="Objem (den)"
          value={
            summary ? formatCompact(summary.volume) : formatCompact(volume?.reduce((s, v) => s + v.value, 0) ?? null)
          }
        />
        <MiniStat
          label="VWAP (včera)"
          value={formatPrice(summary?.lastDayCandlestick?.vwap ?? null)}
        />
        <MiniStat
          label="5m změna"
          value={
            summary
              ? `${summary.fiveMinutesCandlestick.previousClosePercentageChange > 0 ? "+" : ""}${(summary.fiveMinutesCandlestick.previousClosePercentageChange * 100).toFixed(2)} %`
              : "–"
          }
          tone={
            summary
              ? summary.fiveMinutesCandlestick.previousClosePercentageChange > 0
                ? "up"
                : summary.fiveMinutesCandlestick.previousClosePercentageChange < 0
                  ? "down"
                  : "neutral"
              : "neutral"
          }
        />
        <MiniStat
          label="Denní změna (API)"
          value={
            summary
              ? `${summary.pricePercentChange > 0 ? "+" : ""}${(summary.pricePercentChange * 100).toFixed(2)} %`
              : "–"
          }
          tone={
            summary
              ? summary.pricePercentChange > 0
                ? "up"
                : summary.pricePercentChange < 0
                  ? "down"
                  : "neutral"
              : "neutral"
          }
        />
        <MiniStat label="Zdroj dat" value={dataSource} small />
      </div>

      {/* ── Metriky likvidity a volatility ───────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MetricCard
          title="Likvidita"
          grade={liquidity.grade}
          gradeLabel={liquidity.label}
          dots={gradeDots(liquidity.grade)}
          tone={liquidity.grade >= 3 ? "up" : liquidity.grade <= 1 ? "down" : "neutral"}
          description={liquidity.description}
          rows={[
            {
              label: "Obchody (24 h)",
              value:
                liquidity.tradesPerDay === null
                  ? "–"
                  : `${liquidity.tradesPerDay}`,            },
            {
              label: "Obrat / den",
              value:
                liquidity.turnover === null
                  ? "–"
                  : formatPrice(liquidity.turnover),
            },
          ]}
          info="Likvidita = jak moc se aktivum obchoduje. Vyšší = snazší vstup/výstup za férovou cenu. Počítá se z počtu obchodů za 24 h (naše ticky) a průměrného denního obratu (denní svíčky ze Simco Tools)."
        />
        <MetricCard
          title="Volatilita"
          grade={volatility.grade}
          gradeLabel={volatility.label}
          dots={gradeDots(volatility.grade)}
          tone={volatility.grade >= 3 ? "down" : "neutral"}
          description={volatility.description}
          rows={[
            {
              label: "Roční (annualizovaná)",
              value:
                volatility.annualizedPct === null
                  ? "–"
                  : `${volatility.annualizedPct.toFixed(1)} %`,
            },
            {
              label: `Za svíčku (${opt.label})`,
              value:
                volatility.perBarPct === null
                  ? "–"
                  : `${volatility.perBarPct.toFixed(2)} %`,
            },
          ]}
          info="Volatilita = jak moc cena kolísá. Počítá se jako směrodatná odchylka výnosů mezi svíčkami; roční hodnota normalizuje na 365 dní, takže se dá porovnávat mezi timeframy. Vyšší = divočejší výkyvy (víc rizika i příležitostí)."
        />
      </div>

      {/* ── Alerty na této komoditě (přidávají se pravým klikem do grafu) ── */}
      <ItemAlertsTable itemId={id} alerts={itemAlerts} />
    </div>
  );
}

function MiniStat({
  label,
  value,
  small,
  tone = "neutral",
}: {
  label: string;
  value: string;
  small?: boolean;
  tone?: "up" | "down" | "neutral";
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono",
          small ? "text-sm" : "text-lg font-semibold",
          tone === "up" && "text-up",
          tone === "down" && "text-down"
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** Karta metriky (likvidita/volatilita) s hodnocením, detaily a tooltipem. */
function MetricCard({
  title,
  gradeLabel,
  dots,
  tone,
  description,
  rows,
  info,
}: {
  title: string;
  grade: 0 | 1 | 2 | 3 | 4;
  gradeLabel: string;
  dots: string;
  tone: "up" | "down" | "neutral";
  description: string;
  rows: { label: string; value: string }[];
  info: string;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {title}
          </span>
          <Info
            className="size-3 text-muted-foreground/70"
            aria-hidden
          />
        </div>
        <span
          className="font-mono text-[11px] tracking-widest text-muted-foreground/80"
          aria-hidden
        >
          {dots}
        </span>
      </div>
      <div
        className={cn(
          "mt-1 text-lg font-semibold",
          tone === "up" && "text-up",
          tone === "down" && "text-down"
        )}
        title={info}
      >
        {gradeLabel}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      <div className="mt-2 space-y-0.5 border-t border-border/60 pt-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center justify-between gap-2 font-mono text-xs"
          >
            <span className="text-muted-foreground">{r.label}</span>
            <span className="tabular-nums text-foreground">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
