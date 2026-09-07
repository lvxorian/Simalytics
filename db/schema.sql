-- ═══════════════════════════════════════════════════════════════════
--  SIMALYTICS – databázové schéma (PostgreSQL 13+, určeno pro Neon)
--
--  Spuštění:
--    a) Neon Console → SQL Editor → vlož a Run, nebo
--    b) psql "$DATABASE_URL" -f db/schema.sql
--
--  Idempotentní: lze spustit opakovaně (create if not exists).
--  Pozn.: RLS nepotřebujeme – aplikace i cron se připojují přímo
--  s credentials z DATABASE_URL (žádný PostgREST/anon přístup).
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- 1) KATALOG POLOŽEK (komodity / suroviny)
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.items (
  id            integer primary key,          -- resource id ze SimCompanies API
  name          text    not null,
  db_letter     text,                         -- jednopísmenné označení (A, B, C…) ze hry
  category      text,
  image_url     text,
  created_at    timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────
-- 2) HISTORIE CEN (jedna řádka = nejnižší cena dané položky a kvality
--    v daném okamžiku; cron ji vkládá každých 15 minut)
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.price_history (
  id          bigint generated always as identity primary key,
  item_id     integer     not null references public.items(id) on delete cascade,
  quality     smallint    not null default 0,
  price       numeric(12,4) not null,       -- cena na 1 ks
  quantity    integer,                      -- nabízené množství za nejnižší cenu
  recorded_at timestamptz  not null default now(),

  unique (item_id, quality, recorded_at)
);

create index if not exists idx_price_history_item_quality_time
  on public.price_history (item_id, quality, recorded_at desc);

create index if not exists idx_price_history_recorded_at
  on public.price_history (recorded_at desc);

-- ───────────────────────────────────────────────────────────────────
-- 3) POZICE (koupil / prodal – „Buy Low, Sell High")
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.positions (
  id            uuid primary key default gen_random_uuid(),
  item_id       integer     not null references public.items(id),
  quality       smallint    not null default 0,
  quantity      integer     not null check (quantity > 0),
  buy_price     numeric(12,4) not null check (buy_price > 0),
  sell_price    numeric(12,4),              -- null = pozice stále otevřená
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  note          text,
  created_at    timestamptz not null default now(),

  check (
    (sell_price is null and closed_at is null) or
    (sell_price is not null and closed_at is not null and sell_price > 0)
  )
);

create index if not exists idx_positions_open
  on public.positions (closed_at) where closed_at is null;

-- ───────────────────────────────────────────────────────────────────
-- 4) LOG PODMÍNEK (proč jsem pozici otevřel / uzavřel)
--    „Condition Logging" – trigger, analýza, strategie…
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.condition_log (
  id          uuid primary key default gen_random_uuid(),
  position_id uuid        not null references public.positions(id) on delete cascade,
  event_type  text        not null default 'OPENED'
                          check (event_type in ('OPENED', 'ADDED', 'CLOSED', 'NOTE')),
  market_price_at_log numeric(12,4),        -- snapshot ceny při zápisu
  condition_text      text    not null,     -- vlastní text podmínky/logiky
  trigger_reason      text,                 -- např. „cena pod 30d průměrem"
  created_at  timestamptz not null default now()
);

create index if not exists idx_condition_log_position
  on public.condition_log (position_id, created_at desc);

-- ───────────────────────────────────────────────────────────────────
-- 5) SEED: sledované komodity
--
--    Plný katalog se skutečnými názvy, kategoriemi a ikonami je v
--    db/seed-names.sql – spusť ho hned po tomto souboru (npm run db:names).
--    ID = resource id ze SimCompanies; ID 1 = Power, ID 3 = Apples.
--    Seznam ID ke sledování lze přepsat i přes env SIMCOMPANIES_ITEMS.
-- ───────────────────────────────────────────────────────────────────
