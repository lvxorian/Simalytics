"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ChartCandlestick,
  ChevronsUpDown,
  Search,
  X,
} from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ItemIcon } from "@/components/item-icon";
import { LiveChangeBadge, LivePrice } from "@/components/live-price-text";
import { useLiveTick } from "@/lib/live-prices";
import { Sparkline } from "@/components/sparkline";
import { StarButton } from "@/components/star-button";
import { cn } from "@/lib/utils";
import {
  formatCompact,
  formatDateTime,
  formatPrice,
} from "@/lib/format";
import {
  gradeLiquidity,
  gradeVolatility,
  gradeColorClass,
  gradeDots,
} from "@/lib/metrics";
import type { LatestPriceRow } from "@/lib/types";

export type MarketRow = LatestPriceRow & { change24h: number | null };

type SortKey =
  | "name"
  | "price"
  | "change24h"
  | "quantity"
  | "recorded_at"
  | "volatility"
  | "liquidity";
type SortDir = "asc" | "desc";

/** Odstraní diakritiku a lowercase – hledání „jablka“ najde i „Jablka“. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function MarketTable({
  rows,
  watchedIds,
  sparklines,
  volatility,
  liquidity,
}: {
  rows: MarketRow[];
  watchedIds?: Set<number>;
  sparklines?: Map<number, number[]>;
  /** item_id → annualizovaná volatilita v % (batch z denních svíček). */
  volatility?: Map<number, number>;
  /** item_id → obchody/24h + obrat/den (batch z ticků a denních svíček). */
  liquidity?: Map<
    number,
    { tradesPerDay: number | null; turnover: number | null }
  >;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    const matched = q
      ? rows.filter(
          (r) =>
            normalize(r.name).includes(q) ||
            (r.category ? normalize(r.category).includes(q) : false) ||
            (r.db_letter ? normalize(r.db_letter).includes(q) : false)
        )
      : rows;

    const dir = sortDir === "asc" ? 1 : -1;
    return [...matched].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return dir * a.name.localeCompare(b.name, "cs");
        case "price":
          return dir * (a.price - b.price);
        case "change24h":
          return (
            dir * ((a.change24h ?? -Infinity) - (b.change24h ?? -Infinity))
          );
        case "quantity":
          return dir * ((a.quantity ?? -Infinity) - (b.quantity ?? -Infinity));
        case "recorded_at":
          return dir * a.recorded_at.localeCompare(b.recorded_at);
        case "volatility":
          return dir * ((volatility?.get(a.item_id) ?? -1) - (volatility?.get(b.item_id) ?? -1));
        case "liquidity":
          return dir * ((liquidity?.get(a.item_id)?.tradesPerDay ?? -1) - (liquidity?.get(b.item_id)?.tradesPerDay ?? -1));
      }
    });
  }, [rows, query, sortKey, sortDir, volatility, liquidity]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // číselné sloupce řadíme sestupně (největší/nejlepší první)
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Search className="size-4" />
          Celý trh (
          {filtered.length}
          {query.trim() && filtered.length !== rows.length && (
            <span className="normal-case">/{rows.length}</span>
          )}
          )
        </h2>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat komoditu nebo kategorii…"
            aria-label="Hledat v tabulce trhu"
            className="h-9 rounded-full bg-secondary/50 pl-9 pr-8"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Vymazat hledání"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
        <Table>
          <TableHeader>
            <TableRow className="border-border/60 hover:bg-transparent">
              <ThSort
                label="Položka"
                sortKey="name"
                current={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                className="pl-4"
              />
              <ThSort
                label="Cena"
                sortKey="price"
                current={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                className="text-right"
              />
              <ThSort
                label="24h změna"
                sortKey="change24h"
                current={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                className="text-right"
              />
              <TableHead className="hidden text-right md:table-cell">
                Trend 24h
              </TableHead>
              <ThSort
                label="Nabídka"
                sortKey="quantity"
                current={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                className="hidden text-right md:table-cell"
              />
              <ThSort
                label="Volatilita"
                sortKey="volatility"
                current={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                className="hidden text-right xl:table-cell"
              />
              <ThSort
                label="Likvidita"
                sortKey="liquidity"
                current={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                className="hidden text-right xl:table-cell"
              />
              <ThSort
                label="Aktualizováno"
                sortKey="recorded_at"
                current={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                className="hidden text-right lg:table-cell"
              />
              <TableHead className="w-10 pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  Nic nenalezeno
                  {query.trim() && (
                    <>
                      {" pro „"}
                      <span className="text-foreground">{query.trim()}</span>“
                    </>
                  )}
                  .
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow key={row.item_id} className="group border-border/40">
                  <TableCell className="pl-4 font-medium">
                    <div className="flex items-center gap-3">
                      <StarButton
                        itemId={row.item_id}
                        watched={watchedIds?.has(row.item_id) ?? false}
                        size="sm"
                      />
                      <ItemIcon url={row.image_url} name={row.name} size={38} />
                      <div>
                        <Link
                          href={`/market/${row.item_id}`}
                          className="hover:text-primary hover:underline underline-offset-4"
                        >
                          {row.name}
                        </Link>
                        {row.db_letter && (
                          <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                            {row.db_letter}
                          </span>
                        )}
                        {row.category && (
                          <div className="text-xs text-muted-foreground">
                            {row.category}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="text-right">
                    <LivePrice
                      itemId={row.item_id}
                      initialPrice={row.price}
                      className="text-sm"
                    />
                  </TableCell>

                  <TableCell className="text-right">
                    <LiveChangeBadge
                      itemId={row.item_id}
                      initialPrice={row.price}
                      initialChange24h={row.change24h}
                    />
                  </TableCell>

                  <TableCell className="hidden text-right md:table-cell">
                    <div className="flex justify-end">
                      <Sparkline
                        data={sparklines?.get(row.item_id)}
                        uid={`mt-${row.item_id}`}
                        width={96}
                        height={30}
                      />
                    </div>
                  </TableCell>

                  <TableCell className="hidden text-right font-mono text-muted-foreground md:table-cell">
                    {formatCompact(row.quantity)}
                  </TableCell>

                  <VolatilityCell
                    pct={volatility?.get(row.item_id) ?? null}
                  />
                  <LiquidityCell
                    data={liquidity?.get(row.item_id) ?? null}
                  />

                  <TableCell className="hidden text-right font-mono text-xs text-muted-foreground lg:table-cell">
                    <LiveUpdatedCell
                      itemId={row.item_id}
                      initialRecordedAt={row.recorded_at}
                    />
                  </TableCell>

                  <TableCell className="pr-4">
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary"
                    >
                      <Link
                        href={`/market/${row.item_id}`}
                        aria-label={`Graf ${row.name}`}
                      >
                        <ChartCandlestick className="size-4" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

/**
 * Buňka Volatilita: tečky ●●●○○ dle grade (annualizovaná σ denních
 * výnosů) + hodnota v %, tooltip vysvětlí kontext – stejné klasifikace
 * jako karty na market page.
 */
function VolatilityCell({ pct }: { pct: number | null }) {
  const profile = gradeVolatility(pct);
  return (
    <TableCell
      className="hidden text-right xl:table-cell"
      title={
        pct === null
          ? "Volatilita: málo dat pro výpočet (chybí denní svíčky)."
          : `Volatilita ${profile.label.toLowerCase()} – ${profile.description} Annualizovaná σ denních výnosů: ${pct.toFixed(0)} %.`
      }
    >
      <div className="flex items-center justify-end gap-1.5">
        <span
          className={cn(
            "text-[10px] tracking-tight",
            gradeColorClass(profile.grade)
          )}
        >
          {gradeDots(profile.grade)}
        </span>
        <span className="text-xs text-muted-foreground">
          {pct === null ? "–" : `${pct.toFixed(0)} %`}
        </span>
      </div>
    </TableCell>
  );
}

/**
 * Buňka Likvidita: tečky dle grade (obchody/24h primárně) + počet
 * obchodů, tooltip doplní obrat – stejné klasifikace jako market page.
 */
function LiquidityCell({
  data,
}: {
  data: { tradesPerDay: number | null; turnover: number | null } | null;
}) {
  const trades = data?.tradesPerDay ?? null;
  const profile = gradeLiquidity(trades);
  return (
    <TableCell
      className="hidden text-right xl:table-cell"
      title={
        trades === null
          ? "Likvidita: bez ticků (poler tuto položku nesbírá)."
          : `Likvidita ${profile.label.toLowerCase()} – ${profile.description}${data?.turnover != null ? ` Obrat ${formatPrice(data.turnover)} / den.` : ""}`
      }
    >
      <div className="flex items-center justify-end gap-1.5">
        <span
          className={cn(
            "text-[10px] tracking-tight",
            gradeColorClass(profile.grade)
          )}
        >
          {gradeDots(profile.grade)}
        </span>
        <span className="text-xs text-muted-foreground">
          {trades === null ? "–" : `${trades}/24h`}
        </span>
      </div>
    </TableCell>
  );
}

/** Sortovatelná hlavička tabulky – klik přepíná sloupec / směr. */
function ThSort({
  label,
  sortKey,
  current,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = current === sortKey;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`Seřadit podle: ${label}`}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ChevronsUpDown className="size-3 opacity-50" />
        )}
      </button>
    </TableHead>
  );
}

/**
 * Buňka „Aktualizováno“: SSR čas posledního obchodu se po připojení
 * SSE nahradí živým tickem; nový obchod se zvýrazní (text-up, pulse).
 */
function LiveUpdatedCell({
  itemId,
  initialRecordedAt,
}: {
  itemId: number;
  initialRecordedAt: string;
}) {
  const tick = useLiveTick(itemId);
  const iso = tick ? tick.datetime : initialRecordedAt;
  return (
    <span
      className={cn(
        tick && "text-up transition-colors duration-700"
      )}
      title={tick ? "Živý obchod – aktualizováno právě teď" : undefined}
    >
      {formatDateTime(iso)}
    </span>
  );
}

export function MarketTableSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Položka</TableHead>
            <TableHead className="text-right">Cena</TableHead>
            <TableHead className="text-right">24h změna</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: count }).map((_, i) => (
            <TableRow key={i}>
              <TableCell className="pl-4" colSpan={3}>
                <div className="h-5 w-full animate-pulse rounded bg-muted" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
