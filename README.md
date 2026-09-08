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

Next.js (server components)
├─ /                Trh: KPI, top gainers/losers, fulltext, řazení
├─ /watchlist       Sledované komodity (karty se sparklinami)
├─ /market/[id]     Grafy 5m–1M, overlaye (objem/VWAP/průměr/max-min), live summary
├─ /positions       Pozice + P/L + condition logging
├─ /statistiky      Fáze ekonomiky, eventy, zakázky, makro realmu, budovy
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
  import-catalog.mjs      # katalog komodit ze Simco Tools
.github/workflows/
  fetch-market.yml        # cron */15 * * * *
src/
  app/                    # stránky (server components) + api/ + actions.ts
  components/             # UI komponenty (client kde interaktivní)
  lib/
    db.ts                 # postgres.js klient (Neon pooled)
    data.ts               # všechny SQL dotazy
    simcotools.ts         # klient api.simcotools.com
    candles.ts            # OHLC agregace + indikátory
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
- Oficiální pravidla: pouze GET, žádné automatizované akce. Skript jede
  1 request / 5 s, celkově jednou za 15 minut.

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

## Rozšíření (roadmapa)

- **Auth** (Auth.js/Clerk) pro multi-user přístup k pozicím
- **Alerty** – e-mail/webhook při dosažení target/stop ceny
- **Quality** 1–7 (env `SIMCOMPANIES_QUALITIES=0,1,2`)
- **Neon branching** – testovací větev DB pro vývoj
