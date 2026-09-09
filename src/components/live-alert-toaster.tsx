"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Timer, X } from "lucide-react";

import { ItemIcon } from "@/components/item-icon";
import { formatPrice } from "@/lib/format";
import { playAlertTone } from "@/lib/alert-tone";
import { useLiveSnapshot, type LiveAlertEvent } from "@/lib/live-prices";
import { cn } from "@/lib/utils";

/**
 * Live alert toaster (Fáze 2) – poslouchá události ze /api/live pollu.
 * Když server vyhodnotí cenový alert / limitní prodej (latence ≤ ~15 s
 * místo dřívějších ~5 min), okamžitě ukáže toast a přehraje tón.
 * Prohlížečová notifikace (Notification API) se pokusí taky – když
 * uživatel povolil, alert vidí i mimo záložku aplikace.
 */
export function LiveAlertToaster() {
  const { events } = useLiveSnapshot();
  const [toasts, setToasts] = useState<LiveAlertEvent[]>([]);
  const shownKeys = useRef<Set<string>>(new Set());

  // Nové eventy → toast + zvuk (+ browser notification)
  useEffect(() => {
    if (events.length === 0) return;
    const fresh = events.filter((e) => !shownKeys.current.has(e.key));
    if (fresh.length === 0) return;

    for (const e of fresh) shownKeys.current.add(e.key);
    setToasts((t) => [...fresh, ...t].slice(0, 4));

    playAlertTone();

    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      for (const e of fresh) {
        try {
          const title =
            e.kind === "limit_sell"
              ? `🏷️ Limitní prodej: ${e.item_name}`
              : e.direction === "cross"
                ? `🔄 Crossover: ${e.item_name}`
                : `💰 Cenový alert: ${e.item_name}`;
          const condSym =
            e.direction === "cross" ? "⤨" : e.direction === "above" ? "≥" : "≤";
          const body = `Cena ${formatPrice(e.price)} (${condSym} ${formatPrice(e.threshold)})${e.oneShot ? " – jednorázový, smazán" : ""}`;
          const n = new Notification(title, { body, tag: e.key });
          n.onclick = () => {
            window.focus();
            window.location.href = `/market/${e.item_id}`;
          };
        } catch {
          // notifikace nesmí rozbít UI
        }
      }
    }
  }, [events]);

  // Auto-dismiss po 12 s
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      setTimeout(() => {
        setToasts((list) => list.filter((x) => x.key !== t.key));
      }, 12_000)
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => {
        const up =
          t.kind === "limit_sell"
            ? true
            : t.direction === "cross"
              ? t.price >= t.threshold // crossover směrem vzhůru
              : t.direction === "above";
        return (
          <div
            key={t.key}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-xl border bg-popover/95 p-3 shadow-2xl shadow-black/40 backdrop-blur animate-in slide-in-from-right-6 fade-in duration-300",
              t.kind === "limit_sell"
                ? "border-[#d4a72c]/40"
                : up
                  ? "border-up/40"
                  : "border-down/40"
            )}
          >
            <ItemIcon url={t.image_url} name={t.item_name} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                {t.kind === "limit_sell" ? (
                  <Timer className="size-3.5 shrink-0 text-[#d4a72c]" />
                ) : up ? (
                  <ArrowUpRight className="size-3.5 shrink-0 text-up" />
                ) : (
                  <ArrowDownRight className="size-3.5 shrink-0 text-down" />
                )}
                <span className="truncate">{t.item_name}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t.kind === "limit_sell" ? "limit" : "alert"}
                </span>
              </div>
              <div className="mt-0.5 flex items-baseline gap-1.5 font-mono text-xs text-muted-foreground">
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {formatPrice(t.price)}
                </span>
                <span>
                  {t.direction === "cross"
                    ? "⤨"
                    : t.direction === "above"
                      ? "≥"
                      : "≤"}{" "}
                  {formatPrice(t.threshold)}
                  {t.oneShot && (
                    <span className="ml-1 text-[10px] uppercase tracking-wider">
                      ×1
                    </span>
                  )}
                </span>
              </div>
              <Link
                href={`/market/${t.item_id}`}
                className="mt-1 inline-block text-xs text-primary hover:underline underline-offset-4"
              >
                Otevřít graf →
              </Link>
            </div>
            <button
              type="button"
              onClick={() =>
                setToasts((list) => list.filter((x) => x.key !== t.key))
              }
              aria-label="Zavřít upozornění"
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
