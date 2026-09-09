"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";

import { updateAlertRuleAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { alertLabel } from "@/components/alerts-table";
import { cn } from "@/lib/utils";
import type { AlertWithItem } from "@/lib/data";

/**
 * Editovatelná podmínka alertu (tužka): badge „Cena ≥/≤ X" + tužka, po
 * kliknutí inline editor (směr + práh). Jen pro kind='price' – limitní
 * prodeje se řídí z portfolia, skóre generuje Signal Engine. Uložení přes
 * server action + router.refresh (tabulky i alert linie v grafu).
 */
export function EditableAlertRule({
  alert,
  className,
}: {
  alert: AlertWithItem;
  className?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [threshold, setThreshold] = useState("");
  const [direction, setDirection] = useState<"above" | "below">(
    alert.direction
  );
  const [error, setError] = useState<string | null>(null);

  const badgeClasses = cn(
    "font-mono text-[11px]",
    alert.kind === "score" && "border-primary/30 bg-primary/10 text-primary",
    alert.kind === "limit_sell" &&
      "border-[#d4a72c]/30 bg-[#d4a72c]/10 text-[#d4a72c]",
    alert.kind === "price" &&
      alert.current_price != null &&
      (alert.direction === "above"
        ? alert.current_price >= alert.threshold
        : alert.current_price <= alert.threshold) &&
      "border-up/30 bg-up/10 text-up"
  );

  // Limitní prodej / skóre: jen badge (editace jinde)
  if (alert.kind !== "price") {
    return (
      <Badge variant="outline" className={cn(badgeClasses, className)}>
        {alertLabel(alert)}
      </Badge>
    );
  }

  if (!editing) {
    return (
      <span className={cn("inline-flex items-center gap-1", className)}>
        <Badge variant="outline" className={badgeClasses}>
          {alertLabel(alert)}
        </Badge>
        <button
          type="button"
          aria-label="Upravit alert"
          title="Upravit práh a směr alertu"
          onClick={() => {
            setThreshold(String(alert.threshold));
            setDirection(alert.direction);
            setError(null);
            setEditing(true);
          }}
          className="cursor-pointer rounded p-1 text-muted-foreground/80 transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Pencil className="size-3.5" />
        </button>
      </span>
    );
  }

  const save = () => {
    const value = Number(threshold.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      setError("Práh musí být kladné číslo.");
      return;
    }
    startTransition(async () => {
      const res = await updateAlertRuleAction(alert.id, value, direction);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(res.error ?? "Uložení se nepovedlo.");
      }
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className={cn("inline-flex items-center gap-1", className)}
    >
      <Select
        value={direction}
        onValueChange={(v) => setDirection(v as "above" | "below")}
      >
        <SelectTrigger className="h-7 w-[74px] px-2 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="above">Nad</SelectItem>
          <SelectItem value="below">Pod</SelectItem>
        </SelectContent>
      </Select>
      <Input
        value={threshold}
        onChange={(e) => setThreshold(e.target.value)}
        type="number"
        step="0.001"
        min="0"
        autoFocus
        disabled={pending}
        className="h-7 w-24 font-mono text-[11px]"
        aria-label="Práh alertu"
      />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        disabled={pending}
        className="size-6 text-up hover:text-up"
        aria-label="Uložit alert"
      >
        <Check className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={pending}
        onClick={() => setEditing(false)}
        className="size-6 text-muted-foreground"
        aria-label="Zrušit úpravu"
      >
        <X className="size-3.5" />
      </Button>
      {error && (
        <span className="text-[11px] text-down">{error}</span>
      )}
    </form>
  );
}
