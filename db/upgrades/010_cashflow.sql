-- ═══════════════════════════════════════════════════════════════════
--  SIMALYTICS – upgrade 010: cashflow ze hry (reálné ceny transakcí)
--
--  Zdroj: GET /api/v2/companies/me/cashflow/recent/ (userscript).
--  Každý řádek = jedna peněžní transakce ve hře s ID (dedupe klíč):
--    'm' marketbuy-{itemId}   nákup na burze  – details.amount/price (EXAKTNÍ)
--    's' retail-{itemId}      maloobchodní prodej – details.price (unit_cogs)
--    'p' production-{itemId}  produkce (náklad šarže)
--    'g' …                    mimořádné (pokuty, dary, …)
--
--  Ceny se na pozice aplikují PŘI reconcile skladu (lazy):
--  – úbytek skladu + neaplikované prodeje → FIFO uzavření za reálnou cenu
--  – přírůstek skladu + neaplikované nákupy → nové loty za reálnou cenu
--  units_unapplied = kolik ks transakce ještě nebylo „spotřebováno"
--  reconcilem; 0 → applied_at (zpracováno).
--
--  Idempotentní – lze spustit opakovaně.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.game_cashflow (
  id              bigint primary key,      -- ID transakce ze hry (>2^31 → bigint)
  datetime        timestamptz not null,
  category        text        not null,    -- 'm' | 's' | 'p' | 'g' | …
  description     text,
  description_key text,                    -- 'marketbuy-3', 'retail-3', …
  money           numeric(14,2) not null,  -- + příjem / − výdaj
  details         jsonb       not null default '{}'::jsonb,

  -- Odvozené pro napojení na pozice (u kind 'other' null):
  kind        text,                        -- 'market_buy' | 'market_sale' | 'retail_sale' | 'production' | 'other'
  item_id     integer references public.items(id),
  quality     smallint,
  quantity    integer,
  unit_price  numeric(12,4),

  -- Stav aplikace do portfolia (reconcile skladu):
  units_unapplied integer,                 -- ks čekající na aplikaci (null = nepoužitelné)
  applied_at      timestamptz,             -- vše spotřebováno → hotovo

  created_at  timestamptz not null default now()
);

create index if not exists idx_game_cashflow_pending
  on public.game_cashflow (item_id, quality, datetime)
  where applied_at is null and units_unapplied > 0;

create index if not exists idx_game_cashflow_datetime
  on public.game_cashflow (datetime desc);
