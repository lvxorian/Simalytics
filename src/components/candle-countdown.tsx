"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Opočítávání do zavření aktuální svíčky daného timeframu.
 *
 * Bucket hranice musí odpovídat agregaci v lib/candles.ts:
 * - intraday (5m/15m/1H/4H): epoch-aligned intervaly (Math.floor(t / s) * s),
 * - 1D: dny v UTC,
 * - 1W: pondělí v UTC (ISO týden),
 * - 1M: první den měsíce v UTC.
 *
 * Když svíčka zavře (countdown dorazí na 0), jedna sekunda na to spustí
 * router.refresh() – server components dotáhnou čerstvé ticky a cena
 * v hero sekci i graf se aktualizují bez reloadu stránky.
 */

type IntervalKey = "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M";

const INTERVAL_SECONDS: Record<IntervalKey, number> = {
  "5m": 5 * 60,
  "15m": 15 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60,
  "1w": 7 * 24 * 60 * 60,
  "1M": 30 * 24 * 60 * 60, // jen pro typy – reálný konec měsíce počítá monthEnd()
};

/** Začátek aktuálního bucketu daného TF (unix sekundy, UTC). */
function bucketStart(key: IntervalKey, nowSec: number): number {
  if (key === "1d") {
    return Math.floor(nowSec / 86400) * 86400;
  }
  if (key === "1w") {
    const d = new Date(nowSec * 1000);
    const diffToMonday = (d.getUTCDay() + 6) % 7;
    const monday = Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate() - diffToMonday
    );
    return Math.floor(monday / 1000);
  }
  if (key === "1M") {
    const d = new Date(nowSec * 1000);
    return Math.floor(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
    );
  }
  const s = INTERVAL_SECONDS[key];
  return Math.floor(nowSec / s) * s;
}

/** Konec aktuálního bucketu (unix sekundy) – pro 1M skutečný konec měsíce. */
function bucketEnd(key: IntervalKey, nowSec: number): number {
  if (key === "1M") {
    const d = new Date(nowSec * 1000);
    return Math.floor(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000
    );
  }
  if (key === "1w") {
    return bucketStart(key, nowSec) + 7 * 86400;
  }
  return bucketStart(key, nowSec) + INTERVAL_SECONDS[key];
}

/** mm:ss pod 1 h, jinak h:mm:ss. */
function formatRemaining(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function CandleCountdown({
  intervalKey,
  className,
}: {
  intervalKey: IntervalKey;
  className?: string;
}) {
  const router = useRouter();
  // now = null do prvního efektu (SSR i hydration vydají stejný „--:--“)
  const [nowSec, setNowSec] = useState<number | null>(null);
  const [refreshed, setRefreshed] = useState(false);

  useEffect(() => {
    const tick = () => setNowSec(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Po zavření svíčky obnovit server data (cena, poslední svíčka grafu)
  const bucket = useMemo(() => {
    if (nowSec === null) return null;
    return { start: bucketStart(intervalKey, nowSec), end: bucketEnd(intervalKey, nowSec) };
  }, [intervalKey, nowSec]);

  // Po zavření svíčky obnovit server data (cena, poslední svíčka grafu).
  // Poller zapisuje ticky se svou fází (cron každých 5 min), takže hned
  // po zavření tick ještě nemusí být v DB → obnovíme hned a pak s odstupem,
  // ať nová svíčka vyzvedneme, jakmile se objeví.
  const lastEndRef = useRef<number | null>(null);
  useEffect(() => {
    if (!bucket) return;
    if (lastEndRef.current === null) {
      lastEndRef.current = bucket.end;
      return;
    }
    if (bucket.end !== lastEndRef.current) {
      lastEndRef.current = bucket.end;
      setRefreshed(true);
      router.refresh();
      // Následné dotazy – tick od polleru může dorazit o chvíli později
      const retries = [15_000, 30_000, 45_000, 60_000].map((delay) =>
        setTimeout(() => router.refresh(), delay)
      );
      // signál „obnoveno“ zmizí po chvíli
      const t = setTimeout(() => setRefreshed(false), 4000);
      return () => {
        retries.forEach(clearTimeout);
        clearTimeout(t);
      };
    }
  }, [bucket, router]);

  if (nowSec === null || !bucket) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground",
          className
        )}
      >
        ––:––
      </span>
    );
  }

  const remaining = Math.max(0, bucket.end - nowSec);
  const total = bucket.end - bucket.start;
  // Progres zavírané svíčky (0–1) – tenký proužek pod odpočtem
  const progress = total > 0 ? 1 - remaining / total : 0;
  const closing = remaining <= 30; // svíčka se zavírá – zvýraznění
  const label =
    intervalKey === "1M"
      ? "konec měsíce"
      : intervalKey === "1w"
        ? "konec týdne"
        : "zavření svíčky";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-mono text-[11px] tabular-nums",
        className
      )}
      title={`Čas do ${label} (${intervalKey}) – poté se cena obnoví`}
    >
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "transition-colors duration-500",
          closing ? "text-primary" : "text-foreground"
        )}
      >
        {formatRemaining(remaining)}
      </span>
      {/* proužek průběhu svíčky */}
      <span className="relative h-1 w-10 overflow-hidden rounded-full bg-border/60">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-1000 ease-linear",
            closing ? "bg-primary" : "bg-muted-foreground/60"
          )}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </span>
      {refreshed && (
        <span className="text-up" role="status">
          obnoveno
        </span>
      )}
    </span>
  );
}
