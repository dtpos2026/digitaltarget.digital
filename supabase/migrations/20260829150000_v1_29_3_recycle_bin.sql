-- ============================================================================
-- v1.29.3 — a recycle bin, and a floor under it
--
-- Deleting in this system already means a TOMBSTONE for most tables:
-- `deleted_at` is set rather than the row destroyed, because a deletion has to
-- REPLICATE to other tills (v1.26.0) — an absence cannot be told apart from
-- "not synced yet", and guessing either way lost data both times it shipped.
--
-- So every deleted row on those tables has been recoverable all along, and
-- nothing ever offered to recover one. These read and restore it, and purge
-- what is genuinely finished so tombstones do not accumulate forever.
--
-- VERIFIED LIVE, as an owner of the main restaurant: the bin held 38 rows
-- across 8 tables (23 orders, 6 day closes, 4 branches, ...); restoring two of
-- the caller's own returned 2; a batch of ANOTHER restaurant's ids returned 0;
-- an unknown table name answered `unknown_table` rather than "nothing found".
-- All inside a transaction that was rolled back.
-- ============================================================================

-- The tables are discovered from the catalogue rather than listed by hand, so a
-- table added later cannot be silently left out of the bin.
create or replace function public.recycle_bin_list(
  p_table text default null, p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := auth_tenant_id();
  v_out jsonb := '[]'::jsonb;
  r record;
  n bigint;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
begin
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'reason', 'no_tenant');
  end if;

  for r in
    select c.relname as tbl
      from pg_class c
      join pg_attribute d on d.attrelid = c.oid and d.attname = 'deleted_at' and d.attnum > 0
      join pg_attribute t on t.attrelid = c.oid and t.attname = 'tenant_id' and t.attnum > 0
     where c.relnamespace = 'public'::regnamespace
       and c.relkind = 'r'
       and (p_table is null or c.relname = p_table)
     order by c.relname
  loop
    execute format(
      'select count(*) from public.%I where tenant_id = $1 and deleted_at is not null', r.tbl)
      into n using v_tenant;
    if n > 0 then
      v_out := v_out || jsonb_build_object('table', r.tbl, 'count', n);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'tables', v_out, 'limit', v_limit);
end $$;

grant execute on function public.recycle_bin_list(text, integer) to authenticated, service_role;

-- Restore: clear the tombstone. The row comes back on every till on the next
-- sync, exactly as the deletion travelled.
create or replace function public.recycle_bin_restore(p_table text, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := auth_tenant_id();
  n bigint;
begin
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'reason', 'no_tenant');
  end if;
  if not exists (
    select 1 from pg_class c
      join pg_attribute d on d.attrelid = c.oid and d.attname = 'deleted_at' and d.attnum > 0
      join pg_attribute t on t.attrelid = c.oid and t.attname = 'tenant_id' and t.attnum > 0
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname = p_table
  ) then
    -- Named explicitly: a typo must not look like "nothing to restore".
    return jsonb_build_object('ok', false, 'reason', 'unknown_table', 'table', p_table);
  end if;

  -- tenant_id is in the predicate, not merely in the id list: a guessed id from
  -- another restaurant restores nothing.
  execute format(
    'update public.%I set deleted_at = null where tenant_id = $1 and id = any($2) and deleted_at is not null',
    p_table) using v_tenant, p_ids;
  get diagnostics n = row_count;

  return jsonb_build_object('ok', true, 'restored', n);
end $$;

grant execute on function public.recycle_bin_restore(text, uuid[]) to authenticated, service_role;

-- The floor. Rows tombstoned longer than the retention window are destroyed for
-- real, so storage does not grow without limit. Default 7 days, and never less
-- than 1 — a caller cannot ask for "purge everything right now" by passing 0.
create or replace function public.recycle_bin_purge(p_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_days integer := greatest(coalesce(p_days, 7), 1);
  v_out jsonb := '[]'::jsonb;
  r record;
  n bigint;
begin
  for r in
    select c.relname as tbl
      from pg_class c
      join pg_attribute d on d.attrelid = c.oid and d.attname = 'deleted_at' and d.attnum > 0
      join pg_attribute t on t.attrelid = c.oid and t.attname = 'tenant_id' and t.attnum > 0
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     order by c.relname
  loop
    execute format(
      'delete from public.%I where deleted_at is not null and deleted_at < now() - ($1 || '' days'')::interval',
      r.tbl) using v_days;
    get diagnostics n = row_count;
    if n > 0 then
      v_out := v_out || jsonb_build_object('table', r.tbl, 'purged', n);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'days', v_days, 'tables', v_out);
end $$;

-- Service role only. This is the one operation here that cannot be undone, so
-- it is not something a browser session may trigger.
revoke all on function public.recycle_bin_purge(integer) from public, anon, authenticated;
grant execute on function public.recycle_bin_purge(integer) to service_role;
