-- ===========================================================================
-- v1.25.8 — make the 16 document-shaped modules writable
--
-- ===== WHAT WAS WRONG =====
-- src/lib/supabaseStore.ts routes 16 modules through DOC_TABLES. For those,
-- rowToDb() builds this row and nothing else:
--
--     { id, tenant_id, branch_id, data: <jsonb>, deleted_at, updated_at }
--
-- Not one of those 16 tables had a `data` column. They still carried an older
-- relational shape (employees.emp_code, attendance.work_date, ...) with NOT
-- NULL constraints the document write never fills.
--
-- So every write from these modules failed:
--   HR         - employees, attendance, leaves, payslips, advances
--   Accounts   - account_categories, transactions, parties, ledger_entries
--   Inventory  - stock_logs, receiving_entries, recipes, wastages
--   Finance    - day_closes, credit_payments, refunds
--
-- Same class of failure as the marketing-contact error, across sixteen tables.
-- The data lived only in the browser.
--
-- ===== WHAT THIS DOES =====
--  1. Adds the document columns the writer needs.
--  2. Relaxes NOT NULL on the legacy relational columns the document write
--     does not populate. They are KEPT, not dropped: any historical row
--     retains its values and nothing is destroyed.
--
-- All 16 tables were verified EMPTY before this ran.
-- ===========================================================================

do $$
declare
  t text;
  col record;
  doc_tables text[] := array[
    'stock_logs','employees','attendance','leaves','payslips','advances',
    'account_categories','transactions','parties','ledger_entries','day_closes',
    'receiving_entries','recipes','wastages','credit_payments','refunds'
  ];
begin
  foreach t in array doc_tables loop
    execute format(
      'alter table public.%I add column if not exists data jsonb not null default ''{}''::jsonb', t);
    execute format(
      'alter table public.%I add column if not exists deleted_at timestamptz', t);
    execute format(
      'alter table public.%I add column if not exists branch_id uuid', t);
    execute format(
      'alter table public.%I add column if not exists created_at timestamptz not null default now()', t);
    execute format(
      'alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);

    for col in
      select c.column_name
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = t
        and c.is_nullable = 'NO' and c.column_default is null
        and c.column_name not in ('id','tenant_id','data','created_at','updated_at')
    loop
      execute format('alter table public.%I alter column %I drop not null', t, col.column_name);
    end loop;

    execute format(
      'create index if not exists %I on public.%I (tenant_id, branch_id)',
      t || '_tenant_branch_idx', t);
  end loop;
end $$;
