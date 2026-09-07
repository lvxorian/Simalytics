import type { Metadata } from "next";
import Link from "next/link";
import { Star } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { WatchlistCard } from "@/components/watchlist-card";
import { getSparklines, getWatchlistRows } from "@/lib/data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Watchlist",
};

export default async function WatchlistPage() {
  const rows = await getWatchlistRows();
  const sparklines = await getSparklines(
    rows.map((r) => r.item_id),
    0,
    24,
    28
  );

  return (
    <div className="space-y-8">
      <AutoRefresh intervalMs={60_000} />

      <div>
        <p className="mb-2 inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-primary">
          Sledované
        </p>
        <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
          Watchlist
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sledované komodity – poller zaznamenává ticky každých 5 minut,
          takže máš detailní intraday grafy přesně tam, kde potřebuješ.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <Star className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Watchlist je prázdný. Přidej komoditu hvězdičkou na{" "}
            <Link
              href="/"
              className="text-primary underline underline-offset-4"
            >
              trhu
            </Link>{" "}
            nebo v detailu grafu.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <WatchlistCard
              key={row.item_id}
              row={row}
              sparkline={sparklines.get(row.item_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
