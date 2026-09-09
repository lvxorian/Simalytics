"use client";

import { useEffect, useRef, useState } from "react";

import { ChangeBadge } from "@/components/change-badge";
import { formatPrice } from "@/lib/format";
import { useLiveTick, useLiveSnapshot, impliedBase24h } from "@/lib/live-prices";
import { cn } from "@/lib/utils";

/**
 * Live hero cena (market page): SSR cena se po připojení live pollu
 * nahradí čerstvým tickem (SSE push, latence ~1–2 s od obchodu).
 * Zelený/barevný záblesk signalizuje změnu ceny proti předchozí hodnotě;
 * „poslední obchod před X min" se přepočítává každou sekundu.
 *
 * Fáze 3C: navíc AKTIVNÍ NABÍDKA (nejnižší ask z orderbooku) – co
 * reálně stojí koupit hned. Dotahuje se z /api/live/ask (ofiko v3 API,
 * cache 3 s) a žije s vlastními živými ticky.
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
  // base = impliedBase24h(initialPrice, initialChange24h) – mění se jen čitatel
  const base24h =
    initialPrice !== null && initialChange24h !== null
      ? impliedBase24h(initialPrice, initialChange24h)
      : null;
  const change24h =
    price !== null && base24h !== null && base24h > 0
      ? ((price - base24h) / base24h) * 100
      : initialChange24h;

  // Stáří obchodu – ticking každou sekundu
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Záblesk při změně ceny
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

  // ── Live ask (orderbook) ─────────────────────────────────────────
  const { ask, askMs } = useLiveAsk(itemId, initialAsk ?? null);

  // Záblesk asku při změně
  const [askFlash, setAskFlash] = useState<"up" | "down" | null>(null);
  const prevAskRef = useRef<number | null>(ask);
  useEffect(() => {
    const prev = prevAskRef.current;
    prevAskRef.current = ask;
    if (prev === null || ask === null || prev === ask) return;
    setAskFlash(ask > prev ? "up" : "down");
    const t = setTimeout(() => setAskFlash(null), 900);
    return () => clearTimeout(t);
  }, [ask]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span
        className={cn(
          "font-mono text-3xl font-semibold tabular-nums transition-colors duration-500",
          flash === "up" && "text-up",
          flash === "down" && "text-down",
          !flash && "text-foreground"
        )}
      >
        {formatPrice(price)}
      </span>
      <ChangeBadge value={change24h} />
      <span className="text-xs text-muted-foreground">24h změna</span>
      {lastTradeMs != null && (
        <span
          className="text-xs text-muted-foreground"
          title="Čas posledního obchodu této komodity. Na klidném trhu cena dlouho nezmizí – není to zastaralá data."
        >
          · poslední obchod{" "}
          {formatRelativeAgeFromMs(lastTradeMs, nowMs)}
        </span>
      )}
      {ask !== null && (
        <span
          className={cn(
            "flex items-baseline gap-1.5 rounded-lg border border-border/60 bg-secondary/40 px-2 py-0.5 font-mono text-xs transition-colors duration-500",
            askFlash === "up" && "text-down", // ask nahoru = dražší nákup (červeně)
            askFlash === "down" && "text-up", // ask dolů = levnější nákup (zeleně)
            !askFlash && "text-foreground"
          )}
          title="Nejnižší aktivní nabídka na burze (orderbook) – za kolik lze koupit hned. Liší se od posledního obchodu: nabídka je ještě nerealizovaná, obchod už ano."
        >
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            ask
          </span>
          <span className="font-semibold tabular-nums">{formatPrice(ask)}</span>
          {price != null && price > 0 && (
            <span
              className={cn(
                "text-[10px] font-medium",
                ask < price ? "text-up" : ask > price ? "text-down" : "text-muted-foreground"
              )}
              title="Spread asku proti poslednímu obchodu – záporný = koupíš levněji než poslední obchod"
            >
              ({ask < price ? "" : "+"}
              {(((ask - price) / price) * 100).toFixed(1)} %)
            </span>
          )}
          {askMs !== null && (
            <span className="text-[10px] text-muted-foreground">
              · {formatRelativeAgeFromMs(askMs, nowMs)}
            </span>
          )}
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
