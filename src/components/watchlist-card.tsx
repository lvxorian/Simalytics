"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ChangeBadge } from "@/components/change-badge";
import { ItemIcon } from "@/components/item-icon";
import { Sparkline } from "@/components/sparkline";
import { StarButton } from "@/components/star-button";
import { formatDateTime, formatPrice } from "@/lib/format";

export type WatchlistCardRow = {
  item_id: number;
  name: string;
  image_url: string | null;
  category: string | null;
  price: number | null;
  recorded_at: string | null;
  change24h: number | null;
};

/**
 * Karta sledované komodity (klientská, aby hvězdička nemusela
 * aktivovat odkaz karty – stopPropagation na wrapperu).
 */
export function WatchlistCard({
  row,
  sparkline,
}: {
  row: WatchlistCardRow;
  sparkline?: number[];
}) {
  const router = useRouter();

  return (
    <div
      onClick={() => router.push(`/market/${row.item_id}`)}
      className="group cursor-pointer rounded-xl border border-border/80 bg-card p-4 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <ItemIcon url={row.image_url} name={row.name} size={44} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold group-hover:text-primary">
              {row.name}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {row.category ?? "komodita"}
            </div>
          </div>
        </div>
        {/* klik na hvězdičku nesmí aktivovat kartu */}
        <span
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
        >
          <StarButton itemId={row.item_id} watched size="sm" />
        </span>
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
          data={sparkline}
          uid={`wl-${row.item_id}`}
          width={110}
          height={40}
        />
      </div>

      <div className="mt-3 border-t border-border/40 pt-2 text-right font-mono text-[10px] text-muted-foreground">
        {formatDateTime(row.recorded_at)}
      </div>

      {/* zachováme SEO/progr. navigaci jako odkaz na celé kartě */}
      <Link
        href={`/market/${row.item_id}`}
        aria-label={`Detail ${row.name}`}
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:inset-0 focus-visible:rounded-xl focus-visible:ring-2 focus-visible:ring-ring"
      >
        Detail {row.name}
      </Link>
    </div>
  );
}
