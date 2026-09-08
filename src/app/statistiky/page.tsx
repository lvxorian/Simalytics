import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Award, Building2, CalendarClock, Factory, Flag, Landmark, TrendingDown, TrendingUp } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { ItemIcon } from "@/components/item-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCertDemand } from "@/lib/cert-demand";
import {
  getBuildingCounts,
  getCountryStats,
  getEvents,
  getGovernmentOrders,
  getPhaseRanges,
  getRanking,
  getRealmSummaries,
} from "@/lib/simcotools";
import { formatCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tržní statistiky",
};

/** Fáze ekonomiky dle hry: Recese / Stabilní / Růst (každá s emote). */
const PHASE_LABELS: Record<string, string> = {
  normal: "Stabilní 😐",
  boom: "Růst 📈",
  recession: "Recese 📉",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

export default async function StatistikyPage() {
  const [phaseRanges, events, orders, summaries, buildings, ranking, countries, certDemand] = await Promise.all([
    getPhaseRanges().catch(() => []),
    getEvents().catch(() => []),
    getGovernmentOrders(12).catch(() => []),
    getRealmSummaries(8).catch(() => []),
    getBuildingCounts("all").catch(() => ({ buildings: [], total: 0 })),
    getRanking(20).catch(() => []),
    getCountryStats().catch(() => []),
    getCertDemand().catch(() => new Map()),
  ]);

  const now = new Date();
  const currentPhase =
    phaseRanges.find(
      (r) =>
        new Date(r.start) <= now &&
        (!r.end || new Date(r.end) >= now)
    ) ?? phaseRanges[0];
  const previousPhase = phaseRanges[1];

  // Dnešní summary je completed: false – budovy/bondy API doplňuje až za den.
  // Makro KPI proto ukazujeme z posledního DOKONČENÉHO dne (plná čísla).
  const completedSummaries = summaries.filter((s) => s.completed);
  const macro = completedSummaries[0] ?? summaries[0];
  const macroPrev = completedSummaries[1];

  const activeEvents = events
    .filter((e) => new Date(e.until) >= now)
    .sort((a, b) => a.speedModifier - b.speedModifier);

  return (
    <div className="space-y-8">
      <AutoRefresh intervalMs={120_000} />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Tržní statistiky
        </h1>
        <p className="text-sm text-muted-foreground">
          Co hýbe trhem: fáze ekonomiky, výrobní eventy a vládní zakázky.
          Zdroj: Simco Tools (data v češtině).
        </p>
      </div>

      {/* Makro ekonomika realmu */}
      {summaries.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <Landmark className="size-4" />
            Ekonomika realmu
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MacroStat
              label="Aktivní firmy"
              value={macro.activeCompanies.toLocaleString("cs-CZ")}
              delta={pctDelta(macro.activeCompanies, macroPrev?.activeCompanies)}
            />
            <MacroStat
              label="Hodnota firem"
              value={formatCompact(macro.companiesValue)}
              delta={pctDelta(macro.companiesValue, macroPrev?.companiesValue)}
            />
            <MacroStat
              label="Celkem budov"
              value={
                macro.totalBuildings != null
                  ? macro.totalBuildings.toLocaleString("cs-CZ")
                  : "–"
              }
              delta={pctDelta(macro.totalBuildings, macroPrev?.totalBuildings)}
            />
            <MacroStat
              label="Prodané bondy"
              value={
                macro.bondsSold != null
                  ? formatCompact(macro.bondsSold)
                  : "–"
              }
              delta={pctDelta(macro.bondsSold, macroPrev?.bondsSold)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Denní data z {formatDate(macro.date)} · zdroj Simco Tools
            realm summaries.
          </p>
        </section>
      )}

      {/* Top budovy v realmu */}
      {buildings.buildings.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <Building2 className="size-4" />
            Top budovy ({buildings.total.toLocaleString("cs-CZ")} celkem)
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {buildings.buildings.slice(0, 9).map((b) => (
              <div
                key={b.id}
                className="rounded-xl border border-border/80 bg-card px-4 py-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{b.name}</span>
                  <span className="shrink-0 font-mono text-sm">
                    {b.count.toLocaleString("cs-CZ")}
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.min(100, b.proportion * 100 * 3)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Fáze ekonomiky */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <CalendarClock className="size-4" />
          Fáze ekonomiky
        </h2>
        {currentPhase ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Aktuální fáze
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <div
                  className={cn(
                    "font-mono text-2xl font-semibold",
                    currentPhase.phase === "boom" && "text-up",
                    currentPhase.phase === "recession" && "text-down"
                  )}
                >
                  {PHASE_LABELS[currentPhase.phase] ?? currentPhase.phase}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(currentPhase.start)} → {formatDate(currentPhase.end)}{" "}
                  ({currentPhase.days} dní)
                </div>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Předchozí fáze
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <div className="font-mono text-2xl font-semibold">
                  {previousPhase
                    ? PHASE_LABELS[previousPhase.phase] ?? previousPhase.phase
                    : "–"}
                </div>
                {previousPhase && (
                  <div className="text-xs text-muted-foreground">
                    {formatDate(previousPhase.start)} →{" "}
                    {formatDate(previousPhase.end)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
            Data o fázích se nepodařilo načíst.
          </div>
        )}
      </section>

      {/* Výrobní eventy */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Factory className="size-4" />
          Výrobní eventy ({activeEvents.length} aktivních)
        </h2>
        <p className="text-sm text-muted-foreground">
          Změna rychlosti výroby = změna nabídky. Zpomalení výroby typicky tlačí
          cenu nahoru, zrychlení dolů – klasické příležitosti pro swing obchody.
        </p>
        {activeEvents.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {activeEvents.map((e) => {
              const slower = e.speedModifier < 0;
              return (
                <div
                  key={e.id}
                  className="flex items-center gap-3 rounded-xl border border-border/80 bg-card px-4 py-3"
                >
                  {slower ? (
                    <TrendingDown className="size-4 shrink-0 text-down" />
                  ) : (
                    <TrendingUp className="size-4 shrink-0 text-up" />
                  )}
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/market/${e.resource}`}
                      className="truncate font-medium hover:text-primary hover:underline underline-offset-4"
                    >
                      {e.resourceName}
                    </Link>
                    <div className="truncate text-xs text-muted-foreground">
                      {e.producedAtName} · do {formatDate(e.until)}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-mono",
                      slower
                        ? "border-red-500/40 bg-red-500/10 text-down"
                        : "border-emerald-500/40 bg-emerald-500/10 text-up"
                    )}
                  >
                    {e.speedModifier > 0 ? "+" : ""}
                    {e.speedModifier} %
                  </Badge>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
            Žádné aktivní eventy – trh je klidný.
          </div>
        )}
      </section>

      {/* Žebříček firem */}
      {ranking.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <Flag className="size-4" />
            Žebříček firem (top {ranking.length})
          </h2>
          <p className="text-sm text-muted-foreground">
            Největší firmy realmu dle denní valuace. rankDiff ukazuje pohyb
            oproti včerejšku – rostoucí firmy expandují a zvyšují poptávku
            po vstupech.
          </p>
          <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">#</th>
                  <th className="px-4 py-2.5 font-medium">Firma</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Hodnota</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Patenty</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium lg:table-cell">Pracovníci</th>
                  <th className="px-4 py-2.5 text-right font-medium">24h</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((company) => (
                  <tr
                    key={company.companyId}
                    className="border-b border-border/40 last:border-0"
                  >
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">
                      {company.rank}
                    </td>
                    <td className="px-4 py-2.5 font-medium">{company.companyName}</td>
                    <td className="hidden px-4 py-2.5 text-right font-mono sm:table-cell">
                      {formatCompact(company.companyValue)}
                    </td>
                    <td className="hidden px-4 py-2.5 text-right font-mono text-muted-foreground md:table-cell">
                      {formatCompact(company.patentsValue)}
                    </td>
                    <td className="hidden px-4 py-2.5 text-right font-mono text-muted-foreground lg:table-cell">
                      {formatCompact(company.workers)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={cn(
                          "font-mono text-xs",
                          company.rankDiff > 0 && "text-up",
                          company.rankDiff < 0 && "text-down",
                          company.rankDiff === 0 && "text-muted-foreground"
                        )}
                      >
                        {company.rankDiff > 0
                          ? `▲ +${company.rankDiff}`
                          : company.rankDiff < 0
                            ? `▼ ${company.rankDiff}`
                            : "–"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Mapa zemí */}
      {countries.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <Landmark className="size-4" />
            Největší země (dle hodnoty firem)
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...countries]
              .sort((a, b) => b.totalCompaniesValue - a.totalCompaniesValue)
              .slice(0, 9)
              .map((country) => {
                const max = countries[0]?.totalCompaniesValue ?? 1;
                const top = country.rank[0];
                return (
                  <div
                    key={country.countryCode}
                    className="rounded-xl border border-border/80 bg-card px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold">
                        {country.countryCode}
                      </span>
                      <span className="font-mono text-sm">
                        {formatCompact(country.totalCompaniesValue)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{
                          width: `${Math.max(2, Math.min(100, (country.totalCompaniesValue / max) * 100))}%`,
                        }}
                      />
                    </div>
                    <div className="mt-1.5 truncate text-xs text-muted-foreground">
                      {country.totalCompanies} firem
                      {top ? ` · #1 ${top.name}` : ""}
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* Cert demand – strukturální poptávka */}
      {certDemand.size > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <Award className="size-4" />
            Cert demand (strukturální poptávka)
          </h2>
          <p className="text-sm text-muted-foreground">
            Kolik firem drží certifikát „quality leadera" pro komoditu. Držitelé
            certu komoditu prodávají, ostatní ji musí kupovat – vysoký počet
            certů = strukturální poptávka po komoditě.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...certDemand.values()]
              .sort((a, b) => b.holderCount - a.holderCount)
              .slice(0, 9)
              .map((row) => (
                <div
                  key={row.itemId}
                  className="rounded-xl border border-border/80 bg-card px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/market/${row.itemId}`}
                      className="flex min-w-0 items-center gap-2.5 text-sm font-medium hover:text-primary hover:underline underline-offset-4"
                    >
                      <ItemIcon url={row.imageUrl} name={row.name ?? `#${row.itemId}`} size={28} />
                      <span className="truncate">
                        {row.name ?? `Komodita #${row.itemId}`}
                      </span>
                    </Link>
                    <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                      {row.holderCount} certů
                    </Badge>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{
                        width: `${Math.min(100, (row.holderCount / 20) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="mt-1.5 truncate text-xs text-muted-foreground">
                    Objem {formatCompact(row.totalAmount)}
                    {row.topHolder ? ` · #1 ${row.topHolder.name}` : ""}
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* Vládní zakázky */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Landmark className="size-4" />
          Vládní zakázky
        </h2>
        <p className="text-sm text-muted-foreground">
          Velké poptávkové signály – kdo nakoupí suroviny dřív, než se rozjede
          plnění zakázky, vyhrává.
        </p>
        {orders.length > 0 ? (
          <div className="grid gap-2 lg:grid-cols-2">
            {orders.map((o) => (
              <div
                key={o.id}
                className="rounded-xl border border-border/80 bg-card p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="size-4 text-primary" />
                    {o.projectName}
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {o.daysToFulfill} dní
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {o.resources.map((r) => (
                    <Link
                      key={`${o.id}-${r.resourceId}-${r.quality}`}
                      href={`/market/${r.resourceId}`}
                      className="rounded-md border border-border bg-secondary px-2 py-0.5 text-xs hover:border-primary/50 hover:text-primary"
                    >
                      {r.resourceName}{" "}
                      <span className="font-mono text-muted-foreground">
                        Q{r.quality}
                      </span>
                    </Link>
                  ))}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Vypsáno {formatDate(o.created)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
            Zakázky se nepodařilo načíst.
          </div>
        )}
      </section>
    </div>
  );
}

function pctDelta(current: number | undefined, previous: number | undefined): number | null {
  if (!current || !previous || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function MacroStat({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta: number | null;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 font-mono text-xl font-semibold tabular-nums">
        {value}
      </div>
      {delta !== null && (
        <div
          className={cn(
            "mt-0.5 font-mono text-xs",
            delta > 0 && "text-up",
            delta < 0 && "text-down",
            delta === 0 && "text-muted-foreground"
          )}
        >
          {delta > 0 ? "+" : ""}
          {delta.toFixed(2)} % vs. včera
        </div>
      )}
    </div>
  );
}
