"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BellOff,
  BellRing,
  Target,
  Timer,
} from "lucide-react";

import { markAlertsSeenAction } from "@/app/actions";
import { ItemIcon } from "@/components/item-icon";
import { formatDateTime, formatPrice } from "@/lib/format";
import { playAlertTone, unlockAlertAudio } from "@/lib/alert-tone";
import { cn } from "@/lib/utils";

export type HeaderAlert = {
  id: string;
  item_id: number;
  item_name: string;
  image_url: string | null;
  kind: "price" | "score" | "limit_sell";
  direction: "above" | "below";
  threshold: number;
  active: boolean;
  last_triggered_at: string | null;
  seen_at: string | null;
  current_price: number | null;
};

/** Popis podmínky alertu (stejná logika jako AlertsTable). */
function conditionLabel(a: HeaderAlert): string {
  if (a.kind === "limit_sell") {
    return `Limit prodeje ≥ ${formatPrice(a.threshold)}`;
  }
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
 * Badge = počet NESPAMATROVANÝCH spuštění (trigger novější než seen_at).
 * Klik na zvonek označí vše jako seen → badge zmizí (trigger už je
 * „doručený“). Nový trigger navíc přehraje zvukový tón (jednou per
 * událost; Server Actions revalidují layout, takže props se aktualizují).
 */
export function AlertNotifications({ alerts }: { alerts: HeaderAlert[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  // klik mimo = zavřít (stejný vzor jako HeaderSearch)
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Nové (nespamatrované) triggery – badge i zvuk
  const unseen = alerts.filter((a) => {
    if (a.last_triggered_at === null) return false;
    if (a.seen_at === null) return true;
    return (
      new Date(a.last_triggered_at).getTime() >
      new Date(a.seen_at).getTime()
    );
  });
  const unseenCount = unseen.length;

  // Ref na poslední známý „nový trigger“ – zvuk jen při změně na víc,
  // ne při prvním renderu (aby reload stránky nezpůsobil falešný tón
  // pro staré, už viděné stavy... ale právě když dorazí NOVÝ trigger,
  // počet nespamatrovaných naroste a tón spustíme).
  const prevUnseenRef = useRef<number | null>(null);

  // Odemčení audia po prvním gestu uživatele (autoplay politika) –
  // sdílený kontext z lib/alert-tone (toaster i zvonek hrají stejný tón)
  useEffect(() => {
    const unlock = () => unlockAlertAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    const prev = prevUnseenRef.current;
    prevUnseenRef.current = unseenCount;

    if (prev === null || unseenCount <= prev) return;
    // Dorazil nový trigger → tón. Společný playAlertTone má throttle,
    // takže se nezdupá s live toasterem (ten spouští tentýž tón).
    playAlertTone();
  }, [unseenCount]);

  // Klik na zvonek = otevřít dropdown + označit vše jako seen
  const handleBellClick = () => {
    const wasClosed = !open;
    setOpen((o) => !o);
    if (wasClosed && unseenCount > 0) {
      void markAlertsSeenAction().then(() => router.refresh());
    }
  };

  const activeCount = alerts.filter((a) => a.active).length;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={handleBellClick}
        aria-label={`Alerty (${activeCount} aktivních, ${unseenCount} nových)`}
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
        {unseenCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary font-mono text-[9px] font-bold text-white">
            {unseenCount > 9 ? "9+" : unseenCount}
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
                  (a.kind === "price" || a.kind === "limit_sell") &&
                  Math.abs(a.current_price - a.threshold) /
                    Math.max(a.threshold, 1e-9) <=
                    0.02;
                const isUnseen =
                  a.last_triggered_at !== null &&
                  (a.seen_at === null ||
                    new Date(a.last_triggered_at).getTime() >
                      new Date(a.seen_at).getTime());
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
                          {a.kind === "limit_sell" && (
                            <Timer className="size-3 shrink-0 text-muted-foreground" />
                          )}
                          {!a.active && (
                            <BellOff className="size-3 shrink-0 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                          {a.kind === "limit_sell" ? (
                            <Timer className="size-3 text-primary" />
                          ) : a.kind === "price" ? (
                            a.direction === "above" ? (
                              <ArrowUpRight className="size-3 text-up" />
                            ) : (
                              <ArrowDownRight className="size-3 text-down" />
                            )
                          ) : (
                            <Target className="size-3 text-primary" />
                          )}
                          {conditionLabel(a)}
                          {a.current_price !== null &&
                            (a.kind === "price" || a.kind === "limit_sell") && (
                              <span className="text-muted-foreground/70">
                                · teď {formatPrice(a.current_price)}
                              </span>
                            )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {isUnseen ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-up/25 bg-up/10 px-1.5 py-0.5 text-[10px] font-medium text-up">
                            nové
                          </span>
                        ) : a.last_triggered_at &&
                          Date.now() - new Date(a.last_triggered_at).getTime() <
                            24 * 60 * 60 * 1000 ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
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
