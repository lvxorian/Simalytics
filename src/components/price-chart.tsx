"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, LinePoint } from "@/lib/candles";
import {
  computeVolumeProfile,
  valueAreaPercent,
  type VolumeProfile,
} from "@/lib/volume-profile";
import { formatCompact, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export type VolumePoint = { time: number; value: number };

export type ChartExtras = {
  /** Objemový histogram (jen denní data ze Simco Tools) */
  volume?: VolumePoint[];
  /** VWAP linka (jen denní data) */
  vwap?: LinePoint[];
  /** Rozsah období pro hladiny Max/Min */
  high?: number;
  low?: number;
  /** Průměr období */
  average?: number;
};

/** Přepínatelné překryvy grafu. */
const OVERLAY_META = [
  { key: "volume", label: "Objem" },
  { key: "vwap", label: "VWAP" },
  { key: "average", label: "Průměr" },
  { key: "range", label: "Max / Min" },
] as const;

type OverlayKey = (typeof OVERLAY_META)[number]["key"];

/**
 * Financní graf postavený na TradingView Lightweight Charts (v5 API:
 * chart.addSeries(CandlestickSeries, …)). Všechna data čekají na klientu,
 * komponenta je čistě vizuální – čas je UTC unix sekundy.
 *
 * Fixed Range Volume Profile: uživatel tažením myši označí rozsah
 * (od–do), komponenta spočítá profil (biny, POC, Value Area 70 %) a
 * vykreslí ho jako overlay vpravo – jako nástroj ve TradingView.
 */
export function PriceChart({
  candles,
  mode = "candles",
  height = 460,
  extras,
  volumeProfile,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // Ref na hlavní sérii – pro převod ceny → pixel (volume profile overlay)
  const mainSeriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Area"> | null>(null);

  const [visible, setVisible] = useState<Record<OverlayKey, boolean>>({
    volume: true,
    vwap: false,
    average: false,
    range: false,
  });

  // ── Fixed Range Volume Profile ──────────────────────────────────
  // Rozsah měření: null = celý viditelný rozsah dat
  const [vpRange, setVpRange] = useState<{ from: number; to: number } | null>(
    null
  );
  const [vpEnabled, setVpEnabled] = useState(false);
  // Výběr tažením: 0 = neaktivní, 1 = tažení (from), 2 = tažení (do)
  const dragState = useRef<{ anchor: number | null }>({ anchor: null });
  const [dragPreview, setDragPreview] = useState<{
    from: number;
    to: number;
  } | null>(null);

  // Zdroj dat profilu: volumeProfile prop (reálné objemy pro 1D/1W/1M),
  // jinak samotné svíčky (intraday → proxy objem = 1 tick)
  const profileSource = useMemo(
    () =>
      (volumeProfile ?? candles).map((c) => ({
        ...c,
        volume: c.volume ?? 1,
      })),
    [volumeProfile, candles]
  );

  const profile = useMemo(() => {
    if (!vpEnabled || profileSource.length === 0) return null;
    const from = vpRange?.from ?? profileSource[0].time;
    const to =
      vpRange?.to ?? profileSource[profileSource.length - 1].time;
    const slice = profileSource.filter((c) => c.time >= from && c.time <= to);
    return computeVolumeProfile(slice, 48);
  }, [vpEnabled, vpRange, profileSource]);

  // Tažením označit rozsah: mouse down → anchor, mouse move → preview,
  // mouse up → potvrzení rozsahu
  const timeAtEvent = useCallback((clientX: number): number | null => {
    const chart = chartRef.current;
    if (!chart) return null;
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    // coordinate → time (bar/spacen index)
    const time = chart.timeScale().coordinateToTime(x);
    return typeof time === "number" ? time : null;
  }, []);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (!vpEnabled) return;
      const t = timeAtEvent(e.clientX);
      if (t == null) return;
      dragState.current.anchor = t;
      setDragPreview({ from: t, to: t });
    },
    [vpEnabled, timeAtEvent]
  );

  const onDragMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragState.current.anchor == null) return;
      const t = timeAtEvent(e.clientX);
      if (t == null) return;
      setDragPreview({
        from: Math.min(dragState.current.anchor, t),
        to: Math.max(dragState.current.anchor, t),
      });
    },
    [timeAtEvent]
  );

  const onDragEnd = useCallback(() => {
    if (dragState.current.anchor == null) return;
    dragState.current.anchor = null;
    if (dragPreview) {
      setVpRange(dragPreview);
    }
    setDragPreview(null);
  }, [dragPreview]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || candles.length === 0) return;

    const hasVolume = visible.volume && !!extras?.volume?.length;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8a93a6",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(138,147,166,0.07)" },
        horzLines: { color: "rgba(138,147,166,0.07)" },
      },
      rightPriceScale: {
        borderColor: "rgba(138,147,166,0.15)",
        scaleMargins: { top: 0.1, bottom: hasVolume ? 0.22 : 0.1 },
      },
      timeScale: {
        borderColor: "rgba(138,147,166,0.15)",
        timeVisible: true,
        secondsVisible: false,
      },
      // Když je aktivní výběr rozsahu VP, zamkneme pan/zoom grafu
      // (jako ve TV při kreslení) – tažení myší pak měří jen rozsah
      handleScroll: !vpEnabled,
      handleScale: !vpEnabled,
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: "cs-CZ" },
    });
    chartRef.current = chart;

    const upColor = "#22ab94";
    const downColor = "#ec5063";

    let mainSeries: ISeriesApi<"Candlestick"> | ISeriesApi<"Area">;
    if (mode === "candles") {
      const series = chart.addSeries(CandlestickSeries, {
        upColor,
        downColor,
        borderVisible: false,
        wickUpColor: upColor,
        wickDownColor: downColor,
      });
      series.setData(
        candles.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );
      mainSeries = series;
    } else {
      // (area mode)
      const series = chart.addSeries(AreaSeries, {
        lineColor: "#5b8def",
        lineWidth: 2,
        topColor: "rgba(91, 141, 239, 0.25)",
        bottomColor: "rgba(91, 141, 239, 0.02)",
      });
      series.setData(
        candles.map((c) => ({
          time: c.time as UTCTimestamp,
          value: c.close,
        }))
      );
      mainSeries = series;
    }
    mainSeriesRef.current = mainSeries;

    // Objemový histogram (vlastní cenová osa dole, přes overlay)
    if (hasVolume) {
      const volSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: "vol",
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      volSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volSeries.setData(
        extras!.volume!.map((v) => ({
          time: v.time as UTCTimestamp,
          value: v.value,
          color:
            v.value > 0
              ? "rgba(34,171,148,0.45)"
              : "rgba(236,80,99,0.45)",
        }))
      );
    }

    // VWAP linka (zlatá, přerušovaná)
    if (visible.vwap && extras?.vwap?.length) {
      chart
        .addSeries(LineSeries, {
          color: "#d4a72c",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        .setData(
          extras.vwap.map((p) => ({
            time: p.time as UTCTimestamp,
            value: p.value,
          }))
        );
    }

    // Průměr období (modrá, tečkovaná)
    if (visible.average && extras?.average != null) {
      mainSeries.createPriceLine({
        price: extras.average,
        color: "#5b8def",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: "Průměr",
      });
    }

    // Max / Min hladiny období
    if (visible.range && extras?.high != null && extras?.low != null) {
      mainSeries.createPriceLine({
        price: extras.high,
        color: "rgba(34,171,148,0.7)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Max",
      });
      mainSeries.createPriceLine({
        price: extras.low,
        color: "rgba(236,80,99,0.7)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Min",
      });
    }

    chart.timeScale().fitContent();

    // Pan/zoom mění pixelové souřadnice → přepočítat overlay VP
    const onRangeChange = () => setVpEpoch((e) => e + 1);
    chart.timeScale().subscribeVisibleTimeRangeChange(onRangeChange);

    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onRangeChange);
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, mode, extras, visible, vpEnabled]);

  // Bump při pan/zoom – přepočítá pixelovou geometrii overlayů
  const [vpEpoch, setVpEpoch] = useState(0);

  // Overlay SVG pro volume profile – pozice binů se váže na pixelové
  // souřadnice cenové osy (přepočet i při pan/zoom přes vpEpoch)
  const [vpGeom, setVpGeom] = useState<{
    top: number;
    bottom: number;
    priceToY: (p: number) => number;
  } | null>(null);

  useEffect(() => {
    const chart = chartRef.current;
    const series = mainSeriesRef.current;
    const container = containerRef.current;
    if (!chart || !series || !container || !profile) {
      setVpGeom(null);
      return;
    }
    const rect = container.getBoundingClientRect();
    // priceToCoordinate je v v5 API na sérii (ne na cenové ose)
    const top = series.priceToCoordinate(profile.maxPrice) ?? 0;
    const bottom = series.priceToCoordinate(profile.minPrice) ?? rect.height;
    setVpGeom({
      top: Math.max(0, top),
      bottom: Math.min(rect.height, bottom),
      priceToY: (p: number) => series.priceToCoordinate(p) ?? rect.height,
    });
  }, [profile, candles, visible, vpEpoch]);

  const vpWidth = 110; // šířka profilu v px (vpravo)
  const maxBin = profile ? Math.max(...profile.bins) : 0;

  // X-souřadnice pásu výběru (preview při tažení / potvrzený rozsah)
  const [bandX, setBandX] = useState<{ x1: number; x2: number } | null>(null);
  const bandRange = dragPreview ?? vpRange;
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !bandRange) {
      setBandX(null);
      return;
    }
    const ts = chart.timeScale();
    const x1 = ts.timeToCoordinate(bandRange.from as UTCTimestamp);
    const x2 = ts.timeToCoordinate(bandRange.to as UTCTimestamp);
    if (x1 == null || x2 == null) {
      setBandX(null);
      return;
    }
    setBandX({ x1: Math.min(x1, x2), x2: Math.max(x1, x2) });
  }, [bandRange, profile, candles, visible, vpEpoch]);

  return (
    <div className="space-y-2">
      {/* Přepínače overlayů */}
      <div className="flex flex-wrap items-center gap-1.5 px-2 pt-2">
        {OVERLAY_META.map((meta) => {
          const available =
            (meta.key === "volume" && !!extras?.volume?.length) ||
            (meta.key === "vwap" && !!extras?.vwap?.length) ||
            (meta.key === "average" && extras?.average != null) ||
            (meta.key === "range" &&
              extras?.high != null &&
              extras?.low != null);
          if (!available) return null;

          return (
            <button
              key={meta.key}
              type="button"
              onClick={() =>
                setVisible((v) => ({ ...v, [meta.key]: !v[meta.key] }))
              }
              className={cn(
                "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                visible[meta.key]
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {meta.label}
            </button>
          );
        })}

        {/* Fixed Range Volume Profile toggle */}
        <div className="ml-auto flex items-center gap-1.5">
          {vpEnabled && profile && (
            <button
              type="button"
              onClick={() => {
                setVpRange(null);
              }}
              title="Resetovat rozsah na celý graf"
              className="rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Celý rozsah
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setVpEnabled((v) => !v);
              if (vpEnabled) setVpRange(null);
            }}
            className={cn(
              "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
              vpEnabled
                ? "border-primary/60 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            Volume Profile
          </button>
        </div>
      </div>

      {/* Nápověda + statistiky profilu */}
      {vpEnabled && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-[11px] text-muted-foreground">
          <span>
            {dragPreview
              ? "Pusť pro měření…"
              : "Tažením myši v grafu vyber rozsah (od–do) pro profil"}
          </span>
          {profile && (
            <span className="flex flex-wrap gap-x-3 font-mono">
              <span>
                POC{" "}
                <span className="text-foreground">
                  {formatPrice(profile.pocPrice)}
                </span>
              </span>
              <span>
                VA{" "}
                <span className="text-foreground">
                  {formatPrice(
                    profile.minPrice + profile.vaLowIndex * profile.binSize
                  )}{" "}
                  –{" "}
                  {formatPrice(
                    profile.minPrice + (profile.vaHighIndex + 1) * profile.binSize
                  )}
                </span>
              </span>
              <span>
                {valueAreaPercent(profile).toFixed(0)} % objemu ve VA ·{" "}
                {formatCompact(profile.totalVolume)} celkem
              </span>
            </span>
          )}
        </div>
      )}

      <div className="relative">
        <div
          ref={containerRef}
          className={cn(
            "w-full rounded-lg",
            vpEnabled && "cursor-crosshair select-none"
          )}
          style={{ height }}
          onMouseDown={onDragStart}
          onMouseMove={onDragMove}
          onMouseUp={onDragEnd}
          onMouseLeave={() => {
            dragState.current.anchor = null;
            setDragPreview(null);
          }}
        />

        {/* SVG overlay – biny profilu, POC linka, Value Area, výběr tažením */}
        {profile && vpGeom && (
          <svg className="pointer-events-none absolute inset-0 size-full">
            {/* Pás vybraného rozsahu (preview tažení / potvrzený rozsah) */}
            {bandX && (
              <g>
                <rect
                  x={bandX.x1}
                  y={0}
                  width={Math.max(2, bandX.x2 - bandX.x1)}
                  height="100%"
                  fill={dragPreview ? "rgba(91,141,239,0.12)" : "rgba(91,141,239,0.05)"}
                />
                <line
                  x1={bandX.x1}
                  x2={bandX.x1}
                  y1={0}
                  y2="100%"
                  stroke="rgba(91,141,239,0.5)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <line
                  x1={bandX.x2}
                  x2={bandX.x2}
                  y1={0}
                  y2="100%"
                  stroke="rgba(91,141,239,0.5)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
              </g>
            )}

            {/* Value Area (70 %) – jemný podklad */}
            <rect
              x={0}
              y={vpGeom.priceToY(
                profile.minPrice + (profile.vaHighIndex + 1) * profile.binSize
              )}
              width="100%"
              height={Math.max(
                1,
                vpGeom.priceToY(profile.minPrice + profile.vaLowIndex * profile.binSize) -
                  vpGeom.priceToY(
                    profile.minPrice + (profile.vaHighIndex + 1) * profile.binSize
                  )
              )}
              fill="rgba(91,141,239,0.05)"
            />

            {/* Biny – horizontal bars anchored to right edge */}
            {profile.bins.map((v, i) => {
              if (v <= 0) return null;
              const yTop = vpGeom.priceToY(
                profile.minPrice + (i + 1) * profile.binSize
              );
              const yBottom = vpGeom.priceToY(
                profile.minPrice + i * profile.binSize
              );
              const barH = Math.max(1, yBottom - yTop - 1);
              const w = (v / maxBin) * vpWidth;
              const inVA = i >= profile.vaLowIndex && i <= profile.vaHighIndex;
              const isPoc = i === profile.pocIndex;
              return (
                <rect
                  key={i}
                  x={0}
                  y={yTop}
                  width={w}
                  height={barH}
                  rx={1.5}
                  fill={
                    isPoc
                      ? "rgba(212,167,44,0.85)"
                      : inVA
                        ? "rgba(91,141,239,0.55)"
                        : "rgba(138,147,166,0.35)"
                  }
                />
              );
            })}

            {/* POC hladina – zlatá */}
            <line
              x1={0}
              x2="100%"
              y1={vpGeom.priceToY(profile.pocPrice)}
              y2={vpGeom.priceToY(profile.pocPrice)}
              stroke="rgba(212,167,44,0.8)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          </svg>
        )}
      </div>
    </div>
  );
}

type PriceChartProps = {
  candles: Candle[];
  /** "candles" = svíčky, "area" = plynulá linie s gradientem */
  mode?: "candles" | "area";
  height?: number;
  extras?: ChartExtras;
  /** Svíčky s objemy pro Fixed Range Volume Profile (1W/1M reálné, intraday proxy). */
  volumeProfile?: Candle[];
};
