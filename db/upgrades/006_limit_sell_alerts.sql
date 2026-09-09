-- ───────────────────────────────────────────────────────────────────
-- 006 · LIMIT SELL ALERTS (notifikace při dosažení limitního prodeje)
--
-- Limitní prodej zadaný v portfoliu (dialog Prodat → Zadat limit) se
-- od teď ukládá i jako alert kind='limit_sell'. Poller (5 min) hlídá
-- cenu a při dosažení limitu spustí standardní notifikační pipeline:
-- zvonek v hlavičce (+ zvukový tón) a webhook/e-mail. Po odklepnutí
-- prodeje (nebo smazání aktiva) se alert automaticky odstraní.
--
-- Idempotentní — spouští se přes npm run db:upgrade.
-- ───────────────────────────────────────────────────────────────────

-- Nový druh alertu – check constraint z 003 rozšíříme o 'limit_sell'
alter table public.alerts drop constraint if exists alerts_kind_check;
alter table public.alerts
  add constraint alerts_kind_check
  check (kind in ('price', 'score', 'limit_sell'));

-- Rychlé vyhledání limit alertu per aktivum (upsert/cleanup z portfolia)
create index if not exists idx_alerts_limit_sell
  on public.alerts (item_id, quality, kind);
