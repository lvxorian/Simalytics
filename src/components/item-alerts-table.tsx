"use client";

import { useTransition } from "react";
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
import { alertLabel } from "@/components/alerts-table";
import { formatDateTime, formatPrice, plColorClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AlertWithItem } from "@/lib/data";

/**
 * Tabulka alertů jedné komodity (pod grafem na market page).
 * Alerty se přidávají pravým klikem do grafu; tady je vidíš, přepneš
 * aktivitu nebo smažeš. Aktuální cena se barevně odchyluje od prahu
 * (zelená = práh dosažen/obnoveno, šedá = čeká).
 */
export function ItemAlertsTable({
  itemId,
  alerts,
}: {
  itemId: number;
  alerts: AlertWithItem[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-semibold">
        Alerty na této komoditě
        {alerts.length > 0 && (
          <Badge variant="outline" className="font-mono text-[10px]">
            {alerts.filter((a) => a.active).length}/{alerts.length} aktivních
          </Badge>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow className="border-border/60 hover:bg-transparent">
            <TableHead className="pl-4">Podmínka</TableHead>
            <TableHead className="text-right">Aktuální</TableHead>
            <TableHead className="hidden text-right md:table-cell">
              Spuštěno
            </TableHead>
            <TableHead className="text-right">Stav</TableHead>
            <TableHead className="w-16 pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {alerts.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                Žádné alerty. Klikni do grafu pravým tlačítkem → „Nastavit
                alert“.
              </TableCell>
            </TableRow>
          ) : (
            alerts.map((alert) => {
              const reached =
                alert.current_price != null &&
                (alert.direction === "above"
                  ? alert.current_price >= alert.threshold
                  : alert.current_price <= alert.threshold);
              return (
                <TableRow key={alert.id} className="border-border/40">
                  <TableCell className="pl-4">
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-mono text-[11px]",
                        alert.kind === "score" &&
                          "border-primary/30 bg-primary/10 text-primary",
                        alert.kind === "limit_sell" &&
                          "border-[#d4a72c]/30 bg-[#d4a72c]/10 text-[#d4a72c]",
                        alert.kind === "price" && reached && "border-up/30 bg-up/10 text-up"
                      )}
                    >
                      {alertLabel(alert)}
                    </Badge>
                    {alert.note && (
                      <div className="mt-0.5 max-w-56 truncate text-xs text-muted-foreground">
                        {alert.note}
                      </div>
                    )}
                  </TableCell>

                  <TableCell
                    className={cn(
                      "text-right font-mono",
                      reached ? plColorClass(1) : "text-muted-foreground"
                    )}
                  >
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
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
