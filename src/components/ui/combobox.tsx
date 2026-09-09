"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

import { ItemIcon } from "@/components/item-icon";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ComboboxItem = {
  id: number;
  name: string;
  price: number;
};

/** Diakritika-nezávislé porovnání (dyně = Dyně = DYNE). */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Combobox „obojí v jednom“ (vzor shadcn Command, ale bez cmdk závislosti):
 * - klik do pole → píšeš, seznam se průběžně filtruje (diakritika-nezávisle)
 * - klik na šipku vpravo → otevře se kompletní seznam (jako obyčejný select)
 * - klávesy: ↑/↓ navigace, Enter vybere, Esc zavře
 * Když je vybráno nějaké aktivum, zobrazuje se jako hodnota pole (s ikonou
 * a cenou); křížek ho zruší. Skryté `input name=item_id` nese hodnotu pro
 * formulář – komponenta je drop-in náhrada Selectu v NewPositionForm.
 */
export function ItemCombobox({
  items,
  value,
  onChange,
  name = "item_id",
  placeholder = "Vyber komoditu…",
  required = false,
  invalid = false,
}: {
  items: ComboboxItem[];
  value: string;
  onChange: (id: string) => void;
  name?: string;
  placeholder?: string;
  required?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selected = items.find((i) => String(i.id) === value) ?? null;

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return items;
    return items.filter((i) => normalize(i.name).includes(q));
  }, [items, query]);

  // klik mimo = zavřít (stejný vzor jako ostatní dropdowny v appce)
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // při otevření fokusu na input (když klikneš na šipku, ať jde hned psát)
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // scroll na zvýrazněnou položku (klávesová navigace)
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${highlight}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  const openList = () => {
    setQuery("");
    setHighlight(0);
    setOpen(true);
    inputRef.current?.focus();
  };

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === "ArrowDown") {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlight]) pick(String(filtered[highlight].id));
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div ref={rootRef} className="relative">
      {/* skryté pole pro formulář – hodnota vybrané položky */}
      <input type="hidden" name={name} value={value} />

      <div
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] dark:bg-input/30",
          "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
          invalid && "border-destructive ring-[3px] ring-destructive/20"
        )}
        onClick={() => {
          if (!open) openList();
        }}
      >
        {selected && !open ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <ItemIcon
              url={`/icons/${selected.id}.png`}
              name={selected.name}
              size={20}
            />
            <span className="min-w-0 flex-1 truncate">{selected.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {formatPrice(selected.price)}
            </span>
          </span>
        ) : (
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <input
          ref={inputRef}
          value={open ? query : ""}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (!open) openList();
          }}
          placeholder={selected && !open ? selected.name : placeholder}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          aria-label="Vyhledat komoditu"
          autoComplete="off"
        />
        {/* křížek = zrušit výběr; jen když je vybráno a seznam je zavřený */}
        {selected && !open && (
          <button
            type="button"
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Zrušit výběr"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
          >
            <X className="size-3.5" />
          </button>
        )}
        {/* šipka = klasické otevření kompletního seznamu */}
        <button
          type="button"
          tabIndex={-1}
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label={open ? "Zavřít seznam" : "Otevřít seznam"}
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            if (open) {
              setOpen(false);
              setQuery("");
            } else {
              openList();
            }
          }}
        >
          <ChevronDown
            className={cn(
              "size-4 transition-transform duration-200",
              open && "rotate-180"
            )}
          />
        </button>
      </div>

      {open && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
          role="listbox"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              Nic nenalezeno{query ? ` pro „${query}“` : ""}.
            </p>
          ) : (
            filtered.map((item, idx) => {
              const isSel = String(item.id) === value;
              const isHi = idx === highlight;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-idx={idx}
                  className={cn(
                    "flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors",
                    isHi && "bg-accent text-accent-foreground",
                    !isHi && "hover:bg-accent/60"
                  )}
                  onMouseEnter={() => setHighlight(idx)}
                  onClick={() => pick(String(item.id))}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ItemIcon
                      url={`/icons/${item.id}.png`}
                      name={item.name}
                      size={20}
                    />
                    <span className="min-w-0 truncate">{item.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
                    {formatPrice(item.price)}
                    {isSel && <Check className="size-3.5 text-primary" />}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
