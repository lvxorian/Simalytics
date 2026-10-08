"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRightLeft,
  Check,
  Copy,
  Pencil,
  Percent,
  RefreshCw,
  RotateCcw,
  Warehouse,
  X,
} from "lucide-react";

import { AssetPins } from "@/components/asset-pins";
import { ItemCombobox, type ComboboxItem } from "@/components/ui/combobox";
import { ItemIcon } from "@/components/item-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLiveTick } from "@/lib/live-prices";
import {
  formatPrice,
  formatSigned,
  formatPercent,
  formatRelativeAge,
  plColorClass,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MarketInstrument } from "@/lib/data";
import {
  SALE_CHANNELS,
  breakEvenSellPrice,
  computeAllChannels,
  computeResearchRoi,
  pctFromMarket,
  RESEARCH_UNITS_PER_PATENT,
  type SaleChannel,
} from "@/lib/profit-calc";

/**
 * Profit kalkulačka – „za kolik nakoupil, kolik ks, za kolik prodám“.
 *
 * Tři kanály dle mechaniky hry (lib/profit-calc):
 *  - Maloobchod: cena podle značky, bez poplatku, plná přeprava.
 *  - Kontrakt: bez poplatku, PŮLKA přepravy (hra účtuje ½ poměru).
 *  - Burza: poplatek 4 % z tržby, plná přeprava, ask jako reference.
 *
 * Prodejní cena: ručně NEBO z trhu přes „−X % MP“ (obousměrně; stejný
 * vzor jako kalkulačka kontraktů). Reference = ask z orderbooku (ofiko
 * v3 přes /api/live/ask, cache 3 s), fallback poslední obchod (Q0 živě
 * přes SSE), ruční přepsání kliknutím.
 *
 * TAB „Výzkum Q“: patenty dle wiky (Q1 = 12, +50, +500, +2000, +5000,
 * Q6–Q10 = po 10 000) × ≈8 research unitů/patent × cena unitu z trhu.
 * Kvalita je vlastnost ŠARŽE – ROI platí jen pro budoucí výrobu a Q
 * výrobku ≤ min(Q inputů) + 1.
 */

/** Desetinná čárka i tečka → Number. */
function num(s: string): number {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

/** Řádek herního skladu (unit_cost za 1 ks dané kvality). */
export type WarehouseRow = {
  item_id: number;
  quality: number;
  quantity: number;
  unit_cost: number | null;
  updated_at: string;
};

export type TransportInputsProp = {
  ratios: Record<number, number | null>;
  transportUnitCost: number | null;
};

const QUALITIES = [0, 1, 2, 3, 4, 5, 6, 7] as const;

// Presety „−% MP“ (prodává se pod trhem; kladné % se dá zadat ručně).
const PCT_PRESETS = ["-10", "-5", "-4", "-3", "-2", "-1", "0"] as const;

/** Výchozí research unit: Chemikálie (id 32) – levný a likvidní. */
const DEFAULT_RESEARCH_ITEM_ID = 32;

// ── Hook: referenční cena (ask → obchod → ruční) ────────────────────
//
// Používá se dvakrát (hlavní položka + research unit); stejná logika
// jako v contract-calculator jen zapouzdřená. Ask se načítá RESTem na
// požádání (změna položky/kvality, tlačítko) – žádný polling.

function useReferencePrice(
  itemId: number | null,
  quality: number,
  tradeFromServer: number | null
) {
  const [refSource, setRefSource] = useState<"ask" | "trade">("ask");
  const [ask, setAsk] = useState<number | null>(null);
  const [askAtMs, setAskAtMs] = useState<number | null>(null);
  const [apiTrade, setApiTrade] = useState<number | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [manual, setManual] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const loadAsk = useCallback(
    async (id: number, q: number) => {
      setManual(null);
      setEditing(false);
      setAsk(null);
      setAskAtMs(null);
      setApiTrade(null);
      setAskError(null);
      setAskLoading(true);
      try {
        const res = await fetch(
          `/api/live/ask?item=${id}&quality=${q}&depth=1`,
          { signal: AbortSignal.timeout(12_000) }
        );
        const data = (await res.json()) as {
          ask?: unknown;
          trade?: unknown;
          error?: string;
        };
        if (typeof data.ask === "number" && data.ask > 0) {
          setAsk(data.ask);
          setAskAtMs(Date.now());
        } else {
          setAskError(
            data.error ??
              `Burza nemá aktivní nabídku Q${q} – měřeno posledním obchodem.`
          );
        }
        setApiTrade(
          typeof data.trade === "number" && data.trade > 0 ? data.trade : null
        );
      } catch {
        setAskError("Nabídku se nepovedlo načíst – měřeno obchodem.");
      } finally {
        setAskLoading(false);
      }
    },
    []
  );

  // Poznámka: ask se NENAČÍTÁ v efektu (react-hooks/set-state-in-effect,
  // kaskádové rendery) – volá se z handlerů pickItem/pickQuality a
  // tlačítka „Načíst“. Bez asku se cena vždy počítá z posledního obchodu
  // (SSR mapa / live tick), takže UI je funkční okamžitě.

  // Poslední obchod: z API odpovědi, ze serveru (SSR) nebo live tick (Q0).
  const tradeValue = apiTrade ?? tradeFromServer;

  const autoPrice = refSource === "ask" && ask !== null ? ask : tradeValue;
  const refPrice = manual ?? autoPrice;
  const usingAsk = manual === null && refSource === "ask" && ask !== null;
  const usingManual = manual !== null;
  const refMs = usingAsk ? askAtMs : null;

  const switchSource = useCallback(
    (value: "ask" | "trade") => {
      setRefSource(value);
      setManual(null);
      setEditing(false);
      if (value === "ask" && itemId !== null && ask === null && !askLoading) {
        void loadAsk(itemId, quality);
      }
    },
    [itemId, quality, ask, askLoading, loadAsk]
  );

  return {
    refSource,
    refPrice,
    usingAsk,
    usingManual,
    refMs,
    askLoading,
    askError,
    tradeValue,
    manual,
    editing,
    draft,
    setDraft,
    startEdit: () => {
      setDraft(refPrice !== null ? refPrice.toFixed(3) : "");
      setEditing(true);
    },
    commitEdit: () => {
      const v = num(draft);
      if (Number.isFinite(v) && v > 0) {
        setManual(v);
        setEditing(false);
      }
    },
    cancelEdit: () => {
      setEditing(false);
      setDraft("");
    },
    resetManual: () => {
      setManual(null);
      setEditing(false);
    },
    switchSource,
    loadAsk,
    reload: () => {
      if (itemId !== null) void loadAsk(itemId, quality);
    },
  };
}

// ── Hlavní komponenta ──────────────────────────────────────────────

export function ProfitCalculator({
  items,
  warehouse,
  transportInputs,
}: {
  items: MarketInstrument[];
  warehouse: WarehouseRow[];
  transportInputs: TransportInputsProp;
}) {
  const [tab, setTab] = useState<"prodej" | "rozpad" | "vyskum">("prodej");

  // ── Hlavní položka ──
  const [itemId, setItemId] = useState("");
  const [quality, setQuality] = useState(0);
  const [buyPrice, setBuyPrice] = useState("");
  const [qty, setQty] = useState("1000");
  const [sellMode, setSellMode] = useState<"price" | "mp">("price");
  const [sellPrice, setSellPrice] = useState("");
  const [pct, setPct] = useState("-3");
  const [activeChannel, setActiveChannel] = useState<SaleChannel>("retail");

  const selected = items.find((i) => String(i.id) === itemId) ?? null;
  const hasQualities = selected?.hasQualities ?? true;
  const effQuality = hasQualities ? quality : 0;

  // Živý tick Q0 (jen kvalita 0).
  const tick = useLiveTick(selected && effQuality === 0 ? selected.id : null);

  // Poslední obchod vybrané kvality: live tick Q0, jinak SSR mapa.
  const tradeFromServer = useMemo(() => {
    if (!selected) return null;
    if (effQuality === 0) return tick?.price ?? selected.prices["0"] ?? null;
    return selected.prices[String(effQuality)] ?? null;
  }, [selected, effQuality, tick]);

  const ref = useReferencePrice(
    selected ? selected.id : null,
    effQuality,
    tradeFromServer
  );

  // ── Transportní vstupy aktuální položky ──
  const ratio = selected
    ? (transportInputs.ratios[selected.id] ?? null)
    : null;
  const transportUnitCost = transportInputs.transportUnitCost;

  // Řádek skladu: přesná (položka, kvalita), fallback libovolná Q téže
  // položky (šarže se ve hře míchají; unit_cost jde o odhad).
  const whExact = selected
    ? (warehouse.find(
        (w) => w.item_id === selected.id && w.quality === effQuality
      ) ?? null)
    : null;
  const whAny =
    !whExact && selected
      ? (warehouse.find((w) => w.item_id === selected.id && w.quantity > 0) ??
        null)
      : null;
  const whRow = whExact ?? whAny;

  const pickItem = (id: string) => {
    setItemId(id);
    setSellPrice("");
    const next = items.find((i) => String(i.id) === id);
    if (next) void ref.loadAsk(next.id, next.hasQualities === false ? 0 : quality);
  };

  const pickQuality = (q: number) => {
    if (!selected || q === effQuality) return;
    setQuality(q);
    setSellPrice("");
    void ref.loadAsk(selected.id, q);
  };

  // Naplnit vstupy z herního skladu (unit_cost + množství ze syncu).
  const fillFromWarehouse = () => {
    if (!whRow) return;
    if (whRow.unit_cost !== null && whRow.unit_cost > 0) {
      setBuyPrice(whRow.unit_cost.toFixed(3));
    }
    setQty(String(whRow.quantity));
  };

  const buyNum = num(buyPrice);
  const qtyNum = num(qty);
  const sellManualNum = num(sellPrice);
  const pctNum = num(pct);

  const inputsValid =
    Number.isFinite(buyNum) &&
    buyNum > 0 &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0;

  // COGS divergence: zadaná cena vs. herní FIFO unit_cost ze skladu.
  // Hra účtuje zisk proti FIFO COGS celého inventáře (starší šarže se
  // míchají s novými) – když se liší, herní „Zisk" v účetnictví bude
  // jiný než náš výpočet (reálný případ: Rostlinný výzkum 8.10. 2026,
  // zadáno 84,50, herní FIFO 85,688 → rozdíl 3 565 $ na 3000 ks).
  const cogsDivergence =
    inputsValid &&
    whRow?.unit_cost != null &&
    whRow.unit_cost > 0 &&
    Math.abs(buyNum - whRow.unit_cost) / whRow.unit_cost > 0.01
      ? { calc: buyNum, game: whRow.unit_cost }
      : null;

  // Efektivní prodejní cena/ks: ručně nebo z −% MP reference.
  const sellUnit: number | null =
    sellMode === "price"
      ? Number.isFinite(sellManualNum) && sellManualNum > 0
        ? sellManualNum
        : null
      : ref.refPrice !== null && Number.isFinite(pctNum)
        ? ref.refPrice * (1 + pctNum / 100)
        : null;

  // Kontrola % MP ruční ceny (v režimu „Jen cena“).
  const manualPct =
    sellMode === "price" &&
    sellUnit !== null &&
    ref.refPrice !== null
      ? pctFromMarket(sellUnit, ref.refPrice)
      : null;

  // ── Ekonomika: rozpad kanálů + break-even ──
  // (čistá levná matematika – bez useMemo, React Compiler si to
  //  zapamuje sám; ruční deps porušovaly preserve-manual-memoization)
  const channels =
    inputsValid && sellUnit !== null
      ? computeAllChannels({
          buyPrice: buyNum,
          quantity: qtyNum,
          sellPrice: sellUnit,
          transportRatio: ratio,
          transportUnitCost,
        })
      : null;

  const breakEven = inputsValid
    ? breakEvenSellPrice(
        {
          buyPrice: buyNum,
          quantity: qtyNum,
          transportRatio: ratio,
          transportUnitCost,
        },
        activeChannel
      )
    : null;

  const result = channels ? channels[activeChannel] : null;

  const beVsMarket =
    breakEven?.price != null && ref.refPrice !== null && ref.refPrice > 0
      ? pctFromMarket(breakEven.price, ref.refPrice)
      : null;
  const beDistance =
    breakEven?.price != null && sellUnit !== null
      ? (sellUnit - breakEven.price) / breakEven.price
      : null;

  const comboboxItems: ComboboxItem[] = useMemo(
    () =>
      items.map((i) => ({
        id: i.id,
        name: i.name,
        price: i.prices["0"] ?? Object.values(i.prices).find((p) => p) ?? 0,
      })),
    [items]
  );

  const availableQualities = useMemo(() => {
    const s = new Set<number>();
    if (selected) {
      for (const k of Object.keys(selected.prices)) {
        if (selected.prices[k] !== null) s.add(Number(k));
      }
    }
    return s;
  }, [selected]);

  // Ticking hodin pro stáří reference.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!ref.refMs) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ref.refMs]);
  const refAgeLabel = ref.refMs
    ? formatRelativeAge(Math.min(ref.refMs, nowMs))
    : "–";

  // ── Výzkumný tab (druhá instance hooku; research je Q0 položka) ──
  const [researchItemId, setResearchItemId] = useState<number | null>(
    DEFAULT_RESEARCH_ITEM_ID
  );
  const researchItem = items.find((i) => i.id === researchItemId) ?? null;
  const researchTrade = researchItem?.prices["0"] ?? null;
  const researchRef = useReferencePrice(
    researchItemId,
    0,
    researchTrade
  );

  const [fromQ, setFromQ] = useState(0);
  const [toQ, setToQ] = useState(2);
  const [extraCost, setExtraCost] = useState("");
  const [unitsPerDay, setUnitsPerDay] = useState("");

  const extraNum = num(extraCost);
  const updNum = num(unitsPerDay);

  const researchR =
    toQ > fromQ && researchItem && researchRef.refPrice !== null
      ? computeResearchRoi({
          fromQ,
          toQ,
          researchUnitPrice: researchRef.refPrice,
          priceQ0: researchItem.prices["0"] ?? null,
          priceQTarget: researchItem.prices[String(toQ)] ?? null,
          unitsPerDay: Number.isFinite(updNum) && updNum > 0 ? updNum : null,
          extraCostPerUnit:
            Number.isFinite(extraNum) && extraNum !== 0 ? extraNum : null,
        })
      : null;

  return (
    <div className="space-y-4">
      {/* ── Přepínač tabů ─────────────────────────────────────────── */}
      <div className="inline-flex gap-1 rounded-lg border border-border/80 bg-secondary/40 p-1">
        {(
          [
            ["prodej", "Prodej a náklady"],
            ["rozpad", "Rozpad a kanály"],
            ["vyskum", "Výzkum Q"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
              tab === value
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "prodej" && (
        <div className="space-y-4">
          {/* ── Karta: položka + vstupy ─────────────────────────── */}
          <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Label>Aktivum</Label>
                <ItemCombobox
                  items={comboboxItems}
                  value={itemId}
                  onChange={pickItem}
                  placeholder="Vyber komoditu…"
                />
                <AssetPins
                  items={items}
                  value={itemId}
                  onSelect={pickItem}
                  storageKey="simalytics.pins.profit"
                />

                {selected && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-secondary/30 px-3 py-2.5">
                    <Link
                      href={`/market/${selected.id}`}
                      className="group flex min-w-0 items-center gap-3"
                    >
                      <ItemIcon
                        url={`/icons/${selected.id}.png`}
                        name={selected.name}
                        size={30}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium group-hover:text-primary">
                          {selected.name}
                        </span>
                        <span className="block font-mono text-[10px] text-muted-foreground">
                          {selected.category
                            ? selected.category.toLowerCase()
                            : ""}
                        </span>
                      </span>
                    </Link>
                    {hasQualities && (
                      <div className="flex flex-wrap items-center gap-1">
                        {QUALITIES.map((q) => {
                          const hasData = availableQualities.has(q);
                          return (
                            <button
                              key={q}
                              type="button"
                              onClick={() => pickQuality(q)}
                              title={
                                hasData
                                  ? `Q${q} – máme ticky i orderbook`
                                  : `Q${q} – bez ticků (orderbook může existovat)`
                              }
                              className={cn(
                                "cursor-pointer rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors",
                                q === effQuality
                                  ? "border-primary/40 bg-primary/15 text-primary"
                                  : hasData
                                    ? "border-border/70 bg-secondary/40 text-foreground hover:text-primary"
                                    : "border-border/40 bg-transparent text-muted-foreground/60 hover:text-foreground"
                              )}
                            >
                              Q{q}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Naplnit ze skladu + transportní kontext */}
                {selected && (
                  <div className="space-y-2">
                    {whRow && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 rounded-full"
                          title="Předvyplnit pořizovací cenu a kusy z herního skladu (sync userscriptem)"
                          onClick={fillFromWarehouse}
                        >
                          <Warehouse className="size-3.5" />
                          Naplnit ze skladu
                        </Button>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {whRow.unit_cost !== null
                            ? `${formatPrice(whRow.unit_cost)} / ks · `
                            : "cena na skladu neznámá · "}
                          {whRow.quantity.toLocaleString("cs-CZ")} ks
                          {!whExact && whAny
                            ? ` (kvalita Q${whAny.quality})`
                            : whRow.unit_cost !== null
                              ? ` · ${formatRelativeAge(Date.parse(whRow.updated_at))}`
                              : ""}
                        </span>
                      </div>
                    )}
                    {cogsDivergence && (
                      <p
                        className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-600 dark:text-amber-400"
                        title="Hra počítá zisk proti FIFO COGS celého skladu – směs starých i nových šarží"
                      >
                        ⚠ Zadaná cena {formatPrice(cogsDivergence.calc)} se liší od
                        unit_cost na skladu {formatPrice(cogsDivergence.game)} (
                        {formatPercent(((cogsDivergence.calc - cogsDivergence.game) / cogsDivergence.game) * 100)}).
                        Herní účetnictví účtuje FIFO z celého inventáře – jeho „Zisk“
                        bude jiný než tento výpočet. Pro shodu s herní účetnictví
                        použij „Naplnit ze skladu“.
                      </p>
                    )}
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {ratio !== null && ratio === 0
                        ? "Přeprava: položka nespotřebuje žádnou Přepravu (poměr 0) – náklad přesně 0."
                        : ratio !== null && transportUnitCost !== null
                          ? `Přeprava: ${ratio.toFixed(3)} ks Přepravy na 1 ks prodaného zboží (× ${formatPrice(transportUnitCost)} = ${formatPrice(ratio * transportUnitCost)} / ks).`
                          : ratio !== null && ratio > 0
                            ? `Přeprava: poměr ${ratio.toFixed(3)} známý, ale cena Přepravy na skladu chybí → odhad % z tržby.`
                            : "Přeprava: poměr neznámý → odhad 3,06 % z tržby."}
                    </p>
                  </div>
                )}
              </div>

              {/* ── Vstupy nákladů a prodeje ── */}
              <div className="space-y-4 rounded-lg border border-border/60 bg-secondary/30 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pc-buy">Pořizovací cena / ks</Label>
                    <Input
                      id="pc-buy"
                      type="number"
                      min={0.001}
                      step={0.001}
                      placeholder="0.000"
                      value={buyPrice}
                      onChange={(e) => setBuyPrice(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pc-qty">Kusů</Label>
                    <Input
                      id="pc-qty"
                      type="number"
                      min={1}
                      step={1}
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                </div>

                {/* Přepínač: ruční cena vs. −% MP */}
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-border/80 bg-secondary/40 p-1">
                  <button
                    type="button"
                    onClick={() => setSellMode("price")}
                    className={cn(
                      "flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                      sellMode === "price"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Percent className="size-3.5" />
                    Jen cena
                  </button>
                  <button
                    type="button"
                    onClick={() => setSellMode("mp")}
                    className={cn(
                      "flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                      sellMode === "mp"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <ArrowRightLeft className="size-3.5" />
                    z % MP
                  </button>
                </div>

                {sellMode === "price" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="pc-sell">Prodejní cena / ks</Label>
                    <Input
                      id="pc-sell"
                      type="number"
                      min={0.001}
                      step={0.001}
                      placeholder="0.000"
                      value={sellPrice}
                      onChange={(e) => setSellPrice(e.target.value)}
                      className="font-mono"
                    />
                    {manualPct !== null && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span
                          className={cn(
                            "rounded border px-1.5 py-px font-mono text-[10px] uppercase",
                            Math.abs(manualPct) > 30
                              ? "border-destructive/40 bg-destructive/10 text-destructive"
                              : "border-border/60 bg-secondary/40"
                          )}
                          title={`Prodejní cena je ${formatPercent(manualPct)} od reference. Hra kontroluje limity ±30 % od reference ceny (burza, kontrakty).`}
                        >
                          {formatPercent(manualPct)} MP
                        </span>
                        {Math.abs(manualPct) > 30 && (
                          <span className="text-[11px] text-destructive">
                            mimo orientační limit ±30 % od reference
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="pc-pct">Sleva / přirážka (% MP)</Label>
                    <div className="relative">
                      <Input
                        id="pc-pct"
                        type="number"
                        min={-50}
                        max={50}
                        step={0.1}
                        value={pct}
                        onChange={(e) => setPct(e.target.value)}
                        className="pr-8 font-mono"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        %
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {PCT_PRESETS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPct(p)}
                          className={cn(
                            "cursor-pointer rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors",
                            pct === p
                              ? "border-primary/40 bg-primary/15 text-primary"
                              : "border-border/70 bg-secondary/40 hover:text-primary"
                          )}
                        >
                          {p} %
                        </button>
                      ))}
                    </div>
                    {ref.refPrice !== null && sellUnit !== null && (
                      <p className="pt-0.5 font-mono text-sm">
                        = {formatPrice(sellUnit)} / ks
                      </p>
                    )}
                    {!selected && (
                      <p className="text-[11px] text-muted-foreground">
                        Nejdřív vyber aktivum – % se počítá z jeho ceny.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Referenční cena (klik = ruční přepsání) */}
          {selected && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-card px-4 py-3">
              <span className="text-xs text-muted-foreground">
                Reference trhu („100 % MP“)
              </span>
              {ref.editing ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    autoFocus
                    type="number"
                    min={0.001}
                    step={0.001}
                    value={ref.draft}
                    onChange={(e) => ref.setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        ref.commitEdit();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        ref.cancelEdit();
                      }
                    }}
                    className="h-8 w-32 font-mono"
                    aria-label="Ruční referenční cena"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title="Uložit (Enter)"
                    onClick={ref.commitEdit}
                  >
                    <Check className="size-4 text-up" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title="Zrušit (Esc)"
                    onClick={ref.cancelEdit}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={ref.startEdit}
                    title="Klikni pro ruční přepsání reference (např. cena z kontraktu)"
                    className="group/ref flex cursor-text items-baseline gap-1.5 rounded-md px-1 -mx-1 transition-colors hover:bg-secondary/60"
                  >
                    <span
                      className={cn(
                        "font-mono text-lg font-semibold tabular-nums group-hover/ref:text-primary",
                        ref.refPrice === null && "text-muted-foreground/70"
                      )}
                    >
                      {ref.refPrice === null
                        ? "zadat cenu"
                        : formatPrice(ref.refPrice)}
                    </span>
                    <Pencil className="size-3 self-center text-muted-foreground opacity-0 transition-opacity group-hover/ref:opacity-100" />
                  </button>
                  <span
                    className="rounded border border-border/60 bg-secondary/40 px-1.5 py-px font-mono text-[10px] uppercase text-muted-foreground"
                    title={
                      ref.usingManual
                        ? "Cena přepsaná ručně"
                        : ref.usingAsk
                          ? "Cena = nejnižší aktivní nabídka na burze (za kolik lze koupit hned)"
                          : "Cena = poslední obchod"
                    }
                  >
                    {ref.usingManual ? "ručně" : ref.usingAsk ? "ask" : "obchod"}
                  </span>
                  {ref.usingManual ? (
                    <button
                      type="button"
                      onClick={ref.resetManual}
                      title="Vrátit automatickou cenu"
                      className="cursor-pointer text-muted-foreground hover:text-foreground"
                    >
                      <RotateCcw className="size-3" />
                    </button>
                  ) : (
                    refAgeLabel !== "–" && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {refAgeLabel}
                      </span>
                    )
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 rounded-full"
                    disabled={ref.askLoading}
                    onClick={ref.reload}
                    title="Načíst aktuální nabídku z orderbooku"
                  >
                    <RefreshCw
                      className={cn("size-3", ref.askLoading && "animate-spin")}
                    />
                    Načíst
                  </Button>
                  {ref.askError && !ref.usingManual && (
                    <span className="text-[11px] text-muted-foreground">
                      {ref.askError}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Náhled výsledku + cesta do rozpadu */}
          {result && (
            <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border/80 bg-card px-4 py-3">
              <div>
                <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Čistý zisk –{" "}
                  {SALE_CHANNELS.find((c) => c.value === activeChannel)?.label.toLowerCase()}
                </p>
                <p
                  className={cn(
                    "font-mono text-2xl font-semibold tabular-nums",
                    plColorClass(result.net)
                  )}
                >
                  {formatSigned(result.net)}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {formatSigned(result.netPerUnit)} / ks
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                className="gap-1.5 rounded-full"
                onClick={() => setTab("rozpad")}
              >
                Rozpad a kanály
                <ArrowRightLeft className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}

      {tab === "rozpad" && (
        <div className="space-y-4">
          {!channels ? (
            <div className="rounded-xl border border-border/80 bg-card p-6 text-sm text-muted-foreground">
              Nejdřív vyber aktivum a vyplň vstupy (tab „Prodej a náklady“).
            </div>
          ) : (
            <>
              {/* Přepínač kanálu */}
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-border/80 bg-secondary/40 p-1">
                {SALE_CHANNELS.map((ch) => (
                  <button
                    key={ch.value}
                    type="button"
                    onClick={() => setActiveChannel(ch.value)}
                    title={ch.hint}
                    className={cn(
                      "flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all",
                      activeChannel === ch.value
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {ch.label}
                  </button>
                ))}
              </div>

              {result && (
                <div className="grid gap-4 lg:grid-cols-2">
                  {/* Hero výsledek aktivního kanálu */}
                  <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5">
                    <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {SALE_CHANNELS.find((c) => c.value === activeChannel)?.label} – čistý zisk
                    </p>
                    <p
                      className={cn(
                        "font-mono text-3xl font-semibold tabular-nums",
                        plColorClass(result.net)
                      )}
                    >
                      {formatSigned(result.net)}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm">
                      <span>{formatSigned(result.netPerUnit)} / ks</span>
                      {result.marginPct !== null && (
                        <span className={plColorClass(result.marginPct)}>
                          marže {formatPercent(result.marginPct)}
                        </span>
                      )}
                      {result.roiPct !== null && (
                        <span className={plColorClass(result.roiPct)}>
                          ROI {formatPercent(result.roiPct)}
                        </span>
                      )}
                    </div>

                    {/* Break-even */}
                    <div className="mt-4 rounded-lg border border-border/60 bg-secondary/30 p-3 text-sm">
                      <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Break-even – minimální prodejní cena v tomto kanálu
                      </p>
                      {breakEven?.price != null ? (
                        <>
                          <p className="font-mono text-lg font-semibold">
                            {formatPrice(breakEven.price)} / ks
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {beDistance !== null &&
                              `tvoje cena je ${formatPercent(beDistance * 100)} nad break-evenem`}
                            {beVsMarket !== null &&
                              ` · ${formatPercent(beVsMarket)} MP`}
                          </p>
                        </>
                      ) : (
                        <p className="text-muted-foreground">–</p>
                      )}
                    </div>
                  </div>

                  {/* Rozpad ekonomiky */}
                  <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5">
                    <p className="mb-3 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Rozpad (celkem za {qtyNum.toLocaleString("cs-CZ")} ks)
                    </p>
                    <dl className="space-y-1.5 font-mono text-sm">
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">
                          Tržba ({formatPrice(sellUnit ?? 0)} ×{" "}
                          {qtyNum.toLocaleString("cs-CZ")})
                        </dt>
                        <dd className="tabular-nums">
                          {formatPrice(result.gross)}
                        </dd>
                      </div>
                      {result.fee !== 0 && (
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">
                            Burzovní poplatek (4 %)
                          </dt>
                          <dd className="tabular-nums text-down">
                            {formatSigned(result.fee)}
                          </dd>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <dt className="flex items-center gap-1.5 text-muted-foreground">
                          Přeprava
                          <span
                            className="rounded border border-border/60 px-1 text-[10px] uppercase"
                            title={
                              result.transportExact
                                ? "poměr položky × cena Přepravy z herního skladu"
                                : "poměr/cena neznámé → odhad % z tržby"
                            }
                          >
                            {result.transportExact ? "exaktní" : "odhad"}
                          </span>
                        </dt>
                        <dd className="tabular-nums text-down">
                          {formatSigned(result.transport)}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">
                          Náklad pořízení
                        </dt>
                        <dd className="tabular-nums">
                          −{formatPrice(buyNum * qtyNum)}
                        </dd>
                      </div>
                      <div className="flex justify-between border-t border-border/60 pt-1.5 text-base font-semibold">
                        <dt>Čistý zisk</dt>
                        <dd
                          className={cn(
                            "tabular-nums",
                            plColorClass(result.net)
                          )}
                        >
                          {formatSigned(result.net)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              )}

              {/* Srovnání všech kanálů */}
              <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5">
                <p className="mb-3 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Srovnání kanálů (stejné vstupy)
                </p>
                <div className="space-y-1.5">
                  {SALE_CHANNELS.map((ch) => {
                    const c = channels[ch.value];
                    const diff = result ? c.net - result.net : null;
                    return (
                      <button
                        key={ch.value}
                        type="button"
                        onClick={() => setActiveChannel(ch.value)}
                        title={ch.hint}
                        className={cn(
                          "flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm transition-colors",
                          activeChannel === ch.value
                            ? "border-primary/40 bg-primary/5"
                            : "border-border/60 hover:bg-secondary/40"
                        )}
                      >
                        <span className="font-medium">{ch.label}</span>
                        <span className="flex items-center gap-3 font-mono tabular-nums">
                          <span
                            className={cn("font-semibold", plColorClass(c.net))}
                          >
                            {formatSigned(c.net)}
                          </span>
                          <span className="hidden text-xs text-muted-foreground sm:inline">
                            {formatSigned(c.netPerUnit)} / ks
                          </span>
                          {diff !== null && ch.value !== activeChannel && (
                            <span
                              className={cn(
                                "w-28 text-right text-xs",
                                plColorClass(diff)
                              )}
                            >
                              {formatSigned(diff)} vs. aktivní
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <CopyChip
                    text={`${SALE_CHANNELS.find((c) => c.value === activeChannel)?.label}: zisk ${result ? formatSigned(result.net) : "–"} za ${qtyNum.toLocaleString("cs-CZ")} ks @ ${sellUnit ? formatPrice(sellUnit) : "–"}`}
                    label="Kopírovat výsledek"
                  />
                </div>

                {/* Metodika */}
                <div className="mt-4 space-y-1 border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground">
                  <p>
                    Maloobchod a kontrakt: bez poplatku; kontrakt spotřebuje
                    polovinu přepravy. Burza: poplatek 4 % z tržby + plná
                    přeprava. Přeprava = poměr položky × cena Přepravy
                    (item 13) z herního skladu; poměr 0 = přesně 0, chybí-li
                    data → odhad 3,06 % z tržby.
                  </p>
                  <p>
                    Nezahrnuje mzdy, administrativu ani úročení skladu –
                    to je náklad budovy, ne prodeje. Herní limity:
                    burza i kontrakty kontrolují ceny ±30 % od reference
                    (24h aktivita obchodu).
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "vyskum" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pc-fromq">Vyřešeno (od Q)</Label>
                    <Input
                      id="pc-fromq"
                      type="number"
                      min={0}
                      max={12}
                      step={1}
                      value={fromQ}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) {
                          const next = Math.max(0, Math.min(12, v));
                          setFromQ(next);
                          if (toQ <= next) setToQ(next + 1);
                        }
                      }}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pc-toq">Cíl (do Q)</Label>
                    <Input
                      id="pc-toq"
                      type="number"
                      min={1}
                      max={13}
                      step={1}
                      value={toQ}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) {
                          setToQ(Math.max(1, Math.min(13, v)));
                        }
                      }}
                      className="font-mono"
                    />
                  </div>
                </div>
                {toQ <= fromQ && (
                  <p className="text-[11px] text-destructive">
                    Cílová kvalita musí být nad startovní (upgrade spotřebuje
                    další patenty).
                  </p>
                )}

                <div className="space-y-1.5">
                  <Label>Research unit (cena na burze)</Label>
                  <ItemCombobox
                    items={comboboxItems}
                    value={
                      researchItemId !== null ? String(researchItemId) : ""
                    }
                    onChange={(id) => setResearchItemId(Number(id))}
                    placeholder="Vyber research unit…"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pc-rprice">
                      Cena unitu ({" "}
                      <span className="font-mono text-[10px] uppercase text-muted-foreground">
                        {researchRef.usingManual
                          ? "ručně"
                          : researchRef.usingAsk
                            ? "ask"
                            : "obchod"}
                      </span>{" "}
                      )
                    </Label>
                    {researchRef.editing ? (
                      <Input
                        autoFocus
                        type="number"
                        min={0.001}
                        step={0.001}
                        value={researchRef.draft}
                        onChange={(e) => researchRef.setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            researchRef.commitEdit();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            researchRef.cancelEdit();
                          }
                        }}
                        className="font-mono"
                        aria-label="Ruční cena research unitu"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={researchRef.startEdit}
                        title="Klikni pro ruční přepsání (např. tvůj nákup researchu)"
                        className="flex h-9 w-full cursor-text items-center rounded-md border border-input bg-transparent px-3 font-mono text-sm transition-colors hover:bg-secondary/60"
                      >
                        {researchRef.refPrice === null
                          ? "zadat cenu"
                          : formatPrice(researchRef.refPrice)}
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pc-upd">Prodáno ks / den</Label>
                    <Input
                      id="pc-upd"
                      type="number"
                      min={0}
                      step={1}
                      placeholder="vlastní číslo"
                      value={unitsPerDay}
                      onChange={(e) => setUnitsPerDay(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="pc-extra">
                    Extra náklad výroby Q ($ / ks, volitelné)
                  </Label>
                  <Input
                    id="pc-extra"
                    type="number"
                    step={0.001}
                    placeholder="0"
                    value={extraCost}
                    onChange={(e) => setExtraCost(e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>

              {/* Výsledky */}
              <div className="space-y-3 rounded-lg border border-border/60 bg-secondary/30 p-4">
                {researchR ? (
                  <>
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-muted-foreground">
                        Patenty Q{fromQ} → Q{toQ}
                      </span>
                      <span className="font-mono text-lg font-semibold">
                        {researchR.patents.toLocaleString("cs-CZ")}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-muted-foreground">
                        Náklad (
                        {RESEARCH_UNITS_PER_PATENT} unitů / patent)
                      </span>
                      <span className="font-mono text-lg font-semibold">
                        {researchR.cost !== null
                          ? formatPrice(researchR.cost)
                          : "–"}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-muted-foreground">
                        Prémie / ks (Q{toQ} vs. Q0 trh)
                      </span>
                      <span
                        className={cn(
                          "font-mono text-lg font-semibold",
                          plColorClass(researchR.premiumPerUnit)
                        )}
                      >
                        {researchR.premiumPerUnit !== null
                          ? formatSigned(researchR.premiumPerUnit)
                          : "–"}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-muted-foreground">
                        Navíc / den (při tvém throughputu)
                      </span>
                      <span
                        className={cn(
                          "font-mono text-lg font-semibold",
                          plColorClass(researchR.extraPerDay)
                        )}
                      >
                        {researchR.extraPerDay !== null
                          ? formatSigned(researchR.extraPerDay)
                          : "–"}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between border-t border-border/40 pt-2">
                      <span className="text-sm text-muted-foreground">
                        Buyback
                      </span>
                      <span className="font-mono text-xl font-semibold">
                        {researchR.paybackDays !== null
                          ? `${Math.ceil(researchR.paybackDays).toLocaleString("cs-CZ")} dní`
                          : "–"}
                      </span>
                    </div>
                    {researchR.paybackDays === null && (
                      <p className="text-[11px] text-muted-foreground">
                        Bez délky prodaných ks/den se buyback nepočítá –
                        prémie Q je spodní hranice, hra mění hlavně rychlost
                        prodeje (vyšší Q se v maloobchodě prodává rychleji).
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Vyber research unit s cenou a cílovou kvalitu nad
                    startovní.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/80 bg-card p-4 text-[11px] leading-relaxed text-muted-foreground">
            <p>
              Mechanika: výzkum zvyšuje kvalitu JEN budoucí výroby (kvalita
              je vlastnost šarže – dosavadní zboží se nezmění). Vyšší Q
              výrobku ≤ min(Q inputů) + 1: na Q3 potřebuješ inputy aspoň Q2.
              Patenty: Q1 = 12, na Q2 dalších 50, na Q3 dalších 500, na Q4
              dalších 2 000, na Q5 dalších 5 000, Q6–Q10 po 10 000. Konverze
              research unitů ≈ 8 unitů na patent (vylepšuje dobrý CTO).
            </p>
            <p className="mt-1">
              Vyšší kvalita v maloobchodu primárně ZRYCHLUJE prodej (polynomiální
              model rychlosti dle ceny) – prémie při stejném počtu prodaných
              ks je proto spodní hranice výnosu. Cílové ceny Q bereme z
              našich ticků pokud existují (řídké kvality bez dat → „–“).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Copy tlačítko (konec souboru – používá ho tab rozpad) ──────────

function CopyChip({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 rounded-full px-2.5 font-mono text-xs text-muted-foreground hover:text-foreground"
      title={`Zkopírovat: ${text}`}
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setOk(true);
            window.setTimeout(() => setOk(false), 1500);
          })
          .catch(() => {
            // clipboard nedostupný (http/iframe) – nic se nezkopíruje
          });
      }}
    >
      {ok ? <Check className="size-3 text-up" /> : <Copy className="size-3" />}
      {label}
    </Button>
  );
}
