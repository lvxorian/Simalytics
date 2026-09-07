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

export type Indicators = {
  sma: LinePoint[];
  ema: LinePoint[];
  bbUpper: LinePoint[];
  bbLower: LinePoint[];
  rsi: LinePoint[];
};

type PriceChartProps = {
  candles: Candle[];
  /** "candles" = svíčky, "area" = plynulá linie s gradientem */
  mode?: "candles" | "area";
  height?: number;
  /** Objemový histogram (jen denní data ze Simco Tools) */
  volume?: VolumePoint[];
  /** VWAP linka (jen denní data) */
  vwap?: LinePoint[];
  /** Předpočítané indikátory ze serveru */
  indicators?: Indicators;
};

const INDICATOR_META = [
  { key: "sma", label: "SMA 20", color: "#d4a72c" },
  { key: "ema", label: "EMA 50", color: "#9d7bde" },
  { key: "bb", label: "Bollinger", color: "#5b8def" },
  { key: "rsi", label: "RSI 14", color: "#22ab94" },
] as const;

type IndicatorKey = (typeof INDICATOR_META)[number]["key"];

/**
 * Financní graf postavený na TradingView Lightweight Charts (v5 API:
 * chart.addSeries(CandlestickSeries, …)). Všechna data čeká na klientu,
 * komponenta je čistě vizuální – čas je UTC unix sekundy.
 * Indikátory se počítají na serveru, tady se jen přepínají.
 */
export function PriceChart({
  candles,
  mode = "candles",
  height = 460,
  volume,
  vwap,
  indicators,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const [visible, setVisible] = useState<Record<IndicatorKey, boolean>>({
    sma: false,
    ema: false,
    bb: false,
    rsi: false,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || candles.length === 0) return;

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
        scaleMargins: {
          top: 0.1,
          bottom: visible.rsi ? 0.3 : volume && volume.length > 0 ? 0.24 : 0.1,
        },
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
    }

    // Objemový histogram (vlastní cenová osa dole)
    if (volume && volume.length > 0) {
      const volSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: "vol",
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      volSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.82, bottom: visible.rsi ? 0.3 : 0 },
      });
      volSeries.setData(
        volume.map((v) => ({
          time: v.time as UTCTimestamp,
          value: v.value,
          color: "rgba(138,147,166,0.35)",
        }))
      );
    }

    // VWAP linka (zlatá, přerušovaná)
    if (vwap && vwap.length > 0) {
      chart.addSeries(LineSeries, {
        color: "#d4a72c",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }).setData(vwap.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    }

    // ── Indikátory ──────────────────────────────────────────────
    const lineSeries: ISeriesApi<"Line">[] = [];
    if (indicators) {
      if (visible.sma && indicators.sma.length > 0) {
        lineSeries.push(
          chart.addSeries(LineSeries, {
            color: "#d4a72c",
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          })
        );
        lineSeries[lineSeries.length - 1].setData(
          indicators.sma.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
        );
      }
      if (visible.ema && indicators.ema.length > 0) {
        lineSeries.push(
          chart.addSeries(LineSeries, {
            color: "#9d7bde",
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          })
        );
        lineSeries[lineSeries.length - 1].setData(
          indicators.ema.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
        );
      }
      if (visible.bb && indicators.bbUpper.length > 0) {
        for (const data of [indicators.bbUpper, indicators.bbLower]) {
          lineSeries.push(
            chart.addSeries(LineSeries, {
              color: "rgba(91, 141, 239, 0.55)",
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
            })
          );
          lineSeries[lineSeries.length - 1].setData(
            data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
          );
        }
      }
    }

    // RSI panel (samostatná cenová osa vpravo dole)
    if (visible.rsi && indicators && indicators.rsi.length > 0) {
      const rsiSeries = chart.addSeries(LineSeries, {
        color: "#22ab94",
        lineWidth: 1,
        priceScaleId: "rsi",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      rsiSeries.setData(
        indicators.rsi.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      );
      rsiSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
      });
      // referenční čáry 70/30
      for (const level of [70, 30]) {
        rsiSeries.createPriceLine({
          price: level,
          color: "rgba(138,147,166,0.4)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
          title: "",
        });
      }
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, mode, volume, vwap, indicators, visible]);

  return (
    <div className="space-y-2">
      {/* Přepínače indikátorů */}
      <div className="flex flex-wrap items-center gap-1.5 px-2 pt-2">
        {INDICATOR_META.map((meta) => (
          <button
            key={meta.key}
            type="button"
            onClick={() =>
              setVisible((v) => ({ ...v, [meta.key]: !v[meta.key] }))
            }
            className={cn(
              "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
              visible[meta.key]
                ? "border-transparent text-background"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
            style={
              visible[meta.key]
                ? { backgroundColor: meta.color, borderColor: meta.color }
                : undefined
            }
          >
            {meta.label}
          </button>
        ))}
      </div>

      <div
        ref={containerRef}
        className="w-full rounded-lg"
        style={{ height }}
      />
    </div>
  );
}
