import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarClock, Factory, Landmark, TrendingDown, TrendingUp } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEvents, getGovernmentOrders, getPhaseRanges } from "@/lib/simcotools";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tržní statistiky",
};

const PHASE_LABELS: Record<string, string> = {
  normal: "Normální",
  boom: "Konjunktura 📈",
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
  const [phaseRanges, events, orders] = await Promise.all([
    getPhaseRanges().catch(() => []),
    getEvents().catch(() => []),
    getGovernmentOrders(12).catch(() => []),
  ]);

  const now = new Date();
  const currentPhase =
    phaseRanges.find(
      (r) =>
        new Date(r.start) <= now &&
        (!r.end || new Date(r.end) >= now)
    ) ?? phaseRanges[0];
  const previousPhase = phaseRanges[1];

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
                    currentPhase.phase === "boom" && "text-emerald-400",
                    currentPhase.phase === "recession" && "text-red-400"
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
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
                >
                  {slower ? (
                    <TrendingDown className="size-4 shrink-0 text-red-400" />
                  ) : (
                    <TrendingUp className="size-4 shrink-0 text-emerald-400" />
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
                        ? "border-red-500/40 bg-red-500/10 text-red-400"
                        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
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
                className="rounded-lg border border-border bg-card p-4"
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
