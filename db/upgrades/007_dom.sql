-- ═══════════════════════════════════════════════════════════════════
-- 007 DOM (Depth of Market) – trvalý index aktivních nabídek burzy
--
--  Zdroj: ofiko v3 /market/{q}/{id}/ (plný orderbook, ~96–97 řádků per
--  položka). Skenuje ho price-hub (4 položky/kolo) jako JEDINÝ writer –
--  API route /api/dom jen čte. `/api/live/ask` dál píše do ask_cache
--  (jiný source), aby se nepomíchaly dvě oddělené funkce.
--
--  Účel: „nahled do trhu, který instrument v jakém počtu se prodával /
--  se prodává na burze" – agregace hloubky per položka, bez umělých
--  cenových úrovní (bins) – każdá unikátní cena = řádek.
-- ═══════════════════════════   ═════════════════════════════════════

create table if not exists public.market_offers (
  offer_id     bigint primary key,          -- id orderu ze hry (prirodzený klíč)
  item_id      integer not null references public.items(id) on delete cascade,
  quality      smallint not null default 0,
  price        numeric(12,4) not null check (price > 0),
  quantity     integer not null check (quantity > 0),
  npc          boolean not null default false,
  seller_name  text,
  posted_at    timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_market_offers_item
  on public.market_offers (item_id, quality, price);

create index if not exists idx_market_offers_last_seen
  on public.market_offers (last_seen_at desc);

-- DOM sken (price-hub) si pamatuje, kdy položku naposledy viděl –
-- round-robin kolo vezme nejdřív položky se starším pokrytím.
alter table public.items
  add column if not exists dom_covered_at timestamptz;
