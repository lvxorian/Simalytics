import Link from "next/link";

import { ItemIcon } from "@/components/item-icon";
import { getLatestPrices, getPricesAround24hAgo, getSparklines } from "@/lib/data";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type TickerEntry = {
  id: number;
  name: string;
  image_url: string | null;
  price: number;
  quantity: number | null;
  change24h: number | null;
};

/** Malý caret (▲/▼) jako v reálných tickerech. */
function Caret({ up, className }: { up: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 8 8"
      aria-hidden
      className={cn("size-2.5 shrink-0", up ? "text-up" : "rotate-180 text-down", className)}
    >
      <path d="M4 0.8 L7.6 7 H0.4 Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Moderní ticker ve stylu burzovi platforem – dvě řady jedoucí proti
 * sobě (pohyby vs. objem), dlaždice s ikonou, cenou, změnou a
 * sparklinou. Hover zastaví řadu a zvýrazní dlaždici.
 */
export async function TickerTape() {
  let entries: TickerEntry[] = [];

  try {
    const latest = await getLatestPrices(0);
    const ids = latest.map((r) => r.item_id);
    const [dayAgo, sparks] = await Promise.all([
      getPricesAround24hAgo(ids),
      getSparklines(ids, 0, 24, 20),
    ]);

    entries = latest
      .map((r) => {
        const base = dayAgo.get(r.item_id);
        return {
          id: r.item_id,
          name: r.name,
          image_url: r.image_url,
          price: r.price,
          quantity: r.quantity,
          change24h: base && base > 0 ? ((r.price - base) / base) * 100 : null,
        };
      })
      .filter((e) => e.change24h !== null)
      .sort(
        (a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0)
      );
  } catch {
    return null; // DB nedostupná → lista se prostě nezobrazí
  }

  if (entries.length === 0) return null;

  // Horní řada: pohyby (gainers i losers střídané pro vizuální rytmus)
  const movers = entries.slice(0, 18);
  const interwoven: TickerEntry[] = [];
  const gainers = movers.filter((e) => (e.change24h ?? 0) > 0);
  const losers = movers.filter((e) => (e.change24h ?? 0) < 0);
  const maxLen = Math.max(gainers.length, losers.length);
  for (let i = 0; i < maxLen; i++) {
    if (gainers[i]) interwoven.push(gainers[i]);
    if (losers[i]) interwoven.push(losers[i]);
  }

  // Dolní řada: největší objemy (obchodní aktivita)
  const volumes = [...entries]
    .sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0))
    .slice(0, 18);

  return (
    <div
      className="ticker-hover-pause relative border-b border-border/70 bg-card/40 backdrop-blur-sm"
      role="marquee"
      aria-label="Běžící ceny komodit"
    >
      {/* Horní řada – pohyby (→) */}
      <TickerRow entries={interwoven} sparklines keyPrefix="mv" reverse={false} />
      {/* Dolní řada – objemy (←), jen tmavší a decentnější */}
      <div className="border-t border-border/40 bg-background/40">
        <TickerRow entries={volumes} keyPrefix="vol" reverse showVolume />
      </div>
    </div>
  );
}

function TickerRow({
  entries,
  keyPrefix,
  reverse,
  showVolume = false,
  sparklines = false,
}: {
  entries: TickerEntry[];
  keyPrefix: string;
  reverse: boolean;
  showVolume?: boolean;
  sparklines?: boolean;
}) {
  // Dvojnásobný obsah = plynulá nekonečná smyčka (translateX(-50%))
  const copies = [0, 1];

  return (
    <div className="relative overflow-hidden">
      {/* Krajní stínování – lista „zapadá“ do pozadí */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-background/90 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-16 w-16 bg-gradient-to-l from-background/90 to-transparent" />

      <div
        className={cn(
          "flex w-max items-center",
          reverse ? "animate-marquee-reverse" : "animate-marquee"
        )}
      >
        {copies.map((copy) => (
          <ul key={`${keyPrefix}-${copy}`} aria-hidden={copy === 1} className="flex items-center">
            {entries.map((entry) => {
              const up = (entry.change24h ?? 0) > 0;
              const down = (entry.change24h ?? 0) < 0;
              return (
                <li key={`${keyPrefix}-${copy}-${entry.id}`}>
                  <Link
                    href={`/market/${entry.id}`}
                    tabIndex={copy === 1 ? -1 : undefined}
                    className={cn(
                      "group relative m-1.5 flex items-center gap-2.5 rounded-xl border px-3 py-1.5 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                      "hover:z-20 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent/80 hover:shadow-lg hover:shadow-black/30",
                      up
                        ? "border-up/15 bg-up/[0.04]"
                        : down
                          ? "border-down/15 bg-down/[0.04]"
                          : "border-border/60 bg-card"
                    )}
                  >
                    {/* barevná levá signatura směru */}
                    <span
                      className={cn(
                        "absolute inset-y-1 left-0 w-0.5 rounded-full",
                        up && "bg-up/70",
                        down && "bg-down/70",
                        !up && !down && "bg-border"
                      )}
                    />

                    <ItemIcon url={entry.image_url} name={entry.name} size={28} bare />

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[13px] font-medium leading-tight text-foreground/90">
                        <span className="max-w-[140px] truncate">{entry.name}</span>
                        {(up || down) && <Caret up={up} />}
                      </div>
                      <div className="flex items-center gap-2 font-mono text-xs leading-tight">
                        <span className="text-foreground/75">
                          {formatPrice(entry.price)}
                        </span>
                        <span
                          className={cn(
                            "font-medium",
                            up && "text-up",
                            down && "text-down",
                            !up && !down && "text-muted-foreground"
                          )}
                        >
                          {entry.change24h === null
                            ? "–"
                            : `${up ? "+" : down ? "−" : ""}${Math.abs(entry.change24h).toFixed(2)} %`}
                        </span>
                      </div>
                    </div>

                    {showVolume && entry.quantity != null && (
                      <span className="ml-1 hidden shrink-0 rounded-md bg-secondary/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
                        {new Intl.NumberFormat("cs-CZ", {
                          notation: "compact",
                          maximumFractionDigits: 1,
                        }).format(entry.quantity)}
                      </span>
                    )}
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
