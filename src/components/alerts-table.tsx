"use client";

import { useTransition } from "react";
import Link from "next/link";
import { BellOff, BellRing, Trash2 } from "lucide-react";

import { deleteAlertAction, toggleAlertAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ItemIcon } from "@/components/item-icon";
import { EditableAlertRule } from "@/components/editable-alert-rule";
import { formatDateTime, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AlertWithItem } from "@/lib/data";

/** Popis alertu pro tabulku. */
export function alertLabel(alert: AlertWithItem): string {
  if (alert.kind === "limit_sell") {
    return `Limit prodeje ≥ ${formatPrice(alert.threshold)}`;
  }
  if (alert.kind === "price") {
    return alert.direction === "above"
      ? `Cena ≥ ${formatPrice(alert.threshold)}`
      : `Cena ≤ ${formatPrice(alert.threshold)}`;
  }
  return alert.direction === "above"
    ? `Skóre ≥ ${alert.threshold > 0 ? "+" : ""}${alert.threshold}`
    : `Skóre ≤ ${alert.threshold}`;
}

export function AlertsTable({ alerts }: { alerts: AlertWithItem[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
      <Table>
        <TableHeader>
          <TableRow className="border-border/60 hover:bg-transparent">
            <TableHead className="pl-4">Položka</TableHead>
            <TableHead>Podmínka</TableHead>
            <TableHead className="hidden text-right md:table-cell">
              Aktuální
            </TableHead>
            <TableHead className="hidden text-right md:table-cell">
              Spuštěno
            </TableHead>
            <TableHead className="text-right">Stav</TableHead>
            <TableHead className="w-20 pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {alerts.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={6}
                className="py-12 text-center text-sm text-muted-foreground"
              >
                Žádné alerty. Nastav si je na detailu komodity.
              </TableCell>
            </TableRow>
          ) : (
            alerts.map((alert) => (
              <TableRow key={alert.id} className="border-border/40">
                <TableCell className="pl-4">
                  <Link
                    href={`/market/${alert.item_id}`}
                    className="flex items-center gap-2.5 font-medium hover:text-primary hover:underline underline-offset-4"
                  >
                    <ItemIcon url={alert.image_url} name={alert.item_name} size={32} />
                    {alert.item_name}
                  </Link>
                  {alert.note && (
                    <div className="mt-0.5 max-w-56 truncate text-xs text-muted-foreground">
                      {alert.note}
                    </div>
                  )}
                </TableCell>

                <TableCell>
                  <EditableAlertRule alert={alert} />
                </TableCell>

                <TableCell className="hidden text-right font-mono text-muted-foreground md:table-cell">
                  {formatPrice(alert.current_price)}
                </TableCell>

                <TableCell className="hidden text-right font-mono text-xs text-muted-foreground md:table-cell">
                  {alert.last_triggered_at
                    ? formatDateTime(alert.last_triggered_at)
                    : "–"}
                  {alert.trigger_count > 0 && (
                    <span className="ml-1">({alert.trigger_count}×)</span>
                  )}
                </TableCell>

                <TableCell className="text-right">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await toggleAlertAction(alert.id);
                      })
                    }
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      alert.active
                        ? "border-up/25 bg-up/10 text-up"
                        : "border-border bg-muted text-muted-foreground"
                    )}
                  >
                    {alert.active ? (
                      <BellRing className="size-3" />
                    ) : (
                      <BellOff className="size-3" />
                    )}
                    {alert.active ? "Aktivní" : "Vypnutý"}
                  </button>
                </TableCell>

                <TableCell className="pr-4 text-right">
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-down"
                  >
                    <button
                      type="button"
                      disabled={pending}
                      aria-label="Smazat alert"
                      onClick={() =>
                        startTransition(async () => {
                          await deleteAlertAction(alert.id);
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
