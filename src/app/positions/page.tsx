import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Plus, ScrollText, Target } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { AddNoteForm } from "@/components/add-note-form";
import { PositionsTable } from "@/components/positions-table";
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
import { getConditionLog, getPositionsWithPnl } from "@/lib/data";
import type { ConditionLogEntry, PositionWithPnl } from "@/lib/types";
import {
  formatDateTime,
  formatPercent,
  formatPrice,
  formatSigned,
  itemImageUrl,
  plColorClass,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pozice",
};

export default async function PositionsPage() {
  let openPositions: PositionWithPnl[] = [];
  let closedPositions: PositionWithPnl[] = [];
  let log: (ConditionLogEntry & { item_name: string | null })[] = [];
  let dbError: string | null = null;

  try {
    [openPositions, closedPositions, log] = await Promise.all([
      getPositionsWithPnl({ open: true }),
      getPositionsWithPnl({ open: false }),
      getConditionLog(50),
    ]);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  if (dbError) {
    return (
      <Card className="mx-auto mt-16 max-w-2xl border-dashed">
        <CardHeader className="items-center text-center">
          <Target className="mx-auto mb-2 size-10 text-muted-foreground" />
          <CardTitle className="text-lg">Databáze není dostupná</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-center text-sm text-muted-foreground">
          <code className="block break-all font-mono text-xs text-red-300">
            {dbError}
          </code>
        </CardContent>
      </Card>
    );
  }

  const invested = openPositions.reduce(
    (sum, p) => sum + p.buy_price * p.quantity,
    0
  );
  const unrealized = openPositions.reduce(
    (sum, p) => sum + (p.unrealized_pl ?? 0),
    0
  );
  const realized = closedPositions.reduce(
    (sum, p) => sum + (p.realized_pl ?? 0),
    0
  );

  return (
    <div className="space-y-8">
      <AutoRefresh intervalMs={60_000} />

      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pozice</h1>
          <p className="text-sm text-muted-foreground">
            Buy Low, Sell High – a přitom si loguj, proč.
          </p>
        </div>
        <Button asChild size="sm" className="gap-2">
          <Link href="/positions/new">
            <Plus className="size-4" />
            Nová pozice
          </Link>
        </Button>
      </div>

      {/* Souhrn */}
      <div className="grid gap-4 sm:grid-cols-4">
        <SummaryCard
          label="Otevřené pozice"
          value={String(openPositions.length)}
        />
        <SummaryCard label="Investováno" value={formatPrice(invested)} />
        <SummaryCard
          label="Nerealizovaný P/L"
          value={formatSigned(unrealized)}
          tone={unrealized > 0 ? "up" : unrealized < 0 ? "down" : "neutral"}
        />
        <SummaryCard
          label="Realizovaný P/L"
          value={formatSigned(realized)}
          tone={realized > 0 ? "up" : realized < 0 ? "down" : "neutral"}
        />
      </div>

      {/* Otevřené pozice */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Otevřené pozice
        </h2>
        {openPositions.length > 0 ? (
          <PositionsTable positions={openPositions} />
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            Žádné otevřené pozice. Když uvidíš na trhu šanci,{" "}
            <Link
              href="/positions/new"
              className="text-primary underline underline-offset-4"
            >
              otevři pozici
            </Link>
            .
          </div>
        )}
      </section>

      {/* Uzavřené pozice */}
      {closedPositions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Uzavřené pozice
          </h2>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Položka</TableHead>
                  <TableHead className="text-right">Nákup</TableHead>
                  <TableHead className="text-right">Prodej</TableHead>
                  <TableHead className="text-right">Množství</TableHead>
                  <TableHead className="text-right">Realizovaný P/L</TableHead>
                  <TableHead className="pr-4 text-right">Zavřeno</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closedPositions.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-2.5">
                        {itemImageUrl(p.image_url) && (
                          <Image
                            src={itemImageUrl(p.image_url)!}
                            alt={p.item_name}
                            width={24}
                            height={24}
                            className="rounded bg-secondary p-0.5"
                          />
                        )}
                        <span className="font-medium">{p.item_name}</span>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          Q{p.quality}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatPrice(p.buy_price)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatPrice(p.sell_price)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {p.quantity.toLocaleString("cs-CZ")}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono",
                        plColorClass(p.realized_pl)
                      )}
                    >
                      {formatSigned(p.realized_pl)}{" "}
                      <span className="text-xs">
                        ({formatPercent(
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
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {/* Condition Logging */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <ScrollText className="size-4" />
          Condition log – proč jsem co koupil
        </h2>

        {openPositions.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Přidat poznámku</CardTitle>
            </CardHeader>
            <CardContent>
              <AddNoteForm
                positions={openPositions.map((p) => ({
                  id: p.id,
                  label: `${p.item_name} (Q${p.quality}) – ${p.quantity} ks @ ${formatPrice(p.buy_price)}`,
                }))}
              />
            </CardContent>
          </Card>
        )}

        {log.length > 0 ? (
          <div className="space-y-2">
            {log.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-border bg-card p-4"
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
                    <span className="text-primary">Trigger:</span>{" "}
                    {entry.trigger_reason}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            Log je zatím prázdný. Zápisy se vytvářejí automaticky při otevření
            či uzavření pozice.
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "neutral";
}) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div
          className={cn(
            "font-mono text-xl font-semibold",
            tone === "up" && "text-emerald-400",
            tone === "down" && "text-red-400"
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function eventTypeBadgeClass(eventType: string): string {
  switch (eventType) {
    case "OPENED":
      return "border-primary/40 bg-primary/10 text-primary";
    case "CLOSED":
      return "border-sky-500/40 bg-sky-500/10 text-sky-400";
    default:
      return "border-border bg-secondary text-muted-foreground";
  }
}
