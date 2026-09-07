"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";

import { itemImageUrl } from "@/lib/format";
import { cn } from "@/lib/utils";

type SearchResult = {
  item_id: number;
  name: string;
  category: string | null;
  image_url: string | null;
  price: number;
};

/**
 * Hledání instrumentů v hlavičce (vlevo od LIVE badge).
 * Debounce 200 ms, klávesy ↑/↓ + Enter, Esc zavře, klik mimo zavře.
 */
export function HeaderSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // klik mimo = zavřít
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // debounce dotaz na /api/search
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as { results: SearchResult[] };
        setResults(data.results ?? []);
        setActive(0);
      } catch {
        // abortovaný request ignorujeme
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, open]);

  function go(id: number) {
    setOpen(false);
    setQuery("");
    router.push(`/market/${id}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[active];
      if (r) go(r.item_id);
    }
  }

  return (
    <div ref={rootRef} className="relative ml-auto md:ml-0">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Hledat instrument…"
          aria-label="Hledat instrument"
          className="h-9 w-40 rounded-full border border-border bg-secondary/50 pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] focus:w-56 focus:border-ring/60 focus:outline-none focus:ring-2 focus:ring-ring/30 sm:w-48 sm:focus:w-64"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Vymazat hledání"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Dropdown výsledků */}
      {open && (query.trim().length > 0 || loading) && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl shadow-black/40">
          {loading && results.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Hledám…
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">
              Nic nenalezeno.
            </div>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1">
              {results.map((r, i) => {
                const img = itemImageUrl(r.image_url);
                return (
                  <li key={r.item_id}>
                    <Link
                      href={`/market/${r.item_id}`}
                      onClick={() => {
                        setOpen(false);
                        setQuery("");
                      }}
                      onMouseEnter={() => setActive(i)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 transition-colors",
                        i === active ? "bg-accent" : "hover:bg-accent/60"
                      )}
                    >
                      {img && (
                        <Image
                          src={img}
                          alt={r.name}
                          width={28}
                          height={28}
                          className="rounded bg-secondary p-0.5"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {r.name}
                        </div>
                        {r.category && (
                          <div className="truncate text-xs text-muted-foreground">
                            {r.category}
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {new Intl.NumberFormat("cs-CZ", {
                          style: "currency",
                          currency: "USD",
                          maximumFractionDigits: 2,
                        }).format(r.price)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
