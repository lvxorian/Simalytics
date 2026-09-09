"use client";

import { useActionState, useState } from "react";

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
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";

const INITIAL: ActionState = { ok: false };

export function AlertForm({
  itemId,
  currentPrice,
}: {
  itemId: number;
  currentPrice: number | null;
}) {
  const [state, formAction, pending] = useActionState(
    createAlertAction,
    INITIAL
  );
  const [kind, setKind] = useState<"price" | "score">("price");
  const [threshold, setThreshold] = useState<string>("");
  const [oneShot, setOneShot] = useState(false);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="item_id" value={itemId} />
      <input type="hidden" name="quality" value="0" />
      <input type="hidden" name="kind" value={kind} />

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="alert-kind" className="text-xs text-muted-foreground">
            Typ
          </Label>
          <Select name="kind-display" value={kind} onValueChange={(v) => setKind(v as "price" | "score")}>
            <SelectTrigger id="alert-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="price">Cena</SelectItem>
              <SelectItem value="score">Skóre signálu</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="alert-direction" className="text-xs text-muted-foreground">
            Podmínka
          </Label>
          <Select name="direction" defaultValue="above">
            <SelectTrigger id="alert-direction" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kind === "price" ? (
                <>
                  <SelectItem value="above">Cena nad prahem</SelectItem>
                  <SelectItem value="below">Cena pod prahem</SelectItem>
                  <SelectItem value="cross">Při překřížení</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="above">Skóre ≥</SelectItem>
                  <SelectItem value="below">Skóre ≤</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {kind === "price" && (
        <label
          className={cn(
            "flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs transition-colors",
            oneShot
              ? "border-primary/40 bg-primary/5"
              : "border-border hover:border-border"
          )}
        >
          <input
            type="checkbox"
            name="one_shot"
            value="1"
            checked={oneShot}
            onChange={(e) => setOneShot(e.target.checked)}
            className="mt-0.5 size-3.5 accent-[var(--primary)]"
          />
          <span>
            <span className="font-medium">Jednorázový (×1)</span>
            <span className="block text-[11px] text-muted-foreground">
              Po první aktivaci se alert automaticky smaže. Bez zaškrtnutí
              zůstane aktivní, dokud ho neodstraníš.
            </span>
          </span>
        </label>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="alert-threshold" className="text-xs text-muted-foreground">
          {kind === "price" ? "Práh ($ / ks)" : "Práh skóre (−100…+100)"}
        </Label>
        <Input
          id="alert-threshold"
          name="threshold"
          type="number"
          step={kind === "price" ? "0.001" : "1"}
          min={kind === "score" ? -100 : undefined}
          max={kind === "score" ? 100 : undefined}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          placeholder={kind === "price" ? "např. 2,505" : "např. 25"}
          required
          className="h-9"
        />
        {kind === "price" && currentPrice !== null && (
          <p className="text-[11px] text-muted-foreground">
            Aktuální cena: {formatPrice(currentPrice)}
          </p>
        )}
      </div>

      {state.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-red-300">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="rounded-md border border-up/40 bg-up/10 px-3 py-2 text-xs text-up">
          ✅ Alert uložen – notifikace přijde na webhook/e-mail.
        </p>
      )}

      <Button type="submit" size="sm" disabled={pending} className={cn("w-full")}>
        {pending ? "Ukládám…" : "Nastavit alert"}
      </Button>
    </form>
  );
}
