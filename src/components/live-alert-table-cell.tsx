"use client";

import { useEffect, useState } from "react";

import { formatPrice, plColorClass } from "@/lib/format";
import { useLiveTick } from "@/lib/live-prices";
import { cn } from "@/lib/utils";

/**
 * Live buňka „Aktuální“ v tabulce alertů komodity (Fáze 3C).
 * SSR hodnota (current_price) se po připojení SSE nahradí živým tickem;
 * stav „reached“ (cena za prahem) se přepočítává hned, ne s refreshem.
 */
export function LiveCurrentPriceCell({
  itemId,
  threshold,
  direction,
  kind,
  initialPrice,
}: {
  itemId: number;
  threshold: number;
  direction: "above" | "below";
  kind: "price" | "score" | "limit_sell";
  initialPrice: number | null;
}) {
  const tick = useLiveTick(itemId);
  const price = tick ? tick.price : initialPrice;

  const reached =
    price != null &&
    (kind === "limit_sell"
      ? price >= threshold
      : direction === "above"
        ? price >= threshold
        : price <= threshold);

  return (
    <span
      className={cn(
        "font-mono",
        reached ? plColorClass(1) : "text-muted-foreground"
      )}
    >
      {formatPrice(price)}
      {tick ? (
        <span
          className="ml-1 inline-block size-1.5 rounded-full bg-up align-middle"
          title="Live cena"
        />
      ) : null}
    </span>
  );
}
