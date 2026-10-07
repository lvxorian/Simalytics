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
  X,
} from "lucide-react";

import { ItemCombobox, type ComboboxItem } from "@/components/ui/combobox";
import { ItemIcon } from "@/components/item-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLiveTick } from "@/lib/live-prices";
import {
  formatPrice,
  formatRelativeAge,
  plColorClass,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MarketInstrument } from "@/lib/data";

/**
 * Kalkulačka kontraktů – převod „X % MP“ ↔ absolutní cena.
 *
 * Ve hře se u kontraktů cena často domlouvá procentuálně od tržní ceny
 * („prodám −3 % MP“ = o 3 % pod aktuální cenou na burze). Kalkulačka
 * funguje OBOMĚRNĚ:
 *
 * 1. Sleva → cena: zadáš % (slider/preset) a spočítá cenu/ks + celkem.
 * 2. Cena → sleva: zadáš cenu z kontraktu, který ti poslal protistrana,
 *    a dozvíš se, kolik % MP to vlastně je (kontrola „opravdu −3 %?“).
 *
 * REFERENCE („MP“):
 *  - KVALITA Q0–Q7: kontrakty se uzavírají na konkrétní kvalitu, takže
 *    prodej Q3 „bot na podpatku“ se počítá z ceny/nabídky Q3. Ask se
 *    dotazuje per (položka, kvalita) z orderbooku (ofiko v3 API přes
 *    /api/live/ask, cache 3 s); obchod = poslední tick této kvality
 *    (Q0 navíc živě přes SSE).
 *  - ZDROJ: NABÍDKA (ask, primární) ↔ OBCHOD (fallback, když burza
 *    nemá aktivní nabídky dané kvality).
 *  - RUČNÍ PŘEPSÁNÍ: klik na cenu → inline input (Enter/✓ uloží,
 *    Esc/× zruší, ↺ vrátí automatickou hodnotu) – ať si můžeš zadat
 *    přesně tu cenu, kterou nabízí protistrana.
 *  - POLOŽKY BEZ KVALIT (výzkumy, Software): ve hře mají jen jednu
 *    univerzální Q0 – selektor kvality se u nich nezobrazuje a dotaz
 *    na orderbook jde vždy na Q0.
 */

/** Desetinná čárka i tečka → Number. */
function num(s: string): number {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

/** Copy tlačítko s potvrzením (fajfka na 1,5 s). */
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
            // clipboard nedostupný (http/iframe) – jen se nic nezkopíruje
          });
      }}
    >
      {ok ? (
        <Check className="size-3 text-up" />
      ) : (
        <Copy className="size-3" />
      )}
      {label}
    </Button>
  );
}

// Presety = typické kontrakty POD trhem (−X % MP). Kladné % se dá zadat
// ručně (slider/input), ale jako preset nedává smysl – prodáváme pod cenu.
const PCT_PRESETS = ["-10", "-5", "-4", "-3", "-2", "-1", "0"] as const;
const QUALITIES = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export function ContractCalculator({
  items,
}: {
  items: MarketInstrument[];
}) {
  const [itemId, setItemId] = useState("");
  const [quality, setQuality] = useState(0);
  const [mode, setMode] = useState<"discount" | "price">("discount");
  const [pct, setPct] = useState("-3");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1000");

  // Referenční cena: „ask“ (nabídka z orderbooku) nebo „trade“ (poslední
  // obchod). Ask se načítá RESTem na požádání – při výběru aktiva/kvality
  // a tlačítkem; žádný polling (limit ofiko API 1 req/s).
  const [refSource, setRefSource] = useState<"ask" | "trade">("ask");
  const [ask, setAsk] = useState<number | null>(null);
  const [askAtMs, setAskAtMs] = useState<number | null>(null);
  const [apiTrade, setApiTrade] = useState<number | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  // Ruční přepsání referenční ceny (klik na cenu → inline input).
  const [manual, setManual] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const selected = items.find((i) => String(i.id) === itemId) ?? null;

  // Položky bez kvalit (výzkumy, Software) mají jen univerzální Q0 –
  // tak funguje hra. Selektor kvality se u nich nezobrazuje a hodnota
  // se zamyká na 0 (případný předchozí výběr Q>0 se nepoužije).
  const hasQualities = selected?.hasQualities ?? true;
  const effQuality = hasQualities ? quality : 0;

  // Živý tick posledního obchodu Q0 ze SSE (pro kvalitu 0; vyšší
  // kvality nemají SSE ticky – cena jde z DB/API).
  const tick = useLiveTick(selected && effQuality === 0 ? selected.id : null);

  const comboboxItems: ComboboxItem[] = useMemo(
    () =>
      items.map((i) => ({
        id: i.id,
        name: i.name,
        // reprezentativní cena pro seznam = Q0, jinak nejnižší dostupná
        price: i.prices["0"] ?? Object.values(i.prices).find((p) => p) ?? 0,
      })),
    [items]
  );

  // Kvality s daty pro aktuální položku (badge zvýrazní dostupné).
  const availableQualities = useMemo(() => {
    const s = new Set<number>();
    if (selected) {
      for (const k of Object.keys(selected.prices)) {
        if (selected.prices[k] !== null) s.add(Number(k));
      }
    }
    return s;
  }, [selected]);

  // ── Načtení aktuální nabídky + obchodu z orderbooku per kvalita ──
  const loadAsk = useCallback(async (id: number, q: number) => {
    setAskLoading(true);
    setAskError(null);
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
        setAsk(null);
        setAskAtMs(null);
        setAskError(
          data.error ??
            `Burza nemá aktivní nabídku Q${q} – měřeno posledním obchodem.`
        );
      }
      setApiTrade(typeof data.trade === "number" && data.trade > 0 ? data.trade : null);
    } catch {
      setAsk(null);
      setAskAtMs(null);
      setAskError("Nabídku se nepovedlo načíst – měřeno obchodem.");
    } finally {
      setAskLoading(false);
    }
  }, []);

  // Poslední obchod vybrané kvality: Q0 živě ze SSE, jinak DB (SSR map,
  // fallback API odpověď).
  const tradeValue = useMemo(() => {
    if (!selected) return null;
    if (effQuality === 0) return tick?.price ?? selected.prices["0"] ?? apiTrade;
    return selected.prices[String(effQuality)] ?? apiTrade;
  }, [selected, effQuality, tick, apiTrade]);

  // Ticking stáří ceny („před X s“) – jen když je co ukazovat.
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Efektivní referenční cena: ruční přepsání > ask > obchod.
  const autoPrice = refSource === "ask" && ask !== null ? ask : tradeValue;
  const refPrice = manual ?? autoPrice;
  const usingAsk = manual === null && refSource === "ask" && ask !== null;
  const usingManual = manual !== null;
  const refMs = usingAsk
    ? askAtMs
    : effQuality === 0 && tick
      ? Date.parse(tick.datetime)
      : null;
  const showAge = refMs !== null;
  useEffect(() => {
    if (!showAge) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [showAge]);
  const refAgeLabel = refMs
    ? formatRelativeAge(Math.min(refMs, nowMs))
    : "–";

  // ── Handlery (setState v efektu seká kaskádové rendery) ─────────
  const pickItem = (id: string) => {
    setItemId(id);
    setPrice("");
    setAsk(null);
    setAskAtMs(null);
    setApiTrade(null);
    setAskError(null);
    setManual(null);
    setEditing(false);
    const next = items.find((i) => String(i.id) === id);
    if (next) void loadAsk(next.id, next.hasQualities === false ? 0 : quality);
  };

  const pickQuality = (q: number) => {
    if (!selected || q === effQuality) return;
    setQuality(q);
    setAsk(null);
    setAskAtMs(null);
    setApiTrade(null);
    setAskError(null);
    setManual(null);
    setEditing(false);
    void loadAsk(selected.id, q);
  };

  const switchRefSource = (value: "ask" | "trade") => {
    setRefSource(value);
    setManual(null);
    setEditing(false);
    if (value === "ask" && selected && ask === null && !askLoading) {
      void loadAsk(selected.id, effQuality);
    }
  };

  const startEdit = () => {
    // I bez automatické ceny (řídká kvalita bez asku/ticků) lze zadat
    // cenu ručně – jinak by Q bez dat byla slepá ulička.
    setDraft(refPrice !== null ? refPrice.toFixed(3) : "");
    setEditing(true);
  };

  const commitEdit = () => {
    const v = num(draft);
    if (Number.isFinite(v) && v > 0) {
      setManual(v);
      setEditing(false);
    }
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft("");
  };

  const pctNum = num(pct);
  const priceNum = num(price);
  const qtyNum = num(qty);
  const qtyValid = Number.isFinite(qtyNum) && qtyNum > 0;

  // ── Směr 1: % MP → cena kontraktu ──────────────────────────────
  const unit =
    refPrice !== null && Number.isFinite(pctNum)
      ? refPrice * (1 + pctNum / 100)
      : null;
  const total = unit !== null && qtyValid ? unit * qtyNum : null;
  const refDown1 = refPrice !== null ? refPrice * 0.99 : null;
  const refUp1 = refPrice !== null ? refPrice * 1.01 : null;

  // ── Směr 2: cena kontraktu → % MP (kontrola cizího kontraktu) ──
  const pctCalc =
    refPrice !== null &&
    refPrice > 0 &&
    Number.isFinite(priceNum) &&
    priceNum > 0
      ? (priceNum / refPrice - 1) * 100
      : null;
  // „Sedí to na kulaté %?“ – za sedící považujeme odchylku < 0,005 b.
  const nearestPct = pctCalc === null ? null : Math.round(pctCalc * 10) / 10;
  const exactMatch =
    pctCalc !== null &&
    nearestPct !== null &&
    Math.abs(pctCalc - nearestPct) < 0.005;
  const nearestPrice =
    refPrice !== null && nearestPct !== null
      ? refPrice * (1 + nearestPct / 100)
      : null;

  const sliderValue =
    Number.isFinite(pctNum) ? Math.min(50, Math.max(-50, pctNum)) : 0;

  const refBadge = usingManual
    ? { label: "ručně", cls: "border-amber-500/40 bg-amber-500/10 text-amber-500" }
    : usingAsk
      ? { label: "ask", cls: "border-primary/40 bg-primary/10 text-primary" }
      : { label: "obchod", cls: "border-border/60 bg-secondary/40" };

  return (
    <div className="space-y-4">
      {/* ── Výběr aktiva ─────────────────────────────────────────── */}
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
            <p className="text-xs text-muted-foreground">
              Reference = aktivní nabídka z burzy pro vybranou KVALITU
              (obnovíš tlačítkem) nebo poslední obchod; cenu lze přepsat
              ručně kliknutím.
            </p>
          </div>

          {/* Referenční cena + kvalita + zdroj + refresh */}
          <div
            className={cn(
              "flex flex-col justify-between gap-3 rounded-lg border border-border/60 bg-secondary/30 px-4 py-3",
              !selected && "opacity-50"
            )}
          >
            {selected ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <Link
                    href={`/market/${selected.id}`}
                    className="group flex min-w-0 items-center gap-3"
                  >
                    <ItemIcon
                      url={`/icons/${selected.id}.png`}
                      name={selected.name}
                      size={34}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium group-hover:text-primary">
                        {selected.name}
                      </span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {selected.category
                          ? selected.category.toLowerCase()
                          : ""}
                      </span>
                    </span>
                  </Link>

                  {/* Tlačítko: načíst aktuální nabídku z orderbooku */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 rounded-full"
                    disabled={askLoading}
                    title={`Načíst aktuální nejnižší nabídku Q${effQuality} z burzy (orderbook)`}
                    onClick={() => void loadAsk(selected.id, effQuality)}
                  >
                    <RefreshCw
                      className={cn(
                        "size-3.5",
                        askLoading && "animate-spin"
                      )}
                    />
                    {askLoading ? "Načítám…" : "Načíst cenu"}
                  </Button>
                </div>

                {/* Kvalita – kontrakty se uzavírají na konkrétní Q.
                    Položky bez kvalit (výzkumy, Software) mají jen
                    univerzální Q0 – selektor u nich nezobrazujeme. */}
                {hasQualities && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs text-muted-foreground">
                      Kvalita:
                    </span>
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
                            "cursor-pointer rounded-full border px-2.5 py-1 font-mono text-xs transition-colors",
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

                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    {/* Cena – klik přepíše ručně (inline editace) */}
                    {editing ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          autoFocus
                          type="number"
                          min={0.001}
                          step={0.001}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitEdit();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              cancelEdit();
                            }
                          }}
                          className="h-9 w-36 font-mono"
                          aria-label="Ruční referenční cena"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title="Uložit ruční cenu (Enter)"
                          onClick={commitEdit}
                        >
                          <Check className="size-4 text-up" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title="Zrušit (Esc)"
                          onClick={cancelEdit}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={startEdit}
                        title={
                          refPrice !== null
                            ? "Klikni pro ruční přepsání ceny (např. cena z kontraktu protistrany)"
                            : "Žádná automatická cena – klikni a zadej ji ručně"
                        }
                        className="group/ref flex cursor-text items-baseline gap-1.5 rounded-md px-1 -mx-1 transition-colors hover:bg-secondary/60"
                      >
                        <span
                          className={cn(
                            "font-mono text-2xl font-semibold tabular-nums group-hover/ref:text-primary",
                            refPrice === null &&
                              "text-muted-foreground/70"
                          )}
                        >
                          {refPrice === null ? "zadat cenu" : formatPrice(refPrice)}
                        </span>
                        <Pencil className="size-3 self-center text-muted-foreground opacity-0 transition-opacity group-hover/ref:opacity-100" />
                      </button>
                    )}
                    <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] font-medium tracking-wider text-muted-foreground">
                      {/* Badge zdroje: ručně / ask / obchod */}
                      <span
                        className={cn(
                          "rounded border px-1.5 py-px uppercase",
                          refBadge.cls
                        )}
                        title={
                          usingManual
                            ? `Cena přepsaná ručně (${formatPrice(manual)}); ↺ vrátí automatickou hodnotu`
                            : usingAsk
                              ? `Cena = nejnižší aktivní nabídka Q${effQuality} na burze (za kolik lze koupit hned)`
                              : `Cena = poslední obchod Q${effQuality} (nabídka Q${effQuality} není dostupná)`
                        }
                      >
                        {refBadge.label}
                      </span>
                      {usingManual ? (
                        <button
                          type="button"
                          onClick={() => {
                            setManual(null);
                            setEditing(false);
                          }}
                          className="cursor-pointer rounded p-px transition-colors hover:text-foreground"
                          title="Vrátit automatickou cenu (ask/obchod)"
                        >
                          <RotateCcw className="size-3" />
                        </button>
                      ) : (
                        tick &&
                        !usingAsk &&
                        effQuality === 0 && (
                          <span className="relative flex size-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60" />
                            <span className="relative inline-flex size-1.5 rounded-full bg-up" />
                          </span>
                        )
                      )}
                      {!usingManual && <span>{refAgeLabel}</span>}
                    </div>
                  </div>

                  {/* Přepínač zdroje referenční ceny */}
                  <div className="grid shrink-0 grid-cols-2 gap-0.5 rounded-full border border-border/60 bg-secondary/40 p-0.5">
                    {(
                      [
                        ["ask", "Nabídka"],
                        ["trade", "Obchod"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => switchRefSource(value)}
                        className={cn(
                          "cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-medium transition-all",
                          refSource === value && !usingManual
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {askError && !usingManual && (
                  <p className="text-[11px] leading-tight text-muted-foreground">
                    {askError}
                  </p>
                )}
              </>
            ) : (
              <p className="w-full text-center text-sm text-muted-foreground">
                Nejdřív vyber aktivum ze seznamu
              </p>
            )}
          </div>
        </div>
      </div>

      {selected && refPrice !== null && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* ── Vstupy ─────────────────────────────────────────── */}
          <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5">
            {/* Přepínač směru (vzor PortfolioSellDialog) */}
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border/80 bg-secondary/40 p-1">
              <button
                type="button"
                onClick={() => setMode("discount")}
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                  mode === "discount"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Percent className="size-3.5" />
                Sleva → cena
              </button>
              <button
                type="button"
                onClick={() => setMode("price")}
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                  mode === "price"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ArrowRightLeft className="size-3.5" />
                Cena → sleva
              </button>
            </div>

            {mode === "discount" ? (
              <div className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cc-pct">Sleva / přirážka (% MP)</Label>
                  <div className="relative">
                    <Input
                      id="cc-pct"
                      type="number"
                      step={0.1}
                      value={pct}
                      onChange={(e) => setPct(e.target.value)}
                      className="pr-9 font-mono"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                      %
                    </span>
                  </div>
                  {/* Slider – táhni od −50 % do +50 % MP */}
                  <input
                    type="range"
                    min={-50}
                    max={50}
                    step={0.5}
                    value={sliderValue}
                    onChange={(e) => setPct(e.target.value)}
                    aria-label="Sleva % MP (posuvník)"
                    className="mt-1 w-full accent-primary"
                  />
                  <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                    <span>−50 %</span>
                    <span>0 %</span>
                    <span>+50 %</span>
                  </div>
                </div>

                {/* Presety – rychlé kulaté procento */}
                <div className="flex flex-wrap gap-1.5">
                  {PCT_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPct(p)}
                      className={cn(
                        "cursor-pointer rounded-full border px-2.5 py-1 font-mono text-xs transition-colors",
                        num(pct) === num(p)
                          ? "border-primary/40 bg-primary/15 text-primary"
                          : "border-border/70 bg-secondary/40 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {p} %
                    </button>
                  ))}
                </div>

                {/* Herní limit: burza i kontrakty kontrolují ceny ±30 %
                    od reference ceny (24h aktivita; dřív 40 %). Rozsah
                    přepínače (−50…+50) je širší než limit – upozorníme. */}
                {Number.isFinite(pctNum) && Math.abs(pctNum) > 30 && (
                  <p className="text-[11px] text-destructive">
                    Mimo herní limit ±30 % od reference – hra takovou cenu
                    na kontraktu/burze pravděpodobně nepřijme.
                  </p>
                )}

                <div className="space-y-2">
                  <Label htmlFor="cc-qty">Množství (ks) – pro celkem</Label>
                  <Input
                    id="cc-qty"
                    type="number"
                    min={1}
                    step={1}
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                <Label htmlFor="cc-price">
                  Cena z kontraktu ($/ks) – zkontroluj % MP
                </Label>
                <div className="relative">
                  <Input
                    id="cc-price"
                    type="number"
                    min={0.001}
                    step={0.001}
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder={unit !== null ? unit.toFixed(3) : "0.000"}
                    className="pr-9 font-mono"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                    $
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Vlož cenu, kterou ti protistrana napsala do kontraktu –
                  vpravo uvidíš, jestli odpovídá domluvenému procentu.
                </p>
              </div>
            )}
          </div>

          {/* ── Výsledek ───────────────────────────────────────── */}
          <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5">
            {mode === "discount" ? (
              <>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Cena kontraktu / ks (Q{effQuality})
                </p>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span
                    className={cn(
                      "font-mono text-4xl font-semibold tabular-nums",
                      plColorClass(Number.isFinite(pctNum) ? pctNum : 0)
                    )}
                  >
                    {formatPrice(unit)}
                  </span>
                  {Number.isFinite(pctNum) && pctNum !== 0 && (
                    <span
                      className={cn(
                        "font-mono text-sm font-medium",
                        plColorClass(pctNum)
                      )}
                    >
                      {pctNum > 0 ? "+" : ""}
                      {pctNum} % MP
                    </span>
                  )}
                </div>
                {unit !== null && (
                  <CopyChip text={unit.toFixed(3)} label="kopírovat cenu" />
                )}

                <div className="mt-4 space-y-1.5 border-t border-border/60 pt-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Celkem ({qtyValid ? qtyNum.toLocaleString("cs-CZ") : "–"}{" "}
                      ks Q{effQuality})
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatPrice(total)}
                      {total !== null && (
                        <CopyChip
                          text={String(Math.round(total))}
                          label=""
                        />
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      MP Q{effQuality} (100 %) ·{" "}
                      {usingManual ? "ručně" : usingAsk ? "nabídka" : "obchod"}
                    </span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {formatPrice(refPrice)}
                    </span>
                  </div>
                </div>

                {/* Citlivost ±1 % MP – kde se cena posune o procento */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-border/60 bg-secondary/30 px-3 py-2">
                    <div className="font-mono text-[10px] tracking-wider text-muted-foreground">
                      −1 % MP
                    </div>
                    <div className="font-mono text-sm tabular-nums text-down">
                      {formatPrice(refDown1)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-secondary/30 px-3 py-2">
                    <div className="font-mono text-[10px] tracking-wider text-muted-foreground">
                      +1 % MP
                    </div>
                    <div className="font-mono text-sm tabular-nums text-up">
                      {formatPrice(refUp1)}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Zadaná cena odpovídá (Q{effQuality})
                </p>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span
                    className={cn(
                      "font-mono text-4xl font-semibold tabular-nums",
                      plColorClass(pctCalc ?? 0)
                    )}
                  >
                    {pctCalc === null
                      ? "–"
                      : `${pctCalc > 0 ? "+" : pctCalc < 0 ? "−" : ""}${Math.abs(pctCalc).toFixed(2)} % MP`}
                  </span>
                </div>

                {pctCalc !== null && exactMatch ? (
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-up/30 bg-up/10 px-3 py-1 text-xs font-medium text-up">
                    <Check className="size-3.5" />
                    Sedí na {nearestPct} % MP – souhlasí s domluvou
                  </div>
                ) : pctCalc !== null && nearestPrice !== null ? (
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-down/30 bg-down/10 px-3 py-1 text-xs font-medium text-down">
                    Nekulaté % – nejblíž je {nearestPct} % MP (
                    {formatPrice(nearestPrice)})
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Zadej cenu kontraktu vlevo.
                  </p>
                )}

                <div className="mt-4 space-y-1.5 border-t border-border/60 pt-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Zadaná cena</span>
                    <span className="font-mono tabular-nums">
                      {Number.isFinite(priceNum) ? formatPrice(priceNum) : "–"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      MP Q{effQuality} (100 %) ·{" "}
                      {usingManual ? "ručně" : usingAsk ? "nabídka" : "obchod"}
                    </span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {formatPrice(refPrice)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Rozdíl vs. MP
                    </span>
                    <span
                      className={cn(
                        "font-mono tabular-nums",
                        plColorClass(pctCalc ?? 0)
                      )}
                    >
                      {pctCalc === null
                        ? "–"
                        : formatPrice(
                            (priceNum - refPrice) * (qtyValid ? qtyNum : 1)
                          )}
                      {qtyValid && " (celkem)"}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {selected && refPrice === null && !editing && (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Pro {selected.name} Q{effQuality} zatím nemáme tržní cenu ani aktivní
          nabídku – zkus jinou kvalitu, „Načíst cenu“, nebo zadej cenu ručně
          kliknutím.
        </div>
      )}
    </div>
  );
}
