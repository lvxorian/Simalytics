import Link from "next/link";

import { ItemIcon } from "@/components/item-icon";
import { getLatestPrices, getLatestVwaps, getPricesAround24hAgo } from "@/lib/data";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type TickerEntry = {
  id: number;
  name: string;
  image_url: string | null;
  price: number;
  change24h: number | null;
  /** Denní VWAP (kvalita 0) – základ divergence vs. fair value. */
  vwap: number | null;
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
 * Ticker ve stylu burzovních platforem – JEDNA řada se všemi komoditami
 * (seřazeno dle |24h změny|, položky bez změny na konci). Dlaždice:
 * ikona, cena, 24h změna a divergence vs. denní VWAP (fair value).
 * Hover zastaví řadu a zvýrazní dlaždici.
 */
export async function TickerTape() {
  let entries: TickerEntry[] = [];

  try {
    const latest = await getLatestPrices(0);
    const ids = latest.map((r) => r.item_id);
    const [dayAgo, vwaps] = await Promise.all([
      getPricesAround24hAgo(ids),
      getLatestVwaps(ids, 0),
    ]);

    entries = latest
      .map((r) => {
        const base = dayAgo.get(r.item_id);
        const vwap = vwaps.get(r.item_id) ?? null;
        return {
          id: r.item_id,
          name: r.name,
          image_url: r.image_url,
          price: r.price,
          change24h: base && base > 0 ? ((r.price - base) / base) * 100 : null,
          vwap: vwap && vwap > 0 ? vwap : null,
        };
      })
      // Největší pohyby vpřed, položky bez 24h změny na konec –
      // NIC se nezahazuje, lista má vždy obsah celého trhu
      .sort((a, b) => {
        const key = (e: TickerEntry) =>
          e.change24h === null ? -1 : Math.abs(e.change24h);
        return key(b) - key(a);
      });
  } catch {
    return null; // DB nedostupná → lista se prostě nezobrazí
  }

  if (entries.length === 0) return null;

  return (
    <div
      className="ticker-hover-pause ticker-tape relative border-b border-border/70 backdrop-blur-sm"
      role="marquee"
      aria-label="Běžící ceny komodit"
    >
      <TickerRow entries={entries} keyPrefix="tk" />
    </div>
  );
}

function TickerRow({
  entries,
  keyPrefix,
}: {
  entries: TickerEntry[];
  keyPrefix: string;
}) {
  // Dvojnásobný obsah = plynulá nekonečná smyčka (translateX(-50%)).
  // Rychlost škálujeme s délkou řady (~10 s na dlaždici), aby px/s
  // tempo zůstalo stejné jako u původní krátké listy – POMALÉ.
  const speed = `${Math.max(360, entries.length * 10)}s`;
  const copies = [0, 1];

  return (
    <div className="relative overflow-hidden">
      {/* Krajní stínování – lista „zapadá“ do pozadí */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-background/90 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-16 w-16 bg-gradient-to-l from-background/90 to-transparent" />

      <div
        className="animate-marquee flex w-max items-center"
        style={{ "--ticker-speed": speed } as React.CSSProperties}
      >
        {copies.map((copy) => (
          <ul key={`${keyPrefix}-${copy}`} aria-hidden={copy === 1} className="flex items-center">
            {entries.map((entry) => {
              const up = (entry.change24h ?? 0) > 0;
              const down = (entry.change24h ?? 0) < 0;
              // Divergence vs. denní VWAP: pod VWAPem = relativně levné (up),
              // nad = drahé (down) – konzistentní se skenerem příležitostí
              const vwapDiv =
                entry.vwap != null && entry.vwap > 0
                  ? ((entry.price - entry.vwap) / entry.vwap) * 100
                  : null;
              const cheap = vwapDiv !== null && vwapDiv < 0;

              return (
                <li key={`${keyPrefix}-${copy}-${entry.id}`}>
                  <Link
                    href={`/market/${entry.id}`}
                    tabIndex={copy === 1 ? -1 : undefined}
                    className={cn(
                      "ticker-tile group relative m-1.5 flex items-center gap-2.5 rounded-xl border px-3 py-1.5 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                      "hover:z-20 hover:-translate-y-0.5",
                      up
                        ? "ticker-tile-up border-up/20"
                        : down
                          ? "ticker-tile-down border-down/20"
                          : "border-border/60"
                    )}
                  >
                    {/* barevná levá signatura směru – gradientní proužek */}
                    <span
                      className={cn(
                        "absolute inset-y-1 left-0 w-0.5 rounded-full",
                        up && "bg-gradient-to-b from-up to-up/40",
                        down && "bg-gradient-to-b from-down to-down/40",
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

                    {/* VWAP divergence – „fair value“ metrika jako na burze */}
                    {vwapDiv !== null && (
                      <span
                        title={`Cena vs. denní VWAP (Q0): ${vwapDiv > 0 ? "+" : ""}${vwapDiv.toFixed(1)} % – ${
                          cheap ? "pod fair value (relativně levná)" : "nad fair value (relativně drahá)"
                        }`}
                        className={cn(
                          "ml-1 hidden shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] sm:block",
                          cheap ? "bg-up/10 text-up" : "bg-down/10 text-down"
                        )}
                      >
                        VWAP {vwapDiv > 0 ? "+" : "−"}
                        {Math.abs(vwapDiv).toFixed(1)} %
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
