-- ===========================================================================
-- v1.25.7 — close two real column-level schema drifts
--
-- Table existence and RPCs were already correct; these are COLUMNS the running
-- code writes that the database did not have, so the writes failed at runtime:
--
--   "Could not find the 'address' column of 'admin_marketing_contacts'
--    in the schema cache"
--
-- NOTE ON src/integrations/supabase/types.ts: it is stale and must NOT be used
-- to generate migrations. It describes an older document-shaped design (it
-- claims `orders` has a `data` column, while the live table has ~100 real
-- columns). Generating DDL from it would corrupt the schema. The authoritative
-- write contract is ALLOWED_COLUMNS in src/lib/supabaseStore.ts plus the
-- explicit mappers such as marketingContacts.ts contactToDb().
--
-- Everything below is additive: new nullable columns only. Nothing is dropped,
-- renamed or retyped, and no existing row is modified.
-- ===========================================================================

-- --- 1. admin_marketing_contacts -----------------------------------------
alter table public.admin_marketing_contacts
  add column if not exists address           text,
  add column if not exists owner_name        text,
  add column if not exists restaurant_name   text,
  add column if not exists source            text,
  add column if not exists status            text,
  add column if not exists linked_tenant_id  uuid,
  add column if not exists linked_device_ids text[];

-- Deleting a restaurant must not delete the marketing contact that led to it;
-- the sales record outlives the account. SET NULL, not CASCADE.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'admin_marketing_contacts_linked_tenant_id_fkey'
  ) then
    alter table public.admin_marketing_contacts
      add constraint admin_marketing_contacts_linked_tenant_id_fkey
      foreign key (linked_tenant_id) references public.tenants(id) on delete set null;
  end if;
end $$;

create index if not exists admin_marketing_contacts_linked_tenant_id_idx
  on public.admin_marketing_contacts (linked_tenant_id);

-- The old `business` / `stage` columns are LEFT IN PLACE on purpose. They are
-- unused by current code but may hold data entered before the rename, and
-- dropping them here would destroy it silently. Migrate, then drop separately.

-- --- 2. branches ----------------------------------------------------------
-- ALLOWED_COLUMNS.branches lists these as writable, so the generic sync was
-- stripping every one of them before the row reached Postgres: a branch's tax
-- number, invoice prefix and footer silently never saved — and those print on
-- customer receipts.
alter table public.branches
  add column if not exists branch_code         text,
  add column if not exists email               text,
  add column if not exists invoice_prefix      text,
  add column if not exists invoice_footer      text,
  add column if not exists registration_number text,
  add column if not exists tax_number          text;
