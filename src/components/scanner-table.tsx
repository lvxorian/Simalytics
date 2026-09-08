"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Radar, Search, X } from "lucide-react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { ItemIcon } from "@/components/item-icon";
import { ChangeBadge } from "@/components/change-badge";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import type { SignalReason } from "@/lib/signals";

export type ScannerRow = {
  item_id: number;
  name: string;
  image_url: string | null;
  category: string | null;
  price: number;
  change24h: number | null;
  vwap: number | null;
  score: number;
  direction: "BUY" | "SELL" | "NEUTRAL";
  reasons: SignalReason[];
};

type DirectionFilter = "all" | "BUY" | "SELL" | "NEUTRAL";

/** Odstraní diakritiku a lowercase – konzistentní s MarketTable. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const REASON_KIND_LABEL: Record<SignalReason["kind"], string> = {
  event: "Event",
  contest: "Soutěž",
  vwap: "VWAP",
  momentum: "Momentum",
};

export function ScannerTable({ rows }: { rows: ScannerRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DirectionFilter>("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return rows.filter((r) => {
      if (filter !== "all" && r.direction !== filter) return false;
      if (!q) return true;
      return (
        normalize(r.name).includes(q) ||
        (r.category ? normalize(r.category).includes(q) : false)
      );
    });
  }, [rows, query, filter]);

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="space-y-3">
      {/* ── Filtry ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-full border border-border/80 bg-card p-1">
          {(
            [
              { key: "all", label: "Vše" },
              { key: "BUY", label: "Nákupní" },
              { key: "SELL", label: "Prodejní" },
              { key: "NEUTRAL", label: "Bez signálu" },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setFilter(o.key)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                filter === o.key
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat komoditu…"
            aria-label="Hledat ve skeneru"
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

      {/* ── Tabulka ────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
        <Table>
          <TableHeader>
            <TableRow className="border-border/60 hover:bg-transparent">
              <TableHead className="pl-4">Položka</TableHead>
              <TableHead className="text-right">Cena</TableHead>
              <TableHead className="hidden text-right md:table-cell">
                VWAP
              </TableHead>
              <TableHead className="hidden text-right md:table-cell">
                24h
              </TableHead>
              <TableHead className="w-28 text-right">Skóre</TableHead>
              <TableHead className="w-10 pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  Žádné položky neodpovídají filtru.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => {
                const isOpen = expanded.has(row.item_id);
                const up = row.score > 0;
                const down = row.score < 0;

                return (
                  <TableRow
                    key={row.item_id}
                    className={cn(
                      "group border-border/40",
                      isOpen && "bg-accent/20"
                    )}
                  >
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-3">
                        <ItemIcon url={row.image_url} name={row.name} size={36} />
                        <div className="min-w-0">
                          <Link
                            href={`/market/${row.item_id}`}
                            className="font-medium hover:text-primary hover:underline underline-offset-4"
                          >
                            {row.name}
                          </Link>
                          {row.category && (
                            <div className="text-xs text-muted-foreground">
                              {row.category}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="text-right font-mono">
                      {formatPrice(row.price)}
                    </TableCell>

                    <TableCell className="hidden text-right font-mono text-muted-foreground md:table-cell">
                      {formatPrice(row.vwap)}
                    </TableCell>

                    <TableCell className="hidden text-right md:table-cell">
                      <ChangeBadge value={row.change24h} size="sm" />
                    </TableCell>

                    <TableCell className="text-right">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-sm font-semibold tabular-nums",
                          up && "border-up/25 bg-up/10 text-up",
                          down && "border-down/25 bg-down/10 text-down",
                          !up && !down && "border-border bg-muted text-muted-foreground"
                        )}
                      >
                        <Radar className="size-3" />
                        {row.score > 0 ? "+" : ""}
                        {row.score}
                      </span>
                    </TableCell>

                    <TableCell className="pr-4">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(row.item_id)}
                        aria-label={isOpen ? "Skrát důvody" : "Zobrazit důvody"}
                        aria-expanded={isOpen}
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        {isOpen ? (
                          <ChevronUp className="size-4" />
                        ) : (
                          <ChevronDown className="size-4" />
                        )}
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* ── Rozbalené řádky: důvody signálu ─────────────── */}
        {filtered
          .filter((r) => expanded.has(r.item_id))
          .map((row) => (
            <div
              key={`reasons-${row.item_id}`}
              className="border-t border-border/60 bg-background/40 px-4 py-4"
            >
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Proč skóre {row.score > 0 ? "+" : ""}
                {row.score}?
              </div>
              {row.reasons.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Žádné aktivní signály – trh je v klidu.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {row.reasons.map((reason, i) => (
                    <li
                      key={`${row.item_id}-${i}`}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        {REASON_KIND_LABEL[reason.kind]}
                      </span>
                      <span className="text-foreground/90">{reason.label}</span>
                      <span
                        className={cn(
                          "ml-auto font-mono font-medium tabular-nums",
                          reason.points > 0 ? "text-up" : "text-down"
                        )}
                      >
                        {reason.points > 0 ? "+" : ""}
                        {reason.points}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
      </div>
    </section>
  );
}
