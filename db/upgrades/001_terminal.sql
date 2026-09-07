-- ═══════════════════════════════════════════════════════════════════
--  SIMALYTICS – upgrade 001: investorský terminál
--  (denní svíčky, watchlist, zdroje dat, sledování ticků)
--  Idempotentní – lze spustit opakovaně.
-- ═══════════════════════════════════════════════════════════════════

-- Zdroj dat u ticků: 'game_api' (nejlevnější nabídka) | 'simcotools' (skutečný obchod)
alter table public.price_history
  add column if not exists source text not null default 'game_api';

-- Sledovat ticky (poller ukládá intraday data jen pro sledované položky)
alter table public.items
  add column if not exists track_ticks boolean not null default false;

-- Všechny dosud existující položky (náš kurátorovaný seznam) sledovat
update public.items set track_ticks = true where track_ticks = false;

-- Denní svíčky (backfill ze Simco Tools: OHLC + objem + VWAP)
create table if not exists public.market_candles_daily (
  resource_id integer     not null references public.items(id) on delete cascade,
  quality     smallint    not null default 0,
  day         date        not null,
  open        numeric(14,4) not null,
  high        numeric(14,4) not null,
  low         numeric(14,4) not null,
  close       numeric(14,4) not null,
  volume      bigint,
  vwap        numeric(14,6),
  primary key (resource_id, quality, day)
);

create index if not exists idx_candles_daily_resource
  on public.market_candles_daily (resource_id, quality, day desc);

-- Watchlist
create table if not exists public.watchlist (
  id         uuid primary key default gen_random_uuid(),
  item_id    integer  not null references public.items(id) on delete cascade,
  quality    smallint not null default 0,
  note       text,
  created_at timestamptz not null default now(),
  unique (item_id, quality)
);
