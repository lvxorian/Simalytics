"use client";

import { useEffect, useRef, useState } from "react";
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
 */
export function PriceChart({
  candles,
  mode = "candles",
  height = 460,
  extras,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const [visible, setVisible] = useState<Record<OverlayKey, boolean>>({
    volume: true,
    vwap: false,
    average: false,
    range: false,
  });

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

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, mode, extras, visible]);

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
      </div>

      <div
        ref={containerRef}
        className="w-full rounded-lg"
        style={{ height }}
      />
    </div>
  );
}

type PriceChartProps = {
  candles: Candle[];
  /** "candles" = svíčky, "area" = plynulá linie s gradientem */
  mode?: "candles" | "area";
  height?: number;
  extras?: ChartExtras;
};
