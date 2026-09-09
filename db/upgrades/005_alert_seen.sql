-- ───────────────────────────────────────────────────────────────────
-- 005 · ALERT SEEN (odškrtnutí notifikace v hlavičce)
--
-- Když cena překročí práh, poller vyplní last_triggered_at a zvonek v
-- hlavičce začne svítat s počtem spuštěných alertů. Uživatel ale chce
-- notifikace „odškrtnout“ – kliknutí na zvonek je označí jako
-- prohlédnuté (seen_at = now) a badge zmizí. Údaj „spuštěno“ v
-- dropdownu zůstává (historie triggeru), jen už není „nové“.
--
-- Idempotentní — spouští se přes npm run db:upgrade.
-- ───────────────────────────────────────────────────────────────────

alter table public.alerts
  add column if not exists seen_at timestamptz;
