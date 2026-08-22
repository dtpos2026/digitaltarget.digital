-- ============================================================================
-- v1.26.0 — SYNC FOUNDATIONS
--
-- Three things every synchronised table needs, and which most of them were
-- missing. All of it is additive and idempotent: no table is recreated, no
-- row is deleted, no existing column changes type.
--
--  1. updated_at that actually moves.
--     Sixteen document tables (HR, accounts, ledger, day closes, stock logs,
--     refunds, ...) plus order_items/order_payments carry an `updated_at`
--     column whose only value ever written was the row's DEFAULT now() at
--     INSERT. Nothing advanced it on UPDATE. The client derives its merge
--     timestamp (`_updatedAt`) from that column, so a row edited on device A
--     still looked OLDER than device B's untouched copy — and the merge kept
--     B's. Edits made on one till never reached another.
--     Five more tables (floors, inventory_categories, payment_accounts,
--     promo_codes, shifts) had no such column at all, so their merge
--     timestamp was 0 and the local copy always won.
--
--  2. Tombstones.
--     Eleven tables were hard-DELETEd. A device that reads the collection
--     afterwards sees the row simply ABSENT, which is indistinguishable from
--     "not pushed yet" — so the client's union merge re-added it and pushed
--     it back up. Deletes undid themselves. A `deleted_at` stamp is a fact
--     that can be replicated; an absence is not.
--
--  3. Realtime.
--     The client subscribes to ~28 tables. The `supabase_realtime`
--     publication contained SEVEN. Menu, categories, customers, inventory,
--     branches, deals, promos, shifts, settings and every document module
--     produced no change events at all, so a second device only ever saw new
--     data by being restarted.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. updated_at columns for the five tables that never had one
-- ---------------------------------------------------------------------------
alter table public.floors               add column if not exists updated_at timestamptz not null default now();
alter table public.inventory_categories add column if not exists updated_at timestamptz not null default now();
alter table public.payment_accounts     add column if not exists updated_at timestamptz not null default now();
alter table public.promo_codes          add column if not exists updated_at timestamptz not null default now();
alter table public.shifts               add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- 2. touch_updated_at on EVERY public table that has the column.
--    Written as a loop so a table added later cannot silently miss it.
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join information_schema.columns col
      on col.table_schema = 'public'
     and col.table_name   = c.relname
     and col.column_name  = 'updated_at'
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not exists (
        select 1 from pg_trigger tg
        where tg.tgrelid = c.oid
          and not tg.tgisinternal
          and tg.tgname = 'trg_touch_' || c.relname
      )
  loop
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.touch_updated_at()',
      'trg_touch_' || t.relname, t.relname);
    raise notice 'touch_updated_at installed on %', t.relname;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. deleted_at tombstones for the tables that were hard-deleted.
--    Existing rows get NULL, i.e. "not deleted" — nothing disappears.
-- ---------------------------------------------------------------------------
alter table public.dining_tables        add column if not exists deleted_at timestamptz;
alter table public.floors               add column if not exists deleted_at timestamptz;
alter table public.kitchens             add column if not exists deleted_at timestamptz;
alter table public.inventory_items      add column if not exists deleted_at timestamptz;
alter table public.inventory_categories add column if not exists deleted_at timestamptz;
alter table public.customers            add column if not exists deleted_at timestamptz;
alter table public.branches             add column if not exists deleted_at timestamptz;
alter table public.deals                add column if not exists deleted_at timestamptz;
alter table public.promo_codes          add column if not exists deleted_at timestamptz;
alter table public.payment_accounts     add column if not exists deleted_at timestamptz;
alter table public.shifts               add column if not exists deleted_at timestamptz;

-- Live-row lookups skip tombstones; a partial index keeps that free.
create index if not exists idx_dining_tables_live        on public.dining_tables        (tenant_id) where deleted_at is null;
create index if not exists idx_floors_live               on public.floors               (tenant_id) where deleted_at is null;
create index if not exists idx_kitchens_live             on public.kitchens             (tenant_id) where deleted_at is null;
create index if not exists idx_inventory_items_live      on public.inventory_items      (tenant_id) where deleted_at is null;
create index if not exists idx_inventory_categories_live on public.inventory_categories (tenant_id) where deleted_at is null;
create index if not exists idx_customers_live            on public.customers            (tenant_id) where deleted_at is null;
create index if not exists idx_branches_live             on public.branches             (tenant_id) where deleted_at is null;
create index if not exists idx_deals_live                on public.deals                (tenant_id) where deleted_at is null;
create index if not exists idx_promo_codes_live          on public.promo_codes          (tenant_id) where deleted_at is null;
create index if not exists idx_payment_accounts_live     on public.payment_accounts     (tenant_id) where deleted_at is null;
create index if not exists idx_shifts_live               on public.shifts               (tenant_id) where deleted_at is null;

-- The customer-portal read policies must not serve tombstoned rows.
drop policy if exists branches_public_read on public.branches;
create policy branches_public_read on public.branches
  for select to anon using (is_active and deleted_at is null);

-- ---------------------------------------------------------------------------
-- 4. Realtime publication.
--    Every tenant-scoped table the POS synchronises, added idempotently.
-- ---------------------------------------------------------------------------
do $$
declare t text;
declare wanted text[] := array[
  -- POS core
  'categories','menu_items','orders','dining_tables','floors','kitchens',
  'inventory_items','inventory_categories','customers','branches','deals',
  'promo_codes','payment_accounts','shifts','recipes',
  -- documents / back office
  'stock_logs','employees','attendance','leaves','payslips','advances',
  'account_categories','transactions','parties','ledger_entries','day_closes',
  'receiving_entries','wastages','credit_payments','refunds',
  -- settings, staff and the shared document store
  'tenant_settings','module_documents','user_profiles','printer_settings'
];
begin
  foreach t in array wanted loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relname=t and c.relkind='r') then
      raise notice 'skipping % (table not present)', t;
      continue;
    end if;
    if exists (select 1 from pg_publication_tables
               where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      continue;
    end if;
    execute format('alter publication supabase_realtime add table public.%I', t);
    raise notice 'realtime enabled for %', t;
  end loop;
end $$;
