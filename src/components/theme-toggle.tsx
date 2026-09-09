"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Přepínač dark/light režimu v hlavičce.
 *
 * Stav se drží v <html class="light"> + localStorage ("simalytics-theme"),
 * aby přežil reload. Skript v layout.tsx nastaví třídu PŘED prvním
 * renderem (žádný FOUC), tady jen synchronizujeme ikonu s DOM a togglujeme.
 */
export function ThemeToggle() {
  const [light, setLight] = useState(false);

  // Synchronizace s DOM po mountu (server renderuje dark jako výchozí)
  useEffect(() => {
    setLight(document.documentElement.classList.contains("light"));
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    try {
      localStorage.setItem("simalytics-theme", next ? "light" : "dark");
    } catch {
      // localStorage může být blokovaný (private mode) – jen přepneme UI
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? "Přepnout na tmavý režim" : "Přepnout na světlý režim"}
      title={light ? "Tmavý režim" : "Světlý režim"}
      className={cn(
        "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border/70 bg-secondary/50 text-muted-foreground",
        "transition-colors hover:text-foreground"
      )}
    >
      {/* Obě ikony v DOM – překlopení bez hydration flash: viditelnou
          vybírá CSS dle třídy na <html>, ne React state */}
      <Sun className="hidden size-4 dark:block" />
      <Moon className="block size-4 dark:hidden" />
    </button>
  );
}
