import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Pilulka se 24h změnou – zelená roste, červená padá.
 * Standardní prvek každé trading aplikace (tabulky, tickery, karty).
 */
export function ChangeBadge({
  value,
  className,
  size = "md",
}: {
  value: number | null | undefined;
  className?: string;
  size?: "sm" | "md";
}) {
  const up = (value ?? 0) > 0;
  const down = (value ?? 0) < 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-mono font-medium tabular-nums",
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-xs",
        up && "border-up/25 bg-up/10 text-up",
        down && "border-down/25 bg-down/10 text-down",
        !up && !down && "border-border bg-muted text-muted-foreground",
        className
      )}
    >
      {up && <ArrowUpRight className={size === "sm" ? "size-3" : "size-3.5"} />}
      {down && <ArrowDownRight className={size === "sm" ? "size-3" : "size-3.5"} />}
      {!up && !down && <Minus className={size === "sm" ? "size-3" : "size-3.5"} />}
      {formatPercent(value)}
    </span>
  );
}
