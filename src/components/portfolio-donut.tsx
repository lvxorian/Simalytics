"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { ItemIcon } from "@/components/item-icon";
import { formatCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

// Barvy segmentů – odvozené od aplikační palety (ink navy + primár).
const SEGMENT_COLORS = [
  "#5b8def", // primár modrá
  "#22ab94", // up zelená
  "#ec5063", // down červená
  "#f0b429", // jantar
  "#9d7bde", // fialová
  "#4cc9e8", // azurová
  "#e87bb0", // růžová
  "#8fae5d", // olivová
];

const DEFAULT_COLOR = "#596273";

export type DonutSlice = {
  key: string;
  label: string;
  value: number;
  href?: string;
  iconUrl?: string | null;
};

type Segment = {
  slice: DonutSlice;
  pct: number;
  color: string;
};

/**
 * Koláč (donut) alokace portfolia – čisté SVG, bez závislostí.
 * Ukazuje podíl aktiv na celkové hodnotě; střed nese celkovou hodnotu
 * a nerealizovaný P/L (přes 3 řádky, velikost upravená, aby nepřetékala
 * do ringu). Víc než 8 aktiv se sbalí do segmentu „Ostatní“.
 *
 * Interaktivita: hover nad segmentem (nebo položkou legendy) zvýrazní
 * segment (mírně zvětší a ztlumí ostatní) a střed přepne na detail
 * aktiva – název, hodnotu a podíl. Opuštění hoveru vrátí celkový souhrn.
 */
export function PortfolioDonut({
  slices,
  totalValue,
  totalPl,
}: {
  slices: DonutSlice[];
  totalValue: number;
  totalPl: number | null;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // ── Vjetí kruhu při načtení ────────────────────────────────────
  // Segmenty animujeme poměrem obvodu (stroke-dasharray/offset): každý
  // krouží od 0 do své délky s časovým zpožděním podle pozice v kruhu
  // (cascading sweep – segmenty „dorážejí“ za sebou). Spustí se jednou
  // po mountu; prefers-reduced-motion animaci vypne (CSS i JS guard).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setMounted(true);
      return;
    }
    // malá prodleva, ať prohlížeč stihne první frame s prázdným kruhem –
    // pak přepnutí dasharray spustí CSS transition (vjetí segmentů)
    const t = window.setTimeout(() => setMounted(true), 60);
    return () => window.clearTimeout(t);
  }, []);

  const positive = slices.filter((s) => s.value > 0);
  const top = positive.slice(0, 8);
  const restValue = positive.slice(8).reduce((sum, s) => sum + s.value, 0);

  const withRest: DonutSlice[] = restValue
    ? [
        ...top,
        {
          key: "__rest__",
          label: `Ostatní (+${positive.length - top.length})`,
          value: restValue,
        },
      ]
    : top;

  const sum = withRest.reduce((s, x) => s + x.value, 0);
  const segments: Segment[] =
    sum <= 0
      ? []
      : withRest.map((slice, i) => ({
          slice,
          pct: (slice.value / sum) * 100,
          color:
            slice.key === "__rest__"
              ? DEFAULT_COLOR
              : SEGMENT_COLORS[i % SEGMENT_COLORS.length],
        }));

  // Donut: poloměry, tloušťka a obvod (SVG viewBox 120×120)
  const r = 42;
  const cx = 60;
  const cy = 60;
  const strokeW = 13;
  const circumference = 2 * Math.PI * r;
  // Mezera mezi segmenty – větší mezera vypadá čistě, když jich je málo
  const gap = segments.length > 1 ? 1.5 : 0;

  let acc = 0; // akumulovaný podíl v % pro start segmentu

  // Hoverovaný segment – detail v centru
  const hovered = segments.find((s) => s.slice.key === hoveredKey);

  const plTone =
    totalPl === null
      ? "text-muted-foreground"
      : totalPl > 0
        ? "text-up"
        : totalPl < 0
          ? "text-down"
          : "text-muted-foreground";

  // Ať se text v centru nikdy nedotkne ringu: souhrn má 3 řádky, detail
  // hoveru 2–3 – obě varianty se vejdou do vnitřního průměru (r−stroke).
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
      <div
        className="relative shrink-0"
        onMouseLeave={() => setHoveredKey(null)}
      >
        <svg
          width={216}
          height={216}
          viewBox="0 0 120 120"
          role="img"
          aria-label="Alokace portfolia"
          className="drop-shadow-[0_6px_20px_rgba(0,0,0,0.35)]"
        >
          {/* základní kruh (prázdný stav) */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="var(--secondary)"
            strokeWidth={strokeW}
          />
          {segments.map((seg) => {
            const start = (acc / 100) * circumference;
            acc += seg.pct;
            const sweep = (seg.pct / 100) * circumference;
            const gapLen = (gap / 100) * circumference;
            const dash = Math.max(sweep - gapLen, 0.5);
            const isHovered = hoveredKey === seg.slice.key;
            const isDimmed = hoveredKey !== null && !isHovered;

            // Animace vjetí: před mountem má segment nulovou délku, po něm
            // přechod na plnou délku s delay dle pozice v kruhu (kaskáda
            // po směru hodinových ručiček – segmenty dorážejí za sebou).
            const animDelay = 120 + (start / circumference) * 480; // ms
            const restLen = circumference - dash;
            const grown = mounted;

            return (
              <circle
                key={seg.slice.key}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={isHovered ? strokeW + 4 : strokeW}
                strokeDasharray={
                  grown ? `${dash} ${restLen}` : `0.001 ${circumference - 0.001}`
                }
                strokeDashoffset={-start}
                transform={`rotate(-90 ${cx} ${cy})`}
                strokeLinecap="butt"
                className={cn(
                  "cursor-pointer transition-[stroke-dasharray,stroke-width,opacity] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  isDimmed && "opacity-35"
                )}
                style={{
                  transitionDelay: grown ? `${animDelay}ms` : "0ms",
                }}
                onMouseEnter={() => setHoveredKey(seg.slice.key)}
              />
            );
          })}
        </svg>

        {/* Střed donutu – souhrn, nebo detail hoverovaného aktiva.
            pointer-events-none, ať nepřekáží hoveru na segmentech. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
          {hovered ? (
            <>
              <span className="max-w-full truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {hovered.slice.label}
              </span>
              <span className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-foreground">
                {formatCompact(hovered.slice.value)} $
              </span>
              <span
                className="font-mono text-xs tabular-nums"
                style={{ color: hovered.color }}
              >
                {hovered.pct.toFixed(1)} % portfolia
              </span>
            </>
          ) : (
            <>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Hodnota
              </span>
              <span className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-foreground">
                {formatCompact(totalValue)} $
              </span>
              <span
                className={`mt-0.5 font-mono text-[11px] tabular-nums ${plTone}`}
              >
                {totalPl === null
                  ? "–"
                  : `${totalPl > 0 ? "+" : totalPl < 0 ? "−" : ""}${formatCompact(Math.abs(totalPl))} $`}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Legenda – hover nad položkou zvýrazní i segment v koláči */}
      <ul className="grid w-full grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2">
        {segments.map((seg) => {
          const isHovered = hoveredKey === seg.slice.key;
          const isDimmed = hoveredKey !== null && !isHovered;
          return (
            <li key={seg.slice.key} className="min-w-0">
              <Link
                href={seg.slice.href ?? "#"}
                onMouseEnter={() => setHoveredKey(seg.slice.key)}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-1.5 py-1 transition-all duration-200",
                  isHovered && "bg-secondary/60",
                  isDimmed && "opacity-50"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-2.5 shrink-0 rounded-full transition-transform duration-200",
                    isHovered && "scale-125"
                  )}
                  style={{ backgroundColor: seg.color }}
                />
                {seg.slice.iconUrl ? (
                  <ItemIcon
                    url={seg.slice.iconUrl}
                    name={seg.slice.label}
                    size={18}
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate text-xs font-medium group-hover:text-primary">
                  {seg.slice.label}
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {seg.pct.toFixed(1)} %
                </span>
              </Link>
            </li>
          );
        })}
        {segments.length === 0 && (
          <li className="text-xs text-muted-foreground">Žádné aktiva.</li>
        )}
      </ul>
    </div>
  );
}
