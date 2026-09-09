"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellPlus, X } from "lucide-react";

import { createAlertAction, type ActionState } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPrice } from "@/lib/format";

const INITIAL: ActionState = { ok: false };

/**
 * Kontextová nabídka grafu (pravé tlačítko myši).
 * „Nastavit alert“ otevře mini formulář s předvyplněnou cenou z místa
 * kliknutí (snap na OHLC) – po uložení se alert objeví v tabulce pod
 * grafem. Esc / klik mimo / křížek menu zavřou.
 */
export function ChartContextMenu({
  x,
  y,
  price,
  time,
  itemId,
  itemName,
  onClose,
}: {
  x: number;
  y: number;
  price: number | null;
  time: number | null;
  itemId?: number;
  itemName?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [openForm, setOpenForm] = useState(false);
  const [state, formAction, pending] = useActionState(
    createAlertAction,
    INITIAL
  );
  const [threshold, setThreshold] = useState<string>(
    price != null ? price.toFixed(4) : ""
  );
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Zavřít na Esc nebo klik mimo menu
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  // Po úspěšném uložení zavřít menu a obnovit data (tabulka pod grafem)
  useEffect(() => {
    if (state.ok) {
      router.refresh();
      const t = setTimeout(onClose, 900);
      return () => clearTimeout(t);
    }
  }, [state.ok, router, onClose]);

  const canCreate = itemId != null && price != null;

  // Menu překlopit, když by přetékalo doprava/dolů (šířka ~260 px)
  const flipX = x > 320;
  const flipY = y > 420;

  return (
    <div
      ref={boxRef}
      className="absolute z-30 w-64 rounded-lg border border-border bg-popover shadow-xl"
      style={{
        left: flipX ? x - 256 : x + 4,
        top: flipY ? y - 100 : y + 4,
      }}
      // zabránit, aby klik do menu spustil drag v grafu
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {!openForm ? (
        <div className="p-1">
          <div className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
            {price != null ? formatPrice(price) : "–"}
            {itemName ? ` · ${itemName}` : ""}
          </div>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => setOpenForm(true)}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-secondary disabled:opacity-40"
          >
            <BellPlus className="size-4 text-primary" />
            Nastavit alert
          </button>
        </div>
      ) : (
        <form action={formAction} className="space-y-2.5 p-3">
          <input type="hidden" name="item_id" value={itemId ?? ""} />
          <input type="hidden" name="quality" value="0" />
          <input type="hidden" name="kind" value="price" />
          <input type="hidden" name="direction" value="above" />

          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Cenový alert</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Zavřít"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ctx-alert-threshold" className="text-[11px] text-muted-foreground">
              Práh – upozornit, když cena překročí
            </Label>
            <Input
              id="ctx-alert-threshold"
              name="threshold"
              type="number"
              step="0.001"
              min="0"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              required
              autoFocus
              className="h-8 font-mono text-xs"
            />
          </div>

          <p className="text-[11px] text-muted-foreground">
            Podmínku (nad/pod) nebo skóre signálu upravíš v tabulce níže /
            na stránce Alerty.
          </p>

          {state.error && (
            <p className="text-[11px] text-down">{state.error}</p>
          )}
          {state.ok && (
            <p className="text-[11px] text-up">✅ Alert uložen.</p>
          )}

          <Button type="submit" size="sm" disabled={pending} className="h-8 w-full text-xs">
            {pending ? "Ukládám…" : "Uložit alert"}
          </Button>
        </form>
      )}
    </div>
  );
}
