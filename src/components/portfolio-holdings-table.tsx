"use client";

import Link from "next/link";
import { ArrowUpRight, Pencil } from "lucide-react";

import {
  PortfolioSellDialog,
} from "@/components/portfolio-sell-dialog";
import {
  PortfolioEditLotsDialog,
  type EditableLot,
} from "@/components/portfolio-edit-lots-dialog";
import {
  PortfolioIgnoreDialog,
  PortfolioIgnoreTrigger,
} from "@/components/portfolio-ignore-dialog";
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
            <TableHead className="text-right">Nerealizovaný P/L (netto)</TableHead>
            <TableHead className="hidden text-right md:table-cell">
              Nákupy
            </TableHead>
            <TableHead className="pr-4 text-right">Akce</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets.map((h) => {
            return (
              <TableRow key={h.item_id}>
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
                </TableCell>

                <TableCell className="text-right font-mono tabular-nums">
                  {formatPrice(h.market_value)}
                </TableCell>

                <TableCell className="text-right">
                  {/* Netto nerealizovaný P/L = hrubý − burzovní poplatek (4 %
                      z tržby) − přeprava (poměr položky × cena Přepravy ze
                      skladu; bez dat odhad % z tržby). Hrubý zůstává v
                      tooltipu. */}
                  <div
                    className={`font-mono tabular-nums ${plColorClass(h.unrealized_pl_net)}`}
                    title={
                      h.est_fee !== null
                        ? `Hrubý ${formatSigned(h.unrealized_pl)} – poplatek ${formatPrice(h.est_fee)} – přeprava ${formatPrice(h.est_transport)}${h.transport_exact ? " (exaktně ze skladu)" : " (odhad % z tržby)"}`
                        : "Bez aktuální ceny nelze odhadnout náklady prodeje"
                    }
                  >
                    {formatSigned(h.unrealized_pl_net ?? h.unrealized_pl)}
                  </div>
                  <div
                    className={`font-mono text-xs tabular-nums ${plColorClass(h.unrealized_pl_net_pct)}`}
                  >
                    {h.unrealized_pl_net_pct === null
                      ? "–"
                      : `${h.unrealized_pl_net_pct > 0 ? "+" : h.unrealized_pl_net_pct < 0 ? "−" : ""}${Math.abs(h.unrealized_pl_net_pct).toFixed(2)} %`}
                  </div>
                  {h.est_fee !== null && (
                    <div
                      className="text-[10px] leading-tight text-muted-foreground"
                      title={
                        h.transport_exact
                          ? `Poplatek 4 % (${formatPrice(h.est_fee)}) + přeprava exaktně ze skladu (${formatPrice(h.est_transport)})`
                          : `Poplatek 4 % (${formatPrice(h.est_fee)}) + přeprava odhadem % z tržby (${formatPrice(h.est_transport)})`
                      }
                    >
                      popl. + přepr. {formatPrice((h.est_fee ?? 0) + (h.est_transport ?? 0))}
                    </div>
                  )}
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
                    {/* Přesun do „Mimo portfolio“ – dialog s potvrzením
                        a volitelným důvodem (koš bez potvrzení hrozil
                        omylem zahodenou držbou). */}
                    <PortfolioIgnoreDialog
                      itemId={h.item_id}
                      itemName={h.name}
                      quantity={h.quantity}
                      trigger={<PortfolioIgnoreTrigger />}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
        Nerealizovaný P/L je NETTO – po odečtení nákladů prodeje: burzovní
        poplatek 4 % z tržby a přeprava (exaktně poměr položky × cena Přepravy
        ze skladu, jinak odhad % z tržby). Hrubý P/L a rozpad nákladů jsou v
        tooltipu u čísla.
      </p>
    </div>
  );
}
