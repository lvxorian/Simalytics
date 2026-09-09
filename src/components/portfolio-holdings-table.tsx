"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";

import {
  deletePortfolioHoldingAction,
} from "@/app/actions";
import { ItemIcon } from "@/components/item-icon";
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
import { formatPrice, formatSigned, plColorClass } from "@/lib/format";
import type { PortfolioHolding } from "@/lib/data";

/** Tabulka držeb portfolia s mazáním (klient – interaktivní řádky). */
export function PortfolioHoldingsTable({
  holdings,
}: {
  holdings: PortfolioHolding[];
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const handleDelete = (itemId: number, quality: number, key: string) => {
    setPendingId(key);
    startTransition(async () => {
      await deletePortfolioHoldingAction(itemId, quality);
      setPendingId(null);
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Aktivum</TableHead>
            <TableHead className="text-right">Množství</TableHead>
            <TableHead className="text-right">Pořizovací cena</TableHead>
            <TableHead className="text-right">Aktuální cena</TableHead>
            <TableHead className="text-right">Hodnota</TableHead>
            <TableHead className="text-right">Nerealizovaný P/L</TableHead>
            <TableHead className="hidden text-right md:table-cell">
              Pozice
            </TableHead>
            <TableHead className="pr-4 text-right">Akce</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {holdings.map((h) => {
            const key = `${h.item_id}-${h.quality}`;
            return (
              <TableRow key={key}>
                <TableCell className="pl-4">
                  <Link
                    href={`/market/${h.item_id}`}
                    className="flex items-center gap-3 group"
                  >
                    <ItemIcon url={h.image_url} name={h.name} size={34} />
                    <div>
                      <div className="font-medium group-hover:text-primary">
                        {h.name}
                      </div>
                      <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                        <span>Q{h.quality}</span>
                        {h.db_letter && (
                          <>
                            <span>·</span>
                            <span>{h.db_letter}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </Link>
                </TableCell>

                <TableCell className="text-right font-mono tabular-nums">
                  {h.quantity.toLocaleString("cs-CZ")}
                </TableCell>

                <TableCell className="text-right font-mono tabular-nums">
                  {formatPrice(h.avg_buy_price)}
                </TableCell>

                <TableCell className="text-right font-mono tabular-nums">
                  {formatPrice(h.current_price)}
                </TableCell>

                <TableCell className="text-right font-mono tabular-nums">
                  {formatPrice(h.market_value)}
                </TableCell>

                <TableCell className="text-right">
                  <div
                    className={`font-mono tabular-nums ${plColorClass(h.unrealized_pl)}`}
                  >
                    {formatSigned(h.unrealized_pl)}
                  </div>
                  <div
                    className={`font-mono text-xs tabular-nums ${plColorClass(h.unrealized_pl_pct)}`}
                  >
                    {h.unrealized_pl_pct === null
                      ? "–"
                      : `${h.unrealized_pl_pct > 0 ? "+" : h.unrealized_pl_pct < 0 ? "−" : ""}${Math.abs(h.unrealized_pl_pct).toFixed(2)} %`}
                  </div>
                </TableCell>

                <TableCell className="hidden text-right md:table-cell">
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px]"
                    title={
                      h.position_count > 1
                        ? "Více nákupů agregováno do jedné držby"
                        : "Jedna otevřená pozice"
                    }
                  >
                    {h.position_count}×
                  </Badge>
                </TableCell>

                <TableCell className="pr-4 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-down"
                    onClick={() =>
                      handleDelete(h.item_id, h.quality, key)
                    }
                    disabled={pendingId === key}
                    title="Odebrat držbu z portfolia"
                  >
                    <Trash2 className="size-4" />
                    <span className="sr-only">Odebrat držbu</span>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
