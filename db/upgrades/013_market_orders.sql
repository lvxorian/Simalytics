-- ═══════════════════════════════════════════════════════════════════
--  SIMALYTICS – upgrade 013: herní limitní prodeje (vlastní nabídky
--  na burze ze stránky statistiky skladu)
--
--  Zdroj: GET /api/v2/companies/me/market-orders/ (reálný dump
--  2026-09-10, userscript v0.5 posílá jako source 'market_orders'):
--    [{ id, kind, quantity, quality, price, posted,
--       datetimeDecayUpdated, fees, seller: {…} }]
--    – id     = ID nabídky na burze (dedupe klíč)
--    – kind   = ID komodity (resource id)
--    – price  = limitní cena za ks
--    – fees   = poplatek za vložení nabídky (už zaplacen, nechat jen
--               auditně – do sell_price se nepočítá, sell-strana
--               se v Simalytics účtuje netto z cashflow při výplatu)
--
--  Použití v aplikaci:
--  – badge „limit X" u aktiva v portfoliu (podle herní pravdy),
--  – NOTE zápis do logu obchodů („Limitka na burze…"),
--  – hlídka alerts kind='limit_sell' (notifikace při dosažení ceny),
--  – reconcile skladu NEZMENŠUJE loty o jednotky, které jsou na burze
--    (vložení nabídky ve hře přesune ks ze skladu do nabídky – není
--    to prodej ani spotřeba).
--
--  Idempotentní – lze spustit opakovaně.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.game_market_orders (
  id          bigint primary key,              -- ID nabídky ze hry
  item_id     integer     not null references public.items(id) on delete cascade,
  quality     smallint    not null default 0,
  quantity    integer     not null check (quantity > 0),
  price       numeric(12,4) not null check (price > 0),
  fees        numeric(12,4),
  posted_at   timestamptz not null,
  updated_at  timestamptz not null default now()
);

create index if not exists idx_game_market_orders_item
  on public.game_market_orders (item_id);
