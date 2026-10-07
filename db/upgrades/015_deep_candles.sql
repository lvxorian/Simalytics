-- ═══════════════════════════════════════════════════════════════════
--  SIMALYTICS – upgrade 015: hluboká historie svíček (archiv 1W/1M)
--
--  Proč: Simco Tools endpoint candlesticks vrací DENNÍ svíčky jen ~365 dní
--  (bez parametrů dokonce jen posledních ~91 dní!), ale pro granularitu
--  1W/1M má ARCHIV od roku 2022. Denní svíčky proto zůstávají věrné
--  denním datům (žádné fabrikované dny) a hluboká týdenní/měsíční
--  historie se ukládá zvlášť do této tabulky. Grafy 1W/1M je slučují
--  s recentní agregací z denních svíček (dedupe dle bucketu).
--
--  Idempotentní – lze spustit opakovaně.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.market_candles_archive (
  resource_id  integer       not null references public.items(id) on delete cascade,
  quality      smallint      not null default 0,
  granularity  text          not null,    -- '1w' | '1M'
  bucket_start date          not null,    -- pondělí / 1. den měsíce (UTC)
  open         numeric(14,4) not null,
  high         numeric(14,4) not null,
  low          numeric(14,4) not null,
  close        numeric(14,4) not null,
  volume       bigint,                    -- starý archiv (2022–2024) bez objemu = null
  primary key (resource_id, quality, granularity, bucket_start)
);

create index if not exists idx_candles_archive_resource
  on public.market_candles_archive (resource_id, quality, granularity, bucket_start desc);
