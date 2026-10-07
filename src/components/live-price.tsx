"use client";

import { useEffect, useRef, useState } from "react";

import { ChangeBadge } from "@/components/change-badge";
import { formatPrice } from "@/lib/format";
import { useLiveTick, useLiveSnapshot, impliedBase24h } from "@/lib/live-prices";
import { cn } from "@/lib/utils";

/**
 * Live hero cena (market page): HLAVNÍ cena = AKTIVNÍ NABÍDKA (nejnižší
 * ask z orderbooku) – za kolik lze koupit HNED; poslední obchod je
 * zpožděný údaj a ukazuje se jen jako sekundární řádek. Ask se dotahuje
 * z /api/live/ask (ofiko v3 API, cache 3 s) každých 5 s; když orderbook
 * selže/prázdný, jako hlavní cena fallbackne poslední obchod.
 *
 * Živé ticky (SSE, ~1–2 s od obchodu) ženou „poslední obchod“ řádek;
 * „před X min" se přepočítává každou sekundu.
 */
export function HeroLivePrice({
  itemId,
  initialPrice,
  initialChange24h,
  initialLastTradeMs,
  initialAsk,
}: {
  itemId: number;
  initialPrice: number | null;
  initialChange24h: number | null;
  initialLastTradeMs: number | null;
  /** Nejnižší aktivní nabídka ze SSR (orderbook, ofiko v3 API). */
  initialAsk?: number | null | undefined;
}) {
  const tick = useLiveTick(itemId);
  const { status } = useLiveSnapshot();

  const price = tick ? tick.price : initialPrice;
  const lastTradeMs = tick ? Date.parse(tick.datetime) : initialLastTradeMs;

  // 24h změna přepočítaná proti base ceně odvozené ze SSR hodnot:
  // base = impliedBase24h(initialPrice, initialChange24h) – mění se jen čitatel.
  // Počítá se z HLAVNÍ ceny (ask, fallback poslední obchod).
  const base24h =
    initialPrice !== null && initialChange24h !== null
      ? impliedBase24h(initialPrice, initialChange24h)
      : null;

  // Stáří obchodu – ticking každou sekundu
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Live ask (orderbook) – HLAVNÍ cena ───────────────────────────
  const { ask } = useLiveAsk(itemId, initialAsk ?? null);
  const mainPrice = ask ?? price;
  const mainChange24h =
    mainPrice !== null && base24h !== null && base24h > 0
      ? ((mainPrice - base24h) / base24h) * 100
      : initialChange24h;

  // Záblesk hlavní ceny při změně (standardní tržní semantika:
  // nahoru = zelená, dolů = červená)
  const [mainFlash, setMainFlash] = useState<"up" | "down" | null>(null);
  const prevMainRef = useRef<number | null>(mainPrice);
  useEffect(() => {
    const prev = prevMainRef.current;
    prevMainRef.current = mainPrice;
    if (prev === null || mainPrice === null || prev === mainPrice) return;
    setMainFlash(mainPrice > prev ? "up" : "down");
    const t = setTimeout(() => setMainFlash(null), 900);
    return () => clearTimeout(t);
  }, [mainPrice]);

  // Záblesk ceny obchodu (sekundární řádek)
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevPriceRef = useRef<number | null>(price);
  useEffect(() => {
    const prev = prevPriceRef.current;
    prevPriceRef.current = price;
    if (prev === null || price === null || prev === price) return;
    setFlash(price > prev ? "up" : "down");
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [price]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span
        className={cn(
          "font-mono text-3xl font-semibold tabular-nums transition-colors duration-500",
          mainFlash === "up" && "text-up",
          mainFlash === "down" && "text-down",
          !mainFlash && "text-foreground"
        )}
        title={
          ask !== null
            ? "Nejnižší aktivní nabídka na burze (orderbook) – za kolik lze koupit hned. Aktuálnější než poslední obchod, který vzniká až realizovaným obchodem."
            : undefined
        }
      >
        {formatPrice(mainPrice)}
      </span>
      {ask !== null ? (
        <span
          className="rounded-lg border border-border/60 bg-secondary/40 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
          title="Hlavní cena = nejnižší aktivní nabídka (ask) – realizovatelná okamžitě"
        >
          ask
        </span>
      ) : (
        price !== null && (
          <span
            className="rounded-lg border border-border/60 bg-secondary/40 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
            title="Orderbook teď není dostupný – ukazuji poslední realizovaný obchod"
          >
            obchod
          </span>
        )
      )}
      <ChangeBadge value={mainChange24h} />
      <span className="text-xs text-muted-foreground">24h změna</span>
      {lastTradeMs != null && (
        <span
          className={cn(
            "font-mono text-xs tabular-nums transition-colors duration-500",
            flash === "up" && "text-up",
            flash === "down" && "text-down",
            !flash && "text-muted-foreground"
          )}
          title="Čas posledního obchodu této komodity. Na klidném trhu cena dlouho nezmizí – není to zastaralá data."
        >
          · poslední obchod{" "}
          {ask !== null && price != null && price > 0 ? (
            <>
              {formatPrice(price)}
              <span
                className={cn(
                  "ml-1 text-[10px] font-medium",
                  ask < price
                    ? "text-up" // ask pod obchodem = koupíš levněji
                    : ask > price
                      ? "text-down"
                      : "text-muted-foreground"
                )}
              >
                ({ask < price ? "" : "+"}
                {(((ask - price) / price) * 100).toFixed(1)} %)
              </span>
              {" · "}
            </>
          ) : null}
          {formatRelativeAgeFromMs(lastTradeMs, nowMs)}
        </span>
      )}
      {status === "live" && (
        <span
          className="flex items-center gap-1.5 rounded-full border border-up/20 bg-up/5 px-2 py-0.5 font-mono text-[10px] font-medium tracking-wider text-up"
          title="Ceny se aktualizují průběžně (~1–2 s)"
        >
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-up" />
          </span>
          LIVE
        </span>
      )}
    </div>
  );
}

/**
 * Live nejnižší ask – SSR hodnota se refreshuje s page (60 s fallback),
 * mezitím ji živě dotahuje /api/live/ask každých 5 s.
 */
function useLiveAsk(itemId: number, initialAsk: number | null) {
  const [ask, setAsk] = useState<number | null>(initialAsk);
  const [askMs, setAskMs] = useState<number | null>(
    initialAsk !== null ? Date.now() : null
  );

  useEffect(() => {
    setAsk(initialAsk);
    setAskMs(initialAsk !== null ? Date.now() : null);
  }, [initialAsk, itemId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/live/ask?item=${itemId}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { ask: number | null };
        if (cancelled) return;
        if (data.ask !== null && data.ask > 0) {
          setAsk(data.ask);
          setAskMs(Date.now());
        }
      } catch {
        // tiché selhání – SSR hodnota zůstane
      }
      if (!cancelled) {
        timer = setTimeout(poll, 5_000);
      }
    };

    timer = setTimeout(poll, 2_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [itemId]);

  return { ask, askMs };
}

/** Relativní stáří z (timestamp, now) – bez závislosti na Date.now() v renderu. */
function formatRelativeAgeFromMs(ms: number, nowMs: number): string {
  const min = Math.max(0, Math.round((nowMs - ms) / 60_000));
  if (min < 1) return "právě teď";
  if (min < 60) return `před ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `před ${h} h ${m} min` : `před ${h} h`;
}

/**
 * Malý live indikátor – volitelný doplněk do hlaviček sekcí.
 */
export function LiveDot({ className }: { className?: string }) {
  const { status } = useLiveSnapshot();
  if (status !== "live") return null;
  return (
    <span
      className={cn(
        "inline-flex size-1.5 rounded-full bg-up",
        className
      )}
      title="Live ceny aktivní"
    />
  );
}
