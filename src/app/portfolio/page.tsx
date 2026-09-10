import type { Metadata } from "next";
import Link from "next/link";
import { Archive, Briefcase, History, Info, Plus, RotateCcw, ScrollText, Target } from "lucide-react";

import { AddNoteForm } from "@/components/add-note-form";
import { ItemIcon } from "@/components/item-icon";
import { PortfolioDonut, type DonutSlice } from "@/components/portfolio-donut";
import {
  PortfolioHoldingsTable,
  type AssetRow,
} from "@/components/portfolio-holdings-table";
import { PortfolioValueChart } from "@/components/portfolio-value-chart";
import { PortfolioUnignoreButton } from "@/components/portfolio-unignore-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getConditionLog,
  getGameSyncIgnored,
  getPositionLots,
  getPositionsWithPnl,
  getPortfolioHoldings,
  getPortfolioValueHistory,
} from "@/lib/data";
import type { ConditionLogEntry, PositionWithPnl } from "@/lib/types";
import {
  formatDateTime,
  formatPercent,
  formatPrice,
  formatSigned,
  plColorClass,
} from "@/lib/format";
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

  const [holdings, closedPositions, log, ignoredItems] = await Promise.all([
    getPortfolioHoldings().catch(() => []),
    getPositionsWithPnl({ open: false }).catch(() => []),
    getConditionLog(50).catch(
      () => [] as (ConditionLogEntry & { item_name: string | null })[]
    ),
    getGameSyncIgnored().catch(() => []),
  ]);

  // Lots (jednotlivé nákupy) pro každé aktivum – paralelně
  const lotsPerAsset = await Promise.all(
    holdings.map((h) => getPositionLots(h.item_id).catch(() => []))
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
  const realized = closedPositions.reduce(
    (s, p) => s + (p.realized_pl ?? 0),
    0
  );
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
      key: `${h.item_id}`,
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
            Tvá aktiva i uzavřené obchody v jednom přehledu – alokace, vývoj
            hodnoty a zisk/ztráta podle aktuálních cen.
          </p>
        </div>
        <Button asChild size="sm" className="gap-2 rounded-full">
          <Link href="/portfolio/new">
            <Plus className="size-4" />
            Přidat aktivum
          </Link>
        </Button>
      </div>

      {assets.length === 0 && closedPositions.length === 0 ? (
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
                hint="zisk/ztráta aktiv při prodeji za aktuální cenu"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <SummaryCard
                  label="Realizovaný P/L"
                  value={formatSigned(realized)}
                  tone={
                    realized > 0 ? "up" : realized < 0 ? "down" : "neutral"
                  }
                  hint="zisk/ztráta z už uzavřených pozic"
                />
                <MiniCard
                  label="Nejlepší aktivum"
                  name={best?.name}
                  value={best?.unrealized_pl_pct ?? null}
                  tone="up"
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
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <Briefcase className="size-4" />
              Aktiva ({assets.length})
            </h2>
            {assets.length > 0 ? (
              <PortfolioHoldingsTable assets={assets} />
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
                Žádná otevřená aktiva.{" "}
                <Link
                  href="/portfolio/new"
                  className="text-primary underline underline-offset-4"
                >
                  Přidej první nákup
                </Link>
                .
              </div>
            )}
          </section>

          {/* ── Uzavřené pozice (historie) ─────────────────────── */}
          {closedPositions.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <History className="size-4" />
                Uzavřené pozice ({closedPositions.length})
              </h2>
              <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-4">Aktivum</TableHead>
                      <TableHead className="text-right">Nákup</TableHead>
                      <TableHead className="text-right">Prodej</TableHead>
                      <TableHead className="text-right">Množství</TableHead>
                      <TableHead className="text-right">
                        Realizovaný P/L
                      </TableHead>
                      <TableHead className="pr-4 text-right">Zavřeno</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {closedPositions.map((p) => (
                      <ClosedRow key={p.id} p={p} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}

          {/* ── Mimo portfolio (palivo/výroba na skladu) ───────── */}
          {ignoredItems.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <Archive className="size-4" />
                Mimo portfolio ({ignoredItems.length})
              </h2>
              <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-4">Položka</TableHead>
                      <TableHead className="text-right">Na skladu</TableHead>
                      <TableHead className="text-right">Náklad/ks</TableHead>
                      <TableHead className="hidden text-left md:table-cell">Důvod</TableHead>
                      <TableHead className="pr-4 text-right">Akce</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ignoredItems.map((g) => (
                      <TableRow key={g.item_id} className="border-border/40">
                        <TableCell className="pl-4">
                          <Link
                            href={`/market/${g.item_id}`}
                            className="group flex items-center gap-2.5"
                          >
                            <ItemIcon url={g.image_url} name={g.name} size={28} />
                            <span className="font-medium group-hover:text-primary">
                              {g.name}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {g.warehouse_qty.toLocaleString("cs-CZ")}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                          {g.warehouse_cost === null ? "–" : formatPrice(g.warehouse_cost)}
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                          {g.reason ?? "–"}
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <PortfolioUnignoreButton itemId={g.item_id} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Položky syncované ze skladu, které nejsou investicí/flipem
                (palivo, výroba). Ve hře zůstávají na skladu, do portfolia se
                nenačítají a P/L jich netýká.
              </p>
            </section>
          )}

          {/* ── Condition log ──────────────────────────────────── */}
          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <ScrollText className="size-4" />
              Log obchodů
            </h2>

            {assets.length > 0 && (
              <Card className="rounded-xl border-border/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Přidat poznámku</CardTitle>
                </CardHeader>
                <CardContent>
                  <AddNoteForm
                    positions={assets.flatMap((a) =>
                      a.lots.map((lot) => ({
                        id: lot.id,
                        label: `${a.name} – ${lot.quantity.toLocaleString("cs-CZ")} ks @ ${formatPrice(lot.buy_price)}`,
                      }))
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {log.length > 0 ? (
              <div className="space-y-2">
                {log.map((entry) => (
                  <LogEntry key={entry.id} entry={entry} />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
                Log je zatím prázdný. Zápisy se vytvářejí automaticky při
                otevření či uzavření pozice.
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ClosedRow({ p }: { p: PositionWithPnl }) {
  return (
    <TableRow className="border-border/40">
      <TableCell className="pl-4">
        <Link
          href={`/market/${p.item_id}`}
          className="flex items-center gap-2.5 group"
        >
          <ItemIcon url={p.image_url} name={p.item_name} size={30} />
          <span className="font-medium group-hover:text-primary">
            {p.item_name}
          </span>
        </Link>
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatPrice(p.buy_price)}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatPrice(p.sell_price)}
        {p.cost_breakdown !== null && (
          <div
            className="mt-0.5 text-[10px] leading-tight text-muted-foreground"
            title={
              p.cost_breakdown.transport_exact
                ? "Přeprava exaktně (poměr položky × cena ze skladu), poplatky z cashflow"
                : "Přeprava odhadem (% z tržby)"
            }
          >
            hrubá {formatPrice(p.cost_breakdown.gross)}
            {p.cost_breakdown.fees !== 0 && (
              <> · popl. {formatPrice(p.cost_breakdown.fees)}</>
            )}
            {p.cost_breakdown.transport !== 0 && (
              <> · přepr. {formatPrice(p.cost_breakdown.transport)}</>
            )}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {p.quantity.toLocaleString("cs-CZ")}
      </TableCell>
      <TableCell
        className={cn(
          "text-right font-mono tabular-nums",
          plColorClass(p.realized_pl)
        )}
      >
        {formatSigned(p.realized_pl)}{" "}
        <span className="text-xs">
          (
          {formatPercent(
            p.realized_pl !== null
              ? (p.realized_pl / (p.buy_price * p.quantity)) * 100
              : null
          )}
          )
        </span>
      </TableCell>
      <TableCell className="pr-4 text-right font-mono text-xs text-muted-foreground">
        {formatDateTime(p.closed_at)}
      </TableCell>
    </TableRow>
  );
}

function LogEntry({
  entry,
}: {
  entry: ConditionLogEntry & { item_name: string | null };
}) {
  return (
    <div
      className="rounded-xl border border-border/80 bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge
          variant="outline"
          className={eventTypeBadgeClass(entry.event_type)}
        >
          {entry.event_type}
        </Badge>
        <span className="font-medium text-foreground">
          {entry.item_name ?? "Pozice"}
        </span>
        <span>·</span>
        <span className="font-mono">
          {formatDateTime(entry.created_at)}
        </span>
        {entry.market_price_at_log !== null && (
          <>
            <span>·</span>
            <span className="font-mono">
              cena {formatPrice(entry.market_price_at_log)}
            </span>
          </>
        )}
      </div>

      <p className="mt-2 text-sm leading-relaxed">
        {entry.condition_text}
      </p>
      {entry.trigger_reason && (
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="text-primary">Trigger:</span> {entry.trigger_reason}
        </p>
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

function eventTypeBadgeClass(eventType: string): string {
  switch (eventType) {
    case "OPENED":
      return "border-up/40 bg-up/10 text-up";
    case "CLOSED":
      return "border-sky-500/40 bg-sky-500/10 text-sky-400";
    default:
      return "border-border bg-secondary text-muted-foreground";
  }
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
          <Link href="/portfolio/new">Přidat aktivum</Link>
        </Button>
        <Button asChild size="sm" variant="outline" className="rounded-full">
          <Link href="/">Prozkoumat trh</Link>
        </Button>
      </div>
    </div>
  );
}
