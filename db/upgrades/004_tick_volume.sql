-- ───────────────────────────────────────────────────────────────────
-- 004 · OBJEMY TICKŮ (pro Fixed Range Volume Profile na intraday TF)
--
-- market/prices ze Simco Tools množství nevrací, ale
-- market/followed?resources=1q0,2q0,… dá v JEDNOM requestu pro všechy
-- sledované položky fiveMinutesCandlestick.volume = SKUTEČNÝ
-- obchodovaný objem za posledních 5 minut (bucket se shoduje s naším
-- 5min pollerem). Poller ho ukládá do price_history.volume.
--
-- Idempotentní — spouští se přes npm run db:upgrade.
-- ───────────────────────────────────────────────────────────────────

alter table public.price_history
  add column if not exists volume integer;
