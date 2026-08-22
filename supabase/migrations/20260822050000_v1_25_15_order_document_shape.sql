-- ===========================================================================
-- v1.25.15 — the ORDER tables could not accept an order
--
--   Sync rejected (save orders/...): Could not find the 'client_seq' column
--   Sync rejected (save categories/...): Could not find the 'icon' column
--
-- ===== WHY THE EARLIER AUDITS MISSED THIS =====
-- Earlier rounds checked ALLOWED_COLUMNS (10 tables) and DOC_TABLES (16).
-- orders, order_items, order_payments and categories are in NEITHER: they have
-- their own explicit mappers at the top of rowToDb() in supabaseStore.ts, and
-- those mappers were never compared against the database.
--
-- rowToDb('orders') sends exactly:
--     branch_id, device_id, order_number, status, total, data, client_seq,
--     deleted_at
-- The table had none of total, data, client_seq, deleted_at. It was still the
-- old ~100-column relational design while the code had moved to the document
-- design — the same mismatch as v1.25.8, in the most important tables in the
-- product. Nothing a till sold could reach the cloud.
--
-- Additive only. Legacy relational columns are KEPT; their NOT NULL
-- constraints are relaxed because the document write does not fill them.
-- ===========================================================================

alter table public.orders
  add column if not exists data       jsonb  not null default '{}'::jsonb,
  add column if not exists client_seq bigint not null default 0,
  add column if not exists total      numeric(12,2) not null default 0,
  add column if not exists deleted_at timestamptz;

alter table public.order_items
  add column if not exists data       jsonb  not null default '{}'::jsonb,
  add column if not exists client_seq bigint not null default 0,
  add column if not exists deleted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.order_payments
  add column if not exists data       jsonb  not null default '{}'::jsonb,
  add column if not exists client_seq bigint not null default 0,
  add column if not exists deleted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.categories
  add column if not exists icon       text,
  add column if not exists image_path text;

do $$
declare t text; col record;
begin
  foreach t in array array['orders','order_items','order_payments'] loop
    for col in
      select c.column_name from information_schema.columns c
      where c.table_schema='public' and c.table_name=t
        and c.is_nullable='NO' and c.column_default is null
        and c.column_name not in ('id','tenant_id','data','client_seq','total','updated_at')
    loop
      execute format('alter table public.%I alter column %I drop not null', t, col.column_name);
    end loop;
  end loop;
end $$;

create index if not exists orders_tenant_branch_seq_idx
  on public.orders (tenant_id, branch_id, client_seq desc);
create index if not exists order_items_order_idx
  on public.order_items (tenant_id, order_id);
create index if not exists order_payments_order_idx
  on public.order_payments (tenant_id, order_id);
