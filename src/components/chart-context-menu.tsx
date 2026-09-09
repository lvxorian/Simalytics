"use client";

import { useActionState, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  // Hra počítá ceny s přesností 3 desetinná místa (343,355) – stejné
  // kroky používá i formulář alertu i pozic.
  const [threshold, setThreshold] = useState<string>(
    price != null ? price.toFixed(3) : ""
  );
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Pozice menu – počítá se z REÁLNĚ změřené velikosti boxu (menu i
  // formulář mají jinou výšku) a velikosti rodiče (chart container),
  // takže menu je VŽDY celé viditelné – klik dole v grafu ho zvedne
  // nahoru místo překrytí spodní hranou. Skryté, dokud není spočítáno
  // (useLayoutEffect = bez probliknutí).
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

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

  // ── Pozicování menu: vždy celé viditelné v rámci rodiče ──────────
  // Po každém renderu (otevření menu, přepnutí na formulář, chyba/úspěch
  // = změna výšky) přepočítat pozici z měřeného bounding boxu menu a
  // rodiče. Preferovaná pozice = místo kliknutí; když by box přetekl,
  // překlopí se doleva/nahoru; když nejde překlopit, hranu rodiče
  // respektuje (clamp). Výsledek: tlačítko „Uložit alert“ je vždy
  // klikatelné, nikdy skryté pod hranou grafu.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const parent = box?.parentElement;
    if (!box || !parent) return;

    const bRect = box.getBoundingClientRect();
    const pRect = parent.getBoundingClientRect();
    const margin = 4;
    const boxW = bRect.width;
    const boxH = bRect.height;

    // Rodič může být posunutý vzhledem ke kontextu menu (fullscreen
    // re-parent) – pracujeme s relativními souřadnicemi
    const relX = x;
    const relY = y;

    // Vodorovně: preferuj vpravo od kurzoru, přetéká-li, překlop doleva,
    // a pořád-li mimo, clamp na hranu rodiče
    let left = relX + 4;
    if (left + boxW > pRect.width - margin) {
      left = relX - boxW - 4;
    }
    if (left < margin) left = margin;
    if (left + boxW > pRect.width - margin) {
      left = pRect.width - boxW - margin;
    }
    if (left < margin) left = margin;

    // Svisle: preferuj pod kurzorem; přetéká-li, nad kurzor; pak clamp
    let top = relY + 4;
    if (top + boxH > pRect.height - margin) {
      top = relY - boxH - 4;
    }
    if (top < margin) top = margin;
    if (top + boxH > pRect.height - margin) {
      top = pRect.height - boxH - margin;
    }
    if (top < margin) top = margin;

    // GUARD: setPos jen když se pozice REÁLNĚ změnila – jinak by každý
    // render vytvořil nový objekt → nový render → nekonečná smyčka
    // (Maximum update depth exceeded → error page při pravém kliku).
    setPos((prev) =>
      prev && prev.left === left && prev.top === top ? prev : { left, top }
    );
  }); // bez deps – musí se přepočítat i po přepnutí na formulář

  return (
    <div
      ref={boxRef}
      className="absolute z-30 w-64 rounded-lg border border-border bg-popover shadow-xl"
      style={{
        left: pos?.left ?? x + 4,
        top: pos?.top ?? y + 4,
        visibility: pos ? "visible" : "hidden",
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
            <Label htmlFor="ctx-alert-direction" className="text-[11px] text-muted-foreground">
              Aktivovat, když cena je…
            </Label>
            <Select
              name="direction"
              defaultValue={"above"}
            >
              <SelectTrigger id="ctx-alert-direction" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="above">Nad prahem</SelectItem>
                <SelectItem value="below">Pod prahem</SelectItem>
                <SelectItem value="cross">Při překřížení (⤨)</SelectItem>
              </SelectContent>
            </Select>
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
              max="999999.999"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              required
              autoFocus
              className="h-8 font-mono text-xs"
            />
          </div>

          <label
            className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-2.5 py-2 text-[11px] transition-colors hover:border-border"
            title="Po první aktivaci se alert automaticky smaže"
          >
            <input
              type="checkbox"
              name="one_shot"
              value="1"
              className="mt-0.5 size-3 accent-[var(--primary)]"
            />
            <span>
              Jednorázový (×1) – po první aktivaci se smaže; bez toho zůstane
              aktivní, dokud ho neodstraníš.
            </span>
          </label>

          <p className="text-[11px] text-muted-foreground">
            Podmínku nebo skóre signálu upravíš v tabulce níže / na stránce
            Alerty.
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
