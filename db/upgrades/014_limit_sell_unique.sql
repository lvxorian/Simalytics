-- ───────────────────────────────────────────────────────────────────
-- 014 · UNIQUE HLÍDKA LIMITNÍHO PRODEJE
--
-- Upserty hlídek limitního prodeje (upsertLimitSellAlert z portfolia
-- i syncGameMarketOrders z herních nabídek – Fáze 4) používají
--   on conflict (item_id, quality, kind)
-- ale tabulka alerts měla PK jen na id (uuid) a 006 vytvořil pouze
-- NEunikátní index idx_alerts_limit_sell → upsert padal na
-- „no unique or exclusion constraint matching the ON CONFLICT
-- specification“ (hlídka se nevytvořila, API vrátilo 500).
--
-- Řešení: PARCIÁLNÍ unique index jen pro kind='limit_sell' – cenové
-- a skóre alerty na jedné položce musí zůstat vícenásobné (legitimní),
-- hlídka limitky je vždy maximálně jedna. Upserty proto cílí
--   on conflict (item_id, quality, kind) where kind = 'limit_sell'
-- (Postgres inferuje parciální index jen s odpovídajícím predikátem).
--
-- Idempotentní — spouští se přes npm run db:upgrade.
-- ───────────────────────────────────────────────────────────────────

drop index if exists public.idx_alerts_limit_sell;

create unique index if not exists uq_alerts_limit_sell
  on public.alerts (item_id, quality, kind)
  where kind = 'limit_sell';
