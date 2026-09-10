-- ═══════════════════════════════════════════════════════════════════
--  SIMALYTICS – upgrade 011: ignore-list položek skladu
--
--  Sklad se syncuje CELÝ (snapshot zůstává kompletní – hodí se pro
--  budoucí finanční dashboard), ale položky na této listině se do
--  portfolia NENAČÍTAJÍ: reconcile jejich loty nevytváří, stávající
--  loty zahodí (bez P/L – zůstávají na skladu ve hře) a jejich pending
--  cashflow označí za aplikované, ať se nehromadí.
--
--  Určeno pro "palivo" výroby (energie, voda, přeprava, semena…) a
--  jiné instrumenty, které hráč nepreprodává = nejsou investicí/flip.
--
--  Idempotentní – lze spustit opakovaně.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.game_sync_ignored (
  item_id    integer primary key references public.items(id) on delete cascade,
  reason     text,
  ignored_at timestamptz not null default now()
);

-- Seed: výrobní palivo dle zadání (Energie, Voda, Přeprava, Semena)
insert into public.game_sync_ignored (item_id, reason)
values
  (1,  'Palivo výroby – není investiční aktivum'),
  (2,  'Palivo výroby – není investiční aktivum'),
  (13, 'Palivo dopravy – není investiční aktivum'),
  (66, 'Palivo výroby – není investiční aktivum')
on conflict (item_id) do nothing;
