-- ===========================================================================
-- v1.25.13 / v1.25.14 — found by PROACTIVE audit, not by waiting for the error
--
-- BUG 1: menu items with size / inch / manual / both pricing could not save.
--   types.ts declares six PricingType values; the CHECK allowed two.
--   menu_items already HAS size_variants and inch_variants columns, so this is
--   a shipped feature that the database rejected.
--
-- BUG 2: pending_owners upserts on tenant_id with no matching UNIQUE
--   constraint. Postgres requires one for ON CONFLICT, so re-inviting an owner
--   failed with "no unique or exclusion constraint matching...".
--
-- BUG 3: pending_owners.branch_id was NOT NULL, but platform.functions.ts
--   upserts only { tenant_id, email, claimed_at }. When the row existed the
--   UPDATE path worked; when it did not, the INSERT failed. So it broke on the
--   FIRST owner for a restaurant and looked fine on a retry.
-- ===========================================================================

alter table public.menu_items drop constraint if exists menu_items_pricing_type_check;
alter table public.menu_items add constraint menu_items_pricing_type_check
  check (pricing_type is null or pricing_type = any (array[
    'fixed'::text,   -- one price
    'weight'::text,  -- per kg, uses rate_per_kg
    'manual'::text,  -- cashier types the price at the till
    'size'::text,    -- uses size_variants
    'inch'::text,    -- uses inch_variants
    'both'::text     -- both size_variants and inch_variants
  ]));

delete from public.pending_owners a
using public.pending_owners b
where a.tenant_id = b.tenant_id and a.created_at < b.created_at;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'pending_owners_tenant_id_key'
                   and conrelid = 'public.pending_owners'::regclass) then
    alter table public.pending_owners
      add constraint pending_owners_tenant_id_key unique (tenant_id);
  end if;
end $$;

alter table public.pending_owners alter column branch_id       drop not null;
alter table public.pending_owners alter column restaurant_name drop not null;

comment on column public.pending_owners.branch_id is
  'Optional. sa_create_restaurant sets it; the owner-provisioning upsert does not.';
