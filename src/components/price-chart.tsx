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
  TickMarkType,
  createChart,
  type Time,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { ChartBarDecreasing, RulerDimensionLine, X } from "lucide-react";
import type { Candle, LinePoint } from "@/lib/candles";
import type { IntervalKey } from "@/lib/candles";
import { CandleCountdown } from "@/components/candle-countdown";
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

// ── Časová pásma – osa a crosshair v pražském čase ──────────────────
// Lightweight Charts vykresluje timestampy doslova (bez konverze pásma),
// takže UTC data by se uživateli jevila o 2 h „zastaralá“. Data držíme
// v UTC (výpočty, agregace, countdown), jen formattery osy převádějí
// na Europe/Prague – Intl zohledňuje letní čas.

const fmtHM = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: "Europe/Prague",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const fmtDayMonth = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: "Europe/Prague",
  day: "numeric",
  month: "numeric",
});
const fmtMonthShort = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: "Europe/Prague",
  month: "short",
});
const fmtYear = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: "Europe/Prague",
  year: "numeric",
});
const fmtDayMonthYear = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: "Europe/Prague",
  day: "numeric",
  month: "numeric",
  year: "numeric",
});

/** Čas osy (unix sekundy) → popisek v pražském čase dle váhy ticku. */
function pragueTickLabel(time: number, tickMarkType: TickMarkType): string {
  const d = new Date(time * 1000);
  switch (tickMarkType) {
    case TickMarkType.Year:
      return fmtYear.format(d);
    case TickMarkType.Month:
      return fmtMonthShort.format(d);
    case TickMarkType.DayOfMonth:
      return fmtDayMonth.format(d);
    default:
      return fmtHM.format(d);
  }
}

/** České skloňování „svíčka“ (1 svíčka, 2–4 svíčky, 5+ svíček). */
function candleWord(n: number): string {
  if (n === 1) return "svíčka";
  const c = n % 100;
  if (c >= 12 && c <= 14) return "svíček";
  switch (n % 10) {
    case 2:
    case 3:
    case 4:
      return "svíčky";
    default:
      return "svíček";
  }
}

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
  intervalKey,
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

  // ── Měřicí pravítko (measure tool à la TradingView) ─────────────
  // Tažení myší = úsečka od–do (snap na svíčky i OHLC); ukáže % změnu,
  // absolutní deltu, délku trvání a počet svíček. Vzájemně se vylučuje
  // s výběrem rozsahu Volume Profile.
  type RulerPoint = { time: number; price: number };
  const [rulerEnabled, setRulerEnabled] = useState(false);
  const [rulerRange, setRulerRange] = useState<{
    a: RulerPoint;
    b: RulerPoint;
  } | null>(null);
  const [rulerPreview, setRulerPreview] = useState<{
    a: RulerPoint;
    b: RulerPoint;
  } | null>(null);
  const rulerAnchor = useRef<RulerPoint | null>(null);
  // Aktivní měření: preview při tažení má přednost, pak potvrzený rozsah
  const rulerActive = rulerEnabled ? (rulerPreview ?? rulerRange) : null;

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

  const priceAtEvent = useCallback((clientY: number): number | null => {
    const series = mainSeriesRef.current;
    const container = containerRef.current;
    if (!series || !container) return null;
    const rect = container.getBoundingClientRect();
    const price = series.coordinateToPrice(clientY - rect.top);
    return typeof price === "number" ? price : null;
  }, []);

  // Snap času na nejbližší svíčku (mřížka bucketů z lib/candles)
  const snapTime = useCallback(
    (t: number): number => {
      if (candles.length === 0) return t;
      let lo = 0;
      let hi = candles.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (candles[mid].time < t) lo = mid + 1;
        else hi = mid;
      }
      const cand = candles[lo];
      const prev = candles[Math.max(0, lo - 1)];
      return Math.abs(prev.time - t) <= Math.abs(cand.time - t)
        ? prev.time
        : cand.time;
    },
    [candles]
  );

  // Snap ceny na OHLC svíčky u kliknutého času (± 12 px tolerance)
  const snapPrice = useCallback(
    (t: number, p: number): number => {
      const series = mainSeriesRef.current;
      const c = candles.find((x) => x.time === t);
      if (!series || !c) return p;
      const yP = series.priceToCoordinate(p);
      if (yP == null) return p;
      let best = p;
      let bestD = 12;
      for (const v of [c.open, c.high, c.low, c.close]) {
        const y = series.priceToCoordinate(v);
        if (y == null) continue;
        const d = Math.abs(y - yP);
        if (d <= bestD) {
          bestD = d;
          best = v;
        }
      }
      return best;
    },
    [candles]
  );

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      // Pravítko má přednost před výběrem rozsahu VP
      if (rulerEnabled) {
        const t = timeAtEvent(e.clientX);
        const p = priceAtEvent(e.clientY);
        if (t == null || p == null) return;
        const st = snapTime(t);
        const a = { time: st, price: snapPrice(st, p) };
        rulerAnchor.current = a;
        setRulerPreview({ a, b: a });
        return;
      }
      if (!vpEnabled) return;
      const t = timeAtEvent(e.clientX);
      if (t == null) return;
      dragState.current.anchor = t;
      setDragPreview({ from: t, to: t });
    },
    [rulerEnabled, vpEnabled, timeAtEvent, priceAtEvent, snapTime, snapPrice]
  );

  const onDragMove = useCallback(
    (e: React.MouseEvent) => {
      if (rulerAnchor.current != null) {
        const t = timeAtEvent(e.clientX);
        const p = priceAtEvent(e.clientY);
        if (t == null || p == null) return;
        const st = snapTime(t);
        setRulerPreview({
          a: rulerAnchor.current,
          b: { time: st, price: snapPrice(st, p) },
        });
        return;
      }
      if (dragState.current.anchor == null) return;
      const t = timeAtEvent(e.clientX);
      if (t == null) return;
      setDragPreview({
        from: Math.min(dragState.current.anchor, t),
        to: Math.max(dragState.current.anchor, t),
      });
    },
    [timeAtEvent, priceAtEvent, snapTime, snapPrice]
  );

  const onDragEnd = useCallback(() => {
    if (rulerAnchor.current != null) {
      rulerAnchor.current = null;
      if (rulerPreview) setRulerRange(rulerPreview);
      setRulerPreview(null);
      return;
    }
    if (dragState.current.anchor == null) return;
    dragState.current.anchor = null;
    if (dragPreview) {
      setVpRange(dragPreview);
    }
    setDragPreview(null);
  }, [dragPreview, rulerPreview]);

  // Výpočet měření pravítkem: % změna, abs. delta, délka trvání, počet svíček
  const rulerMeasure = useMemo(() => {
    if (!rulerActive) return null;
    const { a, b } = rulerActive;
    const delta = b.price - a.price;
    const pct = a.price !== 0 ? (delta / a.price) * 100 : null;
    const sec = Math.abs(b.time - a.time);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const dur =
      d > 0
        ? `${d} d ${h} h`
        : h > 0
          ? `${h} h ${m} min`
          : m > 0
            ? `${m} min ${s} s`
            : `${s} s`;
    // počet svíček = rozdíl indexů v datech grafu (body jsou snapnuté)
    let count = 0;
    if (candles.length > 0) {
      const idx = (t: number) => {
        let lo = 0;
        let hi = candles.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (candles[mid].time < t) lo = mid + 1;
          else hi = mid;
        }
        return lo;
      };
      count = Math.abs(idx(b.time) - idx(a.time));
    }
    return {
      up: delta >= 0,
      delta,
      pct,
      dur,
      count,
      countLabel: `${count} ${candleWord(count)}`,
    };
  }, [rulerActive, candles]);

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
        // Osa v pražském čase (data jsou UTC, formattery převádějí)
        tickMarkFormatter: (
          time: Time,
          tickMarkType: TickMarkType
        ) => pragueTickLabel(time as number, tickMarkType),
      },
      // Když je aktivní nástroj (výběr rozsahu VP nebo pravítko), zamkneme
      // pan/zoom grafu (jako ve TV při kreslení) – tažení myší pak měří
      handleScroll: !vpEnabled && !rulerEnabled,
      handleScale: !vpEnabled && !rulerEnabled,
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        locale: "cs-CZ",
        // Crosshair label – denní+ TF jen datum, intraday i s časem (Praha)
        timeFormatter: (time: Time) => {
          const d = new Date((time as number) * 1000);
          const dailyOnly =
            intervalKey === "1d" || intervalKey === "1w" || intervalKey === "1M";
          return dailyOnly
            ? fmtDayMonthYear.format(d)
            : `${fmtDayMonth.format(d)} ${fmtHM.format(d)}`;
        },
      },
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
  }, [candles, mode, extras, visible, vpEnabled, rulerEnabled, intervalKey]);

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

  // Pixelová geometrie pravítka (čáry + badge) – přepočet i při pan/zoom
  const [rulerGeom, setRulerGeom] = useState<{
    ax: number;
    ay: number;
    bx: number;
    by: number;
    width: number;
  } | null>(null);
  useEffect(() => {
    const chart = chartRef.current;
    const series = mainSeriesRef.current;
    const container = containerRef.current;
    if (!chart || !series || !container || !rulerActive) {
      setRulerGeom(null);
      return;
    }
    const ts = chart.timeScale();
    const rect = container.getBoundingClientRect();
    const ax = ts.timeToCoordinate(rulerActive.a.time as UTCTimestamp);
    const bx = ts.timeToCoordinate(rulerActive.b.time as UTCTimestamp);
    const ay = series.priceToCoordinate(rulerActive.a.price);
    const by = series.priceToCoordinate(rulerActive.b.price);
    if (ax == null || bx == null || ay == null || by == null) {
      setRulerGeom(null);
      return;
    }
    setRulerGeom({ ax, ay, bx, by, width: rect.width });
  }, [rulerActive, candles, visible, vpEpoch, vpEnabled]);

  // Esc ruší aktivní měření pravítkem i výběr rozsahu VP
  useEffect(() => {
    if (!rulerEnabled && !vpEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        rulerAnchor.current = null;
        setRulerPreview(null);
        setRulerRange(null);
        setVpRange(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rulerEnabled, vpEnabled]);

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

        {/* Nástroje grafu žijí ve svislé liště u levého okraje (viz níže) */}
        <div className="ml-auto flex items-center gap-1.5">
          {intervalKey && <CandleCountdown intervalKey={intervalKey} />}
        </div>
      </div>

      {/* Nápověda pravítka */}
      {rulerEnabled && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-[11px] text-muted-foreground">
          <span>
            {rulerPreview
              ? "Pusť pro měření…"
              : "Tažením myši v grafu změř změnu ceny a čas (Esc = zrušit měření)"}
          </span>
        </div>
      )}

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
        {/* Nástrojová lišta à la TradingView – svislá, u levého okraje grafu.
            Je sourozencem chart containeru, takže kliky na ni nespouštějí
            drag/měření v grafu. */}
        <div className="absolute left-2 top-2 z-20 flex flex-col items-center gap-1 rounded-lg border border-border/80 bg-card/90 p-1 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => {
              const next = !vpEnabled;
              setVpEnabled(next);
              if (next) setRulerEnabled(false); // vzájemná výlučka s pravítkem
              setVpRange(null);
            }}
            title="Fixed Range Volume Profile – tažením vyber rozsah"
            aria-label="Fixed Range Volume Profile"
            aria-pressed={vpEnabled}
            className={cn(
              "flex size-8 items-center justify-center rounded-md transition-colors",
              vpEnabled
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <ChartBarDecreasing className="size-[18px]" />
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !rulerEnabled;
              setRulerEnabled(next);
              if (next) {
                // vzájemná výlučka: pravítko vypne výběr rozsahu VP
                setVpEnabled(false);
                setVpRange(null);
                setRulerRange(null);
                setRulerPreview(null);
              }
            }}
            title="Pravítko – změř změnu ceny a čas tažením v grafu"
            aria-label="Pravítko (měření)"
            aria-pressed={rulerEnabled}
            className={cn(
              "flex size-8 items-center justify-center rounded-md transition-colors",
              rulerEnabled
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <RulerDimensionLine className="size-[18px]" />
          </button>
          {((vpEnabled && vpRange != null) ||
            (rulerEnabled && rulerRange != null)) && (
            <>
              <div className="h-px w-6 bg-border" />
              <button
                type="button"
                onClick={() => {
                  if (rulerEnabled) {
                    setRulerRange(null);
                    setRulerPreview(null);
                  }
                  if (vpEnabled) setVpRange(null);
                }}
                title="Vymazat měření (nebo Esc)"
                aria-label="Vymazat měření"
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-[18px]" />
              </button>
            </>
          )}
        </div>
        <div
          ref={containerRef}
          className={cn(
            "w-full rounded-lg",
            (vpEnabled || rulerEnabled) && "cursor-crosshair select-none"
          )}
          style={{ height }}
          onMouseDown={onDragStart}
          onMouseMove={onDragMove}
          onMouseUp={onDragEnd}
          onMouseLeave={() => {
            dragState.current.anchor = null;
            setDragPreview(null);
            rulerAnchor.current = null;
            setRulerPreview(null);
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

        {/* Overlay pravítka – pás, hladiny, úsečka se šipkou + badge s měřením */}
        {rulerGeom && rulerActive && rulerMeasure && (
          <>
            <svg className="pointer-events-none absolute inset-0 size-full">
              {/* svislé čáry na obou bodech */}
              <line x1={rulerGeom.ax} x2={rulerGeom.ax} y1={0} y2="100%" stroke="rgba(91,141,239,0.35)" strokeWidth={1} strokeDasharray="3 3" />
              <line x1={rulerGeom.bx} x2={rulerGeom.bx} y1={0} y2="100%" stroke="rgba(91,141,239,0.35)" strokeWidth={1} strokeDasharray="3 3" />
              {/* vodorovné hladiny obou cen */}
              <line x1={0} x2="100%" y1={rulerGeom.ay} y2={rulerGeom.ay} stroke="rgba(91,141,239,0.35)" strokeWidth={1} strokeDasharray="3 3" />
              <line x1={0} x2="100%" y1={rulerGeom.by} y2={rulerGeom.by} stroke="rgba(91,141,239,0.35)" strokeWidth={1} strokeDasharray="3 3" />
              {/* pás od–do (zelený při růstu, červený při poklesu) */}
              <rect
                x={Math.min(rulerGeom.ax, rulerGeom.bx)}
                y={Math.min(rulerGeom.ay, rulerGeom.by)}
                width={Math.max(2, Math.abs(rulerGeom.bx - rulerGeom.ax))}
                height={Math.max(2, Math.abs(rulerGeom.by - rulerGeom.ay))}
                fill={rulerMeasure.up ? "rgba(34,171,148,0.10)" : "rgba(236,80,99,0.10)"}
              />
              {/* úsečka + počáteční bod */}
              <line
                x1={rulerGeom.ax}
                y1={rulerGeom.ay}
                x2={rulerGeom.bx}
                y2={rulerGeom.by}
                stroke={rulerMeasure.up ? "#22ab94" : "#ec5063"}
                strokeWidth={1.5}
              />
              <circle cx={rulerGeom.ax} cy={rulerGeom.ay} r={3} fill={rulerMeasure.up ? "#22ab94" : "#ec5063"} />
              {/* šipka na konci (nebo tečka při krátkém tahu) */}
              {(() => {
                const dx = rulerGeom.bx - rulerGeom.ax;
                const dy = rulerGeom.by - rulerGeom.ay;
                const col = rulerMeasure.up ? "#22ab94" : "#ec5063";
                if (Math.hypot(dx, dy) < 14) {
                  return <circle cx={rulerGeom.bx} cy={rulerGeom.by} r={3} fill={col} />;
                }
                const ang = Math.atan2(dy, dx);
                const p1 = `${rulerGeom.bx + 9 * Math.cos(ang + Math.PI - 0.45)},${rulerGeom.by + 9 * Math.sin(ang + Math.PI - 0.45)}`;
                const p2 = `${rulerGeom.bx + 9 * Math.cos(ang + Math.PI + 0.45)},${rulerGeom.by + 9 * Math.sin(ang + Math.PI + 0.45)}`;
                return <polygon points={`${rulerGeom.bx},${rulerGeom.by} ${p1} ${p2}`} fill={col} />;
              })()}
            </svg>
            {/* badge s měřením – přilepený na koncový bod, překlápí se u kraje */}
            {(() => {
              const flipX = rulerGeom.bx + 190 > rulerGeom.width;
              const px = flipX ? rulerGeom.bx - 12 : rulerGeom.bx + 12;
              const py = Math.min(Math.max(rulerGeom.by - 10, 8), height - 96);
              return (
                <div
                  className="pointer-events-none absolute z-10 w-max max-w-56 rounded-lg border border-border/80 bg-popover/95 px-3 py-2 font-mono text-[11px] shadow-lg backdrop-blur"
                  style={{
                    left: px,
                    top: py,
                    transform: flipX ? "translateX(-100%)" : undefined,
                  }}
                >
                  <div
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      rulerMeasure.up ? "text-up" : "text-down"
                    )}
                  >
                    {rulerMeasure.pct != null
                      ? `${rulerMeasure.pct > 0 ? "+" : ""}${rulerMeasure.pct.toFixed(2)} %`
                      : "–"}
                  </div>
                  <div className="mt-1 space-y-0.5 text-muted-foreground">
                    <div>
                      {formatPrice(rulerActive.a.price)} →{" "}
                      {formatPrice(rulerActive.b.price)}
                    </div>
                    <div className="tabular-nums">
                      Δ {rulerMeasure.delta > 0 ? "+" : ""}
                      {formatPrice(rulerMeasure.delta)}
                    </div>
                    <div className="tabular-nums">
                      {rulerMeasure.dur} · {rulerMeasure.countLabel}
                    </div>
                  </div>
                </div>
              );
            })()}
          </>
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
  /** TF pro odpočet do zavření svíčky (nepovinný – bez něj se countdown nezobrazí). */
  intervalKey?: IntervalKey;
};
