"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, BellRing, Timer } from "lucide-react";

import {
  sellPortfolioAssetAction,
  setLimitSellAction,
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
import { formatPrice, formatSigned, plColorClass } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Dialog „Prodat“ – uzavření (části) aktiva z portfolia po skutečném
 * prodeji ve hře. Dva režimy:
 *
 * 1. „Odklepnout prodej“ – prodal jsi ve hře → zadáš množství a cenu,
 *    lots se uzavřou FIFO, realized P/L se zapíše do historie.
 * 2. „Zadat limitní prodej“ – na burze ve hře visí ask za cílovou cenu,
 *    ale zatím se neuskutečnil → uloží se jen badge „limit X“ u aktiva;
 *    když se prodej ve hře povede, vrátíš se a odklepneš ho tu.
 *
 * Preview nerealizovaného P/L se přepočítává live podle zadané ceny.
 */
export function PortfolioSellDialog({
  itemId,
  quality,
  itemName,
  quantity,
  avgBuyPrice,
  currentPrice,
  limitPrice,
  trigger,
}: {
  itemId: number;
  quality: number;
  itemName: string;
  quantity: number;
  avgBuyPrice: number;
  currentPrice: number | null;
  limitPrice: number | null;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"sell" | "limit">("sell");
  const [qty, setQty] = useState(String(quantity));
  const [price, setPrice] = useState(
    limitPrice !== null
      ? limitPrice.toFixed(3)
      : currentPrice !== null
        ? currentPrice.toFixed(3)
        : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  // Reset při otevření (data se mohla mezitím změnit)
  useEffect(() => {
    if (open) {
      setMode("sell");
      setQty(String(quantity));
      setPrice(
        limitPrice !== null
          ? limitPrice.toFixed(3)
          : currentPrice !== null
            ? currentPrice.toFixed(3)
            : ""
      );
      setError(null);
      setDone(null);
    }
  }, [open, quantity, limitPrice, currentPrice]);

  const qtyNum = Number(qty);
  const priceNum = Number(price);

  // Live preview realized P/L pro zadané množství a cenu
  const previewPl = useMemo(() => {
    if (!Number.isFinite(qtyNum) || !Number.isFinite(priceNum)) return null;
    if (qtyNum <= 0 || qtyNum > quantity) return null;
    return (priceNum - avgBuyPrice) * qtyNum;
  }, [qtyNum, priceNum, avgBuyPrice, quantity]);

  const overQty = Number.isFinite(qtyNum) && qtyNum > quantity;

  const sell = async () => {
    setError(null);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError("Zadej kladné množství.");
      return;
    }
    if (overQty) {
      setError(`V portfoliu je jen ${quantity.toLocaleString("cs-CZ")} ks.`);
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setError("Zadej kladnou prodejní cenu.");
      return;
    }
    setPending(true);
    const res = await sellPortfolioAssetAction({
      itemId,
      quality,
      quantity: qtyNum,
      sellPrice: priceNum,
    });
    setPending(false);
    if (res.ok) {
      setDone(res.realizedPl ?? 0);
      router.refresh();
      // po chvíli zavřít, ať uživatel vidí potvrzení
      setTimeout(() => setOpen(false), 1400);
    } else {
      setError(res.error ?? "Prodej se nepovedlo zaznamenat.");
    }
  };

  const saveLimit = async () => {
    setError(null);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setError("Zadej kladnou limitní cenu.");
      return;
    }
    setPending(true);
    const res = await setLimitSellAction({
      itemId,
      quality,
      limitPrice: priceNum,
    });
    setPending(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(res.error ?? "Limit se nepovedlo uložit.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Prodat – {itemName} <span className="font-mono text-xs">Q{quality}</span>
          </DialogTitle>
          <DialogDescription>
            Na burze ve hře prodané kusy tu jen odklepni – lots se uzavřou a
            profit se započte do historie.
          </DialogDescription>
        </DialogHeader>

        {done !== null ? (
          <div className="rounded-lg border border-up/30 bg-up/5 p-4 text-center">
            <p className="text-sm text-muted-foreground">Realizovaný P/L</p>
            <p
              className={cn(
                "font-mono text-2xl font-semibold tabular-nums",
                plColorClass(done)
              )}
            >
              {formatSigned(done)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Zapsáno do historie portfolia.
            </p>
          </div>
        ) : (
          <>
            {/* Přepínač režimu */}
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border/80 bg-secondary/40 p-1">
              <button
                type="button"
                onClick={() => setMode("sell")}
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                  mode === "sell"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ArrowUpRight className="size-3.5" />
                Odklepnout prodej
              </button>
              <button
                type="button"
                onClick={() => setMode("limit")}
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                  mode === "limit"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Timer className="size-3.5" />
                Zadat limit
              </button>
            </div>

            <div className="space-y-4">
              {mode === "sell" ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="sell-qty">Množství (ks)</Label>
                      <Input
                        id="sell-qty"
                        type="number"
                        min={1}
                        step={1}
                        max={quantity}
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        className="font-mono"
                      />
                      <p className="text-xs text-muted-foreground">
                        max {quantity.toLocaleString("cs-CZ")} ks
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sell-price">Prodejní cena ($/ks)</Label>
                      <Input
                        id="sell-price"
                        type="number"
                        min={0.001}
                        step={0.001}
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="font-mono"
                      />
                      <p className="text-xs text-muted-foreground">
                        {limitPrice !== null ? (
                          <span className="text-primary">
                            zadaný limit {formatPrice(limitPrice)}
                          </span>
                        ) : (
                          <>nákup {formatPrice(avgBuyPrice)}</>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Live preview realized P/L */}
                  {previewPl !== null && (
                    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-3 py-2">
                      <span className="text-xs text-muted-foreground">
                        Realizovaný P/L při prodeji {qtyNum.toLocaleString("cs-CZ")} ks
                      </span>
                      <span
                        className={cn(
                          "font-mono text-sm font-semibold tabular-nums",
                          plColorClass(previewPl)
                        )}
                      >
                        {formatSigned(previewPl)}
                      </span>
                    </div>
                  )}

                  {overQty && (
                    <p className="text-sm text-down">
                      Více, než vlastníš – v portfoliu je {quantity.toLocaleString("cs-CZ")} ks.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="limit-price">Limitní cena ($/ks)</Label>
                    <Input
                      id="limit-price"
                      type="number"
                      min={0.001}
                      step={0.001}
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="např. 2.700"
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Např. nahážeš jablka na burze za 2,700, zatímco trh je na
                      2,500 – uloží se badge „limit“ u aktiva, ať víš, co čeká
                      na odklepnutí.
                    </p>
                    <p className="flex items-start gap-1.5 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                      <BellRing className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      <span>
                        Když cena dosáhne limitu, zvonek v hlavičce se rozsvítí,
                        zazní tón a přijde notifikace (webhook/e-mail, máš-li
                        nastavené).
                      </span>
                    </p>
                  </div>
                  {currentPrice !== null && (
                    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-3 py-2">
                      <span className="text-xs text-muted-foreground">
                        Aktuální trh
                      </span>
                      <span className="font-mono text-sm tabular-nums">
                        {formatPrice(currentPrice)}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            {error && <p className="text-sm text-down">{error}</p>}
          </>
        )}

        <DialogFooter>
          {done === null &&
            (mode === "sell" ? (
              <Button onClick={sell} disabled={pending}>
                {pending ? "Zapisuji…" : "Odklepnout prodej"}
              </Button>
            ) : (
              <Button onClick={saveLimit} disabled={pending} variant="outline">
                {pending ? "Ukládám…" : "Uložit limit"}
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
