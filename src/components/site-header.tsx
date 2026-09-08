"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bell, Radar } from "lucide-react";

import { HeaderSearch } from "@/components/header-search";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Trh" },
  { href: "/skener", label: "Skener" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/alerts", label: "Alerty" },
  { href: "/positions", label: "Pozice" },
  { href: "/statistiky", label: "Statistiky" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40">
      {/* Horná lišta – sklo, plavoucí pilulka s navigací */}
      <div className="border-b border-border/60 bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/50">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-4 px-4 sm:gap-6">
          <Link href="/" className="group flex shrink-0 items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-inset ring-primary/30 transition-colors group-hover:bg-primary/25">
              <Activity
                className="size-4 text-primary"
                strokeWidth={2.5}
              />
            </span>
            {/* Skener – pulsující indikátor, když jsou aktivní signály */}
            <span className="font-mono text-sm font-bold tracking-[0.22em]">
              SIM<span className="text-primary">ALYTICS</span>
            </span>
          </Link>

          {/* Pilulková navigace */}
          <nav className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-full border border-border/70 bg-secondary/50 p-1">
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                    active
                      ? "bg-accent text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <HeaderSearch />

          <div className="hidden shrink-0 items-center gap-2 rounded-full border border-up/20 bg-up/5 px-3 py-1.5 font-mono text-[10px] font-medium tracking-wider text-up md:flex">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-up" />
            </span>
            LIVE
          </div>
        </div>
      </div>

      {/* Sliding ticker tape – vkládá se v layoutu pod hlavičku */}
    </header>
  );
}
