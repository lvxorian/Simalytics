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
#           003_alerts (alerts s cooldownem), 005_alert_seen (seen_at), 006_limit_sell_alerts (kind 'limit_sell'),
#           008_alert_v2 (direction 'cross', one_shot)
src/lib/
  metrics.ts               # likvidita (obchody/24h + obrat) a volatilita (annualizovaná σ log-výnosů) – karty na market page
  alerts.ts                # evaluace alertů (cena nad/pod/cross + skóre + limitní prodeje,
                           # one_shot = smazat po první aktivaci, cooldown) – 5min cron
  notifier.ts              # webhook (Discord/Slack) + e-mail přes Resend REST API
  price-hub.ts             # LIVE cenový hub (Fáze 3): smyčka 2 s (followed/prices střídavě),
                           # detekce obchodů, evaluace alertů, orderbook hlídka buy alertů
  live-eval.ts             # sdílená evaluace alertů (ask-aware) + persist ticků (hub i REST)
  live-prices.ts           # client store: SSE /api/live/stream + REST fallback;
                           # useLiveTick (stabilní reference), useLivePriceOverride
  simco-official.ts        # ofiko v3 orderbook (throttle 1,1 s): nejnižší ask, top N nabídek
  alert-tone.ts            # sdílený zvuk alertů (WebAudio, unlock po prvním gestu)
src/lib/
  db.ts                    # postgres.js klient (Neon pooled, prepare: false pro PgBouncer)
  data.ts                  # VŠECHNY SQL dotazy (server-only, nikdy do client komponent)
  simcotools.ts            # klient api.simcotools.com (limit 2 req/s, realm 0 = Magnates)
  candles.ts               # agregace ticků na OHLC + weekly/monthly + indikátory + mergeLiveTick
  format.ts                # cs-CZ formátování ($ = narrowSymbol!, %, data, plColorClass)
src/app/
  page.tsx                 # dashboard: market pulse KPI, top gainers/losers, market table
  market/[resourceId]/     # graf: 5m/15m/1H/4H/1D/1W/1M, overlaye, live summary
  positions/               # pozice + P/L + condition logging (držba z portfolio
                           # page se ukládá jako otevřená pozice do positions)
  watchlist/               # karty se sparklinami
  portfolio/               # aktiva = agregace otevřených pozic na POLOŽKU
                           # (kvality se nerozlišují; víc nákupů = 1 aktivum
                           # s váženým průměrem); koláč alokace, vývoj hodnoty
                           # v čase, P/L, editace nákupů (lots) tužkou, prodej
                           # (FIFO odklepnutí) + limitní prodej = alert kind
                           # 'limit_sell' (poller notifikuje při dosažení limitu)
  skener/                  # Signal Engine skener příležitostí (BUY/SELL skóre)
  alerts/                  # přehled alertů + stav notifikačních kanálů
  statistiky/              # fáze ekonomiky, eventy, vládní zakázky, makro, budovy
  api/cron/ticks/          # poller ticků (cron-job.org, 5 min, Bearer CRON_SECRET)
  api/cron/daily/          # denní sync VWAP/contests/cert kinds (Bearer CRON_SECRET)
  # poller ticků navíc evaluuje alerty (lib/alerts) – jen když je NEXT_PUBLIC_APP_URL
  api/live/                # REST fallback živých cen (ticky + evaluace alertů, throttle 30 s)
  api/live/stream/         # SSE push (hello/tick/alert/stale + heartbeat 15 s, maxDuration 300)
  api/live/ask/            # orderbook položky (ask + top 5 nabídek, cache 3 s)
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
  LIVE čísla přepisuje imperativní `ticker-live-updater.tsx` (data-*
  atributy; React re-render stovek dlaždic by sekal marquee) – pořadí
  dlaždic zůstává ze serveru.
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
  „Nastavit alert“ – cena předvyplněná z místa kliknutí (snap na OHLC,
  3 desetinná místa). Cenové alerty se navíc kreslí do grafu jako
  přetahovací linky (`chart-alert-lines.tsx`, à la TV): drag mění práh
  přes `updateAlertThresholdAction`, koš maže; popisek končí PŘÍMO na
  oddělovací čáře cenové osy (šířka osy = container − paneSize().width).
  Limitní prodeje z portfolia se do grafu Nekreslí (jen zvonek, /alerts).
  Alerty jedné komodity pak
  leží v tabulce pod grafem (`item-alerts-table.tsx`, data
  `getAlertsForItem`) – přepínač aktivní/vypnutý + mazání; celkový
  přehled zůstává na /alerts. Pravé tlačítko nesmí spustit drag
  nástrojů (onMouseDown filtruje `e.button !== 0`). Kontextové menu
  (`chart-context-menu.tsx`) NESMÍ mít `useLayoutEffect` volající
  `setPos` s novým objektem bez deps – vznikne nekonečný render cyklus
  a error page (již jednou opraveno; porovnání souřadnic před setPos).
- **Editace alertů**: tužka vedle badge podmínky (`editable-alert-
  rule.tsx`, TRVALE VIDITELNÁ – ne opacity-0/hover-only, dotyková
  zařízení; tabulka pod grafem i /alerts) mění směr (Nad/Pod/Překříží)
  i práh inline (✓/Enter uloží, X/Esc zruší); jen kind='price' –
  limitní prodeje řídí portfolio, skóre generuje Signal Engine. V grafu:
  dvojklik na CENU v boxu alert linky (`chart-alert-lines.tsx`) otevře
  inline input nad boxem (Enter/✓ uloží přes `updateAlertRuleAction`,
  Esc zruší); kurzor nad hodnotou je ↕ (ns-resize); klik do boxu
  NESPUSTÍ drag prahu. Sloupec/směr `cross` = aktivace při překřížení
  prahu v obou směrech; checkbox „Jednorázový" = `one_shot`.
- **Fullscreen grafu** (`price-chart.tsx`): tlačítko Maximize2 jen vpravo
  nahoře, countdown svíčky sedí vedle něj zleva (ve fullscreen je
  countdown v hlavičce u Minimize2) →
  fixed overlay s kompletním ovládáním: header s ikonou + názvem,
  tickerem, Q0 badge, cenou a ChangeBadge (props currentPrice/
  change24h/itemTicker z market page), TF přepínač, Svíčky/Linie,
  countdown v headeru; wrapper grafu se přemístí
  přes appendChild
  do overlaye (chart se NERE-MOUNTUJE – zoom/nástroje přežijí) a po
  zavření se vrátí do `originalParentRef`. Klávesy: F = jen ZAPNE
  fullscreen (ve fullscreen se ignoruje, minimalizovat jde jen Esc/
  tlačítkem; ignoruje fokus ve vstupních polích), Esc = nejdřív zruš
  měření, pak zavři fullscreen. `containerRef` musí zůstat uvnitř
  `chartHostRef`
  (autoSize přepočítá sám; geometrii overlayů bumpne vpEpoch).
- **LIVE ceny a alerty (Fáze 3)** – architektura, kterou NESMÍ rozbít:
  - **Price hub** (`lib/price-hub.ts`): jediná serverová smyčka per instance
    (Fluid Compute drží funkci živou, dokud je otevřené SSE), každé 2 s
    střídavě `market/followed` (intra-bar patičky = rychlý tick) a
    `market/prices` (autorita pro datetime). Detekce obchodu = změna ceny
    NEBO datetime → publish. Bez odběratelů se smyčka vypne.
  - **SSE** (`/api/live/stream`): eventy hello (snapshot hned po připojení),
    tick (jen ZMĚNĚné položky), alert, stale. Client store
    (`lib/live-prices.ts`) má REST fallback (8 s timeout → 10 s polling).
  - **Alerty**: hub evaluuje po ticku hned (≤ ~2 s) + pravidelně max 10 s
    (mrtvý trh). Cooldown guard je atomický UPDATE sdílený s 5min cronem
    a REST fallbackem → notifikace nikdy neodejde dvakrát. Direction
    'cross' = předchozí cena na DRUHÉ straně prahu (hub drží `prevPrices`,
    poller čte předchozí tick z price_history). `one_shot` alert se hned
    po úspěšném cooldown guardu SMAŽE (trigger + delete v jedné evaluaci;
    persistní verze zůstává s trigger_count).
  - **Orderbook hlídka**: položky s aktivními BUY alerty ('price' +
    'below') se round-robin pollují (1 req / 2 s, ofiko v3 API limit
    1 req/s → throttle v simco-official; seznam refresh 60 s). Buy alert
    triggeruje i ASK ≤ práh (nabídka na úrovni = příležitost koupit hned,
    nemusí čekat na obchod). Sell strana zůstává na posledním obchodě
    (prodej se řídí bidem, který API nevidí).
  - **Cena vs. ask**: velká cena v hero = POSLEDNÍ OBCHOD (kanonická,
    konzistentní s grafem/VWAP/P/L); ask = za kolik lze koupit HNED
    (orderbook). Nezaměňovat – ask nemá historii a je křehký (1 prodávající).
  - **Graf**: živý tick se aplikuje přes `series.update()` (NE rekonstrukce)
    pomocí `mergeLiveTick()` z lib/candles – kontinuita bucketů zachována
    (nový bucket = doplnit ploché svíčky, open = předchozí close).
  - **AutoRefresh** je jen fallback (market page 60 s) pro VWAP/metriky –
    ceny dorážejí přes SSE; nezvyšovat frekvenci.
  - Test: `node scripts/test-live-alert.mjs [url]` (latence end-to-end),
    `diag-live-alert.mjs` (rozliší „evaluace neproběhla" vs. „event šel
    na jinou Vercel instanci" – multi-instance je správné chování).
- **Auto-refresh dat**: `AutoRefresh` (router.refresh()) na market page
  každých 60 s + okamžitý refresh při návratu na kartu (visibilitychange –
  intervaly na pozadí throttluje prohlížeč, bez toho po přepnutí zpět
  zůstanou staré ceny až do F5). `CandleCountdown` po zavření svíčky
  refreshuje hned + retry v +15/30/45/60 s – poller zapisuje ticky se
  svou fází (cron 5 min), takže hned po zavření tick ještě nemusí být
  v DB.
- **Metriky likvidity a volatility** (`lib/metrics.ts`, karty na market
  page pod staty období): Likvidita = obchody/24 h (distinct časy z
  ticků) + obrat/den (denní objem × cena), klasifikace 0–4 s popisem.
  Volatilita = σ log-výnosů close-to-close, annualizace √(svíček/rok)
  pro srovnatelnost mezi TF + hodnota per bar. Body ●●●○○ dle grade.
  Denní svíčky pro obrat se u intraday TF dotahují zvlášť
  (`getDailyCandles`).
- **Portfolio** (`app/portfolio`, `lib/data.ts`): aktivum = otevřené pozice
  agregované na POLOŽKU (kvality se NEROZLIŠUJÍ – Q0 i Q1 je jedno aktivum;
  aktuální cena = tick kvality 0, prodej i limit běží FIFO přes všechny
  nákupy). Uložení: dialog „Přidat do portfolia“ z market page (action
  `addToPortfolioAction`, nové pozice s quality 0). Editace: tužka v
  tabulce → `PortfolioEditLotsDialog` upraví množství/cenu per lot
  (`updatePortfolioLotsAction`). `getPortfolioHoldings()` agreguje,
  `getPositionLots(itemId)` vrací nákupy aktiva,
  `getPortfolioValueHistory()` rekonstruuje denní hodnotu (kumulativní
  množství k dni × close z market_candles_daily, fallback ticky).
  Limitní prodej: `upsertLimitSellAlert`/`deleteLimitSellAlert` udržují
  hlídku alerts kind='limit_sell' (poller notifikuje při dosažení limitu).
  Terminologie v UI: „aktivum/aktiva“ (ne držba), nákup = „lot“.
- **Fáze ekonomiky**: dle hry `recession` = „Recese 📉", `normal` =
  „Stabilní ⚖️", `boom` = „Růst 📈" (PHASE_LABELS v statistiky/page.tsx).
  Kvalita komodit se v UI zkracuje na „Q0" (ne „kvalita 0").
- **„Živý pravý okraj“ grafu**: `datetime` ticků ze Simco Tools je čas
  POSLEDNÍHO OBCHODU (ne dotazu) – klidný trh znamená ticky staré i hodiny
  (medián ~100 min). Intraday graf proto protahuje plochou rozpracovanou
  svíčku až do aktuálního bucketu (market page) a hero ukazuje „poslední
  obchod před X min“ (`formatRelativeAge`). Není to zastaralá data.
- **Live komponenty v UI**: `HeroLivePrice` (market page hero: cena +
  ask se spreadem + LIVE badge), `LivePrice`/`LiveChangeBadge`
  (`live-price-text.tsx` – watchlist karty, market table, movers),
  `LiveUpdatedCell` (čas posledního obchodu v market table),
  `LiveCurrentPriceCell` (tabulka alertů), `OrderbookPanel` (top 5 asků
  s objemy, vedle ItemProfile), `LiveAlertToaster` (global v layoutu –
  toast + zvuk + browser Notification), `TickerLiveUpdater` (imperativní
  přepis dlaždic). Re-render jen u položek s novým obchodem (stabilní
  reference v useLiveTick) – jeden obchod = jedna buňka, ne celá tabulka.
- **DB numeric**: postgres.js vrací numeric jako string — v `data.ts` se
  vždy konvertuje na Number na hranici. Timestamptz → ISO string.
- **Simco Tools**: fetch vždy server-side s `next: { revalidate }` kvůli
  ratelimitu (2 req/s). `Accept-Language: cs` pro české názvy.
- **Ofiko v3 API**: fetch jen přes `simco-official.ts` (serializovaný
  throttle 1,1 s). Nikdy nevolat přímo z komponent/rout – limity by
  spadly.

## Externí API

1. **SimCompanies** (`www.simcompanies.com/api/v3`) — oficiální, jen GET;
   limit 1 req/s (throttle 1,1 s v `simco-official.ts`). Používá se pro
   ORDERBOOK (aktivní nabídky): `market/{quality}/{id}/` → nejnižší ask
   + top N nabídek (hero, mini orderbook, buy-alert hlídka). Dále
   GitHub Actions cron `*/15 * * * *` (`fetch-market.mjs`, 1 req/5 s).
2. **Simco Tools** (`api.simcotools.com`) —OpenAPI spec:
   `https://api.simcotools.com/docs/simcotools.yaml`. Používané endpointy:
   candlesticks, prices (fetch cache 5 s – sdílí všichni diváci),
   market/followed (intra-bar patičky 5m svíček = rychlý tick pro hub),
   market summary, events, government-orders, phases, resources,
   realm summaries, stats/buildings.

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
