-- ═══════════════════════════════════════════════════════════════════
-- 008 ALERTS v2 – směr 'cross' + jednorázové alerty (one_shot)
--
--  - direction 'cross': alert aktivuje Crossover prahu (cena přejde
--    z jedné strany na druhou, ať shora, tak zdola) – jen kind='price'.
--    Hlídá se vůči předchozí známé ceně (hub: poslední tick; poller:
--    předchozí záznam v price_history).
--  - one_shot: true = po PRVNÍ aktivaci se alert automaticky SMAŽE
--    (typické „zahlaď mi jednu příležitost"); false = zůstane aktivní
--    navždy (odstraní jen uživatel), chování beze změny.
--  Idempotentní – lze spustit opakovaně.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Sloupec one_shot
alter table public.alerts
  add column if not exists one_shot boolean not null default false;

-- 2) Rozšíření CHECK constraintu na direction o 'cross'
--    (postgres CHECK se mění jen rekreací – najdi starý název, dropni, vytvoř nový)
do $$
declare
  con text;
begin
  select c.conname into con
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  where t.relname = 'alerts'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%direction%'
    and pg_get_constraintdef(c.oid) like '%above%'
    limit 1;

  if con is not null then
    execute format('alter table public.alerts drop constraint %I', con);
  end if;
end $$;

alter table public.alerts
  drop constraint if exists alerts_direction_check;

alter table public.alerts
  add constraint alerts_direction_check
  check (direction in ('above', 'below', 'cross'));

-- 3) 'cross' dává smysl jen pro cenové alerty (skóre nemá smysluplný
--    crossover ve stejném slova smyslu; limit_sell je vždy 'above')
alter table public.alerts
  drop constraint if exists alerts_cross_price_only;
alter table public.alerts
  add constraint alerts_cross_price_only
  check (direction <> 'cross' or kind = 'price');
