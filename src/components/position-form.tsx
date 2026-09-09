"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createPositionAction,
  type ActionState,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { formatPrice } from "@/lib/format";

export type ItemOption = { id: number; name: string; price: number };

const INITIAL: ActionState = { ok: false };

const QUALITIES = ["0", "1", "2", "3", "4", "5", "6", "7"] as const;

export function NewPositionForm({ items }: { items: ItemOption[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    createPositionAction,
    INITIAL
  );

  const [itemId, setItemId] = useState<string>("");
  const [buyPrice, setBuyPrice] = useState<string>("");

  // Předvyplň nákupní cenu aktuální tržní cenou vybrané položky
  // (plná přesnost burzy – až 3 desetinná místa, 0.755)
  useEffect(() => {
    const item = items.find((i) => String(i.id) === itemId);
    if (item) setBuyPrice(item.price.toFixed(3));
  }, [itemId, items]);

  // Po úspěchu přesměruj na přehled pozic
  useEffect(() => {
    if (state.ok) router.push("/positions");
  }, [state.ok, router]);

  return (
    <form action={formAction} className="space-y-6">
      {/* ── Obchod ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Obchod</CardTitle>
          <CardDescription>
            Zapiš svůj nákup – co jsi koupil, v jakém množství a za jakou
            cenu. Později tu uvidíš, jak si vede.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="item">Položka</Label>
            <Select
              name="item_id"
              value={itemId}
              onValueChange={setItemId}
              required
            >
              <SelectTrigger id="item" className="w-full">
                <SelectValue placeholder="Vyber komoditu…" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {items.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    <span className="flex items-center justify-between gap-4">
                      <span>{item.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatPrice(item.price)}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quality">Kvalita</Label>
              <Select name="quality" defaultValue="0">
                <SelectTrigger id="quality" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUALITIES.map((q) => (
                    <SelectItem key={q} value={q}>
                      Q{q}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quantity">Množství (ks)</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min={1}
                step={1}
                placeholder="např. 500"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="buy_price">Nákupní cena ($ / ks)</Label>
            <Input
              id="buy_price"
              name="buy_price"
              type="number"
              min={0.001}
              step={0.001}
              value={buyPrice}
              onChange={(e) => setBuyPrice(e.target.value)}
              placeholder="12.50"
              required
            />
            <p className="text-xs text-muted-foreground">
              Předvyplněno aktuální tržní cenou – můžeš přepsat.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Poznámka (volitelné)</Label>
            <Input
              id="note"
              name="note"
              placeholder="např. nákup z vlastní výroby, velkoobchodní sleva…"
            />
          </div>
        </CardContent>
      </Card>

      {/* snapshot ceny pro condition_log */}
      <input type="hidden" name="market_price_at_log" value={buyPrice} />

      {state.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Ukládám…" : "Otevřít pozici"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={pending}
        >
          Zrušit
        </Button>
      </div>
    </form>
  );
}
