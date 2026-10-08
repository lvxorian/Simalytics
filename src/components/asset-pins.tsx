"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import { ItemIcon } from "@/components/item-icon";
import { cn } from "@/lib/utils";

/**
 * Připíchnutá aktiva – řádek pilulkových butonů pro rychlé přepínání
 * (kalkulačka kontraktů + profit kalkulačka).
 *
 * - Pin = jen POLOŽKA (id), ne kvalita – kvalita se přepíná zvlášť,
 *   jak je v kalkulačkách zvykem. Klik na pilulku volá onSelect se
 *   stejným id, jaké posílá ItemCombobox (handlery pickItem řeší
 *   načtení asku, reset ruční ceny apod.).
 * - Sada pinů je per KALKULAČKA (storageKey) a žije v localStorage –
 *   jde o osobní preference prohlížeče, ne o data pro server. Načtení
 *   v efektu (ne v initial state) kvůli SSR hydration mismatchi.
 * - Přidání: „+“ připíchne aktuálně vybrané aktivum z comboboxu
 *   (value); duplicity se nepřidávají. Odebrání: × uvnitř pilulky
 *   (viditelné pořád – funguje i na dotykových zařízeních).
 * - Začíná se PRÁZDNÝM řádkem (jen „+“) – uživatel si sám vybere,
 *   která aktiva chce mít po ruce. Stornovaná/poližkou neexistující
 *   id se při načtení zahodí.
 */

const MAX_PINS = 10;

export function AssetPins({
  items,
  value,
  onSelect,
  storageKey,
  max = MAX_PINS,
}: {
  /** Nabídka instrumentů (stačí id + name) – pro ikonu, název i validaci. */
  items: { id: number; name: string }[];
  /** Aktuálně vybrané aktivum v comboboxu (string id) – kandidát na připíchnutí. */
  value: string;
  /** Přepnutí na aktivum – stejný kontrakt jako onChange ItemComboboxu. */
  onSelect: (id: string) => void;
  /** localStorage klíč (per kalkulačka). */
  storageKey: string;
  max?: number;
}) {
  const [pins, setPins] = useState<number[]>([]);

  // Načtení z localStorage až po mountu (SSR bezpečné); neznámá id se zahodí.
  // NIC tu nezapisujeme – zápis dělá jen persist() v handlerech, jinak se
  // ukládací efekt při mountu přežvejknul s načítacím a localStorage se
  // přepsal prázdným polem dřív, než se načtený pin stal (StrictMode v dev
  // to zdvojnásobil – pin zmizel po odchodu z page a návratu).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const known = new Set(items.map((i) => i.id));
          setPins(
            parsed.filter(
              (id): id is number =>
                typeof id === "number" && Number.isInteger(id) && known.has(id)
            )
          );
        }
      }
    } catch {
      // poškozený záznam – začni prázdný, při další změně se přepíše
    }
    // items je stabilní SSR prop (nemění se za běhu) – čteme jen jednou,
    // opakované spuštění při změně reference pole by piny zbytečně resetovalo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Persist: uloží do localStorage hned v handleru (add/remove) – jediný
  // zápisový bod, žádný efekt → žádný mount-race s načítáním.
  const persist = (next: number[]) => {
    setPins(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // localStorage nedostupný (privátní režim apod.) – piny jen nevydrží
    }
  };

  const byId = new Map(items.map((i) => [i.id, i]));
  const valueNum = Number(value);
  const canPin =
    Number.isInteger(valueNum) &&
    byId.has(valueNum) &&
    !pins.includes(valueNum) &&
    pins.length < max;

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pins.map((id) => {
        const item = byId.get(id);
        if (!item) return null;
        const active = value === String(id);
        return (
          <span
            key={id}
            className={cn(
              "group inline-flex items-center gap-1 rounded-full border py-0.5 pl-1 pr-0.5 text-xs transition-colors",
              active
                ? "border-primary/50 bg-primary/10"
                : "border-border/60 bg-secondary/40 hover:border-border"
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(String(id))}
              title={`Přepnout na ${item.name}`}
              className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-1"
            >
              <ItemIcon
                url={`/icons/${id}.png`}
                name={item.name}
                size={18}
              />
              <span
                className={cn(
                  "hidden max-w-32 truncate sm:inline",
                  active ? "font-medium text-foreground" : "text-muted-foreground"
                )}
              >
                {item.name}
              </span>
            </button>
            <button
              type="button"
              onClick={() => persist(pins.filter((x) => x !== id))}
              title={`Odebrat ${item.name} z připíchnutých`}
              className="cursor-pointer rounded-full p-0.5 text-muted-foreground/60 hover:bg-background hover:text-down"
            >
              <X className="size-3" />
              <span className="sr-only">Odebrat {item.name}</span>
            </button>
          </span>
        );
      })}

      <button
        type="button"
        onClick={() => {
          if (canPin) persist([...pins, valueNum]);
        }}
        disabled={!canPin}
        title={
          pins.length >= max
            ? `Max ${max} pilulek – nejprve nějakou odeber`
            : !Number.isInteger(valueNum) || !byId.has(valueNum)
              ? "Nejprve vyber aktivum"
              : "Připíchnout aktuálně vybrané aktivum"
        }
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-1 text-xs transition-colors",
          canPin
            ? "cursor-pointer border-border text-muted-foreground hover:border-primary/50 hover:text-primary"
            : "cursor-not-allowed border-border/40 text-muted-foreground/50"
        )}
      >
        <Plus className="size-3.5" />
        <span className="sr-only">Připíchnout aktivum</span>
      </button>
    </div>
  );
}
