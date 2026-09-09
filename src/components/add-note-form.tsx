"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  addConditionNoteAction,
  type ActionState,
} from "@/app/actions";
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
import { Textarea } from "@/components/ui/textarea";

const INITIAL: ActionState = { ok: false };

export function AddNoteForm({
  positions,
}: {
  positions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    addConditionNoteAction,
    INITIAL
  );
  const [note, setNote] = useState("");

  useEffect(() => {
    if (state.ok) {
      setNote("");
      router.refresh();
    }
  }, [state.ok, router]);

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Pozice</Label>
          <Select name="position_id" required>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Vyber otevřenou pozici…" />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {positions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Aktuální cena ($ / ks)</Label>
          <Input
            name="market_price_at_log"
            type="number"
            min={0.001}
            step={0.001}
            placeholder="volitelné"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Poznámka k pozici</Label>
        <Textarea
          name="condition_text"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="např. Trh se otepluje – kousek z přebytků odchozí, držím."
          required
        />
      </div>

      {state.error && <p className="text-sm text-red-400">{state.error}</p>}

      <Button type="submit" size="sm" disabled={pending || positions.length === 0}>
        {pending ? "Ukládám…" : "Přidat do logu"}
      </Button>
    </form>
  );
}
