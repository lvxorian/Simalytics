# Simalytics

Analytický dashboard a portfolio tracker pro virtuální ekonomiku **SimCompanies**.

Ceny komodit se stahují **cronem** z veřejného API hry a z **Simco Tools API**,
ukládají se do **PostgreSQL (Neon)**. Next.js aplikace zobrazuje trh, historické
grafy (TradingView Lightweight Charts), watchlist, statistiky ekonomiky a
eviduje pozice **Buy Low / Sell High** včetně logu podmínek (Condition Logging).

```
Simco Tools API ──(cron-job.org · 5 min)──▶ /api/cron/ticks ──▶ Neon
   (ticky obchodů)                                          PostgreSQL ▲
SimCompanies API ─(GitHub Actions · 15 min)── fetch-market.mjs ───┘
Simco Tools API ──(backfill skript)── denní svíčky + objem + VWAP ──┘

LIVE (Fáze 3) – cena a alerty do ~2 s od obchodu:
price hub (server smyčka · 2 s: followed patičky + prices)
  ├─▶ SSE /api/live/stream ──▶ klienti (graf, hero, ticker, tabulky, watchlist)
  ├─▶ evaluace alertů (≤ 2 s po obchodě, max 10 s na mrtvém trhu) → webhook/e-mail
  └─▶ orderbook hlídka (ofiko v3 · round-robin) – buy alerty triggeruje i ASK
REST /api/live = fallback (10 s polling), když SSE nejde

Next.js (server components)
├─ /                Trh: KPI, top gainers/losers, fulltext, řazení (live ceny)
├─ /watchlist       Sledované komodity (karty se sparklinami, live ceny)
├─ /market/[id]     Grafy 5m–1M, overlaye, live summary, hero ask + mini orderbook
├─ /positions       Pozice + P/L + condition logging
├─ /alerts          Cenové a signálové alerty (webhook/e-mail, live zvonek)
├─ /statistiky      Fáze ekonomiky, eventy, zakázky, makro, budovy, žebříček firem
└─ /positions/new   Otevřít pozici + podmínky
```

## Struktura projektu

```
db/
  schema.sql              # tabulky: items, price_history, positions, condition_log, watchlist
  seed-names.sql          # názvy/kategorie/ikony komodit (cs)
scripts/
  fetch-market.mjs        # stahovač cen → Neon (postgres.js, přímé SQL)
  download-icons.mjs      # ikony komodit z CDN → public/icons + items.image_url
  backfill-candles.mjs    # denní svíčky ze Simco Tools → market_candles_daily
  sync-daily.mjs          # denní sync: VWAP, contests, cert kinds (Signal Engine)
  import-catalog.mjs      # katalog komodit ze Simco Tools
.github/workflows/
  fetch-market.yml        # cron */15 * * * *
  sync-daily.yml          # cron 20 0 * * * (denní sync VWAP/contests/certs)
src/
  app/                    # stránky (server components) + api/ + actions.ts
  components/             # UI komponenty (client kde interaktivní)
  lib/
    db.ts                 # postgres.js klient (Neon pooled)
    data.ts               # všechny SQL dotazy
    simcotools.ts         # klient api.simcotools.com
    simco-official.ts     # ofiko v3 orderbook (throttle 1 req/s)
    price-hub.ts          # LIVE hub: smyčka 2 s, publish, evaluace, orderbook hlídka
    live-eval.ts          # sdílená evaluace alertů (ask-aware) + persist ticků
    live-prices.ts        # client store: SSE + REST fallback, useLiveTick
    candles.ts            # OHLC agregace + indikátory + mergeLiveTick
    format.ts             # cs-CZ formátování
public/icons/             # 151 ikon komodit {id}.png
```

## Nastavení krok za krokem

### 1. Neon (PostgreSQL)

1. Vytvoř projekt na [neon.tech](https://neon.tech) (free tier stačí).
2. **Dashboard → Connect** – zkopíruj **pooled** string (host končí `-pooler…`)
   do `DATABASE_URL`.
3. Schéma: `npm run db:schema` (nebo Neon SQL Editor → `db/schema.sql`).
4. Názvy a ikony: `npm run db:names` + `npm run icons:download`.

### 2. Next.js lokálně

```bash
cp .env.example .env.local   # vyplň DATABASE_URL z Neonu
npm install
npm run dev                  # http://localhost:3000
```

### 3. GitHub Actions cron

1. Pushni repo na GitHub.
2. **Settings → Secrets → Actions**: `DATABASE_URL` (a volitelně
   `SIMCOMPANIES_ITEMS` = `1,2,3,11,17` …).
3. Workflow `fetch-market.yml` jede dle cronu `*/15 * * * *`.

Lokální test: `npm run fetch:market`.

## Poznámky k API hry

- Endpoint: `GET /api/v3/market/{quality}/{resourceId}/` – pole nabídek;
  bereme nejlevnější.
- Oficiální pravidla: pouze GET, žádné automatizované akce. Backfill skript
  jede 1 request / 5 s, celkově jednou za 15 minut; live orderbook hlídka
  1 request / 2 s (throttle v `simco-official.ts`).

## Live ceny a alerty (Fáze 3)

Cena v UI a alerty dorazí do **~2 s od obchodu** (dříve 60–90 s).

- **Price hub** (`lib/price-hub.ts`) – jedna serverová smyčka per Vercel
  instance (Fluid Compute): každé 2 s střídavě `market/followed`
  (intra-bar patičky 5m svíček = rychlý tick) a `market/prices`
  (autorita). Detekce obchodu = změna ceny NEBO datetime. Bez otevřené
  appky se smyčka vypne (SSR dodá data z DB).
- **SSE push** (`/api/live/stream`) – jedno EventSource spojení na celou
  appku; eventy `hello` (snapshot), `tick` (jen změněné položky), `alert`,
  `stale`. REST `/api/live` = fallback (10 s polling), když SSE nejde.
- **Alerty** – evaluace v hubu hned po obchodě (≤ ~2 s) + každých max 10 s
  i bez ticků. Cooldown guard (60 min) je atomický UPDATE v DB sdílený
  s 5min cronem → nikdy dvojitá notifikace. Zvonek v hlavičce + toast +
  zvuk + browser Notification + webhook/e-mail.
- **Buy alerty hlídají i ASK** – cena aktiva = poslední obchod; ask = za
  kolik lze koupit hned. „Cena spadla“ na burze znamená, že někdo položil
  NABÍDKU – hub hlídá orderbook položek s aktivními buy alerty
  (round-robin 1 req / 2 s přes ofiko v3 API) a alert spustí už při
  `ask ≤ práh` (🛒 nákupní příležitost). Sell strana (limitní prodeje)
  zůstává na posledním obchodě.
- **Mini orderbook** – top 5 nejnižších nabídek s objemy a tagem NPC/hráč
  na market page (`OrderbookPanel`), hero ukazuje ask se spreadem vs.
  poslední obchod.
- **Kde jsou živé ceny**: graf (přemalování poslední svíčky přes
  `series.update`), hero, ticker tape, market table, top movers,
  watchlist karty, tabulka alertů, čas posledního obchodu.

Test po deployi: `node scripts/test-live-alert.mjs https://simalytics.vercel.app`
(latence end-to-end), `diag-live-alert.mjs` (diagnostika multi-instance).

## Simco Tools API – zdroj historie a ticků

Dokumentace: <https://api.simcotools.com/docs/simcotools.yaml> (limit 2 req/s).

- **Denní svíčky** (`/market/resources/{id}/{q}/candlesticks`) – ~3 měsíce,
  OHLC + objem + VWAP → `npm run backfill:candles`.
- **Ticky obchodů** (`/market/prices`) – 1 request = poslední obchod pro VŠECHNY
  resource+kvality; poller `/api/cron/ticks` ukládá intraday data pro
  `track_ticks = true` položky.
- **Market summary** (`/market/resources/{id}/{q}`) – live cena, objem,
  5m svíčka, denní změny (detail komodity).
- **Realm summaries** (`/summaries`) – denní makro: aktivní firmy, hodnota
  ekonomiky, budovy, bondy (statistiky).
- **Stats/buildings** – počty budov realmu dle typu (statistiky).
- **Eventy / vládní zakázky / fáze** – stránka /statistiky.
- **Katalog** (`/resources`) – české názvy komodit (`npm run import:catalog`).
- **VWAP** (`/market/vwaps`) – denní VWAP VŠECH resource+kvalit v 1 requestu
  (`market_vwap_daily`, sync `npm run sync:daily` nebo `/api/cron/daily`).
- **Contests** (`/contests`) – soutěže = poptávkové spike-y; historie od 2019
  pro backtest cenového efektu.
- **Certifikáty** (`/certificates`) – relevantní druhy certů + mapování na
  resources (poptávkový signál pro Signal Engine).

### Timeframy grafů

| TF | Zdroj | Historie |
|----|-------|----------|
| **1D/1W/1M** | Simco Tools candlesticks (+ dnešní ticky u 1D) | ~3 měsíce ✓ |
| **5m** (minimum) | náš poller | od nasazení polleru |
| 15m / 1H / 4H | náš poller | od nasazení polleru |

1W/1M se agregují z denních svíček (`aggregateDaily` v `lib/candles.ts`).

## Deployment na Vercel + poller přes cron-job.org

1. Repo připoj k [vercel.com](https://vercel.com) – Next.js se detekuje sám.
2. Env vars: `DATABASE_URL` (Neon pooled), `CRON_SECRET`,
   `SIMCOTOOLS_REALM=0`, `SIMCOTOOLS_LANGUAGE=cs`.
3. Poller: [cron-job.org](https://cron-job.org) → URL
   `https://TVUJ-APP.vercel.app/api/cron/ticks`, interval 5 min, header
   `Authorization: Bearer <CRON_SECRET>`.
4. GitHub Actions zůstává jako záložní sync cen (15 min).

## Poznámky k Neonu

- **Pooled vs. direct**: aplikace i cron používají pooled string
  (`…-pooler…`), `db.ts` má `prepare: false` pro PgBouncer. Přímý string
  (bez `-pooler`) pro migrace/psql.
- Free tier: compute se po ~5 min neaktivity vypíná (cold start).
- Přístup k DB má výhradně server – credentials nikdy nejsou v prohlížeči.

## Alerty (fáze 4)

Cenové alerty (nad / pod / překřížení), signálové alerty (Signal Engine
skóre −100…+100) i limitní prodeje z portfolia. Každý cenový alert může být
**jednorázový** (`one_shot`) – po první aktivaci se sám smaže; jinak zůstává
aktivní se 60min cooldownem.
Evaluace běží na třech místech se sdíleným cooldownem 60 min (atomický UPDATE
v DB → notifikace nikdy neodejde dvakrát):

- **Live hub** – hned po obchodě (≤ ~2 s) + každých max 10 s; buy alerty
  navíc hlídají AKTIVNÍ NABÍDKU (ask) přes ofiko orderbook
- **Poller** `/api/cron/ticks` – po uložení ticků (5 min, fallback když
  appku nikdo nemá otevřenou)
- **REST fallback** `/api/live` – throttle 30 s per instance

Notifikace (volitelné, obě najednou):

- **Webhook** – `ALERT_WEBHOOK_URL` (Discord i Slack formát rozpoznán automaticky)
- **E-mail** – `ALERT_RESEND_API_KEY` + `ALERT_EMAIL_FROM` + `ALERT_EMAIL_TO`
  (Resend REST API, bez SDK)
- `NEXT_PUBLIC_APP_URL` – základní URL pro odkazy v notifikacích

Migrace: `npm run db:upgrade` (tabulka `alerts` v db/upgrades/003_alerts.sql,
směr `cross` + `one_shot` v db/upgrades/008_alert_v2.sql).

## Sync ze hry (userscript)

**Simalytics Sync** – Tampermonkey skript (`scripts/userscript/simalytics-sync.user.js`) čte data otevřené hry přímo v prohlížeči a synchronizuje je do portfolia. HERNÍ SERVERY SE NEVOLAJÍ ANI JEDNOU – skript jen čte odpovědi, které prohlížeč stejně dostal, takže odpovídá ofiko pravidlům API (jen GET, žádná automatizace vůči hře).

**Co umí (v0.4):** sklad → portfolio s **reálnými pořizovacími cenami** ze hry (Σ cost šarže / ks), **cashflow → reálné prodejní ceny** (maloobchod, burza i kontrakty FIFO — realized P/L se objeví během vteřin od obchodu, bez čekání na sync skladu), spotřeba ve výrobě rozpoznána od prodeje (neznečišťuje P/L), reconcile per (položka, kvalita), kompletní prodej detekován ze zmizení položky. Uložená sell_price je **netto** (hrubá − burzovní poplatky 4 % z cashflow − přeprava exaktně = ks × transportation poměr položky × cena Přepravy na skladu; kontrakt má poloviční přepravu). Raw importy auditované v `game_imports`, transakce v `game_cashflow` (dedupe dle ID, stav aplikace `units_unapplied`/`applied_at`).

**Zjištěné herní endpointy** (reálný dump, neoficiální): sklad = `/api/v3/resources/{companyId}/` (šarže `{id, amount, quality, kind, cost}` — kind = ID komodity, Σcost/amount = pořizovací cena); cashflow = `/api/v2/companies/me/cashflow/recent/` (nákupy 'm' se skutečnou cenou, prodeje 's', produkce 'p').

**Instalace:**
1. Nainstaluj [Tampermonkey](https://www.tampermonkey.net/) a v něm skript `https://simalytics.vercel.app/simalytics-sync.user.js` (otevři URL → nabídne instalaci).
2. Ve Vercelu nastav `GAME_SYNC_SECRET` (dlouhý náhodný řetězec) a redeploy.
3. V Tampermonkey menu: nastav URL (https://simalytics.vercel.app) a token (= GAME_SYNC_SECRET).
4. Otevři hru → sklad (Warehouse). Sync proběhne sám (debounce 3 s, dedupe 60 s); „Simalytics: debug dump“ v menu ukáže nasbíraná data.

**Jak to funguje:** hook na `fetch`/XHR ve hře → POST `/api/import/sync` (Bearer GAME_SYNC_SECRET) se dvěma zdroji: **cashflow** (reálné ceny transakcí, posílá se první) a **warehouse** (šarže skladu). Server reconcile: rozdíl sklad vs. pozice = nákup (cena: unit_cost šarže → burzovní nákup z cashflow → tržní tick) nebo FIFO prodej (cena: maloobchodní prodeje z cashflow → tržní tick). Manuální pozice nesahá. Úbytek bez prodeje = spotřeba ve výrobě → jen zmenšení lotu.

**Důležité:** cena u syncovaných pozic je zatím odhad z trhu – doladit jde editací lots v portfoliu. Skript je heuristický (hra nemá ofiko API dokumentaci) – „debug dump“ pomůže doladit parser, když formát herních odpovědí neodpovídá.

**Mimo portfolio (ignore-list):** sklad obsahuje i věci, které nejsou investicí/flipem (palivo výroby – energie, voda, přeprava, semena). Položka se v portfoliu označí košem („Odebrat z portfolia, ponechat na skladu“) → loty se zahodí bez P/L a sync už ji nenahraje; ve hře na skladu zůstává. Sekce „Mimo portfolio“ dole na /portfolio vypisuje vyloučené položky včetně stavu skladu, tlačítkem **Vrátit** se vrátí (příští sync je znovu nahraje). Tabulka `game_sync_ignored` (migrace 011).

## Editace alertů

- **Tužka** vedle badge podmínky (tabulka pod grafem i /alerts) – inline
  editor směru (Nad/Pod/Překříží) a prahu
- **Dvojklik na cenu v boxu alert linky v grafu** – inline input, Enter/✓
  uloží, Esc zruší; tažením za linku (mimo box) se práh mění jako dřív

## Rozšíření (roadmapa)

- **Auth** (Auth.js/Clerk) pro multi-user přístup k pozicím a alertům
- **Quality** 1–7 (env `SIMCOMPANIES_QUALITIES=0,1,2`)
- **Neon branching** – testovací větev DB pro vývoj
