"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  type LogicalRange,
  type MouseEventParams,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  ChartBarDecreasing,
  Maximize2,
  Minimize2,
  RulerDimensionLine,
  Trash2,
  X,
} from "lucide-react";
import type { Candle, LinePoint } from "@/lib/candles";
import type { IntervalKey } from "@/lib/candles";
import { ChangeBadge } from "@/components/change-badge";
import { CandleCountdown } from "@/components/candle-countdown";
import {
  computeVolumeProfile,
  valueAreaPercent,
  type VolumeProfile,
} from "@/lib/volume-profile";
import { formatCompact, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChartContextMenu } from "@/components/chart-context-menu";
import { ItemIcon } from "@/components/item-icon";
import { ChartAlertLines } from "@/components/chart-alert-lines";
import {
  deleteAlertAction,
  updateAlertThresholdAction,
} from "@/app/actions";

export type IntervalSwitch = {
  key: IntervalKey;
  label: string;
  href: string;
};

export type AlertLineAlert = {
  id: string;
  kind: "price" | "score" | "limit_sell";
  direction: "above" | "below";
  threshold: number;
  active: boolean;
};

export type VolumePoint = { time: number; value: number };

/** Výsledek pravého kliknutí do grafu (pro vytvoření alertu). */
export type ChartContextMenuPayload = {
  /** Cena v místě kliknutí (snap na OHLC, jako u pravítka). */
  price: number | null;
  /** Unix sekundy – čas svíčky pod kurzorem. */
  time: number | null;
};

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
  itemId,
  itemName,
  itemImageUrl,
  currentPrice,
  change24h,
  itemTicker,
  alerts,
  intervalSwitches,
  modeSwitches,
}: PriceChartProps) {
  const router = useRouter();
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
  // VP à la TradingView: ikona nástroje jen ODEMČE kreslení; po tažení se
  // objekt PřIPNE (zůstává při pan/zoom) a nástroj se sám deaktivuje.
  const [vpTool, setVpTool] = useState(false);
  // Připnutý VP objekt je vybraný → u něj vyjede koš
  const [vpSelected, setVpSelected] = useState(false);
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
  // Zrcadlo pro uzávěr onRangeChange (viz výše) – aktualizace při renderu,
  // ať ref nikdy nezůstane zastaralý
  const rulerActiveRef = useRef<{ a: RulerPoint; b: RulerPoint } | null>(null);
  rulerActiveRef.current = rulerActive;

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
    if (!vpRange || profileSource.length === 0) return null;
    const slice = profileSource.filter(
      (c) => c.time >= vpRange.from && c.time <= vpRange.to
    );
    return computeVolumeProfile(slice, 48);
  }, [vpRange, profileSource]);

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
      if (!vpTool) return;
      setVpSelected(false); // nová kresba = zrušit výběr starého objektu
      const t = timeAtEvent(e.clientX);
      if (t == null) return;
      dragState.current.anchor = t;
      setDragPreview({ from: t, to: t });
    },
    [rulerEnabled, vpTool, timeAtEvent, priceAtEvent, snapTime, snapPrice]
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
    if (dragPreview && dragPreview.from !== dragPreview.to) {
      // Připnutí objektu + automatické deaktivování nástroje (jako ve TV)
      setVpRange(dragPreview);
      setVpTool(false);
      setVpSelected(true);
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
      // Zámek pan/zoom se řídí v applyOptions efektu níže – změna nástroje
      // nesmí rekonstruovat graf (zrušilo by to přiblížení)
      handleScroll: true,
      handleScale: true,
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
        priceFormat: { type: "price", precision: 3, minMove: 0.001 },
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
        priceFormat: { type: "price", precision: 3, minMove: 0.001 },
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

    // Plovoucí cenovka u přichyceného bodu (jen režim Linie) – ukáže cenu
    // bodu, na který se crosshair přichytil
    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      if (mode !== "area" || param.time == null || !param.point) {
        setLineHover(null);
        return;
      }
      const data = param.seriesData.get(mainSeries);
      const value = data && "value" in data ? Number(data.value) : null;
      if (value == null) {
        setLineHover(null);
        return;
      }
      const x = chart.timeScale().timeToCoordinate(param.time as UTCTimestamp);
      const y = mainSeries.priceToCoordinate(value);
      if (x == null || y == null) {
        setLineHover(null);
        return;
      }
      setLineHover({ x, y, price: value });
    };
    chart.subscribeCrosshairMove(onCrosshairMove);

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

    // Obnova přiblížení po rekonstrukci grafu (přepnutí overlaye/nástroje,
    // auto-refresh dat) – jinak by se graf pokaždé roztáhl na celou šířku.
    // Změna timeframu záměrně znovu fitne obsah.
    if (prevIntervalRef.current !== intervalKey) {
      savedLogicalRange.current = null;
      prevIntervalRef.current = intervalKey;
    }
    if (savedLogicalRange.current) {
      chart.timeScale().setVisibleLogicalRange(savedLogicalRange.current);
    } else {
      chart.timeScale().fitContent();
    }

    // Pan/zoom: přemalovat VP canvas hned teď (plynulé fitování jako
    // ve TradingView) + uložit logický rozsah pro obnovu zoomu.
    // Alert linky se přepočítají taky – drží cenu, ne pixel.
    const onRangeChange = (range: LogicalRange | null) => {
      if (range) {
        savedLogicalRange.current = { from: range.from, to: range.to };
      }
      vpDrawRef.current();
      alertDrawRef.current();
      // SVG overlay pravítka potřebuje React re-render jen když běží měření
      if (rulerActiveRef.current) setVpEpoch((e) => e + 1);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, mode, extras, visible, intervalKey]);

  // Bump při pan/zoom – přepočítá pixelovou geometrii SVG overlayů
  // (pravítko); VP canvas se kreslí imperativně přes vpDrawRef
  const [vpEpoch, setVpEpoch] = useState(0);
  // Šířka containeru grafu v px – pro výpočet šířky cenové osy (alert
  // popisek se má nalepit přesně na oddělovací čáru osy). ResizeObserver
  // ji aktualizuje i při fullscreen přepnutí.
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const vpDrawRef = useRef<() => void>(() => {});
  // Imperativní draw alert linek – registruje ChartAlertLines, volá
  // onRangeChange při zoom/pan (linka drží cenu, ne pixel)
  const alertDrawRef = useRef<() => void>(() => {});
  // Plovoucí cenovka v režimu Linie – cena bodu pod crosshairem
  const [lineHover, setLineHover] = useState<{
    x: number;
    y: number;
    price: number;
  } | null>(null);
  // Uložený logický rozsah (bar indexy) – zoom přežije rekonstrukci grafu
  const savedLogicalRange = useRef<{ from: number; to: number } | null>(null);
  const prevIntervalRef = useRef(intervalKey);

  // Nástroje VP/pravítko: jen během AKTIVNÍHO kreslení se vypne pan tažením
  // (kolečko/pinch zoomují vždy). Připnutý VP objekt pan/zoomu nebrání –
  // profil se přemalovává synchronně, takže fituje plynule jako ve TV.
  useEffect(() => {
    const drawing = vpTool || rulerEnabled;
    chartRef.current?.applyOptions({
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: !drawing,
        horzTouchDrag: !drawing,
        vertTouchDrag: !drawing,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: !drawing,
        axisDoubleClickReset: true,
      },
    });
  }, [vpTool, rulerEnabled]);

  // ── Kontextová nabídka (pravé tlačítko) → Nastavit alert ─────────
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    price: number | null;
    time: number | null;
  } | null>(null);
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  // ── Fullscreen režim grafu ───────────────────────────────────────
  // Overlay přes celé okno – graf se NESMÍ rekonstruovat (rozbilo by to
  // zoom i nástroje), takže se container jen přemístí do overlaye přes
  // appendChild a po zavření vrátí zpět. Esc ruší nejdřív aktivní
  // měření/rozsah, pak zavře fullscreen.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const originalParentRef = useRef<HTMLDivElement | null>(null);
  const fullscreenRef = useRef<HTMLDivElement | null>(null);

  const onChartContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const price = priceAtEvent(e.clientY);
      const rawTime = timeAtEvent(e.clientX);
      const time = rawTime == null ? null : snapTime(rawTime);
      const rect = containerRef.current?.getBoundingClientRect();
      setCtxMenu({
        // pozice v rámci wrapperu (menu je absolutní uvnitř relativního divu)
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
        price,
        time,
      });
    },
    [priceAtEvent, snapTime, timeAtEvent]
  );
  // right-click = drag begin pro VP/pravítko? Ne – onMouseDown nerozlišuje
  // tlačítka; tažení za pravé tlačítko nechceme, takže drag jen když button===0
  const onChartMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) {
        e.preventDefault();
        return;
      }
      if (rulerEnabled || vpTool) {
        onDragStart(e);
        return;
      }
      // Nástroj neaktivní: klik na připnutý VP objekt ho vybere (vyjede
      // koš), klik mimo ho odvybere. Pan/zoom běží normálně.
      const chart = chartRef.current;
      const rect = containerRef.current?.getBoundingClientRect();
      if (vpRange && chart && rect) {
        const x = e.clientX - rect.left;
        const x1 = chart.timeScale().timeToCoordinate(vpRange.from as UTCTimestamp);
        const x2 = chart.timeScale().timeToCoordinate(vpRange.to as UTCTimestamp);
        const hit =
          x1 != null && x2 != null &&
          x >= Math.min(x1, x2) && x <= Math.max(x1, x2);
        setVpSelected(hit);
      } else if (vpSelected) {
        setVpSelected(false);
      }
    },
    [onDragStart, rulerEnabled, vpTool, vpRange, vpSelected]
  );

  // Přemístění chart wrapperu do fullscreen overlaye a zpět – zachová
  // živou instanci grafu (zoom, nástroje, overlaye). Graf se nikdy
  // neRe-mountuje, jen mění DOM rodiče.
  useEffect(() => {
    const host = chartHostRef.current;
    const original = originalParentRef.current;
    if (!host) return;
    if (isFullscreen && host.parentElement !== fullscreenRef.current) {
      fullscreenRef.current?.appendChild(host);
      document.body.style.overflow = "hidden";
    } else if (!isFullscreen && original && host.parentElement !== original) {
      original.appendChild(host);
      document.body.style.overflow = "";
    }
    // přepočítat pixelovou geometrii overlayů po změně velikosti
    requestAnimationFrame(() => setVpEpoch((e) => e + 1));
    return () => {
      document.body.style.overflow = "";
    };
  }, [isFullscreen]);

  // ── VP overlay: imperativní canvas místo React/SVG ──────────────
  // SVG overlay se přemalovával přes React state (vpEpoch) – během
  // zoomu to sekalo. Canvas se přemalovává synchronně v onRangeChange
  // i v efektech, takže profil fituje plynule jako ve TradingView.
  const vpCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Plovoucí koš u vybraného VP objektu – pozice se nastavuje imperativně
  // v drawVp (žádný React re-render během zoomu)
  const vpTrashRef = useRef<HTMLButtonElement | null>(null);
  const profileRef = useRef(profile);
  const vpRangeRef = useRef(vpRange);
  const dragPreviewRef = useRef(dragPreview);
  const profileSourceRef = useRef(profileSource);
  const vpSelectedRef = useRef(vpSelected);

  const drawVp = useCallback(() => {
    const canvas = vpCanvasRef.current;
    const chart = chartRef.current;
    const series = mainSeriesRef.current;
    const container = containerRef.current;
    if (!canvas || !chart || !series || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (
      canvas.width !== Math.round(w * dpr) ||
      canvas.height !== Math.round(h * dpr)
    ) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const prof = profileRef.current;
    const ts = chart.timeScale();

    // Pás rozsahu (preview tažení / připnutý objekt) + vizuál výběru.
    // Musí běžet i když prof == null (po smazání), ať se koš schová.
    const band = dragPreviewRef.current ?? vpRangeRef.current;
    const selected = vpSelectedRef.current && !dragPreviewRef.current;
    let bandL: number | null = null;
    let bandR: number | null = null;
    if (band) {
      const bx1 = ts.timeToCoordinate(band.from as UTCTimestamp);
      const bx2 = ts.timeToCoordinate(band.to as UTCTimestamp);
      if (bx1 != null && bx2 != null) {
        bandL = Math.min(bx1, bx2);
        bandR = Math.max(bx1, bx2);
        ctx.fillStyle = dragPreviewRef.current
          ? "rgba(91,141,239,0.12)"
          : selected
            ? "rgba(91,141,239,0.10)"
            : "rgba(91,141,239,0.05)";
        ctx.fillRect(bandL, 0, Math.max(2, bandR - bandL), h);
        // Rámec objektu: vybraný = plná primary linka + úchopy (jako ve TV)
        ctx.strokeStyle = selected
          ? "rgba(91,141,239,0.95)"
          : "rgba(91,141,239,0.5)";
        ctx.lineWidth = selected ? 1.5 : 1;
        if (!selected) ctx.setLineDash([3, 3]);
        ctx.strokeRect(
          bandL + 0.5,
          4.5,
          Math.max(2, bandR - bandL) - 1,
          h - 9
        );
        ctx.setLineDash([]);
        if (selected) {
          ctx.fillStyle = "#5b8def";
          ctx.fillRect(bandL - 3, 1, 7, 7);
          ctx.fillRect(bandR - 4, 1, 7, 7);
        }
      }
    }
    // Koš u vybraného objektu – pozice imperativně, sedí i během zoomu
    const trash = vpTrashRef.current;
    if (trash) {
      if (selected && bandL != null && bandR != null) {
        trash.style.display = "flex";
        trash.style.left = `${Math.round((bandL + bandR) / 2)}px`;
      } else {
        trash.style.display = "none";
      }
    }
    if (!prof) return;

    // X-oblast profilu: vybraný rozsah (nebo celá šířka dat)
    const src = profileSourceRef.current;
    const from = vpRangeRef.current?.from ?? src[0]?.time;
    const to = vpRangeRef.current?.to ?? src[src.length - 1]?.time;
    if (from == null || to == null) return;
    const x1 = ts.timeToCoordinate(from as UTCTimestamp) ?? 0;
    const x2 = ts.timeToCoordinate(to as UTCTimestamp) ?? w;
    const areaL = Math.min(x1, x2);
    const areaR = Math.max(x1, x2);

    // Value Area (70 %) – jemný podklad
    const yVaTop = series.priceToCoordinate(
      prof.minPrice + (prof.vaHighIndex + 1) * prof.binSize
    );
    const yVaBottom = series.priceToCoordinate(
      prof.minPrice + prof.vaLowIndex * prof.binSize
    );
    if (yVaTop != null && yVaBottom != null) {
      ctx.fillStyle = "rgba(91,141,239,0.05)";
      ctx.fillRect(
        areaL,
        yVaTop,
        Math.max(2, areaR - areaL),
        Math.max(1, yVaBottom - yVaTop)
      );
    }

    // Biny – horizontální bary od levého okraje pásu (jako ve TV)
    const maxBin = Math.max(...prof.bins);
    if (maxBin <= 0) return;
    const areaW = Math.max(2, areaR - areaL);
    for (let i = 0; i < prof.bins.length; i++) {
      const v = prof.bins[i];
      if (v <= 0) continue;
      const yTop = series.priceToCoordinate(
        prof.minPrice + (i + 1) * prof.binSize
      );
      const yBottom = series.priceToCoordinate(
        prof.minPrice + i * prof.binSize
      );
      if (yTop == null || yBottom == null) continue;
      ctx.fillStyle =
        i === prof.pocIndex
          ? "rgba(212,167,44,0.85)"
          : i >= prof.vaLowIndex && i <= prof.vaHighIndex
            ? "rgba(91,141,239,0.55)"
            : "rgba(138,147,166,0.35)";
      ctx.fillRect(areaL, yTop, (v / maxBin) * areaW, Math.max(1, yBottom - yTop - 1));
    }

    // POC hladina – zlatá
    const yPoc = series.priceToCoordinate(prof.pocPrice);
    if (yPoc != null) {
      ctx.strokeStyle = "rgba(212,167,44,0.8)";
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(areaL, yPoc + 0.5);
      ctx.lineTo(areaR, yPoc + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, []);

  // Synchronizace refů + překreslení při změně dat/stavu; zároveň
  // zaregistruje aktuální draw pro uzávěr onRangeChange
  useEffect(() => {
    vpDrawRef.current = drawVp;
    profileRef.current = profile;
    vpRangeRef.current = vpRange;
    dragPreviewRef.current = dragPreview;
    profileSourceRef.current = profileSource;
    vpSelectedRef.current = vpSelected;
    drawVp();
  }, [
    profile,
    vpRange,
    dragPreview,
    profileSource,
    vpSelected,
    candles,
    visible,
    mode,
    vpEpoch,
    drawVp,
  ]);

  // Změna velikosti containeru (fullscreen, okno) – překreslit canvas
  // a aktualizovat šířku pro výpočet cenové osy (alert popisky)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setContainerWidth(container.getBoundingClientRect().width);
      drawVp();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [drawVp]);

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
  }, [rulerActive, candles, visible, vpEpoch]);

  // Klávesové zkratky:
  // Esc – nejdřív deaktivuj nástroj / zruš měření, pak odvyber objekt,
  //       ve fullscreen pak minimalizuje graf. Připnutý VP objekt Esc
  //       nemaže (jen odvybere) – mazání je na koši.
  // F   – zapne fullscreen; ve fullscreen se F ignoruje (minimalizovat
  //       jde jen Esc nebo tlačítkem), ať náhodou nevyskočíš z grafu
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") {
        // Ve fullscreen F ignorujeme – minimalizace jen Esc/tlačítkem
        if (isFullscreen) return;
        const target = e.target as HTMLElement | null;
        const typing =
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable);
        if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          setIsFullscreen(true);
        }
        return;
      }
      if (e.key !== "Escape") return;
      if (vpTool || rulerEnabled) {
        rulerAnchor.current = null;
        setRulerPreview(null);
        setRulerRange(null);
        setVpTool(false);
        return;
      }
      if (vpSelected) {
        setVpSelected(false);
        return;
      }
      if (isFullscreen) setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rulerEnabled, vpTool, vpSelected, isFullscreen]);

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

        {/* Fullscreen přepínač vpravo nahoře – countdown svíčky sedí
            vedle něj zleva (jeden pás ovládání vpravo nahoře) */}
        <div className="ml-auto flex items-center gap-2">
          {intervalKey && !isFullscreen && (
            <CandleCountdown intervalKey={intervalKey} />
          )}
          {!isFullscreen && (
            <button
              type="button"
              onClick={() => setIsFullscreen(true)}
              title="Celá obrazovka (F)"
              aria-label="Celá obrazovka"
              aria-pressed={isFullscreen}
              className="flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Maximize2 className="size-[18px]" />
            </button>
          )}
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
      {(vpTool || profile) && (
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

      {/* Stabilní rodič wrapperu – při fullscreen se wrapper přemístí
          do overlaye a tady zůstane díra, kam se vrátí. Nesmí obsahovat
          žádné podmíněné sourozence (React by mohl zamíchat DOM). */}
      <div ref={originalParentRef} className={cn(isFullscreen && "hidden")}>
        <div
          ref={chartHostRef}
          className={cn("relative", isFullscreen && "h-full")}
        >
        {ctxMenu && (
          <ChartContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            price={ctxMenu.price}
            time={ctxMenu.time}
            itemId={itemId}
            itemName={itemName}
            onClose={closeCtxMenu}
          />
        )}
        {/* Nástrojová lišta à la TradingView – svislá, u levého okraje grafu.
            Je sourozencem chart containeru, takže kliky na ni nespouštějí
            drag/měření v grafu. */}
        <div className="absolute left-2 top-2 z-20 flex flex-col items-center gap-1 rounded-lg border border-border/80 bg-card/90 p-1 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => {
              const next = !vpTool;
              setVpTool(next);
              if (next) {
                setRulerEnabled(false); // vzájemná výlučka s pravítkem
                setVpSelected(false);
              }
              // Pozor: přepnutí nástroje NEMAŽE připnutý objekt (jako ve TV)
            }}
            title="Fixed Range Volume Profile – tažením vyber rozsah, objekt zůstane připnutý"
            aria-label="Fixed Range Volume Profile"
            aria-pressed={vpTool}
            className={cn(
              "flex size-8 items-center justify-center rounded-md transition-colors",
              vpTool
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
                // vzájemná výlučka nástrojů – připnutý VP objekt zůstává
                setVpTool(false);
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
          {rulerEnabled && rulerRange != null && (
            <>
              <div className="h-px w-6 bg-border" />
              <button
                type="button"
                onClick={() => {
                  if (rulerEnabled) {
                    setRulerRange(null);
                    setRulerPreview(null);
                  }
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
        {/* Countdown svíčky – ve fullscreen plave uvnitř grafu dole
            vpravo (mimo fullscreen je v hlavičce vedle fullscreen ikony) */}
        {intervalKey && isFullscreen && (
          <div className="absolute bottom-2 right-2 z-20 rounded-md border border-border/80 bg-card/90 px-2.5 py-1.5 shadow-lg backdrop-blur">
            <CandleCountdown intervalKey={intervalKey} />
          </div>
        )}
        {/* Plovoucí koš u vybraného VP objektu (jako floating toolbar ve TV).
            Pozici nastavuje drawVp imperativně – sedí přesně nad objektem
            i během zoomu bez React re-renderu. */}
        <button
          ref={vpTrashRef}
          type="button"
          onClick={() => {
            setVpRange(null);
            setVpSelected(false);
            setVpTool(false);
          }}
          title="Odstranit Volume Profile"
          aria-label="Odstranit Volume Profile"
          className="absolute z-30 flex size-7 -translate-x-1/2 cursor-pointer items-center justify-center rounded-md border border-border/80 bg-popover/95 text-muted-foreground shadow-lg backdrop-blur transition-colors hover:bg-secondary hover:text-foreground"
          style={{ top: 10, display: "none" }}
        >
          <Trash2 className="size-4" />
        </button>
        <div
          ref={containerRef}
          className={cn(
            "w-full rounded-lg",
            (vpTool || rulerEnabled) && "cursor-crosshair select-none"
          )}
          style={{ height: isFullscreen ? "100%" : height }}
          onMouseDown={onChartMouseDown}
          onMouseMove={onDragMove}
          onMouseUp={onDragEnd}
          onContextMenu={onChartContextMenu}
          onMouseLeave={() => {
            dragState.current.anchor = null;
            setDragPreview(null);
            rulerAnchor.current = null;
            setRulerPreview(null);
          }}
        />

        {/* Cenovka přichyceného bodu – jen režim Linie (u svíček crosshair
            label na ose stačí, tady chybí orientace). Větší odsazení nahoru,
            ať nepřekrývá křivku grafu. */}
        {mode === "area" && lineHover && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-border/80 bg-popover/95 px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums text-foreground shadow-md backdrop-blur"
            style={{
              left: lineHover.x,
              top: Math.max(4, lineHover.y - 48),
            }}
          >
            {formatPrice(lineHover.price)}
          </div>
        )}

        {/* VP canvas – imperativně kreslený overlay; přemalovává se
            synchronně při zoom/pan (onRangeChange), takže profil fituje
            plynule jako ve TradingView */}
        <canvas
          ref={vpCanvasRef}
          className="pointer-events-none absolute inset-0 size-full"
        />

        {/* Přetahovací čáry alertů (à la TradingView) – jen cenové alerty
            komodity; drag mění práh, koš maže. Draw se registruje do
            alertDrawRef → přepočet pixelů při každém zoom/pan (linka drží
            cenu) i po rekonstrukci grafu (přepnutí TF). */}
        {alerts && alerts.length > 0 && (
          <ChartAlertLines
            alerts={alerts}
            epoch={vpEpoch}
            axisWidth={
              // Šířka cenové osy = celková šířka − šířka pane (bez os)
              containerWidth != null && chartRef.current != null
                ? containerWidth - chartRef.current.paneSize().width
                : null
            }
            priceToY={(p) => mainSeriesRef.current?.priceToCoordinate(p) ?? null}
            yToPrice={(y) =>
              mainSeriesRef.current?.coordinateToPrice(y) ?? null
            }
            registerDraw={(fn) => {
              // null = unmount (nebo rekonstrukce grafu) – nahradit no-op,
              // ať onRangeChange po odpojení nespadne na null.current()
              alertDrawRef.current = fn ?? (() => {});
            }}
            onThresholdChange={(alertId, threshold) => {
              void updateAlertThresholdAction(alertId, threshold).then(() =>
                router.refresh()
              );
            }}
            onDelete={(alertId) => {
              void deleteAlertAction(alertId).then(() =>
                router.refresh()
              );
            }}
          />
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

      {/* Fullscreen overlay – wrapper grafu se sem přemístí přes appendChild.
          Kompletní ovládání: header s ikonou, TF, Svíčky/Linie, overlaye,
          countdown i nástroje (žijí ve wrapperu grafu). */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          {/* Header: ikona + název + cena/24h (jako v normálním režimu)
              + countdown a Zmenšit vpravo */}
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <ItemIcon url={itemImageUrl} name={itemName ?? ""} size={40} />
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="truncate text-lg font-semibold tracking-tight">
                  {itemName}
                </h2>
                {itemTicker && (
                  <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {itemTicker}
                  </span>
                )}
                <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  Q0
                </span>
                {currentPrice != null && (
                  <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
                    {formatPrice(currentPrice)}
                  </span>
                )}
                <ChangeBadge value={change24h} size="sm" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              {intervalKey && (
                <CandleCountdown intervalKey={intervalKey} />
              )}
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                title="Zmenšit (Esc)"
                aria-label="Ukončit celou obrazovku"
                className="flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Minimize2 className="size-[18px]" />
              </button>
            </div>
          </div>

          {/* Toolbar: timeframy + Svíčky/Linie */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-2">
            <div className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-full border border-border/80 bg-card p-1">
              {(intervalSwitches ?? []).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => router.push(o.href)}
                  className={cn(
                    "shrink-0 rounded-full px-3.5 py-1.5 font-mono text-xs transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                    o.key === intervalKey
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 rounded-full border border-border/80 bg-card p-1">
              {(modeSwitches ?? []).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => router.push(o.href)}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-xs transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                    o.key === mode
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div ref={fullscreenRef} className="relative min-h-0 flex-1" />
        </div>
      )}
    </div>
  );
}

type PriceChartProps = {
  /** Hlavní cena (last tick) – pro fullscreen hlavičku. */
  currentPrice?: number | null;
  /** 24h změna v % – pro fullscreen hlavičku. */
  change24h?: number | null;
  /** Herní zkratka komodity (např. „BXC"). */
  itemTicker?: string | null;
  /** Cenové alerty komodity – kreslí se jako přetahovací linky. */
  alerts?: AlertLineAlert[];
  candles: Candle[];
  /** "candles" = svíčky, "area" = plynulá linie s gradientem */
  mode?: "candles" | "area";
  height?: number;
  extras?: ChartExtras;
  /** Svíčky s objemy pro Fixed Range Volume Profile (1W/1M reálné, intraday proxy). */
  volumeProfile?: Candle[];
  /** TF pro odpočet do zavření svíčky (nepovinný – bez něj se countdown nezobrazí). */
  intervalKey?: IntervalKey;
  /** Položka grafu – pro kontextovou nabídku (Nastavit alert). */
  itemId?: number;
  /** Název položky pro zobrazení v nabídce. */
  itemName?: string;
  /** URL ikony komodity (fullscreen header). */
  itemImageUrl?: string | null;
  /** Přepínače timeframu pro fullscreen (href = router.push). */
  intervalSwitches?: IntervalSwitch[];
  /** Přepínač Svíčky/Linie pro fullscreen (href = router.push). */
  modeSwitches?: { key: "candles" | "area"; label: string; href: string }[];
};
