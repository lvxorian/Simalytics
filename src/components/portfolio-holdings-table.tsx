"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUpRight, Pencil, Trash2 } from "lucide-react";

import {
  deletePortfolioHoldingAction,
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

/** Řádek tabulky aktiv – držba s editací jednotlivých nákupů. */
export type AssetRow = PortfolioHolding & { lots: EditableLot[] };

/** Skupina řádků jedné komodity (Q0, Q1, … pod sebou). */
type ItemGroup = {
  itemId: number;
  name: string;
  db_letter: string | null;
  image_url: string | null;
  rows: AssetRow[];
};

/**
 * Tabulka aktiv seskupená podle komodity: Dyně = jedna položka, pod ní
 * řádek pro každou kvalitu (Q0, Q1, …). Každá kvalita se edituje a
 * prodává zvlášť (vlastní tlačítka i vlastní limit), hlavička skupiny
 * ukazuje agregát přes všechny kvality.
 */
export function PortfolioHoldingsTable({
  assets,
}: {
  assets: AssetRow[];
}) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const handleDelete = (itemId: number, quality: number, key: string) => {
    setPendingKey(key);
    startTransition(async () => {
      await deletePortfolioHoldingAction(itemId, quality);
      setPendingKey(null);
    });
  };

  // Seskupení podle komodity (zachová pořadí dle investice, Q vzestupně)
  const groups: ItemGroup[] = [];
  const byItem = new Map<number, ItemGroup>();
  for (const a of assets) {
    let g = byItem.get(a.item_id);
    if (!g) {
      g = {
        itemId: a.item_id,
        name: a.name,
        db_letter: a.db_letter,
        image_url: a.image_url,
        rows: [],
      };
      byItem.set(a.item_id, g);
      groups.push(g);
    }
    g.rows.push(a);
  }
  for (const g of groups) g.rows.sort((x, y) => x.quality - y.quality);

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
          {groups.map((g) => {
            // Agregát skupiny přes všechny kvality
            const qty = g.rows.reduce((s, r) => s + r.quantity, 0);
            const invested = g.rows.reduce((s, r) => s + r.invested, 0);
            const value = g.rows.reduce(
              (s, r) => s + (r.market_value ?? r.invested),
              0
            );
            const pl = g.rows.reduce((s, r) => s + (r.unrealized_pl ?? 0), 0);

            return (
              <ItemGroupRows
                key={g.itemId}
                group={g}
                qty={qty}
                invested={invested}
                value={value}
                pl={pl}
                pendingKey={pendingKey}
                onDelete={handleDelete}
              />
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ItemGroupRows({
  group,
  qty,
  value,
  pl,
  pendingKey,
  onDelete,
}: {
  group: ItemGroup;
  qty: number;
  invested: number;
  value: number;
  pl: number;
  pendingKey: string | null;
  onDelete: (itemId: number, quality: number, key: string) => void;
}) {
  return (
    <>
      {/* Hlavička skupiny – komodita + agregát přes všechny kvality */}
      <TableRow className="border-border/60 bg-secondary/30 hover:bg-secondary/30">
        <TableCell colSpan={8} className="py-2.5 pl-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <Link
              href={`/market/${group.itemId}`}
              className="group flex items-center gap-3"
            >
              <ItemIcon
                url={group.image_url}
                name={group.name}
                size={32}
              />
              <span className="font-semibold group-hover:text-primary">
                {group.name}
              </span>
            </Link>
            {group.db_letter && (
              <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                {group.db_letter}
              </span>
            )}
            <span className="font-mono text-xs text-muted-foreground">
              {group.rows.length}{" "}
              {group.rows.length === 1 ? "kvalita" : "kvality"} ·{" "}
              {qty.toLocaleString("cs-CZ")} ks
            </span>
            <div className="ml-auto flex items-center gap-4 font-mono text-xs tabular-nums">
              <span className="text-muted-foreground">
                hodnota {formatPrice(value)}
              </span>
              <span className={cn("font-semibold", plColorClass(pl))}>
                {formatSigned(pl)}
              </span>
            </div>
          </div>
        </TableCell>
      </TableRow>

      {/* Řádky kvalit – každá se spravuje zvlášť */}
      {group.rows.map((h) => {
        const key = `${h.item_id}-${h.quality}`;
        return (
          <TableRow key={key} className="border-border/40">
            <TableCell className="pl-4">
              <div className="flex items-center gap-2 pl-[44px]">
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] text-muted-foreground"
                >
                  Q{h.quality}
                </Badge>
                {h.limit_price !== null && (
                  <Badge
                    variant="outline"
                    className="border-primary/30 bg-primary/10 font-mono text-[9px] text-primary"
                    title={`Zadaný limitní prodej ve hře @ ${formatPrice(h.limit_price)} – po realizaci odklepni tlačítkem Prodat`}
                  >
                    limit {formatPrice(h.limit_price)}
                  </Badge>
                )}
              </div>
            </TableCell>

            <TableCell className="text-right font-mono tabular-nums">
              {h.quantity.toLocaleString("cs-CZ")}
            </TableCell>

            <TableCell className="text-right font-mono tabular-nums">
              {formatPrice(h.avg_buy_price)}
              {h.lots.length > 1 && (
                <div
                  className="text-[10px] text-muted-foreground"
                  title="Vážený průměr napříč nákupy"
                >
                  průměr
                </div>
              )}
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
                  quality={h.quality}
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
                        Prodat {h.name} Q{h.quality}
                      </span>
                    </Button>
                  }
                />
                <PortfolioEditLotsDialog
                  holdingLabel={h.name}
                  qualityLabel={`Q${h.quality}`}
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
                        Upravit {h.name} Q{h.quality}
                      </span>
                    </Button>
                  }
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-down"
                  onClick={() => onDelete(h.item_id, h.quality, key)}
                  disabled={pendingKey === key}
                  title="Odebrat aktivum z portfolia"
                >
                  <Trash2 className="size-4" />
                  <span className="sr-only">
                    Odebrat {h.name} Q{h.quality}
                  </span>
                </Button>
              </div>
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
}
