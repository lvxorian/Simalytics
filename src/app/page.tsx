import Link from "next/link";
import { ArrowRight, Flame, Plus, Snowflake } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { ChangeBadge } from "@/components/change-badge";
import { DailyReportCard } from "@/components/daily-report-card";
import { ItemIcon } from "@/components/item-icon";
import { MarketTable, type MarketRow } from "@/components/market-table";
import { Sparkline } from "@/components/sparkline";
import { Button } from "@/components/ui/button";
import {
  getActiveContests,
  getLatestPrices,
  getLatestVwaps,
  getMarketLiquidity,
  getMarketVolatility,
  getPositionsWithPnl,
  getPricesAround24hAgo,
  getSparklines,
  getWatchedIds,
} from "@/lib/data";
import { buildDailyReport, type ReportEvent } from "@/lib/daily-report";
import { formatCompact, formatPrice } from "@/lib/format";
import { getEvents } from "@/lib/simcotools";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let rows: MarketRow[] = [];
  let sparklines = new Map<number, number[]>();
  let watchedIds = new Set<number>();
  let dbError: string | null = null;

  try {
    const [latest, watched] = await Promise.all([
      getLatestPrices(0),
      getWatchedIds(),
    ]);
    const [dayAgo, sparks] = await Promise.all([
      getPricesAround24hAgo(latest.map((r) => r.item_id)),
      getSparklines(
        latest.map((r) => r.item_id),
        0,
        24,
        28
      ),
    ]);
    watchedIds = watched;
    sparklines = sparks;
    rows = latest.map((r) => {
      const base = dayAgo.get(r.item_id);
      const change24h =
        base && base > 0 ? ((r.price - base) / base) * 100 : null;
      return { ...r, change24h };
    });
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }
  if (dbError || rows.length === 0) {
    return <SetupNotice error={dbError} />;
  }

  // ── Market pulse ──────────────────────────────────────────────
  const withChange = rows.filter((r) => r.change24h !== null);
  const gainers = withChange.filter((r) => (r.change24h ?? 0) > 0);
  const losers = withChange.filter((r) => (r.change24h ?? 0) < 0);
  const avgChange =
    withChange.length > 0
      ? withChange.reduce((s, r) => s + (r.change24h ?? 0), 0) /
        withChange.length
      : null;

  const sorted = [...withChange].sort(
    (a, b) => (b.change24h ?? 0) - (a.change24h ?? 0)
  );
  const topGainers = sorted.slice(0, 5);
  const topLosers = [...sorted].reverse().slice(0, 5);
  const biggestValue = [...rows]
    .sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0))
    .slice(0, 5);

  // ── Denní report (rule-based, bez AI) + metriky trhu ─────────
  // Data se dotahují paralelně; když některý zdroj selže (eventy ze
  // Simco Tools), report se stejně sestaví ze zbytku – stejný vzor
  // jako skener. Selže-li DB, page spadne do SetupNotice výše.
  let report = null;
  let volatility = new Map<number, number>();
  let liquidity = new Map<
    number,
    { tradesPerDay: number | null; turnover: number | null }
  >();
  try {
    const [vwaps, contests, positions, events, vol, liq] = await Promise.all([
      getLatestVwaps(rows.map((r) => r.item_id)),
      getActiveContests(),
      getPositionsWithPnl({ open: true }),
      getEvents().catch(() => []),
      getMarketVolatility().catch(() => volatility),
      getMarketLiquidity().catch(() => liquidity),
    ]);
    volatility = vol;
    liquidity = liq;
    const todayStr = new Date().toISOString().slice(0, 10);
    const activeEvents: ReportEvent[] = events
      .filter((e) => e.until.slice(0, 10) >= todayStr)
      .map((e) => ({
        resourceId: e.resource,
        speedModifier: e.speedModifier,
        until: e.until,
      }));
    report = buildDailyReport({
      rows,
      vwap: vwaps,
      events: activeEvents,
      contests: new Map(
        [...contests].map(([id, c]) => [id, { name: c.name, endDate: c.endDate }])
      ),
      positions: positions.map((p) => ({
        item_id: p.item_id,
        item_name: p.item_name,
        quantity: p.quantity,
        buy_price: p.buy_price,
        current_price: p.current_price,
        unrealized_pl: p.unrealized_pl,
        unrealized_pl_pct: p.unrealized_pl_pct,
      })),
    });
  } catch {
    // Report je doplněk – selhání (např. prázdné tabulky VWAP) nesmí
    // shodit celý dashboard.
  }

  return (
    <div className="space-y-8">
      <AutoRefresh intervalMs={60_000} />

      {/* ── Hlavička ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-primary">
            Market overview
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Přehled trhu
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Nejnovější ceny komodit (Q0) ze simulátoru SimCompanies.
          </p>
        </div>
        <Button asChild size="sm" className="gap-2 rounded-full">
          <Link href="/positions/new">
            <Plus className="size-4" />
            Nová pozice
          </Link>
        </Button>
      </div>

      {/* ── Market pulse (4 KPI) ─────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PulseCard
          label="Sledované položky"
          value={String(rows.length)}
          hint="Q0 · celý trh"
        />
        <PulseCard
          label="Průměrná 24h změna"
          value={avgChange === null ? "–" : `${avgChange > 0 ? "+" : ""}${avgChange.toFixed(2)} %`}
          hint={`${gainers.length} roste · ${losers.length} padá`}
          tone={
            avgChange === null ? "neutral" : avgChange > 0 ? "up" : "down"
          }
        />
        <PulseCard
          label="Top gainer"
          value={topGainers[0] ? formatPercentSafe(topGainers[0].change24h) : "–"}
          hint={topGainers[0]?.name}
          tone="up"
        />
        <PulseCard
          label="Top loser"
          value={topLosers[0] ? formatPercentSafe(topLosers[0].change24h) : "–"}
          hint={topLosers[0]?.name}
          tone="down"
        />
      </section>

      {/* ── Denní report + investiční doporučení ────────────── */}
      {report && <DailyReportCard report={report} />}

      {/* ── Top gainers / losers ─────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <MoversCard
          title="Top gainers"
          icon={<Flame className="size-4 text-up" />}
          rows={topGainers}
          sparklines={sparklines}
          tone="up"
          moreHref="/"
        />
        <MoversCard
          title="Top losers"
          icon={<Snowflake className="size-4 text-down" />}
          rows={topLosers}
          sparklines={sparklines}
          tone="down"
          moreHref="/"
        />
      </section>

      {/* ── Největší objem ───────────────────────────────────── */}
      <MoversCard
        title="Největší nabídka (objem)"
        icon={<ArrowRight className="size-4 text-primary" />}
        rows={biggestValue}
        sparklines={sparklines}
        tone="neutral"
        moreHref="/"
      />

      {/* ── Celý trh ─────────────────────────────────────────── */}
      <MarketTable
        rows={rows}
        watchedIds={watchedIds}
        sparklines={sparklines}
        volatility={volatility}
        liquidity={liquidity}
      />
    </div>
  );
}

function formatPercentSafe(v: number | null): string {
  if (v === null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)} %`;
}

function PulseCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "up" | "down" | "neutral";
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-2 font-mono text-2xl font-semibold tabular-nums",
          tone === "up" && "text-up",
          tone === "down" && "text-down"
        )}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
}

/**
 * Karta s pohyby trhu – řádky s ikonou, cenou, badge a sparkline.
 */
function MoversCard({
  title,
  icon,
  rows,
  sparklines,
  tone,
  moreHref,
}: {
  title: string;
  icon: React.ReactNode;
  rows: MarketRow[];
  sparklines: Map<number, number[]>;
  tone: "up" | "down" | "neutral";
  moreHref: string;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </h2>
        <Link
          href={moreHref}
          className="text-xs text-muted-foreground transition-colors hover:text-primary"
        >
          Celý trh →
        </Link>
      </div>
      <ul className="divide-y divide-border/40">
        {rows.map((row, i) => (
          <li key={row.item_id}>
            <Link
              href={`/market/${row.item_id}`}
              className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40"
            >
              <span className="w-4 shrink-0 font-mono text-xs text-muted-foreground">
                {i + 1}
              </span>
              <ItemIcon
                url={row.image_url}
                name={row.name}
                size={36}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium group-hover:text-primary">
                  {row.name}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {formatPrice(row.price)}
                </div>
              </div>
              <Sparkline
                data={sparklines.get(row.item_id)}
                uid={`mv-${tone}-${row.item_id}`}
                width={88}
                height={28}
                className="hidden sm:block"
              />
              <ChangeBadge value={row.change24h} size="sm" />
            </Link>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            Zatím žádná data.
          </li>
        )}
      </ul>
    </div>
  );
}

function SetupNotice({ error }: { error: string | null }) {
  return (
    <div className="mx-auto mt-24 max-w-lg rounded-xl border border-dashed border-border bg-card p-10 text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-secondary">
        <span className="font-mono text-lg text-muted-foreground">?</span>
      </div>
      <h2 className="text-lg font-semibold">Zatím žádná data</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Tabulky jsou prázdné nebo není nastavené připojení k databázi.
        Zkontroluj <code className="font-mono text-foreground">.env.local</code>{" "}
        a spusť cron skript:
      </p>
      <pre className="mx-auto mt-4 w-fit rounded-lg bg-muted px-4 py-2 font-mono text-xs text-foreground">
        npm run fetch:market
      </pre>
      {error && (
        <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-left font-mono text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
