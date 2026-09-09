"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AreaSeries,
  CrosshairMode,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import { cn } from "@/lib/utils";

type Point = { time: number; value: number };

const fmtValue = new Intl.NumberFormat("cs-CZ", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "narrowSymbol",
  maximumFractionDigits: 0,
});

const fmtDate = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Prague",
});

const PERIODS = [
  { key: "7", label: "7D" },
  { key: "30", label: "30D" },
  { key: "90", label: "90D" },
] as const;

/**
 * Vývoj hodnoty portfolia v čase – area graf (lightweight-charts v5).
 * Odlehčená verze price-chart: žádné nástroje, jen křivka + crosshair
 * cenovka. Data přichází rekonstruovaná po dnech (UTC sekundy).
 */
export function PortfolioValueChart({
  data,
  invested,
}: {
  data: Point[];
  invested: number | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const [hover, setHover] = useState<{ value: number; time: number } | null>(
    null
  );
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("30");

  useEffect(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) return;

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
      },
      timeScale: {
        borderColor: "rgba(138,147,166,0.15)",
        timeVisible: false,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        locale: "cs-CZ",
        priceFormatter: (p: number) => fmtValue.format(p),
      },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineColor: "#5b8def",
      lineWidth: 2,
      topColor: "rgba(91, 141, 239, 0.25)",
      bottomColor: "rgba(91, 141, 239, 0.02)",
      priceFormat: { type: "price", precision: 0, minMove: 1 },
    });
    seriesRef.current = series;

    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      if (param.time == null || !param.point) {
        setHover(null);
        return;
      }
      const d = param.seriesData.get(series);
      const value = d && "value" in d ? Number(d.value) : null;
      if (value == null) {
        setHover(null);
        return;
      }
      setHover({
        value,
        time: (param.time as UTCTimestamp) * 1000,
      });
    };
    chart.subscribeCrosshairMove(onCrosshairMove);

    chart.timeScale().fitContent();

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // period je jen windowing dat – graf se nemusí rekonstruovat
    // (data se nastaví níže), ale jednoduchost vítězí: malý graf.
  }, [data]);

  // Nastav data podle vybraného období (bez rekonstrukce grafu)
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const days = Number(period);
    const cutoff = days * 86400;
    const filtered = data.filter(
      (p) => p.time >= (data[data.length - 1]?.time ?? 0) - cutoff
    );
    series.setData(
      filtered.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
    );
    chartRef.current?.timeScale().fitContent();
  }, [data, period]);

  const shown =
    data.length === 0
      ? null
      : (hover ??
        {
          value: data[data.length - 1].value,
          time: data[data.length - 1].time * 1000,
        });

  const changeAbs =
    data.length > 0
      ? data[data.length - 1].value - data[0].value
      : null;
  const changePct =
    data.length > 0 && data[0].value > 0
      ? ((data[data.length - 1].value - data[0].value) / data[0].value) * 100
      : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {hover ? "Hodnota k datu" : "Aktuální hodnota"}
          </div>
          <div className="font-mono text-xl font-semibold tabular-nums">
            {shown ? fmtValue.format(shown.value) : "–"}
            {shown && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {fmtDate.format(new Date(shown.time))}
              </span>
            )}
          </div>
          {changeAbs !== null && (
            <div
              className={cn(
                "font-mono text-xs tabular-nums",
                changeAbs > 0 && "text-up",
                changeAbs < 0 && "text-down"
              )}
            >
              {changeAbs > 0 ? "+" : changeAbs < 0 ? "−" : ""}
              {fmtValue.format(Math.abs(changeAbs))} za období
              {changePct !== null
                ? ` (${changePct > 0 ? "+" : changePct < 0 ? "−" : ""}${changePct.toFixed(2)} %)`
                : ""}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-full border border-border/80 bg-secondary/40 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={cn(
                "rounded-full px-3 py-1 font-mono text-xs transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                period === p.key
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="h-56 w-full" />

      {invested !== null && invested > 0 && (
        <p className="text-xs text-muted-foreground">
          Pro srovnání: aktuálně investováno{" "}
          <span className="font-mono text-foreground">
            {fmtValue.format(invested)}
          </span>{" "}
          (pořizovací cena držeb) ·{" "}
          <Link href="/positions" className="text-primary hover:underline">
            historie pozic
          </Link>
        </p>
      )}
    </div>
  );
}
