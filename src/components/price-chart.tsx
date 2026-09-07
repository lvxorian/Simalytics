"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/candles";

type PriceChartProps = {
  candles: Candle[];
  /** "candles" = svíčky, "area" = plynulá linie s gradientem */
  mode?: "candles" | "area";
  height?: number;
};

/**
 * Financální graf postavený na TradingView Lightweight Charts (v5 API:
 * chart.addSeries(CandlestickSeries, …)). Všechna data čekají na klientu,
 * komponenta je čistě vizuální – čísla i čas musí být UTC unix sekundy.
 */
export function PriceChart({
  candles,
  mode = "candles",
  height = 440,
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
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "rgba(139,149,167,0.15)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: "cs-CZ" },
    });
    chartRef.current = chart;

    if (mode === "candles") {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#26a69a",
        downColor: "#ef5350",
        borderVisible: false,
        wickUpColor: "#26a69a",
        wickDownColor: "#ef5350",
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

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, mode]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg"
      style={{ height }}
    />
  );
}
