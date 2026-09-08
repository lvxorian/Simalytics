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
npm run sync:daily   # denní sync VWAP/contests/cert kinds (Signal Engine fáze 1)
```

Testy nejsou — ověření = `npm run typecheck` + `npm run build`.

## Architektura

```
db/schema.sql              # items, price_history, positions, condition_log, watchlist
# upgrades: 001_terminal (candles, watchlist), 002_signal_engine (vwap_daily, contests, cert_kinds),
#           003_alerts (alerts s cooldownem)
src/lib/
  signals.ts               # Signal Engine scoring (event/contest/VWAP/momentum → −100…+100)
  alerts.ts                # evaluace alertů (cena + skóre, cooldown)
  notifier.ts              # webhook (Discord/Slack) + e-mail přes Resend REST API
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
  skener/                  # Signal Engine skener příležitostí (BUY/SELL skóre)
  alerts/                  # přehled alertů + stav notifikačních kanálů
  statistiky/              # fáze ekonomiky, eventy, vládní zakázky, makro, budovy
  api/cron/ticks/          # poller ticků (cron-job.org, 5 min, Bearer CRON_SECRET)
  api/cron/daily/          # denní sync VWAP/contests/cert kinds (Bearer CRON_SECRET)
  # poller ticků navíc evaluuje alerty (lib/alerts) – jen když je NEXT_PUBLIC_APP_URL
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
  sekundy UTC (data NIKDY nepřevádět na jiný offset), ale osa a crosshair
  se formattují do Europe/Prague přes `tickMarkFormatter` +
  `localization.timeFormatter` v `price-chart.tsx` (Intl zohlední
  letní čas; jinak by grafy působily o 2 h „zastarale“). Svíčky z `toCandles()` i `aggregateDaily()` mají kontinuitu
  (open = předchozí close, prázdné buckety = plochá svíčka) — neměnit zpět,
  jinak graf vypadá roztříštěně. Kontinuita denních svíček se aplikuje
  přes `applyContinuity()` v market page (Simco Tools data jsou „surová").
- **Fixed Range Volume Profile** (`lib/volume-profile.ts` + overlay v
  `price-chart.tsx`): model à la TradingView – klik na ikonu aktivuje
  kreslení (`vpTool`), tažení vytvoří objekt (`vpRange`), který ZŮSTANE
  PŘIPNUTÝ a nástroj se sám deaktivuje; pan/zoom objekt neovlivní
  (profil se přemalovává synchronně v onRangeChange). Klik do objektu ho
  vybere (`vpSelected` → rámec + úchopy) a u něj vyjede plovoucí koš
  (pozice imperativně z drawVp přes `vpTrashRef`, sedí i během zoomu);
  koš maže, Esc jen odvybere. Overlay je imperativní CANVAS
  (`vpCanvasRef` + `drawVp()`), přemalování přes React state během
  zoomu sekalo. Nástroje VP/pravítko zakazují jen `pressedMouseMove`
  pan (kreslení), kolečko/pinch zoomují dál. Reálný objem: denní svíčky (Simco Tools) i intraday
  ticky od migrace 004 — poller ukládá `fiveMinutesCandlestick.volume`
  z `market/followed?resources=1q0,2q0,…` (1 request pro všechny
  položky) do `price_history.volume`; `toCandles()` objemy sčítá.
  V5 API: cena→pixel je `series.priceToCoordinate()`, NE na `priceScale`.
- **Rekonstrukce grafu vs. zoom**: `vpEnabled`/`rulerEnabled` NESMÍ být
  v deps vytvářejícího efektu grafu – zámek pan/zoom se řídí přes
  `chart.applyOptions()` (bez rekonstrukce). Zoom se ukládá do refu
  (`savedLogicalRange`) přes `subscribeVisibleLogicalRangeChange`
  a obnovuje po rekonstrukci (přepnutí overlaye, auto-refresh); změna
  timeframu záměrně dělá fitContent.
- **Ticker tape**: JEDNA řada marquee se všemi komoditami (CSS keyframes
  v globals.css; rychlost `--ticker-speed` se škáluje s počtem dlaždic,
  default 360s). Dlaždice = cena + 24h % + divergence vs. denní VWAP
  (fair value). Hover pauza přes `.ticker-hover-pause`. Uživatel
  chce POMALÉ tempo — nezrychlovat. Skleněný gradient design: `.ticker-tape`
  (gradientní pás + duhová top linka) a `.ticker-tile` / `-up` / `-down`
  (tónované dlaždice) — barvy jen přes tyto třídy, ne ad-hoc bg.
- **Countdown svíčky** (`components/candle-countdown.tsx` + prop
  `intervalKey` v `price-chart.tsx`): odpočet do zavření aktuálního TF
  v hlavičce grafu; hranice bucketů musí odpovídat agregaci v
  `lib/candles.ts` (epoch intervaly, UTC dny, pondělí pro 1W, 1. den
  měsíce pro 1M). Po zavření svíčky spustí `router.refresh()` a
  chvíli ukáže „obnoveno". Při změně agregace bucketů upravit i
  `bucketStart()`/`bucketEnd()` v candle-countdown.
- **Nástrojová lišta grafu** (`price-chart.tsx`): svislá lišta u levého
  horního okraje grafu (absolute overlay nad canvasem) s velkými ikonami
  18px à la TradingView – Fixed Range VP (`ChartBarDecreasing`), pravítko
  (`RulerDimensionLine`) a po měření i X (vymazat). Countdown svíčky
  zůstává v hlavičce vpravo. Kliky na lištu nesmí spouštět drag/měření
  (lišta je sourozenec chart containeru, ne jeho potomek).
- **Měřicí pravítko** (`price-chart.tsx`): tažením myši
  úsečka od–do (snap na čas svíčky binárním hledáním + snap ceny na OHLC
  ± 12 px), overlay ukáže % změnu, Δ, délku trvání a počet svíček.
  Vzájemně se vylučuje s výběrem rozsahu VP; oba nástroje zamykají
  pan/zoom, Esc/Vymazat ruší měření. Při změně typu grafu (mode/
  candles vs area) počítat s tím, že snap čte `candles` prop.
- **Cenovka bodu v režimu Linie** (`price-chart.tsx`): crosshair se v
  area módu přichytává na body linie; plovoucí cenovka nad bodem
  (`subscribeCrosshairMove` → `seriesData.get(mainSeries)`) ukáže jeho
  cenu. Jen pro `mode === "area"` – u svíček stačí crosshair label na ose.
- **Alerty z grafu**: pravé tlačítko do grafu (`onContextMenu` v
  `price-chart.tsx`) → kontextové menu (`chart-context-menu.tsx`) s
  „Nastavit alert“ – cena předvyplněná z místa kliknutí (snap na OHLC).
  Alerty jedné komodity pak leží v tabulce pod grafem
  (`item-alerts-table.tsx`, data `getAlertsForItem`) – přepínač
  aktivní/vypnutý + mazání; celkový přehled zůstává na /alerts.
  Pravé tlačítko nesmí spustit drag nástrojů (onMouseDown filtruje
  `e.button !== 0`).
- **Fullscreen grafu** (`price-chart.tsx`): tlačítko Maximize2 jen vpravo
  nahoře (countdown plave dole vpravo v grafu, žádné další fullscreen
  tlačítko) →
  fixed overlay s kompletním ovládáním: header s ikonou + názvem, TF
  přepínač, Svíčky/Linie, countdown v headeru; wrapper grafu se přemístí
  přes appendChild
  do overlaye (chart se NERE-MOUNTUJE – zoom/nástroje přežijí) a po
  zavření se vrátí do `originalParentRef`. Esc = nejdřív zruš měření,
  pak zavři fullscreen. `containerRef` musí zůstat uvnitř `chartHostRef`
  (autoSize přepočítá sám; geometrii overlayů bumpne vpEpoch).
- **Auto-refresh dat**: `AutoRefresh` (router.refresh()) na market page
  každých 20 s + okamžitý refresh při návratu na kartu (visibilitychange –
  intervaly na pozadí throttluje prohlížeč, bez toho po přepnutí zpět
  zůstanou staré ceny až do F5). `CandleCountdown` po zavření svíčky
  refreshuje hned + retry v +15/30/45/60 s – poller zapisuje ticky se
  svou fází (cron 5 min), takže hned po zavření tick ještě nemusí být
  v DB.
- **Fáze ekonomiky**: dle hry `recession` = „Recese 📉", `normal` =
  „Stabilní 😐", `boom` = „Růst 📈" (PHASE_LABELS v statistiky/page.tsx).
- **„Živý pravý okraj“ grafu**: `datetime` ticků ze Simco Tools je čas
  POSLEDNÍHO OBCHODU (ne dotazu) – klidný trh znamená ticky staré i hodiny
  (medián ~100 min). Intraday graf proto protahuje plochou rozpracovanou
  svíčku až do aktuálního bucketu (market page) a hero ukazuje „poslední
  obchod před X min“ (`formatRelativeAge`). Není to zastaralá data.
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
