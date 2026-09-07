import type { Metadata } from "next";
import Link from "next/link";
import { Star } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { ChangeBadge } from "@/components/change-badge";
import { ItemIcon } from "@/components/item-icon";
import { Sparkline } from "@/components/sparkline";
import { StarButton } from "@/components/star-button";
import { getSparklines, getWatchlistRows } from "@/lib/data";
import { formatDateTime, formatPrice } from "@/lib/format";

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
            <Link
              key={row.item_id}
              href={`/market/${row.item_id}`}
              className="group rounded-xl border border-border/80 bg-card p-4 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <ItemIcon url={row.image_url} name={row.name} size={36} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold group-hover:text-primary">
                      {row.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {row.category ?? "komodita"}
                    </div>
                  </div>
                </div>
                <StarButton
                  itemId={row.item_id}
                  watched
                  size="sm"
                  // klik na hvězdičku nesmí aktivovat kartu
                />
              </div>

              <div className="mt-4 flex items-end justify-between gap-2">
                <div>
                  <div className="font-mono text-xl font-semibold tabular-nums">
                    {formatPrice(row.price)}
                  </div>
                  <div className="mt-1">
                    <ChangeBadge value={row.change24h} size="sm" />
                  </div>
                </div>
                <Sparkline
                  data={sparklines.get(row.item_id)}
                  uid={`wl-${row.item_id}`}
                  width={110}
                  height={40}
                />
              </div>

              <div className="mt-3 border-t border-border/40 pt-2 text-right font-mono text-[10px] text-muted-foreground">
                {formatDateTime(row.recorded_at)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
