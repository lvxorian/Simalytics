"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUpRight, Pencil, Trash2 } from "lucide-react";

import {
  ignoreGameSyncItemAction,
} from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import {
  PortfolioSellDialog,
} from "@/components/portfolio-sell-dialog";
import {
  PortfolioEditLotsDialog,
  type EditableLot,
} from "@/components/portfolio-edit-lots-dialog";
import { ItemIcon } from "@/components/item-icon";
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
import { cn } from "@/lib/utils";

/** Řádek tabulky aktiv – držba jedné položky (všechny kvality dohromady). */
export type AssetRow = PortfolioHolding & { lots: EditableLot[] };

/**
 * Tabulka aktiv portfolia – jeden řádek na komoditu (bez rozlišení
 * kvalit; průměrná cena je vážený průměr přes všechny nákupy). Editace
 * (tužka), prodej/limit (↗) a mazání (koš) fungují na celé položce.
 */
export function PortfolioHoldingsTable({
  assets,
}: {
  assets: AssetRow[];
}) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const handleIgnore = (itemId: number, key: string) => {
    setPendingKey(key);
    startTransition(async () => {
      // Vyloučí z portfolia (loty zahodí), ale na skladu ve hře zůstane –
      // sync už položku do portfolia nenahrá. Vrátit jde v sekci
      // „Mimo portfolio“ dole na stránce.
      await ignoreGameSyncItemAction(itemId);
      setPendingKey(null);
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
              Nákupy
            </TableHead>
            <TableHead className="pr-4 text-right">Akce</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets.map((h) => {
            const key = `${h.item_id}`;
            return (
              <TableRow key={key}>
                <TableCell className="pl-4">
                  <Link
                    href={`/market/${h.item_id}`}
                    className="group flex items-center gap-3"
                  >
                    <ItemIcon url={h.image_url} name={h.name} size={34} />
                    <span className="font-medium group-hover:text-primary">
                      {h.name}
                    </span>
                  </Link>
                </TableCell>

                <TableCell className="text-right font-mono tabular-nums">
                  {h.quantity.toLocaleString("cs-CZ")}
                </TableCell>

                <TableCell className="text-right font-mono tabular-nums">
                  {formatPrice(h.avg_buy_price)}
                  {h.lots.length > 1 && (
                    <div
                      className="text-[10px] text-muted-foreground"
                      title="Vážený průměr napříč všemi nákupy"
                    >
                      průměr
                    </div>
                  )}
                </TableCell>

                <TableCell className="text-right font-mono tabular-nums">
                  {formatPrice(h.current_price)}
                  {h.limit_price !== null && (
                    <Badge
                      variant="outline"
                      className="mt-0.5 border-primary/30 bg-primary/10 font-mono text-[9px] text-primary"
                      title={`Zadaný limitní prodej ve hře @ ${formatPrice(h.limit_price)} – po realizaci odklepni tlačítkem Prodat`}
                    >
                      limit {formatPrice(h.limit_price)}
                    </Badge>
                  )}
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
                  <span
                    className="font-mono text-xs text-muted-foreground"
                    title={
                      h.lots.length > 1
                        ? "Aktivum tvoří více nákupů – uprav je tužkou"
                        : "Jeden nákup"
                    }
                  >
                    {h.lots.length}×
                  </span>
                </TableCell>

                <TableCell className="pr-4 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <PortfolioSellDialog
                      itemId={h.item_id}
                      itemName={h.name}
                      quantity={h.quantity}
                      avgBuyPrice={h.avg_buy_price}
                      currentPrice={h.current_price}
                      limitPrice={h.limit_price}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-up"
                          title="Odklepnout prodej / zadat limit"
                        >
                          <ArrowUpRight className="size-4" />
                          <span className="sr-only">
                            Prodat {h.name}
                          </span>
                        </Button>
                      }
                    />
                    <PortfolioEditLotsDialog
                      holdingLabel={h.name}
                      lots={h.lots}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-foreground"
                          title="Upravit nákupy (množství, cena)"
                        >
                          <Pencil className="size-4" />
                          <span className="sr-only">
                            Upravit {h.name}
                          </span>
                        </Button>
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-down"
                      onClick={() => handleIgnore(h.item_id, key)}
                      disabled={pendingKey === key}
                      title="Odebrat z portfolia (ponechat na skladu ve hře)"
                    >
                      <Trash2 className="size-4" />
                      <span className="sr-only">Odebrat {h.name} z portfolia</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
