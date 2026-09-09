"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";

import {
  updatePortfolioLotsAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatPrice } from "@/lib/format";

export type EditableLot = {
  id: string;
  quantity: number;
  buy_price: number;
  opened_at: string;
};

type Draft = {
  id: string;
  quantity: string;
  buyPrice: string;
  delete: boolean;
};

/**
 * Dialog „Upravit aktivum“ – rozbalí držbu na jednotlivé nákupy (lots),
 * kde jde upravit množství i pořizovací cena, a lot smazat. Držba je
 * per položka (kvality se nerozlišují) – loty všech kvalit tvoří
 * společný průměr.
 */
export function PortfolioEditLotsDialog({
  holdingLabel,
  lots,
  trigger,
}: {
  holdingLabel: string;
  lots: EditableLot[];
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const initial = useMemo<Draft[]>(
    () =>
      lots.map((l) => ({
        id: l.id,
        quantity: String(l.quantity),
        buyPrice: l.buy_price.toFixed(3),
        delete: false,
      })),
    [lots]
  );
  const [drafts, setDrafts] = useState<Draft[]>(initial);

  // Při otevření dialogu načíst čerstvé loty (držba se mohla změnit)
  useEffect(() => {
    if (open) {
      setDrafts(initial);
      setError(null);
    }
  }, [open, initial]);

  const updateDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const save = () => {
    setError(null);

    const updates: {
      positionId: string;
      quantity: number;
      buyPrice: number;
    }[] = [];
    const deletes: string[] = [];

    for (const d of drafts) {
      const orig = lots.find((l) => l.id === d.id);
      if (!orig) continue;
      if (d.delete) {
        deletes.push(d.id);
        continue;
      }
      const quantity = Number(d.quantity);
      const buyPrice = Number(d.buyPrice);
      if (
        quantity !== orig.quantity ||
        Math.abs(buyPrice - orig.buy_price) > 1e-9
      ) {
        updates.push({ positionId: d.id, quantity, buyPrice });
      }
    }

    if (deletes.length === lots.length) {
      setError(
        "Nelze smazat všechny nákupy – celé aktivum odeber košem v tabulce."
      );
      return;
    }

    startTransition(async () => {
      const res = await updatePortfolioLotsAction({ updates, deletes });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error ?? "Uložení se nepovedlo.");
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
      }}
    >
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : null}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upravit aktivum – {holdingLabel}</DialogTitle>
          <DialogDescription>
            {lots.length}{" "}
            {lots.length === 1 ? "nákup" : lots.length < 5 ? "nákupy" : "nákupů"}{" "}
            v tomto aktivu. Uprav množství či pořizovací cenu každého nákupu,
            nebo konkrétní nákup smaž.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {drafts.map((d, idx) => {
            const orig = lots.find((l) => l.id === d.id);
            return (
              <div
                key={d.id}
                className={`flex items-center gap-2 rounded-lg border p-2 ${
                  d.delete
                    ? "border-down/40 bg-down/5 opacity-60"
                    : "border-border/60"
                }`}
              >
                <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">
                  {orig
                    ? new Date(orig.opened_at).toLocaleDateString("cs-CZ", {
                        day: "numeric",
                        month: "short",
                      })
                    : `#${idx + 1}`}
                </span>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={d.quantity}
                  onChange={(e) =>
                    updateDraft(d.id, { quantity: e.target.value })
                  }
                  disabled={d.delete}
                  className="h-8 w-24 font-mono text-xs"
                  aria-label="Množství"
                />
                <Input
                  type="number"
                  min={0.001}
                  step={0.001}
                  value={d.buyPrice}
                  onChange={(e) =>
                    updateDraft(d.id, { buyPrice: e.target.value })
                  }
                  disabled={d.delete}
                  className="h-8 w-28 font-mono text-xs"
                  aria-label="Pořizovací cena"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto text-muted-foreground hover:text-down"
                  onClick={() => updateDraft(d.id, { delete: !d.delete })}
                  title={d.delete ? "Vrátit zpět" : "Označit ke smazání"}
                >
                  {d.delete ? (
                    <Plus className="size-4" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              </div>
            );
          })}
        </div>

        {error && <p className="text-sm text-down">{error}</p>}

        <DialogFooter>
          <Button onClick={save} disabled={pending}>
            {pending ? "Ukládám…" : "Uložit změny"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
