"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Database,
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
import { Input } from "@/components/ui/input";
import { ItemIcon } from "@/components/item-icon";
import { LivePrice } from "@/components/live-price-text";
import { cn } from "@/lib/utils";
import { formatCompact, formatPrice } from "@/lib/format";
import type { DomRow } from "@/lib/dom";

type SortKey = "name" | "depth" | "offers" | "best_ask" | "volume24h";
type SortDir = "asc" | "desc";

/** Odstraní diakritiku a lowercase – hledání „zlata“ najde i „Zlatá“. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function DomTable({ initialRows }: { initialRows: DomRow[] }) {
  const [rows, setRows] = useState<DomRow[]>(initialRows);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("depth");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // ── Polling /api/dom (10 s) – DOM page má vlastní tempo, SSE netřeba ──
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const res = await fetch("/api/dom", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { rows: DomRow[] };
        if (!cancelled) {
          setRows(data.rows);
          setUpdatedAt(Date.now());
        }
      } catch {
        // tiché – zůstávají poslední data
      }
      if (!cancelled) timer = setTimeout(poll, 10_000);
    };
    // První refresh až po 10 s – SSR data jsou čerstvá (force-dynamic)
    timer = setTimeout(poll, 10_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    const base = q
      ? rows.filter((r) => normalize(r.name).includes(q))
      : rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name, "cs") * dir;
        case "depth":
          return (a.depth - b.depth) * dir;
        case "offers":
          return (a.offers - b.offers) * dir;
        case "best_ask":
          return (
            ((a.best_ask ?? Infinity) - (b.best_ask ?? Infinity)) * dir
          );
        case "volume24h":
          return ((a.volume24h ?? 0) - (b.volume24h ?? 0)) * dir;
      }
    });
  }, [rows, query, sortKey, sortDir]);

  const maxDepth = Math.max(...rows.map((r) => r.depth), 1);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const SortHeader = ({
    label,
    sortId,
    className,
    align = "left",
  }: {
    label: string;
    sortId: SortKey;
    className?: string;
    align?: "left" | "right";
  }) => (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => toggleSort(sortId)}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground",
          align === "right" && "flex-row-reverse"
        )}
      >
        {sortKey === sortId ? (
          sortDir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ChevronsUpDown className="size-3 opacity-40" />
        )}
        {label}
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-3">
      {/* Ovládání: hledání + info o čerstvosti */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat položku…"
            className="pl-8 pr-8"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Vymazat hledání"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <Database className="size-3" />
          {filtered.length} položek · sken celého trhu ~1× / 1 min
          {updatedAt && (
            <span className="hidden sm:inline">
              · refresh {new Date(updatedAt).toLocaleTimeString("cs-CZ")}
            </span>
          )}
        </span>
      </div>

      <div className="rounded-xl border border-border/60 bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHeader label="Položka" sortId="name" />
              <SortHeader
                label="Nabídek"
                sortId="offers"
                align="right"
                className="text-right"
              />
              <SortHeader
                label="Objem na burze"
                sortId="depth"
                align="right"
                className="text-right"
              />
              <SortHeader
                label="Nejnižší nabídka"
                sortId="best_ask"
                align="right"
                className="text-right"
              />
              <TableHead className="hidden text-right lg:table-cell">
                Poslední obchod
              </TableHead>
              <SortHeader
                label="24h objem"
                sortId="volume24h"
                align="right"
                className="hidden text-right md:table-cell"
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.item_id}>
                <TableCell>
                  <Link
                    href={`/market/${r.item_id}`}
                    className="flex items-center gap-2.5 hover:text-primary"
                  >
                    <ItemIcon url={r.image_url} name={r.name} />
                    <span className="font-medium">{r.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      Q0
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {r.offers}
                </TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">
                  <span className="inline-flex items-center justify-end gap-2">
                    {/* hloubka – vizuální bar proporcionální celému trhu */}
                    <span
                      className="hidden h-2 rounded-sm bg-primary/25 sm:inline-block"
                      style={{
                        width: `${Math.max(2, (r.depth / maxDepth) * 120)}px`,
                      }}
                      aria-hidden
                    />
                    {formatCompact(r.depth)}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {r.best_ask !== null ? formatPrice(r.best_ask) : "—"}
                </TableCell>
                <TableCell className="hidden text-right font-mono tabular-nums lg:table-cell">
                  <LivePrice itemId={r.item_id} initialPrice={r.last_price} />
                </TableCell>
                <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground md:table-cell">
                  {r.volume24h !== null ? formatCompact(r.volume24h) : "—"}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {rows.length === 0
                    ? "DOM sken ještě nikdy neproběhl – data se objeví do ~1 minuty od spuštění aplikace."
                    : "Nic nenalezeno."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
