-- ═══════════════════════════════════════════════════════════════════
--  SIMALYTICS – upgrade 002: Signal Engine (fáze 1)
--  Denní VWAP, soutěže (contests) a druhy certifikátů.
--  Idempotentní – lze spustit opakovaně.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- 1) DENNÍ VWAP pro všechny resource+kvality (1 request z market/vwaps)
--    Základ pro „fair value" a VWAP divergenci v Signal Engine.
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.market_vwap_daily (
  resource_id integer      not null references public.items(id) on delete cascade,
  quality     smallint     not null default 0,
  day         date         not null,
  vwap        numeric(14,6) not null,
  primary key (resource_id, quality, day)
);

create index if not exists idx_vwap_daily_resource
  on public.market_vwap_daily (resource_id, quality, day desc);

-- ───────────────────────────────────────────────────────────────────
-- 2) SOUTĚŽE (contests) – boost poptávky po jedné komoditě.
--    Historie od 2019 ⇒ data pro backtest cenového efektu soutěží.
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.contests (
  id          integer primary key,          -- contest id ze Simco Tools
  name        text    not null,
  resource_id integer references public.items(id) on delete set null,
  building_id text,                          -- jen u soutěží o budovy (např. „r" = Restaurant)
  start_date  date    not null,
  end_date    date    not null,
  is_active   boolean not null default false,
  synced_at   timestamptz not null default now()
);

create index if not exists idx_contests_active
  on public.contests (is_active, start_date desc);

create index if not exists idx_contests_resource
  on public.contests (resource_id);

-- ───────────────────────────────────────────────────────────────────
-- 3) DRUHY CERTIFIKÁTŮ – relevantní certy + mapování na resources.
--    Referenční data (stahují se jen jednou denně, ~1 req).
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.cert_kinds (
  kind        integer primary key,          -- cert kind id ze hry
  relevant    boolean not null default false,
  resource_ids integer[] not null default '{}',  -- související resource IDs
  synced_at   timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────
-- 4) Poznámka k items: soutěže i VWAP se vážou na items FK.
--    VWAP API vrací i kvality > 7 a resource, které v items nemáme –
--    ty řádky sync prostě přeskočí (FK by spadl), není to chyba.
-- ───────────────────────────────────────────────────────────────────
