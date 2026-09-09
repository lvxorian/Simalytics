"use client";

import { ChangeBadge } from "@/components/change-badge";
import { formatPrice } from "@/lib/format";
import { useLivePriceOverride } from "@/lib/live-prices";
import { cn } from "@/lib/utils";

/**
 * Živá cena pro tabulky a karty (Fáze 3C): SSR hodnota se po připojení
 * SSE nahradí živým tickem (~1–2 s od obchodu). Re-render jen u položek,
 * které dostaly nový obchod (useLiveTick → stabilní reference).
 */
export function LivePrice({
  itemId,
  initialPrice,
  className,
}: {
  itemId: number;
  initialPrice: number | null;
  className?: string;
}) {
  const { price } = useLivePriceOverride(itemId, initialPrice, null);

  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {formatPrice(price)}
    </span>
  );
}

/**
 * Živý 24h ChangeBadge: dokud není živý tick, ukazuje SSR hodnotu;
 * po ticku přepočítá proti base odvozené ze SSR (initialPrice +
 * initialChange24h). Bez ticku = nulové náklady na render.
 */
export function LiveChangeBadge({
  itemId,
  initialPrice,
  initialChange24h,
  size,
}: {
  itemId: number;
  initialPrice: number | null;
  initialChange24h: number | null;
  size?: "sm" | "md";
}) {
  const { change24h } = useLivePriceOverride(
    itemId,
    initialPrice,
    initialChange24h
  );
  return <ChangeBadge value={change24h} size={size} />;
}
