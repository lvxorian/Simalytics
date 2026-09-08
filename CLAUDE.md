# CLAUDE.md

Kontext pro AI agenty pracující na tomto repozitáři.

## Co je to za projekt

**Simalytics** — analytický dashboard a portfolio tracker pro virtuální
ekonomiku **SimCompanies**. Next.js 16 (App Router, React 19, Turbopack) +
PostgreSQL (Neon) + Tailwind CSS v4 + shadcn/ui komponenty.

- **Produkce**: https://simalytics.vercel.app (Vercel, deploy z mainu)
- **Repo**: https://github.com/lvxorian/Simalytics
- **Jazyk UI**: čeština (všechny texty, commity i data z API jsou v cs)

## Příkazy

```bash
npm run dev          # dev server (localhost:3000)
npm run build        # produkční build (Turbopack)
npm run typecheck    # tsc --noEmit – POKAŽDÉ před commitem
npm run lint         # eslint
npm run db:schema    # aplikuje db/schema.sql do Neonu
npm run db:names     # seed názvů/kategorií/ikon (db/seed-names.sql)
npm run icons:download  # stáhne ikony z CDN do public/icons + image_url do DB
npm run fetch:market # lokální test cron skriptu (ceny → Neon)
npm run backfill:candles  # denní svíčky ze Simco Tools → DB
```

Testy nejsou — ověření = `npm run typecheck` + `npm run build`.

## Architektura

```
db/schema.sql              # items, price_history, positions, condition_log, watchlist
src/lib/
  db.ts                    # postgres.js klient (Neon pooled, prepare: false pro PgBouncer)
  data.ts                  # VŠECHNY SQL dotazy (server-only, nikdy do client komponent)
  simcotools.ts            # klient api.simcotools.com (limit 2 req/s, realm 0 = Magnates)
  candles.ts               # agregace ticků na OHLC + weekly/monthly + indikátory
  format.ts                # cs-CZ formátování ($ = narrowSymbol!, %, data, plColorClass)
src/app/
  page.tsx                 # dashboard: market pulse KPI, top gainers/losers, market table
  market/[resourceId]/     # graf: 5m/15m/1H/4H/1D/1W/1M, overlaye, live summary
  positions/               # pozice + P/L + condition logging
  watchlist/               # karty se sparklinami
  statistiky/              # fáze ekonomiky, eventy, vládní zakázky, makro, budovy
  api/cron/ticks/          # poller ticků (cron-job.org, 5 min, Bearer CRON_SECRET)
  api/search/              # hledání instrumentů pro header
  actions.ts               # server actions (open/close position, notes, watchlist)
src/components/            # vizní komponenty (viz níže)
```

## Klíčové konvence a pasti

- **Data vrstva je server-only**: `data.ts` importuje `db.ts` (postgres.js).
  Nikdy nedávej `"use client"` na stránku, která importuje z `lib/data` —
  build spadne na Client Component SSR. Interaktivní části vždy vytáhni do
  samostatné client komponenty (vzor: `watchlist-card.tsx`).
- **Server vs. client komponenty**: stránky jsou server components s
  `export const dynamic = "force-dynamic"`; client komponenty mají vlastní
  soubor a `"use client"` nahoře (star-button, header-search, watchlist-card,
  positions-table, price-chart, market-table, add-note-form, position-form,
  auto-refresh, site-header).
- **Ikony komodit**: lokální `public/icons/{id}.png` (151 souborů, stažené z
  SimCompanies CDN). Cesty řeší `itemImageUrl()` v `format.ts`. Nová ikona
  se přidá přes `npm run icons:download`.
- **ItemIcon**: `bare` prop = bez pozadí/rámu (používá jen ticker tape).
  Všude jinde ikony dostanou "mince" styl (bg-secondary + ring).
- **Ceny**: vždy `formatPrice()` z `lib/format.ts` — cs-CZ + narrowSymbol
  (dává `2,30 $`, NE `US$`). Nikdy nevypisuj cenu ručně.
- **Barvy trhu**: jen tokeny `text-up` (#22ab94) / `text-down` (#ec5063) a
  `plColorClass()`. Žádné ad-hoc emerald/red — paleta je v `globals.css`
  (ink navy pozadí, modrá primár #5b8def, IBM Plex Sans/Mono).
- **Grafy**: TradingView Lightweight Charts v5 API — `chart.addSeries(
  CandlestickSeries, …)`, NE staré `addCandlestickSeries()`. Čas = unix
  sekundy UTC. Svíčky z `toCandles()` mají kontinuitu (open = předchozí
  close, prázdné buckety = plochá svíčka) — neměnit zpět, jinak 5m graf
  vypadá roztříštěně.
- **Ticker tape**: dvě řady marquee proti sobě (CSS keyframes v globals.css,
  `--ticker-speed: 360s`). Hover pauza přes `.ticker-hover-pause`. Uživatel
  chce POMALÉ tempo — nezrychlovat.
- **Fáze ekonomiky**: dle hry `recession` = „Recese 📉", `normal` =
  „Stabilní 😐", `boom` = „Růst 📈" (PHASE_LABELS v statistiky/page.tsx).
- **DB numeric**: postgres.js vrací numeric jako string — v `data.ts` se
  vždy konvertuje na Number na hranici. Timestamptz → ISO string.
- **Simco Tools**: fetch vždy server-side s `next: { revalidate }` kvůli
  ratelimitu (2 req/s). `Accept-Language: cs` pro české názvy.

## Externí API

1. **SimCompanies** (`api.simcompanies.com`) — oficiální, jen GET, 1 req/5 s;
   GitHub Actions cron `*/15 * * * *` (`fetch-market.mjs`).
2. **Simco Tools** (`api.simcotools.com`) —OpenAPI spec:
   `https://api.simcotools.com/docs/simcotools.yaml`. Používané endpointy:
   candlesticks, prices, market summary, events, government-orders, phases,
   resources, realm summaries, stats/buildings.

## Deployment

- Vercel (Hobby) — deploy automaticky z pushe na main. Env: `DATABASE_URL`
  (Neon pooled), `CRON_SECRET`, `SIMCOTOOLS_REALM`, `SIMCOTOOLS_LANGUAGE`.
- Poller ticků: cron-job.org → `/api/cron/ticks` každých 5 min s Bearer
  tokenem.
- GitHub Actions: záložní sync cen každých 15 min (secret DATABASE_URL).

## Commit styl

Čeština, imperative/krátký subject + body s "proč". Footer:

```
🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
```

Push na main = produkční deploy. Nikdy nepushovat bez souhlasu uživatele.
