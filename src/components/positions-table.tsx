"use client";

import { useActionState, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  closePositionAction,
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  formatDateTime,
  formatPercent,
  formatPrice,
  formatSigned,
  itemImageUrl,
  plColorClass,
} from "@/lib/format";
import type { PositionWithPnl } from "@/lib/types";

const INITIAL: ActionState = { ok: false };

export function PositionsTable({
  positions,
}: {
  positions: PositionWithPnl[];
}) {
  const [selected, setSelected] = useState<PositionWithPnl | null>(null);
  const [state, formAction, pending] = useActionState(
    closePositionAction,
    INITIAL
  );
  const router = useRouter();

  // Po úspěšném uzavření zavři dialog a načti čerstvá data
  useEffect(() => {
    if (state.ok) {
      setSelected(null);
      router.refresh();
    }
  }, [state.ok, router]);

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">Položka</TableHead>
              <TableHead className="text-right">Množství</TableHead>
              <TableHead className="text-right">Nákup</TableHead>
              <TableHead className="text-right">Aktuálně</TableHead>
              <TableHead className="text-right">Nerealizovaný P/L</TableHead>
              <TableHead className="hidden text-right md:table-cell">
                Otevřeno
              </TableHead>
              <TableHead className="pr-4 text-right">Akce</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="pl-4">
                  <div className="flex items-center gap-3">
                    {itemImageUrl(p.image_url) && (
                      <Image
                        src={itemImageUrl(p.image_url)!}
                        alt={p.item_name}
                        width={34}
                        height={34}
                        className="object-contain"
                      />
                    )}
                    <div>
                      <Link
                        href={`/market/${p.item_id}`}
                        className="font-medium hover:text-primary hover:underline underline-offset-4"
                      >
                        {p.item_name}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">
                        Q{p.quality}
                      </div>
                    </div>
                  </div>
                </TableCell>

                <TableCell className="text-right font-mono">
                  {p.quantity.toLocaleString("cs-CZ")}
                </TableCell>

                <TableCell className="text-right font-mono">
                  {formatPrice(p.buy_price)}
                </TableCell>

                <TableCell className="text-right font-mono">
                  {formatPrice(p.current_price)}
                </TableCell>

                <TableCell className="text-right">
                  <div
                    className={cn(
                      "font-mono",
                      plColorClass(p.unrealized_pl)
                    )}
                  >
                    {formatSigned(p.unrealized_pl)}
                  </div>
                  <div
                    className={cn(
                      "text-xs font-mono",
                      plColorClass(p.unrealized_pl)
                    )}
                  >
                    {formatPercent(p.unrealized_pl_pct)}
                  </div>
                </TableCell>

                <TableCell className="hidden text-right font-mono text-xs text-muted-foreground md:table-cell">
                  {formatDateTime(p.opened_at)}
                </TableCell>

                <TableCell className="pr-4 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelected(p)}
                  >
                    Zavřít
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Dialog pro uzavření pozice */}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>Uzavřít pozici – {selected.item_name}</DialogTitle>
                <DialogDescription>
                  Nákup {formatPrice(selected.buy_price)} ×{" "}
                  {selected.quantity.toLocaleString("cs-CZ")} ks · aktuálně{" "}
                  {formatPrice(selected.current_price)}
                </DialogDescription>
              </DialogHeader>

              <form action={formAction} className="space-y-4">
                <input type="hidden" name="position_id" value={selected.id} />
                <input
                  type="hidden"
                  name="market_price_at_log"
                  value={selected.current_price ?? ""}
                />

                <div className="space-y-2">
                  <Label htmlFor="sell_price">Prodejní cena ($ / ks)</Label>
                  <Input
                    id="sell_price"
                    name="sell_price"
                    type="number"
                    min={0.01}
                    step={0.01}
                    defaultValue={selected.current_price?.toFixed(2) ?? ""}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="close_condition">Proč prodáváš právě teď? *</Label>
                  <Textarea
                    id="close_condition"
                    name="condition_text"
                    rows={3}
                    required
                    placeholder="např. splněn cíl +8 %, na trhu se objevily levné náhrady, tlačí mě skladové náklady…"
                  />
                </div>

                {state.error && (
                  <p className="text-sm text-red-400">{state.error}</p>
                )}

                <DialogFooter>
                  <Button type="submit" disabled={pending}>
                    {pending ? "Zavírám pozici…" : "Potvrdit prodej"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
