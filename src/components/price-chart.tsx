"use client";

import { useEffect, useRef } from "react";
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
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/candles";

export type VolumePoint = { time: number; value: number };
export type LinePoint = { time: number; value: number };

type PriceChartProps = {
  candles: Candle[];
  /** "candles" = svíčky, "area" = plynulá linie s gradientem */
  mode?: "candles" | "area";
  height?: number;
  /** Objemový histogram (jen denní data ze Simco Tools) */
  volume?: VolumePoint[];
  /** VWAP linka (jen denní data) */
  vwap?: LinePoint[];
};

/**
 * Financální graf postavený na TradingView Lightweight Charts (v5 API:
 * chart.addSeries(CandlestickSeries, …)). Všechna data čekají na klientu,
 * komponenta je čistě vizuální – čas je UTC unix sekundy.
 */
export function PriceChart({
  candles,
  mode = "candles",
  height = 460,
  volume,
  vwap,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || candles.length === 0) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b95a7",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(139,149,167,0.08)" },
        horzLines: { color: "rgba(139,149,167,0.08)" },
      },
      rightPriceScale: {
        borderColor: "rgba(139,149,167,0.15)",
        scaleMargins: { top: 0.1, bottom: volume && volume.length > 0 ? 0.24 : 0.1 },
      },
      timeScale: {
        borderColor: "rgba(139,149,167,0.15)",
        timeVisible: mode === "area" || true,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: "cs-CZ" },
    });
    chartRef.current = chart;

    const upColor = "#26a69a";
    const downColor = "#ef5350";

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
        lineColor: "#22d3ee",
        lineWidth: 2,
        topColor: "rgba(34, 211, 238, 0.25)",
        bottomColor: "rgba(34, 211, 238, 0.02)",
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
        scaleMargins: { top: 0.82, bottom: 0 },
      });
      volSeries.setData(
        volume.map((v) => ({
          time: v.time as UTCTimestamp,
          value: v.value,
          color: "rgba(139,149,167,0.35)",
        }))
      );
    }

    // VWAP linka (jantarová, přerušovaná)
    if (vwap && vwap.length > 0) {
      const vwapSeries = chart.addSeries(LineSeries, {
        color: "#f5a623",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      vwapSeries.setData(
        vwap.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      );
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, mode, volume, vwap]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg"
      style={{ height }}
    />
  );
}
