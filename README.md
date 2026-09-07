# SIMALYTICS

Analytický dashboard a portfolio tracker pro virtuální ekonomiku **SimCompanies**.

Ceny komodit se stahují **cronem každých 15 minut** (GitHub Actions) z veřejného
API hry a ukládají se do **PostgreSQL (Neon)**. Next.js aplikace pak zobrazuje
trh, historické grafy (TradingView **Lightweight Charts**) a eviduje pozice
**Buy Low / Sell High** včetně logu podmínek (Condition Logging).

```
SimCompanies API ──(GitHub Actions cron · 15 min)──▶ Neon PostgreSQL
                                                        │
                              Next.js (server components) │
                              ├─ /                Trh + 24h změny
                              ├─ /market/[id]     Svíčkové/liniové grafy
                              ├─ /positions       Pozice + P/L
                              └─ /positions/new   Otevřít pozici + podmínky
```

## Struktura projektu

```
db/
  schema.sql              # tabulky + seed (spusť v Neon SQL editoru nebo psql)
scripts/
  fetch-market.mjs        # stahovač cen → Neon (postgres.js, přímé SQL)
.github/workflows/
  fetch-market.yml        # cron */15 * * * *
src/
  app/
    page.tsx              # Market Dashboard
    market/[resourceId]/  # Historické grafy
    positions/            # Pozice, P/L, condition log
    actions.ts            # Server actions (open/close position, notes)
  components/
    price-chart.tsx       # Lightweight Charts (v5 API addSeries)
    market-table.tsx      # Tabulka trhu
    positions-table.tsx   # Pozice + dialog uzavření
    position-form.tsx     # Otevření pozice + condition logging
  lib/
    db.ts                 # postgres.js klient (Neon pooled connection)
    data.ts               # Všechny SQL dotazy na jednom místě
    candles.ts            # Agregace ticků na OHLC svíčky
    format.ts             # cs-CZ formátování ($, %, data)
```

## Nastavení krok za krokem

### 1. Neon (PostgreSQL)

1. Vytvoř projekt na [neon.tech](https://neon.tech) (free tier stačí).
2. **Dashboard → Connect (Connection string)** – zkopíruj **pooled** string
   (host končí na `-pooler…`). Ten dej do `DATABASE_URL`.
3. Schéma vytvoř jedním ze způsobů:
   - **Neon Console → SQL Editor** → vlož celý `db/schema.sql` → Run, nebo
   - lokálně: `psql "$DATABASE_URL" -f db/schema.sql`, nebo
   - po vyplnění `.env.local`: `npm run db:schema`

Migruješ data ze Supabase? `pg_dump` odtamtud a restore sem:
`pg_dump "$SUPABASE_URL" | psql "$NEON_URL"` (použij direct, ne pooler).

### 2. Next.js lokálně

```bash
cp .env.example .env.local   # vyplň DATABASE_URL z Neonu
npm install
npm run dev                  # http://localhost:3000
```

Názvy/kategorie/ikony komodit jsou připravené v `db/seed-names.sql`:

```bash
npm run db:names
```

ID odpovídá URL encyklopedie: `simcompanies.com/encyclopedia/resource/{id}/`
(ověřeno: ID 1 = Power, ID 3 = Apples, ID 68 = Gold ore…).

### 3. GitHub Actions cron

1. Pushni repo na GitHub.
2. **Settings → Secrets and variables → Actions**:
   - Secret `DATABASE_URL` = connection string z Neonu
   - (volitelná variable) `SIMCOMPANIES_ITEMS` = `1,2,3,11,17` …
3. Workflow `fetch-market.yml` se spustí sám dle cronu `*/15 * * * *`
   (na defaultní větvi). Pro test: **Actions → Simalytics – market data
   fetch → Run workflow**.

Lokální test skriptu: `npm run fetch:market` (hodnoty do env z `.env.local`).

## Poznámky k API hry

- Endpoint: `GET /api/v3/market/{quality}/{resourceId}/` – pole aktivních
  nabídek `{ price, quantity, quality, seller, … }`; bereme nejlevnější.
- Oficiální pravidla ([API guide](https://www.simcompanies.com/articles/api/)):
  pouze GET, žádné automatizované akce, necpat server. Skript jede
  1 request / 5 s a celkově jednou za 15 minut – pohodově v rámci limitů.
- GitHub cron může mít pár minut zpoždění – to je v pořádku, čas záznamu
  je identický pro celý run, takže svíčky agregují čistě.

## Poznámky k Neonu

- **Pooled vs. direct connection**: aplikace i cron používají pooled string
  (`…-pooler…`), skript i `db.ts` mají `prepare: false` pro kompatibilitu
  s PgBouncerem. Přímý string (bez `-pooler`) využij pro migrace/psql.
- Free tier: autoscaling compute se po ~5 min neaktivity vypíná; první
  dotaz po „cold startu“ trvá o kousek déle – pro tento use-case nevadí.
- Pozice jsou chráněné jen tím, že přístup k DB má výhradně server
  (service credentials nikdy nejsou v prohlížeči).

## Rozšíření (roadmapa)

- **Auth** (např. Auth.js/Clerk) pro multi-user přístup k pozicím
- **Alerty** – e-mail/webhook při dosažení target/stop ceny
- **Quality** 1–7 (env `SIMCOMPANIES_QUALITIES=0,1,2`)
- **Neon branching** – testovací větev DB pro vývoj
