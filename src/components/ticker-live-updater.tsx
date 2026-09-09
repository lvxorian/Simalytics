"use client";

import { useEffect } from "react";

import { useLiveSnapshot } from "@/lib/live-prices";
import { formatPrice } from "@/lib/format";

/**
 * Live updater ticker tape (Fáze 3C) – imperativně přepisuje čísla
 * v existujících dlaždicích ze SSE store:
 *   [data-ticker-item]      → id položky (na <Link>)
 *   [data-ticker-price]     → poslední cena
 *   [data-ticker-change]    → 24h změna (přepočet proti SSR base)
 *   [data-ticker-vwap]      → divergence vs. denní VWAP
 *
 * React re-render stovek dlaždic by sekal CSS marquee (fullscreen
 * layout thrash), proto DOM patch jen tam, kde se cena změnila.
 * Pořadí dlaždic zůstává ze serveru (žádné „poskakování“ během jízdy).
 */
export function TickerLiveUpdater() {
  const { items } = useLiveSnapshot();

  useEffect(() => {
    if (items.size === 0) return;

    const tiles = document.querySelectorAll<HTMLElement>("[data-ticker-item]");
    for (const tile of tiles) {
      const id = Number(tile.dataset.tickerItem);
      if (!Number.isFinite(id)) continue;
      const tick = items.get(id);
      if (!tick) continue;

      const ssPrice = Number(tile.dataset.ssPrice);
      if (!Number.isFinite(ssPrice) || tick.price === ssPrice) continue;

      // ── Cena ──────────────────────────────────────────────────────
      const priceEl = tile.querySelector<HTMLElement>("[data-ticker-price]");
      if (priceEl) priceEl.textContent = formatPrice(tick.price);

      // ── 24h změna (proti SSR base) ────────────────────────────────
      const ssChangeRaw = tile.dataset.ssChange;
      const base =
        ssPrice > 0 && ssChangeRaw !== "" && Number.isFinite(Number(ssChangeRaw))
          ? ssPrice / (1 + Number(ssChangeRaw) / 100)
          : null;
      const changeEl = tile.querySelector<HTMLElement>("[data-ticker-change]");
      if (changeEl && base && base > 0) {
        const change = ((tick.price - base) / base) * 100;
        const up = change > 0;
        const down = change < 0;
        changeEl.textContent = `${up ? "+" : down ? "−" : ""}${Math.abs(change).toFixed(2)} %`;
        changeEl.classList.toggle("text-up", up);
        changeEl.classList.toggle("text-down", down);
        changeEl.classList.toggle("text-muted-foreground", !up && !down);
        // Tón dlaždice (okraj + proužek) řídí třídy na Linku
        tile.classList.toggle("ticker-tile-up", up);
        tile.classList.toggle("ticker-tile-down", down);
        tile.classList.toggle("border-up/20", up);
        tile.classList.toggle("border-down/20", down);
        tile.classList.toggle("border-border/60", !up && !down);
      }

      // ── VWAP divergence ───────────────────────────────────────────
      const ssVwap = Number(tile.dataset.ssVwap);
      const vwapEl = tile.querySelector<HTMLElement>("[data-ticker-vwap]");
      if (vwapEl && Number.isFinite(ssVwap) && ssVwap > 0) {
        const div = ((tick.price - ssVwap) / ssVwap) * 100;
        const cheap = div < 0;
        vwapEl.textContent = `VWAP ${div > 0 ? "+" : "−"}${Math.abs(div).toFixed(1)} %`;
        vwapEl.classList.toggle("bg-up/10", cheap);
        vwapEl.classList.toggle("text-up", cheap);
        vwapEl.classList.toggle("bg-down/10", !cheap);
        vwapEl.classList.toggle("text-down", !cheap);
        vwapEl.title = `Cena vs. denní VWAP (Q0): ${div > 0 ? "+" : ""}${div.toFixed(1)} % – ${
          cheap ? "pod fair value (relativně levná)" : "nad fair value (relativně drahá)"
        }`;
      }
    }
  }, [items]);

  return null;
}
