"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bell,
  Briefcase,
  Percent,
  Radar,
  Star,
  TrendingUp,
} from "lucide-react";

import { HeaderSearch } from "@/components/header-search";
import {
  AlertNotifications,
  type HeaderAlert,
} from "@/components/alert-notifications";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Trh", icon: TrendingUp },
  { href: "/skener", label: "Skener", icon: Radar },
  { href: "/watchlist", label: "Watchlist", icon: Star },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/alerts", label: "Alerty", icon: Bell },
  { href: "/statistiky", label: "Statistiky", icon: BarChart3 },
  { href: "/kalkulacka", label: "Kalkulačka", icon: Percent },
] as const;

export function SiteHeader({
  alerts,
}: {
  alerts: HeaderAlert[];
}) {
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

          {/* Pilulková navigace – JEN IKONY (label v title tooltipu a
              sr-only pro čtečky). S texty se 7 položek + hledání + zvonek
              + LIVE do max-w-7xl nevejde (potřebuje ~1390 px) a poslední
              položky (Kalkulačka) přetékaly do skrolovací zóny. Ikony
              řádně velké (size-4.5) a odsazené, ať je cíl kliknutí
              komfortní; aktivní položka má primární podkres. */}
          <nav
            aria-label="Hlavní navigace"
            className="no-scrollbar flex shrink-0 items-center gap-0.5 rounded-full border border-border/70 bg-secondary/50 p-1"
          >
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              const Icon = "icon" in item ? item.icon : null;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                    active
                      ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/30"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  )}
                >
                  {Icon && <Icon className="size-4.5" />}
                  <span className="sr-only">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <HeaderSearch />

          {/* Zvonek – přehled nastavených alertů + přepínač režimu */}
          <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-0">
            <AlertNotifications alerts={alerts} />
            <ThemeToggle />
          </div>

          <div className="hidden shrink-0 items-center gap-2 rounded-full border border-up/20 bg-up/5 px-3 py-1.5 font-mono text-[10px] font-medium tracking-wider text-up xl:flex">
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
