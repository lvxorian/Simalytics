"use client";

import { useEffect, useRef, useState } from "react";

import { formatCompact, formatPrice } from "@/lib/format";
import { useLiveOrderbook, type LiveAsk } from "@/lib/live-prices";
import { cn } from "@/lib/utils";

type AskRow = {
  orderId: number;
  price: number;
  quantity: number;
  npc: boolean;
};

/**
 * Mini orderbook (Fáze 3C) – top nejnižších nabídek pod hero na market
 * page. Ukazuje HLUBOKU trhu na straně nákupu: kolik kusů stojí na které
 * úrovni a jestli je za ní NPC (nezájemce trhu) nebo hráč.
 *
 * Data živě přes SSE (Fáze 3C): market page registruje zájem přes
 * useLiveOrderbook → hub polluje položku s předností a při změně pushuje
 * 'orderbook' event (latence ~2–4 s). REST /api/live/ask zůstává jen
 * jako fallback v offline režimu (6 s polling).
 *
 * ANIMACE (polish pass): řádky mají stabilní identitu (orderId), takže
 *   - nová nabídka: fade+slide (ob-row-in),
 *   - odcházející nabídka: krátce „duch" (ob-row-out) – koupili/stáhli ji,
 *   - změna objemu: bar plynule dýchá (scaleX) + záblesk čísla (zelená =
 *     někdo do úrovně nakoupil, červená = prodávající přidal),
 *   - vše respektuje prefers-reduced-motion (viz globals.css).
 */
export function OrderbookPanel({ itemId }: { itemId: number }) {
  const { asks, source } = useLiveOrderbook(itemId);

  // ── Animovaný stav: diff předchozích ↔ nových asků podle orderId ──
  // `rows` = co se renderuje (včetně duchů), `flashes` = směr záblesku.
  const [rows, setRows] = useState<AskRow[] | null>(null);
  /** Nové nabídky (právě přibyly) – vstupní animace ob-row-in. */
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
  const [flashes, setFlashes] = useState<Map<number, "up" | "down">>(
    () => new Map()
  );
  const prevRef = useRef<Map<number, AskRow>>(new Map());
  const ghostsRef = useRef<Map<number, AskRow>>(new Map());
  const flashTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  useEffect(() => {
    if (asks === null) return;
    const next = asks as AskRow[];
    const prev = prevRef.current;

    // První data: žádné animace – jen vykreslit (SSR-friendly)
    if (prev.size === 0) {
      prevRef.current = new Map(next.map((a) => [a.orderId, a]));
      setRows(next);
      return;
    }

    const flash = new Map<number, "up" | "down">();
    const freshIds = new Set<number>();
    const gone: AskRow[] = [];

    for (const a of next) {
      const old = prev.get(a.orderId);
      if (!old) {
        freshIds.add(a.orderId); // nová nabídka – vstupní animace
      } else if (a.quantity !== old.quantity) {
        // Objem klesá = někdo tam koupil (zelená), roste = přidal (červená)
        flash.set(a.orderId, a.quantity < old.quantity ? "up" : "down");
      }
    }
    for (const [id, old] of prev) {
      if (!next.some((a) => a.orderId === id)) gone.push(old); // → duch
    }

    // Duchové: zmizelé ordery držíme ~220 ms, ať odejdou animovaně
    const ghosts = ghostsRef.current;
    for (const g of gone) ghosts.set(g.orderId, g);

    setRows([...next, ...[...ghosts.values()]]);
    setFresh(new Set(freshIds));
    if (flash.size > 0) setFlashes(flash);

    prevRef.current = new Map(next.map((a) => [a.orderId, a]));

    // Úklid duchů + flash timerů
    for (const [id] of ghosts) {
      if (!next.some((a) => a.orderId === id)) {
        setTimeout(() => {
          ghosts.delete(id);
          setRows((cur) =>
            cur ? cur.filter((r) => r.orderId !== id) : cur
          );
        }, 220);
      }
    }
    for (const timer of flashTimers.current.values()) clearTimeout(timer);
    for (const id of flash.keys()) {
      flashTimers.current.set(
        id,
        setTimeout(() => {
          setFlashes((cur) => {
            const next2 = new Map(cur);
            next2.delete(id);
            return next2;
          });
        }, 720)
      );
    }
  }, [asks]);

  // Ukliď timery při unmountu
  useEffect(() => {
    const timers = flashTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  if (asks === null && rows === null) {
    return (
      <div className="h-[116px] animate-pulse rounded-xl border border-border/60 bg-card" />
    );
  }
  if (rows !== null && rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-card px-4 py-3 text-center text-xs text-muted-foreground">
        Burza: žádné aktivní nabídky.
      </div>
    );
  }
  if (rows === null) return null;

  const maxQty = Math.max(...rows.map((a) => a.quantity), 1);

  return (
    <div className="ob-enter rounded-xl border border-border/60 bg-card">
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Nabídky (ask)
        </span>
        <span
          className="font-mono text-[10px] text-muted-foreground"
          title={
            source === "sse"
              ? "Hloubka trhu – kolik kusů je na které úrovni k dostání. Živě přes SSE."
              : "Hloubka trhu – kolik kusů je na které úrovni k dostání. Offline polling."
          }
        >
          koupíš hned ↓{source === "sse" && <span className="ml-1 text-up">●</span>}
        </span>
      </div>
      <ul className="divide-y divide-border/30">
        {rows.map((a, i) => {
          const flash = flashes.get(a.orderId);
          const isGhost = !asks?.some((x) => x.orderId === a.orderId);
          return (
            <li
              key={a.orderId}
              className={cn(
                "relative px-3 py-1.5",
                fresh.has(a.orderId) && !isGhost && "ob-row-in",
                isGhost && "ob-row-out"
              )}
            >
              {/* hloubka – pozadí proporcionální objemu; scaleX plynulý přechod */}
              <div
                className="ob-depth-bar absolute inset-y-0 right-0 bg-down/8"
                style={{
                  transform: `scaleX(${(a.quantity / maxQty).toFixed(4)})`,
                  width: "100%",
                }}
                aria-hidden
              />
              <div className="relative flex items-center justify-between gap-3 font-mono text-xs">
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    i === 0 && !isGhost ? "text-up" : "text-foreground/80"
                  )}
                >
                  {formatPrice(a.price)}
                </span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span
                    className={cn("tabular-nums", flash && "ob-flash")}
                    style={
                      flash
                        ? ({ "--ob-flash": `var(--${flash})` } as React.CSSProperties)
                        : undefined
                    }
                  >
                    {formatCompact(a.quantity)}
                  </span>
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
          );
        })}
      </ul>
    </div>
  );
}
