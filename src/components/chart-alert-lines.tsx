"use client";

/**
 * Interaktivní čáry alertů v grafu (à la TradingView).
 *
 * Model je stejný jako u VP overlaye – imperativní CANVAS, pozice se
 * přepočítává při každém zoom/panu (rodič volá registrovaný draw v
 * onRangeChange), takže linka VŽDY sedí na své ceně, ne na pixelu.
 *
 * Editovatelnost: přes linku leží tenký interaktivní pás (±7 px) jako
 * sourozenec chart containeru – tažením mění práh (pointer capture drží
 * tah i mimo pás), koš maže. Pás nekoliduje s pan/kreslením v grafu.
 */

import { useCallback, useEffect, useRef } from "react";

export type AlertLineAlert = {
  id: string;
  kind: "price" | "score" | "limit_sell";
  direction: "above" | "below";
  threshold: number;
  active: boolean;
};

type Props = {
  alerts: AlertLineAlert[];
  /** Převod ceny → Y pixel v containeru. */
  priceToY: (price: number) => number | null;
  /** Převod Y pixelu → cena. */
  yToPrice: (y: number) => number | null;
  /** Registrace imperativního draw pro onRangeChange rodiče (zoom/pan). */
  registerDraw: (fn: (() => void) | null) => void;
  /** Uložení nového prahu (server action wrapper). */
  onThresholdChange: (alertId: string, threshold: number) => void;
  /** Smaže alert (koš). */
  onDelete: (alertId: string) => void;
  /** bump pro překreslení při re-renderu rodiče. */
  epoch: number;
};

type DragState = {
  alertId: string;
  offsetY: number;
  y: number;
} | null;

const LABEL_W = 84;
const LABEL_H = 20;
// Mezera mezi koncem linky/popisku a cenovou osou (osa je vpravo a
// nesmí se překrývat – popisek proto končí PRED osou, ne nad ní).
const PRICE_AXIS_GAP = 68;

export function ChartAlertLines({
  alerts,
  priceToY,
  yToPrice,
  registerDraw,
  onThresholdChange,
  onDelete,
  epoch,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const trashRef = useRef<HTMLButtonElement | null>(null);
  const trashForRef = useRef<string | null>(null);
  // Interaktivní pásy přes linky (drag) – pozice nastavuje draw imperativně
  const stripsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  // lokální preview prahu při dragu (optimisticky přes DB)
  const previewRef = useRef<Map<string, number>>(new Map());

  const priceAlerts = alerts.filter((a) => a.kind === "price");

  const getThreshold = useCallback(
    (a: AlertLineAlert) => previewRef.current.get(a.id) ?? a.threshold,
    []
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (
      canvas.width !== Math.round(rect.width * dpr) ||
      canvas.height !== Math.round(rect.height * dpr)
    ) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    // pozice koše – jen u tažené linky
    let trashXY: { x: number; y: number } | null = null;

    /** Pravý okraj popisku – mezera před cenovou osou (nechat vidět osu). */
    const labelX = (width: number) => width - LABEL_W - PRICE_AXIS_GAP;

    for (const a of priceAlerts) {
      const y = priceToY(getThreshold(a));

      // interaktivní pás přes linku (drag) – vždy přemístíme na aktuální y
      const strip = stripsRef.current.get(a.id);
      if (strip) {
        if (y == null) {
          strip.style.display = "none";
        } else {
          strip.style.display = "block";
          strip.style.top = `${y - 7}px`;
        }
      }

      if (y == null) continue; // cena mimo viditelný rozsah

      const dragging = dragRef.current?.alertId === a.id;
      const color = a.direction === "above" ? "#22ab94" : "#ec5063";
      const alpha = a.active ? 1 : 0.45;

      ctx.save();
      ctx.globalAlpha = alpha;
      // linka – končí před popiskem, který stojí VLEVO od cenové osy
      ctx.strokeStyle = color;
      ctx.lineWidth = dragging ? 2 : 1.25;
      ctx.setLineDash(dragging ? [] : [6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(labelX(rect.width), y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      // popisek vlevo od cenové osy: zvoneček + cena (nepřekrývá osu)
      const lx = labelX(rect.width);
      ctx.fillStyle = color;
      ctx.fillRect(lx, y - LABEL_H / 2, LABEL_W, LABEL_H);
      ctx.fillStyle = "rgba(11,18,32,0.9)";
      ctx.fillRect(lx + 1, y - LABEL_H / 2 + 1, LABEL_W - 2, LABEL_H - 2);
      drawBell(ctx, lx + 5, y - 5, color);
      ctx.fillStyle = color;
      ctx.font = "600 11px 'IBM Plex Mono', ui-monospace, monospace";
      ctx.textBaseline = "middle";
      ctx.fillText(
        `${formatThreshold(getThreshold(a))} $`,
        lx + 20,
        y + 0.5
      );
      ctx.restore();

      if (dragging) {
        trashXY = { x: lx - 34, y: y - 12 };
      }
    }

    // koš při dragu (zobrazí se vedle linky; pustíš-li na něj, alert maže)
    const trash = trashRef.current;
    if (trash) {
      if (trashXY) {
        trash.style.display = "flex";
        trash.style.left = `${trashXY.x}px`;
        trash.style.top = `${trashXY.y}px`;
      } else {
        trash.style.display = "none";
      }
    }
  }, [priceAlerts, priceToY, getThreshold]);

  // aktuální draw pro registraci (zoom/pan rodiče) i lokální volání
  const drawRef = useRef(draw);
  drawRef.current = draw;

  // registrace imperativního draw – rodič volá při každém zoom/pan
  // (linka tak drží cenu, ne pixel) i po rekonstrukci grafu (přepnutí TF)
  useEffect(() => {
    registerDraw(() => drawRef.current());
    return () => registerDraw(null);
  }, [registerDraw]);

  // Čerstvá data z DB (router.refresh po uložení/mazání) – zruš lokální
  // preview prahů, ať linka přejde na skutečnou uloženou hodnotu.
  useEffect(() => {
    previewRef.current.clear();
  }, [alerts]);

  // Kreslení při epoch bump (re-render rodiče) a změně alertů – rAF, ať
  // běží až PO parent efektech (child efekty běží dřív: po přepnutí
  // timeframu je graf/mainSeries teprve ve vytváření a starý series už
  // je odstraněný). Řeší i první kreslení po mountu a fullscreen re-parent.
  useEffect(() => {
    const id = requestAnimationFrame(() => drawRef.current());
    return () => cancelAnimationFrame(id);
  }, [draw, epoch, alerts]);

  // překreslení při změně velikosti
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => drawRef.current());
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Drag prahu: tah pásu přes linku (pointer capture drží i mimo pás) ──

  const onStripPointerDown = useCallback(
    (a: AlertLineAlert) => (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const ay = priceToY(getThreshold(a));
      if (ay == null) return;
      dragRef.current = {
        alertId: a.id,
        offsetY: e.clientY - rect.top - ay,
        y: e.clientY - rect.top,
      };
      trashForRef.current = a.id;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [getThreshold, priceToY]
  );

  const onStripPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const container = containerRef.current;
      if (!drag || !container) return;
      const rect = container.getBoundingClientRect();
      drag.y = e.clientY - rect.top;
      const price = yToPrice(drag.y - drag.offsetY);
      if (price != null) {
        previewRef.current.set(drag.alertId, price);
      }
      drawRef.current();
    },
    [yToPrice]
  );

  /** Puštěno na koš? (geometrický test – pointer capture drží strip) */
  const isOverTrash = useCallback((e: React.PointerEvent) => {
    const trash = trashRef.current;
    if (!trash || trash.style.display === "none") return false;
    const r = trash.getBoundingClientRect();
    return (
      e.clientX >= r.left &&
      e.clientX <= r.right &&
      e.clientY >= r.top &&
      e.clientY <= r.bottom
    );
  }, []);

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, save: boolean) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      trashForRef.current = null;
      const price = yToPrice(drag.y - drag.offsetY);
      // Puštěno na koš → smazat alert (à la TradingView)
      if (save && isOverTrash(e)) {
        previewRef.current.delete(drag.alertId);
        onDelete(drag.alertId);
        drawRef.current();
        return;
      }
      if (save && price != null) {
        // Preview ponecháme – linka zůstane, kde pustíš, dokud nepřijdou
        // čerstvá data z DB (router.refresh → nové alerts → clear výše).
        onThresholdChange(drag.alertId, price);
      } else {
        previewRef.current.delete(drag.alertId);
      }
      drawRef.current();
    },
    [isOverTrash, onDelete, onThresholdChange, yToPrice]
  );

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0">
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 size-full"
      />

      {/* Interaktivní pásy přes linky – jen ±7 px kolem čáry, zbytek
          grafu zůstává průchozí (pan/zoom/nástroje) */}
      {priceAlerts.map((a) => (
        <div
          key={a.id}
          ref={(el) => {
            if (el) stripsRef.current.set(a.id, el);
            else stripsRef.current.delete(a.id);
          }}
          className="pointer-events-auto absolute left-0 z-20 block cursor-ns-resize"
          style={{
            right: 0,
            height: 14,
            top: -100,
            touchAction: "none",
          }}
          title="Táhni pro změnu prahu alertu"
          onPointerDown={onStripPointerDown(a)}
          onPointerMove={onStripPointerMove}
          onPointerUp={(e) => endDrag(e, true)}
          onPointerCancel={(e) => endDrag(e, false)}
        />
      ))}

      {/* Koš – objeví se u tažené linky (pozici řídí draw imperativně) */}
      <button
        ref={trashRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (trashForRef.current) onDelete(trashForRef.current);
        }}
        className="pointer-events-auto absolute z-30 hidden size-7 cursor-pointer items-center justify-center rounded-md border border-border/80 bg-popover/95 text-muted-foreground shadow-lg backdrop-blur transition-colors hover:bg-secondary hover:text-foreground"
        title="Odstranit alert"
        aria-label="Odstranit alert"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </div>
  );
}

/** Zvoneček (ikonka alertu) kreslený na canvas – 10 px, barva linky. */
function drawBell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string
) {
  ctx.save();
  ctx.translate(x, y);
  const s = 10 / 24; // ikona v 24-jednotkovém prostoru → 10 px
  ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(12, 2.5);
  ctx.bezierCurveTo(8.7, 2.5, 6.5, 5.1, 6.5, 8.5);
  ctx.lineTo(6.5, 12.5);
  ctx.lineTo(4.6, 15.6);
  ctx.quadraticCurveTo(4.2, 16.4, 5.1, 16.4);
  ctx.lineTo(18.9, 16.4);
  ctx.quadraticCurveTo(19.8, 16.4, 19.4, 15.6);
  ctx.lineTo(17.5, 12.5);
  ctx.lineTo(17.5, 8.5);
  ctx.bezierCurveTo(17.5, 5.1, 15.3, 2.5, 12, 2.5);
  ctx.closePath();
  ctx.fill();
  // klapka
  ctx.beginPath();
  ctx.arc(12, 19.2, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function formatThreshold(v: number): string {
  // stejná přesnost jako burza ve hře: až 3 desetinná místa (0,755)
  return v.toLocaleString("cs-CZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}
