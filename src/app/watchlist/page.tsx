import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Star } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { StarButton } from "@/components/star-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getWatchlistRows } from "@/lib/data";
import { formatDateTime, formatPercent, formatPrice, itemImageUrl } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Watchlist",
};

export default async function WatchlistPage() {
  const rows = await getWatchlistRows();

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={60_000} />

      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Star className="size-5 text-primary" />
          Watchlist
        </h1>
        <p className="text-sm text-muted-foreground">
          Sledované komodity – pro všechny položky ve watchlistu poller
          zaznamenává ticky každých 5 minut, takže máš detailní intraday
          grafy přesně tam, kde potřebuješ.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Watchlist je prázdný. Přidej komoditu hvězdičkou na{" "}
          <Link
            href="/"
            className="text-primary underline underline-offset-4"
          >
            trhu
          </Link>{" "}
          nebo v detailu grafu.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 pl-4" />
                <TableHead>Položka</TableHead>
                <TableHead className="text-right">Cena</TableHead>
                <TableHead className="text-right">24h změna</TableHead>
                <TableHead className="pr-4 text-right">
                  Aktualizováno
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const img = itemImageUrl(row.image_url);
                const up = (row.change24h ?? 0) > 0;
                const down = (row.change24h ?? 0) < 0;
                return (
                  <TableRow key={row.item_id} className="group">
                    <TableCell className="pl-2">
                      <StarButton itemId={row.item_id} watched size="sm" />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
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
                            className="font-medium hover:text-primary hover:underline underline-offset-4"
                          >
                            {row.name}
                          </Link>
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
                          "font-mono text-sm",
                          up && "text-emerald-400",
                          down && "text-red-400",
                          !up && !down && "text-muted-foreground"
                        )}
                      >
                        {formatPercent(row.change24h)}
                      </span>
                    </TableCell>
                    <TableCell className="pr-4 text-right font-mono text-xs text-muted-foreground">
                      {formatDateTime(row.recorded_at)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
