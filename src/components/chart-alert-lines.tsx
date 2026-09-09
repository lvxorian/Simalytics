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
 *
 * Editace hodnoty: box (zvoneček + cena) se chová jako HTML overlay nad
 * canvasem – hover nad cenou ukáže ns-resize kurzor (jako u linky),
 * DVOJKLIK otevře inline input; Enter/tlčítko ✓ uloží, Esc zruší.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

export type AlertLineAlert = {
  id: string;
  kind: "price" | "score" | "limit_sell";
  direction: "above" | "below" | "cross";
  threshold: number;
  active: boolean;
};

type Props = {
  alerts: AlertLineAlert[];
  /** Šířka cenové osy v px (chart.width()). Null = ještě není k dispozici. */
  axisWidth: number | null;
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
  /**
   * Uložení prahu + směru (dvouklik na cenu v boxu → inline editor).
   * Když není, editor se nezobrazí (jen drag + koš).
   */
  onUpdateRule?: (
    alertId: string,
    threshold: number,
    direction: "above" | "below" | "cross"
  ) => Promise<void>;
};

type DragState = {
  alertId: string;
  offsetY: number;
  y: number;
} | null;

const LABEL_W = 84;
const LABEL_H = 20;
// Mezera mezi koncem linky/popisku a cenovou osou. Popisek končí PŘÍMO
// na oddělovací čáře osy (žádná zvláštní mezera) – jen se přidá 1 px,
// ať čára není překrytá a box na ni „nalepený“.

export function ChartAlertLines({
  alerts,
  axisWidth,
  priceToY,
  yToPrice,
  registerDraw,
  onThresholdChange,
  onDelete,
  epoch,
  onUpdateRule,
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
  // Inline editor hodnoty v boxu (dvouklik na cenu) – pozice řídí draw
  const [editingId, setEditingId] = useState<string | null>(null);
  const editValueRef = useRef<string>("");
  // pozice boxu editoru (nastavuje draw imperativně, ~ jako koš)
  const editorRef = useRef<HTMLDivElement | null>(null);

  const priceAlerts = alerts.filter((a) => a.kind === "price");

  const getThreshold = useCallback(
    (a: AlertLineAlert) => previewRef.current.get(a.id) ?? a.threshold,
    []
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    // Šířka cenové osy – popisek se má nalepit PŘÍMO na oddělovací čáru
    // osy. Znám-li šířku osy (chart.width()), spočítám ji přesně;
    // fallback = 62 px (typická šířka osy s cenami ~2,505).
    const axisPx = axisWidth ?? 62;
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

    // pozice koše – jen u tažené linky; editor – u linky v editaci
    let trashXY: { x: number; y: number } | null = null;
    let editorXY: { x: number; y: number } | null = null;

    /** Levý okraj popisku – box končí PŘÍMO na oddělovací čáře osy. */
    const labelX = (width: number) => width - axisPx - LABEL_W - 1;

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

      // editor hodnoty (dvouklik na cenu) – sedí nad boxem alertu
      if (editingId === a.id) {
        editorXY = { x: lx, y: y - LABEL_H / 2 - 34 };
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

    // inline editor – pozice imperativně (drží se i během zoomu jako koš)
    const editor = editorRef.current;
    if (editor) {
      if (editorXY) {
        editor.style.display = "flex";
        editor.style.left = `${editorXY.x}px`;
        editor.style.top = `${editorXY.y}px`;
      } else {
        editor.style.display = "none";
      }
    }
  }, [priceAlerts, priceToY, getThreshold, axisWidth, editingId]);

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

  /**
   * Je pointer nad boxem alertu (zvoneček + cena)? Tam NEdraguje se –
   * dvouklik otevře editor; editační zóna = celý box (±10 px kolem linky).
   */
  const isOverPriceLabel = useCallback(
    (a: AlertLineAlert, e: React.PointerEvent | React.MouseEvent) => {
      const container = containerRef.current;
      if (!container) return false;
      const rect = container.getBoundingClientRect();
      const axisPx = axisWidth ?? 62;
      const lx = rect.width - axisPx - LABEL_W - 1;
      const y = priceToY(getThreshold(a));
      if (y == null) return false;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      return px >= lx && px <= lx + LABEL_W && py >= y - 10 && py <= y + 10;
    },
    [axisWidth, getThreshold, priceToY]
  );

  const onStripPointerDown = useCallback(
    (a: AlertLineAlert) => (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      // Klik na box (zvoneček + cena) – tady se netáhne; dvojklik otevře
      // editor (onDoubleClick na tomže pásu), jednoduchý klik = nic.
      if (isOverPriceLabel(a, e)) return;
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
    [getThreshold, priceToY, isOverPriceLabel]
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

  /** Uložení inline editoru (Enter / ✓) – validace + server action. */
  const saveEditing = useCallback(() => {
    const id = editingId;
    if (!id || !onUpdateRule) return;
    const value = Number(editValueRef.current.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) return; // nevalidní = ticho
    const alert = priceAlerts.find((a) => a.id === id);
    setEditingId(null);
    previewRef.current.set(id, value); // optimisticky, dokud nepřijdou data
    drawRef.current();
    void onUpdateRule(id, value, alert?.direction ?? "above");
  }, [editingId, onUpdateRule, priceAlerts]);

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
          grafu zůstává průchozí (pan/zoom/nástroje). Nad boxem alertu
          (zvoneček + cena) kurzor ns-resize; dvojklik na cenu = editor. */}
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
          title={
            onUpdateRule
              ? "Táhni = změna prahu · dvojklik na cenu = přesná editace"
              : "Táhni pro změnu prahu alertu"
          }
          onPointerDown={onStripPointerDown(a)}
          onPointerMove={onStripPointerMove}
          onPointerUp={(e) => endDrag(e, true)}
          onPointerCancel={(e) => endDrag(e, false)}
          onDoubleClick={
            onUpdateRule && a.kind === "price"
              ? (e) => {
                  if (!isOverPriceLabel(a, e)) return;
                  editValueRef.current = String(getThreshold(a));
                  setEditingId(a.id);
                  drawRef.current();
                  // focus až po umístění editoru (draw běží v rAF)
                  requestAnimationFrame(() =>
                    editorRef.current?.querySelector("input")?.focus()
                  );
                }
              : undefined
          }
        />
      ))}

      {/* Inline editor hodnoty alertu (dvojklik na cenu v boxu) – pozice
          řídí draw imperativně (sedí i během zoomu), Enter/✓ uloží. */}
      {onUpdateRule && (
        <div
          ref={editorRef}
          className="pointer-events-auto absolute z-30 hidden items-center gap-1 rounded-md border border-border/80 bg-popover/95 p-1 shadow-lg backdrop-blur"
          style={{ display: "none" }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <input
            ref={(el) => {
              if (el && editingId) {
                el.value = editValueRef.current;
              }
            }}
            type="number"
            step="0.001"
            min="0"
            aria-label="Nová hodnota alertu"
            className="h-7 w-24 rounded border border-border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            onChange={(e) => {
              editValueRef.current = e.target.value;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveEditing();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditingId(null);
                drawRef.current();
              }
            }}
          />
          <button
            type="button"
            aria-label="Uložit hodnotu alertu"
            title="Uložit (Enter)"
            onClick={() => saveEditing()}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-up transition-colors hover:bg-secondary"
          >
            <Check className="size-4" />
          </button>
        </div>
      )}

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
