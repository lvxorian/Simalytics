-- ═══════════════════════════════════════════════════════════════════
--  SIMALYTICS – upgrade 009: sync dat ze hry (userscript import)
--
--  Userscript v prohlížeči čte odpovědi herního klienta a tlačí je do
--  /api/import/sync. Zjištěný formát (z reálného dumpu 2026-09-09):
--
--  SKLAD: GET /api/v3/resources/{companyId}/
--    [{ id, amount, quality, kind, blocked, cost: {workers, admin,
--       material1..5, market}, datetime, materials }]
--    – id        = ID šarže (velké číslo)
--    – kind      = ID komodity (resource id, např. 3 = Jablka)
--    – amount    = množství ks v šarži
--    – Σ cost.* ÷ amount = skutečná průměrná pořizovací cena / ks
--
--  CASHFLOW: GET /api/v2/companies/me/cashflow/recent/
--    { data: [{ id, datetime, money, category ('m'|'s'|'p'|'g'|…),
--               description, descriptionKey ('marketbuy-3', 'retail-3'…),
--               details: { amount, price, quality, … } }] }
--    – category 'm' = nákup na trhu se skutečnou cenou (details.amount/price)
--
--  Idempotentní – lze spustit opakovaně.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) Raw importy (audit + pozdější analýza) ──────────────────────
create table if not exists public.game_imports (
  id          bigint generated always as identity primary key,
  source      text        not null,                -- 'warehouse' | 'cashflow' | …
  payload     jsonb       not null,
  received_at timestamptz not null default now()
);

create index if not exists idx_game_imports_received
  on public.game_imports (received_at desc);

-- ── 2) Snapshot skladu (poslední známý stav ze hry) ────────────────
create table if not exists public.game_warehouse (
  item_id     integer     not null references public.items(id) on delete cascade,
  quality     smallint    not null default 0,
  quantity    integer     not null check (quantity >= 0),
  -- vážená průměrná pořizovací cena šarží (Σ cost.* / amount)
  unit_cost   numeric(12,4),
  updated_at  timestamptz not null default now(),
  primary key (item_id, quality)
);

-- ── 3) Odkud pozice přišla (manuál vs. sync ze hry) ────────────────
alter table public.positions
  add column if not exists source text not null default 'manual';

create index if not exists idx_positions_source
  on public.positions (source) where closed_at is null;
