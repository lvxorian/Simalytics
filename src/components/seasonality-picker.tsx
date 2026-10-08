"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { ItemCombobox, type ComboboxItem } from "@/components/ui/combobox";

/**
 * Picker sezónality – výběr aktiva (combobox) a kvality (tabs).
 * Změna = router.push s URL param (item/q) → server re-fetch historie.
 * URL je sdílená/uložitelná (/sezonalita?item=146&q=3).
 */

export function SeasonalityPicker({
  items,
  selectedId,
}: {
  items: ComboboxItem[];
  selectedId: number | null;
}) {
  const router = useRouter();

  return (
    <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5">
      <div className="max-w-md">
        <ItemCombobox
          items={items}
          value={selectedId ? String(selectedId) : ""}
          onChange={(id) => {
            if (id) router.push(`/sezonalita?item=${id}`);
          }}
          placeholder="Vyber aktivum pro sezonalitu…"
        />
      </div>
      {!selectedId && (
        <p className="mt-3 text-xs text-muted-foreground">
          Např. „Dýna“ má 55 měsíců historie – heatmapa ukáže, ve kterých
          měsících cena tradičně roste.
        </p>
      )}
    </div>
  );
}

export function SeasonalityQualityTabs({
  qualities,
  itemId,
  activeQuality,
}: {
  qualities: number[];
  itemId: number;
  activeQuality: number;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-muted-foreground">Kvalita:</span>
      {qualities.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => router.push(`/sezonalita?item=${itemId}&q=${q}`)}
          className={cn(
            "cursor-pointer rounded-full border px-3 py-1 font-mono text-xs transition-colors",
            q === activeQuality
              ? "border-primary/40 bg-primary/15 text-primary"
              : "border-border/70 bg-secondary/40 text-muted-foreground hover:text-foreground"
          )}
        >
          Q{q}
        </button>
      ))}
    </div>
  );
}
