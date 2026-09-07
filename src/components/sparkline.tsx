import { cn } from "@/lib/utils";

/**
 * Mini-graf ceny (SVG polyline, server-rendered, zero JS).
 * Barva podle směru: zelená roste, červená padá – jako v reálných
 * trading aplikacích. `uid` musí být unikátní na stránce (gradient defs).
 */
export function Sparkline({
  data,
  uid,
  width = 96,
  height = 32,
  className,
}: {
  data: number[] | undefined;
  uid: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className={cn("rounded", className)} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} ${width - pad},${height} ${pad},${height}`;
  const positive = data[data.length - 1] >= data[0];
  const stroke = positive ? "var(--up)" : "var(--down)";
  const gradId = `spark-${uid}`;

  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden
      className={cn("overflow-visible", className)}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradId})`} />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r="2" fill={stroke} />
    </svg>
  );
}
