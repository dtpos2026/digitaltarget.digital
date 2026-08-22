-- ===========================================================================
-- v1.25.16 — two sync rejections reported from live tills
--
--   Sync rejected (save tables/...): violates "chk_free_table_not_seated"
--   Order fail: null value in column "notes" of relation "orders"
--
-- BUG A: chk_free_table_not_seated says a table with status 'free' must have
-- seated_at and current_order_id NULL. When the POS closes a bill it sets
-- status='free' but does not always clear those, so the row is rejected and
-- the table never syncs — it stays "occupied" on every other till.
--
-- The constraint is RIGHT: a free table still pointing at an order is corrupt.
-- Rather than delete the rule or patch every call site that frees a table,
-- normalise at the boundary. A BEFORE trigger MAKES the invariant true instead
-- of merely asserting it, so no client can violate it — including the offline
-- queue replaying an old operation.
--
-- BUG B: orders.notes is NOT NULL *with a default*. A default only applies
-- when the column is OMITTED; the website order path sends notes explicitly as
-- null. v1.25.15 relaxed the legacy NOT NULLs but skipped columns that had
-- defaults, assuming the default would cover it. It does not. Same bug class,
-- arriving through the gap that assumption left.
-- ===========================================================================

create or replace function public.normalise_free_table()
returns trigger language plpgsql as $function$
begin
  if new.status = 'free' then
    new.seated_at        := null;
    new.current_order_id := null;
    new.seated_guests    := null;
  end if;
  return new;
end $function$;

drop trigger if exists trg_normalise_free_table on public.dining_tables;
create trigger trg_normalise_free_table
  before insert or update on public.dining_tables
  for each row execute function public.normalise_free_table();

do $$
declare t text; col record;
begin
  foreach t in array array['orders','order_items','order_payments'] loop
    for col in
      select c.column_name from information_schema.columns c
      where c.table_schema='public' and c.table_name=t
        and c.is_nullable='NO'
        and c.column_name not in ('id','tenant_id','data','client_seq','created_at','updated_at')
    loop
      execute format('alter table public.%I alter column %I drop not null', t, col.column_name);
    end loop;
  end loop;
end $$;
