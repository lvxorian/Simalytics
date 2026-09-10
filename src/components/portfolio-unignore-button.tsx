"use client";

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";

import { unignoreGameSyncItemAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

/**
 * „Vrátit do portfolia" – sundá položku z ignore-listu. Příští sync
 * ze skladu ji sám znovu nahraje (včetně reálné ceny z cashflow).
 */
export function PortfolioUnignoreButton({ itemId }: { itemId: number }) {
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 text-muted-foreground hover:text-up"
      disabled={pending}
      onClick={() => {
        setPending(true);
        startTransition(async () => {
          await unignoreGameSyncItemAction(itemId);
          setPending(false);
        });
      }}
      title="Vrátit do portfolia – příští sync ze skladu ji znovu nahraje"
    >
      <RotateCcw className="size-3.5" />
      Vrátit
    </Button>
  );
}
