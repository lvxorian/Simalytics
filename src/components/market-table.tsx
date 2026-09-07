import Link from "next/link";
import { ChartCandlestick, Search } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChangeBadge } from "@/components/change-badge";
import { ItemIcon } from "@/components/item-icon";
import { Sparkline } from "@/components/sparkline";
import { StarButton } from "@/components/star-button";
import { cn } from "@/lib/utils";
import {
  formatCompact,
  formatDateTime,
  formatPrice,
} from "@/lib/format";
import type { LatestPriceRow } from "@/lib/types";

export type MarketRow = LatestPriceRow & { change24h: number | null };

export function MarketTable({
  rows,
  watchedIds,
  sparklines,
}: {
  rows: MarketRow[];
  watchedIds?: Set<number>;
  sparklines?: Map<number, number[]>;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Search className="size-4" />
          Celý trh ({rows.length})
        </h2>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
        <Table>
          <TableHeader>
            <TableRow className="border-border/60 hover:bg-transparent">
              <TableHead className="pl-4">Položka</TableHead>
              <TableHead className="text-right">Cena</TableHead>
              <TableHead className="text-right">24h změna</TableHead>
              <TableHead className="hidden text-right md:table-cell">
                Trend 24h
              </TableHead>
              <TableHead className="hidden text-right md:table-cell">
                Nabídka
              </TableHead>
              <TableHead className="hidden text-right lg:table-cell">
                Aktualizováno
              </TableHead>
              <TableHead className="w-10 pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.item_id} className="group border-border/40">
                <TableCell className="pl-4 font-medium">
                  <div className="flex items-center gap-3">
                    <StarButton
                      itemId={row.item_id}
                      watched={watchedIds?.has(row.item_id) ?? false}
                      size="sm"
                    />
                    <ItemIcon url={row.image_url} name={row.name} size={32} />
                    <div>
                      <Link
                        href={`/market/${row.item_id}`}
                        className="hover:text-primary hover:underline underline-offset-4"
                      >
                        {row.name}
                      </Link>
                      {row.db_letter && (
                        <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                          {row.db_letter}
                        </span>
                      )}
                      {row.category && (
                        <div className="text-xs text-muted-foreground">
                          {row.category}
                        </div>
                      )}
                    </div>
                  </div>
                </TableCell>

                <TableCell className="text-right font-mono">
                  {formatPrice(row.price)}
                </TableCell>

                <TableCell className="text-right">
                  <ChangeBadge value={row.change24h} />
                </TableCell>

                <TableCell className="hidden text-right md:table-cell">
                  <div className="flex justify-end">
                    <Sparkline
                      data={sparklines?.get(row.item_id)}
                      uid={`mt-${row.item_id}`}
                      width={96}
                      height={30}
                    />
                  </div>
                </TableCell>

                <TableCell className="hidden text-right font-mono text-muted-foreground md:table-cell">
                  {formatCompact(row.quantity)}
                </TableCell>

                <TableCell className="hidden text-right font-mono text-xs text-muted-foreground lg:table-cell">
                  {formatDateTime(row.recorded_at)}
                </TableCell>

                <TableCell className="pr-4">
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary"
                  >
                    <Link
                      href={`/market/${row.item_id}`}
                      aria-label={`Graf ${row.name}`}
                    >
                      <ChartCandlestick className="size-4" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

export function MarketTableSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Položka</TableHead>
            <TableHead className="text-right">Cena</TableHead>
            <TableHead className="text-right">24h změna</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: count }).map((_, i) => (
            <TableRow key={i}>
              <TableCell className="pl-4" colSpan={3}>
                <div className="h-5 w-full animate-pulse rounded bg-muted" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
