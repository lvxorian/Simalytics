import Link from "next/link";

import { ItemIcon } from "@/components/item-icon";
import { getLatestPrices, getPricesAround24hAgo } from "@/lib/data";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type TickerEntry = {
  id: number;
  name: string;
  image_url: string | null;
  price: number;
  change24h: number | null;
};

/** Malý caret (▲/▼) jako v reálných tickerech. */
function Caret({ up, className }: { up: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 8 8"
      aria-hidden
      className={cn("size-2 shrink-0", up ? "text-up" : "rotate-180 text-down", className)}
    >
      <path d="M4 0.8 L7.6 7 H0.4 Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Sliding lista s komoditami (marquee, pauza na hover) – poběží pod
 * hlavičkou na každé stránce, jako v reálných trading aplikacích.
 * Server component: data dotáhne sama, animace je čisté CSS.
 */
export async function TickerTape() {
  let entries: TickerEntry[] = [];

  try {
    const latest = await getLatestPrices(0);
    const dayAgo = await getPricesAround24hAgo(latest.map((r) => r.item_id));
    entries = latest
      .map((r) => {
        const base = dayAgo.get(r.item_id);
        return {
          id: r.item_id,
          name: r.name,
          image_url: r.image_url,
          price: r.price,
          change24h: base && base > 0 ? ((r.price - base) / base) * 100 : null,
        };
      })
      // největší pohyby pierwszí – tickery žijí akcí
      .sort(
        (a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0)
      );
  } catch {
    return null; // DB nedostupná → lista se prostě nezobrazí
  }

  if (entries.length === 0) return null;

  // Dvojnásobný obsah = plynulá nekonečná smyčka (translateX(-50%))
  const copies = [0, 1];

  return (
    <div
      className="ticker-hover-pause group relative overflow-hidden border-b border-border/70 bg-card/60"
      role="marquee"
      aria-label="Běžící ceny komodit"
    >
      {/* Svetlé stínové okraje – lista „zapadá“ do pozadí */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-background to-transparent" />

      <div className="animate-marquee flex w-max items-center">
        {copies.map((copy) => (
          <ul
            key={copy}
            aria-hidden={copy === 1}
            className="flex items-center"
          >
            {entries.map((entry) => {
              const up = (entry.change24h ?? 0) > 0;
              const down = (entry.change24h ?? 0) < 0;
              return (
                <li key={`${copy}-${entry.id}`}>
                  <Link
                    href={`/market/${entry.id}`}
                    tabIndex={copy === 1 ? -1 : undefined}
                    className="flex items-center gap-2.5 border-r border-border/40 px-5 py-2.5 text-sm transition-colors hover:bg-accent/60"
                  >
                    <ItemIcon
                      url={entry.image_url}
                      name={entry.name}
                      size={30}
                    />
                    <span className="font-medium text-foreground/90">
                      {entry.name}
                    </span>
                    <span className="font-mono text-foreground/70">
                      {formatPrice(entry.price)}
                    </span>
                    <span
                      className={cn(
                        "flex items-center gap-1 font-mono text-sm font-medium",
                        up && "text-up",
                        down && "text-down",
                        !up && !down && "text-muted-foreground"
                      )}
                    >
                      {(up || down) && <Caret up={up} className="size-2.5" />}
                      {entry.change24h === null
                        ? "–"
                        : `${up ? "+" : down ? "−" : ""}${Math.abs(entry.change24h).toFixed(2)} %`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
      </div>
    </div>
  );
}
