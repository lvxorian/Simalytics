import Image from "next/image";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChartCandlestick } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StarButton } from "@/components/star-button";
import { cn } from "@/lib/utils";
import {
  formatCompact,
  formatDateTime,
  formatPercent,
  formatPrice,
  itemImageUrl,
} from "@/lib/format";
import type { LatestPriceRow } from "@/lib/types";

export type MarketRow = LatestPriceRow & { change24h: number | null };

export function MarketTable({
  rows,
  watchedIds,
}: {
  rows: MarketRow[];
  watchedIds?: Set<number>;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Položka</TableHead>
            <TableHead className="text-right">Cena</TableHead>
            <TableHead className="text-right">24h změna</TableHead>
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
          {rows.map((row) => {
            const img = itemImageUrl(row.image_url);
            const up = (row.change24h ?? 0) > 0;
            const down = (row.change24h ?? 0) < 0;

            return (
              <TableRow key={row.item_id} className="group">
                <TableCell className="pl-4 font-medium">
                  <div className="flex items-center gap-3">
                    <StarButton
                      itemId={row.item_id}
                      watched={watchedIds?.has(row.item_id) ?? false}
                      size="sm"
                    />
                    {img && (
                      <Image
                        src={img}
                        alt={row.name}
                        width={28}
                        height={28}
                        className="rounded bg-secondary p-0.5"
                      />
                    )}
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
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 font-mono text-sm",
                      up && "text-emerald-400",
                      down && "text-red-400",
                      !up && !down && "text-muted-foreground"
                    )}
                  >
                    {up && <ArrowUpRight className="size-3.5" />}
                    {down && <ArrowDownRight className="size-3.5" />}
                    {formatPercent(row.change24h)}
                  </span>
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
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function MarketTableSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
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

export { Badge };
