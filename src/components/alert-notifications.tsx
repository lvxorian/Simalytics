"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BellOff,
  BellRing,
  Target,
} from "lucide-react";

import { ItemIcon } from "@/components/item-icon";
import { formatDateTime, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export type HeaderAlert = {
  id: string;
  item_id: number;
  item_name: string;
  image_url: string | null;
  kind: "price" | "score";
  direction: "above" | "below";
  threshold: number;
  active: boolean;
  last_triggered_at: string | null;
  current_price: number | null;
};

/** Popis podmínky alertu (stejná logika jako AlertsTable). */
function conditionLabel(a: HeaderAlert): string {
  if (a.kind === "price") {
    return a.direction === "above"
      ? `Cena ≥ ${formatPrice(a.threshold)}`
      : `Cena ≤ ${formatPrice(a.threshold)}`;
  }
  return a.direction === "above"
    ? `Skóre ≥ ${a.threshold > 0 ? "+" : ""}${a.threshold}`
    : `Skóre ≤ ${a.threshold}`;
}

/**
 * Zvonek v hlavičce – dropdown s přehledem nastavených alertů.
 * Data dostává hotová ze serveru (site-header je server component data
 * nemá, proto props z layoutu); poslední spuštění zvýrazní badge.
 * Klik mimo zavře, aktivní/pozastavené rozlišeny ikonou a průhledností.
 */
export function AlertNotifications({ alerts }: { alerts: HeaderAlert[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // klik mimo = zavřít (stejný vzor jako HeaderSearch)
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const activeCount = alerts.filter((a) => a.active).length;
  // Badge = alerty spuštěné během posledních 24 h (poslední trigger)
  const dayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
  const recentTriggers = alerts.filter(
    (a) =>
      a.last_triggered_at !== null &&
      new Date(a.last_triggered_at).getTime() >= dayAgoMs
  ).length;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Alerty (${activeCount} aktivních)`}
        aria-expanded={open}
        title="Alerty"
        className={cn(
          "relative flex size-9 cursor-pointer items-center justify-center rounded-full border border-border/70 bg-secondary/50",
          "text-muted-foreground transition-colors hover:text-foreground",
          open && "text-foreground"
        )}
      >
        {activeCount > 0 ? (
          <BellRing className="size-4" />
        ) : (
          <Bell className="size-4" />
        )}
        {recentTriggers > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-up font-mono text-[9px] font-bold text-white">
            {recentTriggers > 9 ? "9+" : recentTriggers}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl shadow-black/40">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Bell className="size-4 text-primary" />
              Alerty
            </span>
            <Link
              href="/alerts"
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              Spravovat →
            </Link>
          </div>

          {alerts.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <BellOff className="mx-auto mb-2 size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Žádné alerty nenastaveny.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Přidej je pravým klikem do grafu na detailu komodity.
              </p>
            </div>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1">
              {alerts.map((a) => {
                const near =
                  a.current_price !== null &&
                  a.kind === "price" &&
                  Math.abs(a.current_price - a.threshold) /
                    Math.max(a.threshold, 1e-9) <=
                    0.02;
                const triggeredRecently =
                  a.last_triggered_at !== null &&
                  new Date(a.last_triggered_at).getTime() >= dayAgoMs;
                return (
                  <li key={a.id}>
                    <Link
                      href={`/market/${a.item_id}`}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 transition-colors hover:bg-accent/60",
                        !a.active && "opacity-50"
                      )}
                    >
                      <ItemIcon
                        url={a.image_url}
                        name={a.item_name}
                        size={30}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">
                            {a.item_name}
                          </span>
                          {a.kind === "score" && (
                            <Target className="size-3 shrink-0 text-muted-foreground" />
                          )}
                          {!a.active && (
                            <BellOff className="size-3 shrink-0 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                          {a.kind === "price" ? (
                            a.direction === "above" ? (
                              <ArrowUpRight className="size-3 text-up" />
                            ) : (
                              <ArrowDownRight className="size-3 text-down" />
                            )
                          ) : (
                            <Target className="size-3 text-primary" />
                          )}
                          {conditionLabel(a)}
                          {a.current_price !== null && a.kind === "price" && (
                            <span className="text-muted-foreground/70">
                              · teď {formatPrice(a.current_price)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {triggeredRecently ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-up/25 bg-up/10 px-1.5 py-0.5 text-[10px] font-medium text-up">
                            spuštěno
                          </span>
                        ) : near ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[#d4a72c]/25 bg-[#d4a72c]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#d4a72c]">
                            blízko
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            {a.last_triggered_at
                              ? formatDateTime(a.last_triggered_at)
                              : "čeká"}
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
