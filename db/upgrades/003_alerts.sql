-- ═══════════════════════════════════════════════════════════════════
--  SIMALYTICS – upgrade 003: alerty (fáze 4)
--  Cenové alerty (target/stop) + signálové alerty (Signal Engine skóre).
--  Idempotentní – lze spustit opakovaně.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.alerts (
  id          uuid primary key default gen_random_uuid(),
  item_id     integer     not null references public.items(id) on delete cascade,
  quality     smallint    not null default 0,

  -- 'price' = cena překročí/propadne pod threshold
  -- 'score' = Signal Engine skóre dosáhne prahu
  kind        text        not null default 'price'
                          check (kind in ('price', 'score')),

  -- pro kind='price': 'above' | 'below'
  -- pro kind='score': 'above' | 'below' (skóre ≥ / ≤ práh)
  direction   text        not null default 'above'
                          check (direction in ('above', 'below')),

  threshold   numeric(12,4) not null,   -- $ pro ceny, body (−100…100) pro skóre

  note        text,                     -- vlastní popis („prodej při zisku")
  active      boolean     not null default true,

  -- Anti-spam: poslední trigger + počet opakování (cena se může držet
  -- nad prahem – notifikujeme jen překročení, po cooldownu znovu)
  last_triggered_at timestamptz,
  trigger_count     integer not null default 0,

  created_at  timestamptz not null default now()
);

create index if not exists idx_alerts_active
  on public.alerts (active, item_id);

create index if not exists idx_alerts_item
  on public.alerts (item_id, quality);
