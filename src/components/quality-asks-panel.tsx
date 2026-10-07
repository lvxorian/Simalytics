"use client";

import { formatCompact, formatPercent, formatPrice } from "@/lib/format";
import { useLiveQualityAsks } from "@/lib/live-prices";
import { cn } from "@/lib/utils";

/**
 * Žebříček kvalit na burze (market page) – nejnižší ask každé kvality,
 * kterou burza AKTUÁLNĚ nabízí, s celkovým objemem a prémií vs. Q0.
 *
 * Data živě přes SSE: hub agreguje quality ladder z TÉŽE upstream
 * odpovědi jako mini orderbook (path 0 = kompletní kniha v3 API) a
 * posílá ji ve stejném 'orderbook' eventu – nula requestů navíc.
 * REST fallback (/api/live/asks) jen v offline režimu (15 s).
 *
 * Položky bez variant kvality (výzkumy, Software, Přeprava) mají na
 * burze jen Q0 → panel se nezobrazuje (orderbook panel to kryje).
 */
export function QualityAsksPanel({ itemId }: { itemId: number }) {
  const { qualities, source } = useLiveQualityAsks(itemId);

  if (qualities === null) {
    return (
      <div className="h-[116px] animate-pulse rounded-xl border border-border/60 bg-card" />
    );
  }
  // Jediná kvalita = nic nad rámec mini orderbooku.
  if (qualities.length < 2) return null;

  const q0 = qualities.find((q) => q.quality === 0) ?? null;
  const maxQty = Math.max(...qualities.map((q) => q.quantity), 1);

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Kvality na burze
        </span>
        <span
          className="font-mono text-[10px] text-muted-foreground"
          title={
            source === "sse"
              ? "Nejnižší aktivní nabídka každé kvality. Živě přes SSE."
              : "Nejnižší aktivní nabídka každé kvality. Offline polling."
          }
        >
          {source === "sse" && <span className="mr-1 text-up">●</span>}
          nejnižší ask
        </span>
      </div>
      <ul className="divide-y divide-border/30">
        {qualities.map((q) => {
          const premium =
            q0 && q.quality !== 0 && q0.price > 0
              ? (q.price / q0.price - 1) * 100
              : null;
          return (
            <li key={q.quality} className="relative px-3 py-1.5">
              {/* hloubka – pozadí proporcionální celkovému objemu kvality */}
              <div
                className="absolute inset-y-0 right-0 bg-primary/8"
                style={{ width: `${(q.quantity / maxQty) * 100}%` }}
                aria-hidden
              />
              <div className="relative flex items-center justify-between gap-3 font-mono text-xs">
                <span
                  className={cn(
                    "rounded border px-1 text-[10px] uppercase tracking-wider",
                    q.quality === 0
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border/60 bg-secondary/40 text-foreground/80"
                  )}
                  title={
                    q.quality === 0
                      ? "Základní kvalita – cena grafu"
                      : `${q.offers} ${q.offers === 1 ? "aktivní nabídka" : "aktivních nabídek"} · celkem ${q.quantity.toLocaleString("cs-CZ")} ks`
                  }
                >
                  Q{q.quality}
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      q.quality === 0 ? "text-up" : "text-foreground/80"
                    )}
                  >
                    {formatPrice(q.price)}
                  </span>
                  <span
                    className="tabular-nums text-muted-foreground"
                    title="Celkem nabízených ks v této kvalitě"
                  >
                    {formatCompact(q.quantity)}
                  </span>
                  {premium !== null && (
                    <span
                      className="w-16 text-right tabular-nums text-muted-foreground"
                      title={`Prémie Q${q.quality} vs. Q0 (o kolik % dražší než základní kvalita)`}
                    >
                      {formatPercent(premium)}
                    </span>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-border/40 px-3 py-1.5 text-[10px] leading-snug text-muted-foreground">
        Cena = nejnižší nabídka kvality · % = prémie vs. Q0 · číslo = nabízené ks
      </p>
    </div>
  );
}
