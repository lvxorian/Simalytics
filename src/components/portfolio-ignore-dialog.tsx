"use client";

import { useState, useTransition } from "react";
import { Archive } from "lucide-react";

import { ignoreGameSyncItemAction } from "@/app/actions";
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
import { Textarea } from "@/components/ui/textarea";

/**
 * „Přesunout mimo portfolio“ – vyloučí aktivum z portfolia, ale NECHÁ ho
 * na skladu ve hře. Otevřené loty se zahodí (bez P/L) a sync ze skladu
 * už položku do portfolia nenahraje. Vrácení je jednoduché – „Vrátit“
 * v sekci Mimo portfolio, příští sync ji znovu nahraje s reálnou cenou.
 *
 * Dialog slouží jako potvrzení – koš bez potvrzení mohl zahodit držbu
 * omylem (nyní uživatel vidí, co se stane, a může připsat důvod).
 */
export function PortfolioIgnoreDialog({
  itemId,
  itemName,
  quantity,
  trigger,
}: {
  itemId: number;
  itemName: string;
  quantity: number;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  const submit = () => {
    setPending(true);
    startTransition(async () => {
      const trimmed = reason.trim();
      // Vyloučí z portfolia (loty zahodí), ale na skladu ve hře zůstane –
      // sync už položku do portfolia nenahraje. Vrátit jde v sekci
      // „Mimo portfolio“ tlačítkem Vrátit.
      await ignoreGameSyncItemAction(
        itemId,
        trimmed.length > 0 ? trimmed : null
      );
      setPending(false);
      setOpen(false);
      setReason("");
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mimo portfolio – {itemName}</DialogTitle>
          <DialogDescription>
            Položka se skryje z portfolia a přidá se do sekce „Mimo
            portfolio“. Ve hře ji necháme na skladu, ale Simalytics ji
            přestane sledovat jako investici.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-down/30 bg-down/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <ul className="list-inside list-disc space-y-1">
              <li>
                Zahodí se{" "}
                <span className="font-medium text-foreground">
                  {quantity.toLocaleString("cs-CZ")} ks
                </span>{" "}
                otevřených nákupů (bez zápisu P/L do historie).
              </li>
              <li>
                Na skladu ve hře zůstane – hra se nijak nezmění.
              </li>
              <li>
                Zpět ji snadno vrátíš tlačítkem „Vrátit“ v sekci Mimo
                portfolio (příští sync ji znovu nahraje).
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="ignore-reason"
              className="text-xs font-medium text-muted-foreground"
            >
              Důvod (nepovinný)
            </label>
            <Textarea
              id="ignore-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="např. palivo pro výrobu, materiál na skladě…"
              rows={2}
              className="min-h-16 resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Zrušit
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Přesouvám…" : "Přesunout mimo portfolio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Malá archive ikona pro tabulku aktiv (trigger dialogu). */
export function PortfolioIgnoreTrigger() {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground hover:text-foreground"
      title="Přesunout mimo portfolio (ponechat na skladu ve hře)"
    >
      <Archive className="size-4" />
      <span className="sr-only">Přesunout mimo portfolio</span>
    </Button>
  );
}
