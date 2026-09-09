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
 * Editovatelná podmínka alertu (tužka): badge „Cena ≥/≤/⤨ X" + tužka, po
 * kliknutí inline editor (směr nad/pod/cross + práh + jednorázovost).
 * Jen pro kind='price' – limitní prodeje se řídí z portfolia, skóre
 * generuje Signal Engine. Uložení přes server action + router.refresh
 * (tabulky i alert linie v grafu).
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
  const [direction, setDirection] = useState<"above" | "below" | "cross">(
    alert.direction
  );
  const [oneShot, setOneShot] = useState(alert.one_shot);
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
        : alert.direction === "cross"
          ? Math.abs(alert.current_price - alert.threshold) / alert.threshold <
            0.005 // u crossu "dosaženo" = cena těsně u prahu
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
          title="Upravit práh, směr a jednorázovost alertu"
          onClick={() => {
            setThreshold(String(alert.threshold));
            setDirection(alert.direction);
            setOneShot(alert.one_shot);
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
      const res = await updateAlertRuleAction(
        alert.id,
        value,
        direction,
        oneShot
      );
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
      className="inline-flex flex-wrap items-center gap-1"
    >
      <Select
        value={direction}
        onValueChange={(v) => setDirection(v as "above" | "below" | "cross")}
      >
        <SelectTrigger className="h-7 w-[86px] px-2 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="above">Nad</SelectItem>
          <SelectItem value="below">Pod</SelectItem>
          <SelectItem value="cross">Při překřížení</SelectItem>
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
      <label
        className={cn(
          "flex cursor-pointer items-center gap-1 rounded border px-1.5 py-1 text-[10px] transition-colors",
          oneShot
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:text-foreground"
        )}
        title="Jednorázový alert – po první aktivaci se automaticky smaže"
      >
        <input
          type="checkbox"
          checked={oneShot}
          onChange={(e) => setOneShot(e.target.checked)}
          className="size-3 accent-[var(--primary)]"
        />
        ×1
      </label>
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
      {error && <span className="text-[11px] text-down">{error}</span>}
    </form>
  );
}
