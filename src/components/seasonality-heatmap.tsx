"use client";

import { useMemo } from "react";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  computeSeasonality,
  computeMonthlyPhases,
  MONTH_LABELS,
  type SeasonalityRow,
  type SeasonalityStats,
} from "@/lib/seasonality";
import type { MonthlyClose } from "@/lib/data";
import type { SimcoPhaseRange } from "@/lib/simcotools";

/**
 * Sezonalita – heatmapa měsíčních výnosů à la TradingView / Seasonax.
 *
 * Řádky = roky, sloupce = měsíce (Led–Pro). Barva buňky = intenzita
 * výnosu (červená = pokles, zelená = růst; saturace škálovaná dle
 * max |výnosu| v datech, aby heatmapa nebyla ani přepálená, ani
 * bledá). Spodek = průměr / medián / % pozitivních let per měsíc.
 * Poslední sloupec = celoroční výnos (jen kompletní roky).
 */

/** Barva buňky dle výnosu – saturace relativní k maximu v datech. */
function cellColor(r: number | null, maxAbs: number): string | null {
  if (r === null || maxAbs <= 0) return null;
  const t = Math.min(Math.abs(r) / maxAbs, 1); // 0–1 intenzita
  const alpha = 0.12 + t * 0.55; // min 12 %, max ~67 %
  return r >= 0
    ? `rgba(34, 171, 148, ${alpha.toFixed(3)})` // #22ab94 (text-up)
    : `rgba(236, 80, 99, ${alpha.toFixed(3)})`; // #ec5063 (text-down)
}

function fmtCell(r: number | null): string {
  if (r === null) return "–";
  const pct = r * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)} %`;
}

/** Emoji herní fáze (shodné s PHASE_LABELS na /statistiky). */
const PHASE_EMOJI: Record<string, string> = {
  boom: "📈",
  normal: "⚖️",
  recession: "📉",
};

const PHASE_LABELS_CS: Record<string, string> = {
  boom: "Růst",
  normal: "Stabilní",
  recession: "Recese",
};

export function SeasonalityHeatmap({
  closes,
  phaseRanges = [],
}: {
  closes: MonthlyClose[];
  phaseRanges?: SimcoPhaseRange[];
}) {
  const { rows, stats } = useMemo(() => computeSeasonality(closes), [closes]);
  // Dominantní fáze per měsíc – statická data (cache 15 min na API),
  // výpočet jen při změně ranges.
  const phaseMap = useMemo(() => computeMonthlyPhases(phaseRanges), [phaseRanges]);

  if (rows.length === 0 || stats.monthsOfData < 3) {
    return (
      <div className="rounded-xl border border-border/80 bg-card p-8 text-center text-sm text-muted-foreground">
        Pro sezonalitu není dost historie – potřebujeme alespoň ~3 měsíce
        souvislých dat (archiv měsíčních svíček od 2022-02).
      </div>
    );
  }

  const maxAbs = Math.max(
    ...rows.flatMap((row) =>
      row.returns.map((r) => (r === null ? 0 : Math.abs(r)))
    ),
    0.01
  );

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1; // 1–12

  return (
    <div className="space-y-4">
      {/* ── Heatmapa ─────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-border/80 bg-card p-4 sm:p-5">
        <table className="w-full min-w-[760px] border-separate border-spacing-0.5 text-center font-mono text-[11px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-1 py-1.5 text-left font-medium">Rok</th>
              {MONTH_LABELS.map((label) => (
                <th key={label} className="px-1 py-1.5 font-medium">
                  {label}
                </th>
              ))}
              <th className="px-1 py-1.5 font-medium">Rok ±</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <SeasonalityRowView
                key={row.year}
                row={row}
                maxAbs={maxAbs}
                isCurrent={row.year === currentYear}
                currentMonth={currentMonth}
                phaseMap={phaseMap}
              />
            ))}

            {/* ── Statistické řádky ──────────────────────────────── */}
            <StatRow
              label="Průměr"
              values={stats.avg}
              maxAbs={maxAbs}
              title="Průměrný výnos měsíce napříč lety (min. 2 pozorování)"
              bold
            />
            <StatRow
              label="Medián"
              values={stats.median}
              maxAbs={maxAbs}
              title="Medián výnosu měsíce napříč lety"
            />
            <StatRow
              label="Pozitivních"
              values={stats.positivePct}
              maxAbs={100}
              title="Kolik % let byl měsíc v plusu"
              pctMode
            />
          </tbody>
        </table>
        <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
          Výnos měsíce = změna uzávěrové ceny oproti konci předchozího
          měsíce. „Rok ±“ jen pro kompletní roky (compounding všech 12
          měsíců). Data: měsíční svíčky Simco Tools od {stats.rangeFrom ??
            "2022-02"} (čerstvý měsíc z denních dat, uzavírá se po
          měsíci). Emoji = dominantní herní fáze ekonomiky v měsíci
          ({"📈"} Růst · {"⚖️"} Stabilní · {"📉"} Recese).
        </p>
      </div>

      {/* ── Legendový vzorec (avg per měsíc pro herní chat) ──────── */}
      <SeasonalityFormula stats={stats} />
    </div>
  );
}

/** Řádek jednoho roku. */
function SeasonalityRowView({
  row,
  maxAbs,
  isCurrent,
  currentMonth,
  phaseMap,
}: {
  row: SeasonalityRow;
  maxAbs: number;
  isCurrent: boolean;
  currentMonth: number;
  phaseMap: Map<
    string,
    { phase: "normal" | "boom" | "recession"; share: number; days: Record<string, number> }
  >;
}) {
  return (
    <tr>
      <td
        className={cn(
          "rounded-l px-2 py-1.5 text-left font-semibold",
          isCurrent && "text-primary"
        )}
        title={isCurrent ? "Aktuální rok – běží" : undefined}
      >
        {row.year}
      </td>
      {row.returns.map((r, i) => {
        const isFuture = isCurrent && i + 1 > currentMonth;
        const color = isFuture ? null : cellColor(r, maxAbs);
        const monthKey = `${row.year}-${String(i + 1).padStart(2, "0")}`;
        const phase = phaseMap.get(monthKey);
        const phaseTitle = phase
          ? `${PHASE_LABELS_CS[phase.phase]} (${Math.round(phase.share * 100)} % dní)` +
            Object.entries(phase.days)
              .map(([p, d]) => `\n${PHASE_LABELS_CS[p] ?? p}: ${Math.round(d)} d`)
              .join("")
          : undefined;
        return (
          <td
            key={i}
            className="px-1 py-1.5 tabular-nums"
            style={color ? { backgroundColor: color } : undefined}
            title={
              isFuture
                ? undefined
                : [
                    r !== null ? `${MONTH_LABELS[i]} ${row.year}: ${fmtCell(r)}` : null,
                    phaseTitle,
                  ]
                    .filter(Boolean)
                    .join("\n")
            }
          >
            {isFuture ? "" : (
              <span className="inline-flex items-center gap-0.5">
                {fmtCell(r)}
                {phase && !isFuture && (
                  <span
                    aria-hidden
                    className="text-[9px] leading-none"
                  >
                    {PHASE_EMOJI[phase.phase]}
                  </span>
                )}
              </span>
            )}
          </td>
        );
      })}
      <td
        className={cn(
          "rounded-r px-2 py-1.5 font-semibold tabular-nums",
          row.yearReturn === null
            ? "text-muted-foreground/50"
            : row.yearReturn >= 0
              ? "text-up"
              : "text-down"
        )}
        title={
          row.yearReturn !== null
            ? `Celoroční výnos ${row.year}: ${fmtCell(row.yearReturn)} (compounding 12 měsíců)`
            : "Rok není kompletní – celoroční výnos se nepočítá"
        }
      >
        {row.yearReturn === null ? "–" : fmtCell(row.yearReturn)}
      </td>
    </tr>
  );
}

/** Statistický řádek (průměr / medián / % pozitivních). */
function StatRow({
  label,
  values,
  maxAbs,
  title,
  bold,
  pctMode,
}: {
  label: string;
  values: (number | null)[];
  maxAbs: number;
  title: string;
  bold?: boolean;
  pctMode?: boolean;
}) {
  return (
    <tr className="border-t-2 border-border/60">
      <td
        className={cn(
          "rounded-l px-2 py-1.5 text-left",
          bold && "font-semibold"
        )}
        title={title}
      >
        {label}
      </td>
      {values.map((v, i) => {
        const color = pctMode
          ? v === null
            ? null
            : v >= 50
              ? `rgba(34, 171, 148, ${(0.1 + (v / 100) * 0.4).toFixed(3)})`
              : `rgba(236, 80, 99, ${(0.1 + (1 - v / 100) * 0.4).toFixed(3)})`
          : cellColor(v, maxAbs);
        return (
          <td
            key={i}
            className={cn(
              "px-1 py-1.5 tabular-nums",
              bold && "font-semibold"
            )}
            style={color ? { backgroundColor: color } : undefined}
          >
            {v === null
              ? "–"
              : pctMode
                ? `${v.toFixed(0)} %`
                : fmtCell(v)}
          </td>
        );
      })}
      {/* Rok ± sloupec zůstává prázdný */}
      <td className="rounded-r" />
    </tr>
  );
}

/**
 * Průměrný „měsíční vzorec“ – textová šablona pro herní chat
 * (inspirace Seasonax avg seasonality): led +2,3 % · úno −0,8 % …
 */
function SeasonalityFormula({ stats }: { stats: SeasonalityStats }) {
  const parts = stats.avg
    .map((avg, i) =>
      avg === null
        ? null
        : `${MONTH_LABELS[i].toLowerCase()} ${avg >= 0 ? "+" : ""}${(avg * 100).toFixed(1)} %`
    )
    .filter((s): s is string => s !== null);

  if (parts.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/80 bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Průměrný měsíční vzorec
      </p>
      <p className="mt-2 font-mono text-sm leading-relaxed">{parts.join(" · ")}</p>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Zkopíruj do chatu jako shrnutí sezónality aktiva.
      </p>
    </div>
  );
}
