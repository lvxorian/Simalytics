# Codebuff knowledge

Projekt: Simalytics (Next.js 16 + React 19 + Tailwind v4 + Neon Postgres).
UI v češtině. Produkce: simalytics.vercel.app (Vercel, deploy z main).

## Ověřování změn

- Po každé úpravě: `npm run typecheck` (tsc --noEmit) a před pushem i
  `npm run build`. Testy v projektu nejsou.
- Build spadne, pokud stránka (server component) importuje `lib/data` a má
  zároveň `"use client"` — interaktivní kód vždy do samostatného souboru.

## Design systém (globals.css)

- Paleta: ink navy (#0b0e14 pozadí), primár #5b8def (modrá), trh
  `--up: #22ab94` / `--down: #ec5063`. Žádné emerald/red třídy — jen tokeny
  `text-up`, `text-down`, `plColorClass()`.
- Fonty: IBM Plex Sans / IBM Plex Mono (next/font, proměnné
  `--font-ibm-plex-sans` / `--font-ibm-plex-mono`).
- Ceny vždy přes `formatPrice()` (cs-CZ, narrowSymbol → „2,30 $", ne „US$").
- Ikony komodit: `ItemIcon` (public/icons/{id}.png), default „mince" styl
  (bg + ring), prop `bare` = bez rámu (používá jen ticker tape).
- Fáze ekonomiky: Recese 📉 / Stabilní 😐 / Růst 📈 (PHASE_LABELS).

## Grafy (lightweight-charts v5)

- API: `chart.addSeries(CandlestickSeries, …)` (v5), ne addCandlestickSeries.
- Svíčky: `toCandles()` z lib/candles — kontinuita (open = prev close,
  prázdné buckety = ploché). Něvrátit na "surové" buckety.
- Timeframy: 5m/15m/1H/4H/1D z ticků, 1W/1M agregace z denních svíček.
- Overlaye: Objem (default on), VWAP, Průměr, Max/Min hladiny.
- Ticker tape: dvě řady marquee proti sobě, tempo `--ticker-speed: 360s`,
  hover pauza. Uživatel chce pomalé tempo a velké ikony — neměnit bez zadání.

## Datové vrstvy

- `lib/data.ts` — vše z Neonu (postgres.js, numeric jako string → Number).
- `lib/simcotools.ts` — api.simcotools.com (2 req/s, Accept-Language: cs,
  realm 0 = Magnates). Spec: api.simcotools.com/docs/simcotools.yaml.
- SimCompanies API: jen GET, 1 req/5 s (GitHub Actions 15 min).

## Portfolio (sem se píš i nové funkce)

- Aktivum = otevřené pozice agregované na POLOŽKU – kvality se
  NEROZLIŠUJÍ (Q0 i Q1 = jedno aktivum, aktuální cena z ticku Q0).
  Neskoušet zpět per-quality agregaci – uživatel to explicitně zrušil.
- Prodej = FIFO odklepnutí (`sellPortfolioAsset`), limitní prodej =
  hlídka alerts kind='limit_sell' (poller notifikuje, zvonek + tón).
- Interaktivita koláče alokace: hover resetuje i `onMouseLeave` na
  legendě i segmentech (jinak zůstává zvýraznění viset).

## Git

- Commit messages v češtině, footer „🤖 Generated with Codebuff /
  Co-Authored-By: Codebuff <noreply@codebuff.com>".
- Push na main = okamžitý produkční deploy — jen na výslovný žádost uživatele.
