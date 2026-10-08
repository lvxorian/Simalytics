"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";

import { ItemCombobox, type ComboboxItem } from "@/components/ui/combobox";
import { ItemIcon } from "@/components/item-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLiveQualityAsks, type LiveQualityAsk } from "@/lib/live-prices";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MarketInstrument } from "@/lib/data";

/**
 * Ceník – dávkový generátor cen kvalit pro herní chat.
 *
 * Zadání: aktivum + sleva/přirážka v % MP → ceník všech kvalit.
 * Reference per kvalita = nejnižší aktivní nabídka burzy (ask) živě
 * přes SSE orderbook hubu (useLiveQualityAsks – nula extra requestů
 * proti ofiko API, limit 1 req/s); fallback = poslední obchod dané
 * kvality z getMarketInstruments(). Kvality se dají odškrtnout
 * (defaultně VŠECHNY s daty). Výstup obsahuje herní emoji kód
 * aktiva `:re-{id}:` – herní chat jej převede na obrázkové emoji
 * (např. Dýna `:re-146:`, Jablka `:re-3:`).
 *
 * Výstup (režim BUY, multiřádek, celá čísla):
 *   BUY :re-146: -3% MP
 *   Q0 1456
 *   Q1 1892
 * Jeden řádek: `BUY :re-146: -3% MP | Q0 1456 | Q1 1892 …`
 */

/** Desetinná čárka i tečka → Number (vzor contract-calculator). */
function num(s: string): number {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

const PCT_PRESETS = [
  "-10",
  "-5",
  "-3",
  "-1",
  "0",
  "+1",
  "+3",
  "+5",
  "+10",
] as const;

/**
 * Kvality pro ceník = SJEDNOCENÍ živého ask ladderu (orderbook v3 API
 * umí Q0–Q10+, ne jen 0–7!) a kvalit s posledním obchodem. Pevný rozsah
 * zahazoval reálné kvality na burze (Dýna 2026-10-08: Q8, Q9, Q11 v
 * ladderu) – zadání zní „ceník VŠECH kvalit“.
 */
function collectQualities(
  askByQuality: Map<number, LiveQualityAsk>,
  prices: Record<string, number | null>
): number[] {
  const set = new Set<number>();
  for (const q of askByQuality.keys()) set.add(q);
  for (const k of Object.keys(prices)) {
    const q = Number(k);
    if (Number.isInteger(q) && (prices[k] ?? null) !== null) set.add(q);
  }
  return [...set].sort((a, b) => a - b);
}

type Side = "BUY" | "SELL";
type Layout = "lines" | "single";
type Rounding = "int" | "dec";

function formatOut(v: number, rounding: Rounding): string {
  if (rounding === "int") return String(Math.round(v));
  // 2 desetinná, cs formát (čárka) bez mezer tisíců – pro chat
  return v.toFixed(2).replace(".", ",");
}

export function CenikBuilder({ items }: { items: MarketInstrument[] }) {
  const [itemId, setItemId] = useState("");
  const [pct, setPct] = useState("-3");
  const [side, setSide] = useState<Side>("BUY");
  const [layout, setLayout] = useState<Layout>("lines");
  const [rounding, setRounding] = useState<Rounding>("int");
  // Odškrtnuté kvality (default = vše zapnuté).
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  const selected = items.find((i) => String(i.id) === itemId) ?? null;
  const hasQualities = selected?.hasQualities ?? true;

  // Asky všech kvalit živě ze SSE hubu (null dokud nejsou data).
  const { qualities: liveAsks } = useLiveQualityAsks(
    selected ? selected.id : 0
  );

  const comboboxItems: ComboboxItem[] = useMemo(
    () =>
      items.map((i) => ({
        id: i.id,
        name: i.name,
        price: i.prices["0"] ?? Object.values(i.prices).find((p) => p) ?? 0,
      })),
    [items]
  );

  // Kvality s daty (obchod i ask) pro aktuální položku.
  const askByQuality = useMemo(() => {
    const m = new Map<number, LiveQualityAsk>();
    for (const q of liveAsks ?? []) m.set(q.quality, q);
    return m;
  }, [liveAsks]);

  // Všechny kvality položky = sjednocení ask ladderu + kvalit s obchodem.
  // Bez useMemo – React Compiler neumí zachovat memoizaci nad derivovaným
  // `selected` a výpočet je triviální (set malého počtu kvalit).
  const allQualities = selected
    ? collectQualities(askByQuality, selected.prices)
    : [];

  const pickItem = (id: string) => {
    setItemId(id);
    setExcluded(new Set());
  };

  const pctNum = num(pct);
  const pctValid = Number.isFinite(pctNum) && Math.abs(pctNum) <= 50;

  // Řádky ceníku: kvality s aspoň jednou cenou, vzestupně, mimo vyřazené.
  const rows: { q: number; ref: number; src: "ask" | "obchod"; price: number }[] =
    [];
  if (selected && pctValid) {
    for (const q of allQualities) {
      if (excluded.has(q)) continue;
      const ask = askByQuality.get(q)?.price ?? null;
      const trade = selected.prices[String(q)] ?? null;
      const ref = ask ?? trade;
      if (ref === null || ref <= 0) continue;
      rows.push({
        q,
        ref,
        src: ask !== null ? "ask" : "obchod",
        price: ref * (1 + pctNum / 100),
      });
    }
  }

  // Položky bez kvalit (výzkumy, Software, Přeprava) = jen Q0.
  const effRows = hasQualities ? rows : rows.filter((r) => r.q === 0);

  // ── Výstupní text pro herní chat ──────────────────────────────
  let output = "";
  if (selected && effRows.length > 0) {
    const pctLabel = `${pctNum > 0 ? "+" : ""}${pctNum}% MP`;
    const header = `${side} :re-${selected.id}: ${pctLabel}`;
    if (layout === "single") {
      output = `${header} | ${effRows
        .map((r) => `Q${r.q} ${formatOut(r.price, rounding)}`)
        .join(" | ")}`;
    } else {
      output = [
        header,
        ...effRows.map((r) => `Q${r.q} ${formatOut(r.price, rounding)}`),
      ].join("\n");
    }
  }

  const copyOutput = () => {
    if (!output) return;
    navigator.clipboard
      .writeText(output)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // clipboard nedostupný (http/iframe) – jen se nic nezkopíruje
      });
  };

  const toggleQuality = (q: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(q)) next.delete(q);
      else next.add(q);
      return next;
    });
  };

  const sliderValue = Number.isFinite(pctNum)
    ? Math.min(50, Math.max(-50, pctNum))
    : 0;

  return (
    <div className="space-y-4">
      {/* ── Vstupy: aktivum + % MP + režimy ─────────────────────── */}
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
              Reference = nejnižší nabídka burzy per kvalita (živě ze SSE,
              fallback poslední obchod). Emoji kód{" "}
              <code className="font-mono">:re-{selected?.id ?? "X"}:</code> se
              do výstupu vloží automaticky.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cenik-pct">Sleva / přirážka (% MP)</Label>
              <div className="relative">
                <Input
                  id="cenik-pct"
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
              {Number.isFinite(pctNum) && Math.abs(pctNum) > 30 && (
                <p className="text-[11px] text-destructive">
                  Mimo herní limit ±30 % od reference – hra takovou cenu na
                  kontraktu/burze pravděpodobně nepřijme.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Režimy výstupu */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <div className="grid shrink-0 grid-cols-2 gap-0.5 rounded-full border border-border/60 bg-secondary/40 p-0.5">
            {(
              [
                ["BUY", "Výkup"],
                ["SELL", "Prodej"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSide(value)}
                className={cn(
                  "cursor-pointer rounded-full px-3 py-1 text-[11px] font-medium transition-all",
                  side === value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-0.5 rounded-full border border-border/60 bg-secondary/40 p-0.5">
            {(
              [
                ["lines", "Řádky"],
                ["single", "Jeden řádek"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setLayout(value)}
                className={cn(
                  "cursor-pointer rounded-full px-3 py-1 text-[11px] font-medium transition-all",
                  layout === value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-0.5 rounded-full border border-border/60 bg-secondary/40 p-0.5">
            {(
              [
                ["int", "Celá"],
                ["dec", "2 desetinná"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setRounding(value)}
                className={cn(
                  "cursor-pointer rounded-full px-3 py-1 text-[11px] font-medium transition-all",
                  rounding === value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {selected && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => setExcluded(new Set())}
                className="cursor-pointer rounded-full border border-border/70 bg-secondary/40 px-2.5 py-1 transition-colors hover:text-foreground"
              >
                Vybrat vše
              </button>
              <button
                type="button"
                onClick={() =>
                  setExcluded(
                    new Set(allQualities.filter((q) => q !== 0))
                  )
                }
                className="cursor-pointer rounded-full border border-border/70 bg-secondary/40 px-2.5 py-1 transition-colors hover:text-foreground"
              >
                Jen Q0
              </button>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* ── Tabulka kvalit ──────────────────────────────────── */}
          <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <ItemIcon
                url={`/icons/${selected.id}.png`}
                name={selected.name}
                size={34}
              />
              <div className="min-w-0">
                <div className="truncate font-medium">{selected.name}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {selected.category ? selected.category.toLowerCase() : ""}
                </div>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-secondary/30 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Kvalita</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Reference
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Ceník ({pctNum > 0 ? "+" : ""}
                      {pctNum} %)
                    </th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {allQualities.filter(
                    (q) =>
                      (hasQualities || q === 0) &&
                      (askByQuality.get(q) !== undefined ||
                        (selected.prices[String(q)] ?? null) !== null)
                  ).map((q) => {
                    const ask = askByQuality.get(q)?.price ?? null;
                    const trade = selected.prices[String(q)] ?? null;
                    const ref = ask ?? trade;
                    const included = !excluded.has(q) && ref !== null;
                    const price =
                      ref !== null ? ref * (1 + pctNum / 100) : null;
                    return (
                      <tr
                        key={q}
                        className={cn(
                          "border-b border-border/30 last:border-0",
                          !included && "opacity-40"
                        )}
                      >
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs font-semibold">
                            Q{q}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {ref !== null ? (
                            <span className="inline-flex items-center gap-1.5">
                              {formatPrice(ref)}
                              <span
                                className={cn(
                                  "rounded border px-1 py-px font-mono text-[9px] uppercase",
                                  ask !== null
                                    ? "border-primary/40 bg-primary/10 text-primary"
                                    : "border-border/60 bg-secondary/40 text-muted-foreground"
                                )}
                                title={
                                  ask !== null
                                    ? "Nejnižší aktivní nabídka burzy (ask)"
                                    : "Poslední obchod (nabídka není dostupná)"
                                }
                              >
                                {ask !== null ? "ask" : "obchod"}
                              </span>
                            </span>
                          ) : (
                            "–"
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {price !== null ? formatPrice(price) : "–"}
                        </td>
                        <td className="px-2 py-2 text-center">
                          {ref !== null && (
                            <input
                              type="checkbox"
                              checked={included}
                              onChange={() => toggleQuality(q)}
                              aria-label={`Q${q} do ceníku`}
                              className="size-4 cursor-pointer accent-primary"
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
              Odškrtnuté kvality se do výstupu nezahrnou. Asky tečou živě ze
              SSE hubu; kvalita bez nabídky měří posledním obchodem.
            </p>
          </div>

          {/* ── Výstup pro chat ─────────────────────────────────── */}
          <div className="flex flex-col rounded-xl border border-border/80 bg-card p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Výstup pro herní chat
              </p>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 rounded-full"
                disabled={!output}
                onClick={copyOutput}
              >
                {copied ? (
                  <Check className="size-3.5 text-up" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {copied ? "Zkopírováno" : "Kopírovat"}
              </Button>
            </div>
            <pre
              className={cn(
                "mt-3 flex-1 whitespace-pre-wrap rounded-lg border border-border/60 bg-secondary/30 p-3 font-mono text-sm leading-relaxed",
                !output && "text-muted-foreground"
              )}
            >
              {output ||
                "Vyber aktivum a zadej % MP – ceník se vygeneruje tady."}
            </pre>
            <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
              <code className="font-mono">:re-{selected.id}:</code> = herní
              emoji aktiva (chat ho převede na obrázek). Formát:{" "}
              {side === "BUY" ? "VÝKUP" : "PRODEJ"} {layout === "lines" ? "po řádcích" : "na jednom řádku"} ·{" "}
              {rounding === "int" ? "celá čísla" : "2 desetinná místa"}.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
