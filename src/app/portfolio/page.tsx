import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Info, Plus } from "lucide-react";

import { PortfolioDonut, type DonutSlice } from "@/components/portfolio-donut";
import {
  PortfolioHoldingsTable,
  type AssetRow,
} from "@/components/portfolio-holdings-table";
import { PortfolioValueChart } from "@/components/portfolio-value-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getPositionLots,
  getPortfolioHoldings,
  getPortfolioValueHistory,
} from "@/lib/data";
import { formatPercent, formatPrice, formatSigned } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portfolio",
};

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const historyDays = range === "7" ? 7 : range === "90" ? 90 : 30;

  const holdings = await getPortfolioHoldings().catch(() => []);

  // Lots (jednotlivé nákupy) pro každé aktivum – paralelně
  const lotsPerAsset = await Promise.all(
    holdings.map((h) =>
      getPositionLots(h.item_id, h.quality).catch(() => [])
    )
  );
  const assets: AssetRow[] = holdings.map((h, i) => ({
    ...h,
    lots: lotsPerAsset[i],
  }));

  const valueHistory = await getPortfolioValueHistory(historyDays).catch(
    () => [] as { time: number; value: number }[]
  );

  const invested = assets.reduce((s, h) => s + h.invested, 0);
  const marketValue = assets.reduce(
    (s, h) => s + (h.market_value ?? h.invested),
    0
  );
  const totalPl = assets.reduce(
    (s, h) => s + (h.unrealized_pl ?? 0),
    0
  );
  const totalPlPct = invested > 0 ? (totalPl / invested) * 100 : null;
  const best = assets.reduce<null | AssetRow>((best, h) => {
    if (h.unrealized_pl_pct === null) return best;
    if (!best || (best.unrealized_pl_pct ?? -Infinity) < h.unrealized_pl_pct)
      return h;
    return best;
  }, null);
  const worst = assets.reduce<null | AssetRow>((worst, h) => {
    if (h.unrealized_pl_pct === null) return worst;
    if (!worst || (worst.unrealized_pl_pct ?? Infinity) > h.unrealized_pl_pct)
      return h;
    return worst;
  }, null);

  const slices: DonutSlice[] = assets
    .filter((h) => h.market_value !== null)
    .map((h) => ({
      key: `${h.item_id}-${h.quality}`,
      label: h.name,
      value: h.market_value ?? 0,
      href: `/market/${h.item_id}`,
      iconUrl: h.image_url,
    }));

  return (
    <div className="space-y-8">
      {/* ── Hlavička ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-primary">
            Portfolio
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Portfolio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tvá aktiva v jednom přehledu – koláč alokace, vývoj hodnoty a
            zisk/ztráta podle aktuálních cen.
          </p>
        </div>
        <Button asChild size="sm" className="gap-2 rounded-full">
          <Link href="/positions/new">
            <Plus className="size-4" />
            Přidat aktivum
          </Link>
        </Button>
      </div>

      {assets.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* ── Koláč + souhrn ─────────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
            <Card className="rounded-xl border-border/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Alokace portfolia</CardTitle>
              </CardHeader>
              <CardContent>
                <PortfolioDonut
                  slices={slices}
                  totalValue={marketValue}
                  totalPl={totalPl}
                />
              </CardContent>
            </Card>

            <div className="grid content-start gap-3 sm:grid-cols-2">
              <SummaryCard
                label="Investováno"
                value={formatPrice(invested)}
                hint="celková pořizovací cena aktiv"
              />
              <SummaryCard
                label="Tržní hodnota"
                value={formatPrice(marketValue)}
                hint="podle posledních tržních cen"
              />
              <SummaryCard
                label="Nerealizovaný P/L"
                value={formatSigned(totalPl)}
                sub={totalPlPct === null ? null : formatPercent(totalPlPct)}
                tone={
                  totalPl > 0 ? "up" : totalPl < 0 ? "down" : "neutral"
                }
                hint="zisk/ztráta při prodeji za aktuální cenu"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <MiniCard
                  label="Nejlepší"
                  name={best?.name}
                  value={best?.unrealized_pl_pct ?? null}
                  tone="up"
                />
                <MiniCard
                  label="Nejhorší"
                  name={worst?.name}
                  value={worst?.unrealized_pl_pct ?? null}
                  tone="down"
                />
              </div>
            </div>
          </div>

          {/* ── Vývoj hodnoty portfolia ────────────────────────── */}
          {valueHistory.length > 1 && (
            <Card className="rounded-xl border-border/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Vývoj hodnoty</CardTitle>
              </CardHeader>
              <CardContent>
                <PortfolioValueChart data={valueHistory} invested={invested} />
              </CardContent>
            </Card>
          )}

          {/* ── Tabulka aktiv ──────────────────────────────────── */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Aktiva ({assets.length})
            </h2>
            <PortfolioHoldingsTable assets={assets} />
          </section>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string | null;
  hint?: string;
  tone?: "up" | "down" | "neutral";
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {hint && (
          <span title={hint} className="text-muted-foreground/60">
            <Info className="size-3" aria-hidden />
          </span>
        )}
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
      {sub && (
        <div
          className={cn(
            "font-mono text-xs tabular-nums",
            tone === "up" && "text-up",
            tone === "down" && "text-down"
          )}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function MiniCard({
  label,
  name,
  value,
  tone,
}: {
  label: string;
  name?: string;
  value: number | null;
  tone: "up" | "down";
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-medium" title={name}>
        {name ?? "–"}
      </div>
      <div
        className={cn(
          "font-mono text-xs tabular-nums",
          value === null
            ? "text-muted-foreground"
            : tone === "up"
              ? "text-up"
              : "text-down"
        )}
      >
        {value === null
          ? "–"
          : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)} %`}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto mt-8 max-w-lg rounded-xl border border-dashed border-border bg-card p-10 text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-secondary">
        <Briefcase className="size-5 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold">Portfolio je zatím prázdné</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Přidej první aktivum tlačítkem „Přidat aktivum“, nebo rovnou z detailu
        komodity – u grafu je tlačítko „Přidat do portfolia“.
      </p>
      <div className="mt-4 flex justify-center gap-3">
        <Button asChild size="sm" className="rounded-full">
          <Link href="/positions/new">Přidat aktivum</Link>
        </Button>
        <Button asChild size="sm" variant="outline" className="rounded-full">
          <Link href="/">Prozkoumat trh</Link>
        </Button>
      </div>
    </div>
  );
}
