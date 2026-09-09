"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase } from "lucide-react";

import {
  addToPortfolioAction,
  type ActionState,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

const QUALITIES = ["0", "1", "2", "3", "4", "5", "6", "7"] as const;

/**
 * Tlačítko „Přidat do portfolia“ – dialog s množstvím, kvalitou a
 * pořizovací cenou (předvyplněno aktuální tržní cenou). Držba se ukládá
 * jako otevřená pozice, takže ji Portfolio i Pozice vidí.
 */
export function AddToPortfolioButton({
  itemId,
  currentPrice,
}: {
  itemId: number;
  currentPrice: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    addToPortfolioAction,
    INITIAL
  );
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [state.ok, router]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 rounded-full">
          <Briefcase className="size-4" />
          Přidat do portfolia
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Přidat do portfolia</DialogTitle>
          <DialogDescription>
            Zaznamenej, kolik kusů vlastníš a za jakou pořizovací cenu. Držba
            se objeví v Portfoliu i mezi pozicemi.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="item_id" value={itemId} />
          <input type="hidden" name="revalidate_portfolio" value="1" />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pf-quantity">Množství (ks)</Label>
              <Input
                id="pf-quantity"
                name="quantity"
                type="number"
                min={1}
                step={1}
                placeholder="např. 500"
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pf-quality">Kvalita</Label>
              <Select name="quality" defaultValue="0">
                <SelectTrigger id="pf-quality" className="w-full">
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="pf-buy-price">Pořizovací cena ($ / ks)</Label>
            <Input
              id="pf-buy-price"
              name="buy_price"
              type="number"
              min={0.001}
              step={0.001}
              defaultValue={currentPrice !== null ? currentPrice.toFixed(3) : ""}
              placeholder="12.500"
              required
            />
            <p className="text-xs text-muted-foreground">
              Předvyplněno aktuální tržní cenou
              {currentPrice !== null ? ` (${formatPrice(currentPrice)})` : ""} –
              přepiš, pokud jsi nakupoval jinak.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pf-note">Poznámka (volitelné)</Label>
            <Input
              id="pf-note"
              name="note"
              placeholder="např. nákup z vlastní výroby, sklad…"
            />
          </div>

          {state.error && (
            <p className="text-sm text-down">{state.error}</p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Ukládám…" : "Přidat do portfolia"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
