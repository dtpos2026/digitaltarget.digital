-- ============================================================================
-- v1.33.0/1 — CRITICAL: the recycle-bin purge could destroy sales history
--
-- SELF-INFLICTED, in v1.29.3. Before that migration a `deleted_at` tombstone
-- was permanent but HARMLESS: the row stayed on the server for ever, and admin
-- sales history could still read it with includeDeleted. Adding
-- recycle_bin_purge turned every tombstone into an eventual HARD DELETE.
--
-- Measured on the live database:
--     orders with deleted_at set ......................... 23
--     of those, older than the 7-day window .............. 23
-- One call to recycle_bin_purge() would have permanently destroyed twenty-three
-- real bills. pg_cron is not installed, so nothing had run it and no data was
-- lost — this closes the hole before it could ever open.
--
-- The instruction was explicit: "Closing the day must NEVER permanently destroy
-- required historical sales records." A recycle bin that eats the ledger is not
-- a recycle bin.
--
-- A SECOND BUG, FOUND BY RUNNING IT
-- The first version of this fix still aborted the whole run:
--     ERROR: update or delete on table "branches" violates foreign key
--            constraint "orders_branch_id_fkey" on table "orders"
-- One tombstoned branch that a live order still referenced stopped every later
-- table from being cleaned at all. So the purge now also protects the rows the
-- books POINT AT, and wraps each table in its own block: a blocked table is
-- reported, not fatal.
--
-- WHAT IT DOES NOW, verified live with an aggressive 1-day window:
--     orders      23 -> 23        day_closes 33 -> 33      customers 1499 -> 1499
--     purged:     leaves 1, module_documents 1   (genuinely disposable)
--     retained:   orders, day_closes, branches, menu_items, advances, ...
--     blocked:    []                              (no foreign-key aborts)
--     callable by anon/authenticated: no — service_role only
--
-- Note the system already has the RIGHT mechanism for closing a day:
-- orders.archived_at keeps the row in full while stopping it loading into the
-- POS. Nothing in the ledger ever needs destroying to close a day.
-- ============================================================================

create or replace function public.recycle_bin_purge(p_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_days integer := greatest(coalesce(p_days, 7), 1);
  v_out jsonb := '[]'::jsonb;
  v_kept jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  r record;
  n bigint;
  protected constant text[] := array[
    -- financial and audit records
    'orders', 'order_items', 'order_payments', 'order_payment_corrections',
    'order_edit_logs', 'refunds', 'refund_lines', 'transactions',
    'ledger_entries', 'credit_payments', 'cash_movements', 'day_closes',
    'shifts', 'stock_logs', 'wastages', 'receiving_entries',
    'kot_revisions', 'kot_revision_lines', 'reprint_logs',
    'staff_audit_logs', 'payslips', 'advances', 'attendance',
    -- referenced BY the books: destroying one of these orphans a real bill
    'customers', 'branches', 'payment_accounts', 'menu_items',
    'inventory_items', 'user_profiles', 'parties', 'employees'
  ];
begin
  for r in
    select c.relname as tbl
      from pg_class c
      join pg_attribute d on d.attrelid = c.oid and d.attname = 'deleted_at' and d.attnum > 0
      join pg_attribute t on t.attrelid = c.oid and t.attname = 'tenant_id' and t.attnum > 0
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     order by c.relname
  loop
    if r.tbl = any(protected) then
      execute format(
        'select count(*) from public.%I where deleted_at is not null and deleted_at < now() - ($1 || '' days'')::interval',
        r.tbl) into n using v_days;
      if n > 0 then
        v_kept := v_kept || jsonb_build_object('table', r.tbl, 'retained', n);
      end if;
      continue;
    end if;

    begin
      execute format(
        'delete from public.%I where deleted_at is not null and deleted_at < now() - ($1 || '' days'')::interval',
        r.tbl) using v_days;
      get diagnostics n = row_count;
      if n > 0 then
        v_out := v_out || jsonb_build_object('table', r.tbl, 'purged', n);
      end if;
    exception
      when foreign_key_violation then
        v_blocked := v_blocked || jsonb_build_object(
          'table', r.tbl, 'reason', 'still referenced by a live record');
      when others then
        v_blocked := v_blocked || jsonb_build_object(
          'table', r.tbl, 'reason', left(sqlerrm, 200));
    end;
  end loop;

  return jsonb_build_object(
    'ok', true, 'days', v_days,
    'purged', v_out,
    'retained_forever', v_kept,
    'blocked', v_blocked,
    'note', 'financial and audit records, and anything the books reference, are never purged');
end $$;

revoke all on function public.recycle_bin_purge(integer) from public, anon, authenticated;
grant execute on function public.recycle_bin_purge(integer) to service_role;
