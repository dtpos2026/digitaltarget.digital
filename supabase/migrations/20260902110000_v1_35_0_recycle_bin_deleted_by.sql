-- ============================================================================
-- v1.35.0 — the recycle bin knows WHO deleted a record
--
-- The bin was derived from `deleted_at` alone: it could show what was deleted
-- and offer it back, but never answer the first question an owner asks — who
-- did this? The requirement asked for record, restaurant, user, deleted-by,
-- timestamp and type.
--
-- Stamped by a TRIGGER, not by the client. sbDeleteMany could have been made to
-- send a user id, but a client-supplied "who" is worth nothing: it can be
-- whatever the caller likes. auth.uid() comes from the verified JWT inside
-- Postgres and cannot be forged.
--
-- Applied to every table that has both deleted_at and tenant_id, discovered
-- from the catalogue rather than listed by hand, so a table added later is
-- covered without anyone remembering to come back here.
--
-- VERIFIED LIVE (rolled back): deleting a menu item as a signed-in owner
-- stamped 3f18fbad-… / "Butt"; the bin returned the record with its id,
-- tenantId, deletedAt, deletedBy, deletedByName and recordType; restore
-- returned 1 and cleared both marks.
-- ============================================================================

do $$
declare r record;
begin
  for r in
    select c.relname as tbl from pg_class c
      join pg_attribute d on d.attrelid=c.oid and d.attname='deleted_at' and d.attnum>0
      join pg_attribute t on t.attrelid=c.oid and t.attname='tenant_id'  and t.attnum>0
     where c.relnamespace='public'::regnamespace and c.relkind='r'
  loop
    execute format('alter table public.%I add column if not exists deleted_by uuid', r.tbl);
    execute format('alter table public.%I add column if not exists deleted_by_name text', r.tbl);
  end loop;
end $$;

create or replace function public.stamp_deleted_by()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text;
begin
  -- Only on the transition INTO the bin: a row that is already tombstoned and
  -- gets touched again must keep the original culprit and the original time.
  if new.deleted_at is not null and old.deleted_at is null then
    select coalesce(p.display_name, p.username) into v_name
      from public.user_profiles p where p.user_id = auth.uid() limit 1;
    new.deleted_by      := auth.uid();
    -- Denormalised on purpose: a staff member can be removed, and "deleted by
    -- <nobody>" six months later helps no one.
    new.deleted_by_name := v_name;
  elsif new.deleted_at is null and old.deleted_at is not null then
    new.deleted_by      := null;
    new.deleted_by_name := null;
  end if;
  return new;
end $function$;

do $$
declare r record;
begin
  for r in
    select c.relname as tbl from pg_class c
      join pg_attribute d on d.attrelid=c.oid and d.attname='deleted_at' and d.attnum>0
      join pg_attribute t on t.attrelid=c.oid and t.attname='tenant_id'  and t.attnum>0
     where c.relnamespace='public'::regnamespace and c.relkind='r'
  loop
    execute format('drop trigger if exists trg_stamp_deleted_by on public.%I', r.tbl);
    execute format('create trigger trg_stamp_deleted_by before update of deleted_at on public.%I '
                   || 'for each row execute function public.stamp_deleted_by()', r.tbl);
  end loop;
end $$;
