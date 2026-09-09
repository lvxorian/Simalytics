import Link from "next/link";

import { ItemIcon } from "@/components/item-icon";
import { formatCompact } from "@/lib/format";

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
 * Ukazuje podíl držeb na celkové hodnotě; střed nese celkovou hodnotu
 * a nerealizovaný P/L. Víc než 8 držeb se sbalí do segmentu „Ostatní“.
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

  // Donut: poloměry a obvod
  const r = 42;
  const cx = 60;
  const cy = 60;
  const circumference = 2 * Math.PI * r;
  // Větší mezer mezi segmenty, když jich je málo (jinak vypadá plný kruh)
  const gap = segments.length > 1 ? 1.5 : 0;

  let acc = 0; // akumulovaný podíl v % pro start segmentu

  const plTone =
    totalPl === null
      ? "text-muted-foreground"
      : totalPl > 0
        ? "text-up"
        : totalPl < 0
          ? "text-down"
          : "text-muted-foreground";

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
      <div className="relative shrink-0">
        <svg
          width={220}
          height={220}
          viewBox="0 0 120 120"
          role="img"
          aria-label="Alokace portfolia"
        >
          {/* základní kruh (prázdný stav) */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="var(--secondary)"
            strokeWidth={14}
          />
          {segments.map((seg) => {
            const start = (acc / 100) * circumference;
            acc += seg.pct;
            const sweep = (seg.pct / 100) * circumference;
            const gapLen = (gap / 100) * circumference;
            const dash = Math.max(sweep - gapLen, 0.5);
            return (
              <circle
                key={seg.slice.key}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={14}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-start}
                transform={`rotate(-90 ${cx} ${cy})`}
                strokeLinecap="butt"
              />
            );
          })}
        </svg>

        {/* Střed donutu */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Hodnota
          </span>
          <span className="font-mono text-xl font-semibold tabular-nums">
            {formatCompact(totalValue)} $
          </span>
          <span className={`mt-0.5 font-mono text-xs tabular-nums ${plTone}`}>
            {totalPl === null
              ? "–"
              : `${totalPl > 0 ? "+" : totalPl < 0 ? "−" : ""}${formatCompact(Math.abs(totalPl))} $`}
          </span>
        </div>
      </div>

      {/* Legenda */}
      <ul className="grid w-full grid-cols-1 gap-x-5 gap-y-1.5 sm:grid-cols-2">
        {segments.map((seg) => (
          <li key={seg.slice.key} className="min-w-0">
            <Link
              href={seg.slice.href ?? "#"}
              className="group flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-secondary/50"
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: seg.color }}
              />
              {seg.slice.iconUrl !== undefined && seg.slice.iconUrl ? (
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
        ))}
        {segments.length === 0 && (
          <li className="text-xs text-muted-foreground">Žádné držby.</li>
        )}
      </ul>
    </div>
  );
}
