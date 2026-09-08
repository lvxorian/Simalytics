"use client";

/**
 * Interaktivní čáry alertů v grafu (à la TradingView).
 *
 * Renderuje se do VP canvasu? Ne – má vlastní transparentní canvas přes
 * graf (pointer-events auto jen na čárách samotných, zbytek průchozí).
 * Každý aktivní cenový alert = vodorovná čárkovaná linka s popiskem.
 * Tažením linky se změní práh alertu (server action), výběr ukáže koš.
 */

import { useCallback, useEffect, useRef } from "react";

export type AlertLineAlert = {
  id: string;
  kind: "price" | "score";
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
  /** Říká rodiči, že se má překreslit (drag běží / skončil). */
  onRedraw: () => void;
  /** Uložení nového prahu (server action wrapper). */
  onThresholdChange: (alertId: string, threshold: number) => void;
  /** Smaže alert (koš). */
  onDelete: (alertId: string) => void;
  /** bump pro překreslení při zoom/pan. */
  epoch: number;
};

type DragState = {
  alertId: string;
  offsetY: number;
  y: number;
} | null;

const LABEL_W = 74;
const LABEL_H = 20;

export function ChartAlertLines({
  alerts,
  priceToY,
  yToPrice,
  onRedraw,
  onThresholdChange,
  onDelete,
  epoch,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const alertsRef = useRef(alerts);
  const trashRef = useRef<HTMLButtonElement | null>(null);
  const trashForRef = useRef<string | null>(null);
  // lokální preview prahu při dragu (optimisticky přes DB)
  const previewRef = useRef<Map<string, number>>(new Map());

  alertsRef.current = alerts;
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

    // pozice koše – jen u vybrané (tažené) linky
    let trashXY: { x: number; y: number } | null = null;

    for (const a of priceAlerts) {
      const y = priceToY(getThreshold(a));
      if (y == null) continue;
      const dragging = dragRef.current?.alertId === a.id;
      const color = a.direction === "above" ? "#22ab94" : "#ec5063";
      const alpha = a.active ? 1 : 0.45;

      ctx.save();
      ctx.globalAlpha = alpha;
      // linka
      ctx.strokeStyle = color;
      ctx.lineWidth = dragging ? 2 : 1.25;
      ctx.setLineDash(dragging ? [] : [6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(rect.width - 76, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      // popisek vpravo (přes cenovou osu)
      const lx = rect.width - 76;
      ctx.fillStyle = color;
      ctx.fillRect(lx, y - LABEL_H / 2, LABEL_W, LABEL_H);
      ctx.fillStyle = "#0b1220";
      // kontrastní text
      ctx.fillStyle = "rgba(11,18,32,0.9)";
      ctx.fillRect(lx + 1, y - LABEL_H / 2 + 1, LABEL_W - 2, LABEL_H - 2);
      const label = `${a.direction === "above" ? "▲" : "▼"} ${formatThreshold(getThreshold(a))}`;
      ctx.fillStyle = color;
      ctx.font = "600 11px 'IBM Plex Mono', ui-monospace, monospace";
      ctx.textBaseline = "middle";
      ctx.fillText(label, lx + 6, y + 0.5);
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

  // pointer hit-test: je kurzor na nějaké lince? (±6 px)
  const hitTest = useCallback(
    (clientY: number): { alert: AlertLineAlert; offsetY: number } | null => {
      const container = containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      const y = clientY - rect.top;
      for (const a of priceAlerts) {
        const ay = priceToY(getThreshold(a));
        if (ay == null) continue;
        if (Math.abs(y - ay) <= 6) {
          return { alert: a, offsetY: y - ay };
        }
      }
      return null;
    },
    [priceAlerts, priceToY, getThreshold]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const hit = hitTest(e.clientY);
      if (!hit) return;
      e.stopPropagation();
      dragRef.current = {
        alertId: hit.alert.id,
        offsetY: hit.offsetY,
        y: e.clientY - (containerRef.current?.getBoundingClientRect().top ?? 0),
      };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [hitTest]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.stopPropagation();
      drag.y =
        e.clientY - (containerRef.current?.getBoundingClientRect().top ?? 0);
      const price = yToPrice(drag.y - drag.offsetY);
      if (price != null) {
        previewRef.current.set(drag.alertId, price);
      }
      draw();
    },
    [draw, yToPrice]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.stopPropagation();
      dragRef.current = null;
      const price = yToPrice(drag.y - drag.offsetY);
      previewRef.current.delete(drag.alertId);
      if (price != null) {
        onThresholdChange(drag.alertId, price);
      }
      draw();
      onRedraw();
    },
    [draw, onThresholdChange, onRedraw, yToPrice]
  );

  // kreslení při zoom/pan (epoch) i při změně alertů
  useEffect(() => {
    draw();
  }, [draw, epoch, alerts]);

  // redeuce velikosti
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" />
      <button
        ref={trashRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (trashForRef.current) onDelete(trashForRef.current);
        }}
        className="absolute z-30 hidden size-7 cursor-pointer items-center justify-center rounded-md border border-border/80 bg-popover/95 text-muted-foreground shadow-lg backdrop-blur transition-colors hover:bg-secondary hover:text-foreground"
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

function formatThreshold(v: number): string {
  return v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
}
