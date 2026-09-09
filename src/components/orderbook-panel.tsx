"use client";

import { useEffect, useState } from "react";

import { formatCompact, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type AskRow = {
  price: number;
  quantity: number;
  npc: boolean;
};

/**
 * Mini orderbook (Fáze 3C) – top nejnižších nabídek pod hero na market
 * page. Ukazuje HLUBOKU trhu na straně nákupu: kolik kusů stojí na které
 * úrovni a jestli je za ní NPC (nezájemce trhu) nebo hráč. Data tahá
 * z /api/live/ask (ofiko v3 orderbook, cache 3 s, client poll 6 s –
 * ofiko API má limit 1 req/s, proto pomalejší tempo než ceny).
 */
export function OrderbookPanel({ itemId }: { itemId: number }) {
  const [asks, setAsks] = useState<AskRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/live/ask?item=${itemId}&depth=5`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { asks: AskRow[] };
        if (cancelled) return;
        setAsks(data.asks ?? []);
        setLoaded(true);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
      if (!cancelled) timer = setTimeout(poll, 6_000);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [itemId]);

  if (failed && asks.length === 0) return null;
  if (!loaded) {
    return (
      <div className="h-[116px] animate-pulse rounded-xl border border-border/60 bg-card" />
    );
  }
  if (asks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-card px-4 py-3 text-center text-xs text-muted-foreground">
        Burza: žádné aktivní nabídky.
      </div>
    );
  }

  const maxQty = Math.max(...asks.map((a) => a.quantity), 1);

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Nabídky (ask)
        </span>
        <span
          className="font-mono text-[10px] text-muted-foreground"
          title="Hloubka trhu – kolik kusů je na které úrovni k dostání"
        >
          koupíš hned ↓
        </span>
      </div>
      <ul className="divide-y divide-border/30">
        {asks.map((a, i) => (
          <li key={`${a.price}-${i}`} className="relative px-3 py-1.5">
            {/* hloubka – pozadí proporcionální objemu */}
            <div
              className="absolute inset-y-0 right-0 bg-down/8"
              style={{ width: `${(a.quantity / maxQty) * 100}%` }}
              aria-hidden
            />
            <div className="relative flex items-center justify-between gap-3 font-mono text-xs">
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  i === 0 ? "text-up" : "text-foreground/80"
                )}
              >
                {formatPrice(a.price)}
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="tabular-nums">{formatCompact(a.quantity)}</span>
                {a.npc ? (
                  <span
                    className="rounded border border-border/60 px-1 text-[9px] uppercase tracking-wider"
                    title="Nabídka od NPC – obvykle stabilní část trhu"
                  >
                    NPC
                  </span>
                ) : (
                  <span
                    className="rounded border border-primary/30 bg-primary/10 px-1 text-[9px] uppercase tracking-wider text-primary"
                    title="Nabídka od hráče"
                  >
                    hráč
                  </span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
