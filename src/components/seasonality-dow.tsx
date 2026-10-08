"use client";

import { cn } from "@/lib/utils";
import {
  DOW_LABELS,
  type DowStats,
} from "@/lib/seasonality";

/**
 * Day-of-week sezonalita – druhý pohled pod monthly heatmapou.
 *
 * 7 buněk (Po–Ne) s průměrným denním výnosem, mediánem a % pozitivních
 * dní. ~365 dní dat = ~51 pozorování na den (statisticky solidní, na
 * rozdíl od weekly-of-year heatmapy). Barvy stejné konvence jako
 * monthly heatmapa (text-up / text-down, saturace dle max |výnosu|).
 */

const DOW_MIN_N = 5; // musí souhlasit s computeDowSeasonality

function fmtCell(r: number | null): string {
  if (r === null) return "–";
  const pct = r * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)} %`;
}

function cellColor(r: number | null, maxAbs: number): string | null {
  if (r === null || maxAbs <= 0) return null;
  const t = Math.min(Math.abs(r) / maxAbs, 1);
  const alpha = 0.12 + t * 0.55;
  return r >= 0
    ? `rgba(34, 171, 148, ${alpha.toFixed(3)})`
    : `rgba(236, 80, 99, ${alpha.toFixed(3)})`;
}

export function SeasonalityDow({ stats }: { stats: DowStats }) {
  if (stats.totalReturns < 10) {
    return null; // denních dat je málo – sekci nezobrazovat
  }

  const maxAbs = Math.max(
    ...stats.avg.map((r) => (r === null ? 0 : Math.abs(r))),
    0.001
  );

  // Nejlepší a nejhorší den (dle průměru, jen s dost pozorováními).
  let bestIdx = -1;
  let worstIdx = -1;
  for (let d = 0; d < 7; d++) {
    if (stats.avg[d] === null) continue;
    if (bestIdx === -1 || (stats.avg[d] as number) > (stats.avg[bestIdx] as number)) {
      bestIdx = d;
    }
    if (worstIdx === -1 || (stats.avg[d] as number) < (stats.avg[worstIdx] as number)) {
      worstIdx = d;
    }
  }

  return (
    <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Day-of-week sezonalita
        </p>
        <span
          className="font-mono text-[10px] text-muted-foreground"
          title={`Denní výnosy od ${stats.rangeFrom ?? "–"} do ${stats.rangeTo ?? "–"}`}
        >
          {stats.totalReturns} denních výnosů
        </span>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {stats.avg.map((avg, d) => {
          const med = stats.median[d];
          const pos = stats.positivePct[d];
          const color = cellColor(avg, maxAbs);
          const isBest = d === bestIdx;
          const isWorst = d === worstIdx;
          return (
            <div
              key={d}
              className={cn(
                "rounded-lg border px-2 py-2 text-center",
                isBest
                  ? "border-up/40"
                  : isWorst
                    ? "border-down/40"
                    : "border-border/50"
              )}
              style={color ? { backgroundColor: color } : undefined}
            >
              <div
                className={cn(
                  "font-mono text-[10px] uppercase tracking-wider",
                  (isBest || isWorst) && "font-bold"
                )}
                title={
                  isBest
                    ? "Nejlepší den (nejvyšší průměrný výnos)"
                    : isWorst
                      ? "Nejhorší den (nejnižší průměrný výnos)"
                      : undefined
                }
              >
                {DOW_LABELS[d]}
              </div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums">
                {fmtCell(avg)}
              </div>
              <div
                className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground"
                title={`Medián: ${fmtCell(med)} · pozitivních dní: ${pos === null ? "–" : `${pos.toFixed(0)} %`} · pozorování: ${stats.n[d]}`}
              >
                {med === null ? "–" : fmtCell(med)} · {pos === null ? "–" : `${pos.toFixed(0)} %`}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
        Výnos dne vs. předchozí obchodní den (pondělí měří proti pátku).
        Velké číslo = průměr, malé = medián + % pozitivních dní. Rámeček
        zvýrazňuje nejlepší (zelený) a nejhorší (červený) den. Min.
        {DOW_MIN_N} pozorování na den. Rozsah: {stats.rangeFrom ?? "–"} →{" "}
        {stats.rangeTo ?? "–"}.
      </p>
    </div>
  );
}
