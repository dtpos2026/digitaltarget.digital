-- ===========================================================================
-- v1.25.19 — fields the sync was silently discarding
--
-- Found by replaying a REAL backup (405 orders, 90 customers, 172 menu items,
-- 253 recipes, 5111 stock logs) through the same filter rowToDb() applies,
-- instead of reasoning about the code in the abstract.
--
-- rowToDb() drops any field not in ALLOWED_COLUMNS:
--     if (allowed && !allowed.has(column)) continue;
-- There is no `extra` jsonb fallback, despite what the docstring above it
-- claims. So these fields were never rejected and never errored — they simply
-- never arrived, and the next cloud load overwrote the local copy that still
-- had them.
--
-- CUSTOMERS lost 14 fields across 90 records, including `addresses` — the
-- customer's saved delivery addresses. A delivery POS losing addresses is not
-- a cosmetic loss.
--
-- PROMO CODES: the app writes usageCount -> usage_count; the table has
-- used_count. Different names, so redemption counts never synced and a
-- max-uses limit could not be enforced across devices.
-- ===========================================================================

alter table public.customers
  add column if not exists addresses            jsonb not null default '[]'::jsonb,
  add column if not exists area                 text,
  add column if not exists province             text,
  add column if not exists full_address         text,
  add column if not exists grade                text,
  add column if not exists avg_order_value      numeric(12,2),
  add column if not exists order_frequency_days numeric(10,2),
  add column if not exists first_order_at       timestamptz,
  add column if not exists favorite_item_id     uuid,
  add column if not exists favorite_item_name   text,
  add column if not exists last_rider_id        uuid,
  add column if not exists preferred_branch_id  uuid,
  add column if not exists location_label       text,
  add column if not exists location_captured_at timestamptz;

alter table public.promo_codes
  add column if not exists usage_count integer not null default 0,
  add column if not exists created_at  timestamptz not null default now();

create or replace function public.sync_promo_usage_counts()
returns trigger language plpgsql as $function$
begin
  -- Whichever side the writer touched, make the other match. Without this a
  -- till writing usage_count leaves used_count stale, and the max_uses check
  -- reads the stale one.
  if new.usage_count is distinct from coalesce(old.usage_count, -1) then
    new.used_count := new.usage_count;
  elsif new.used_count is distinct from coalesce(old.used_count, -1) then
    new.usage_count := new.used_count;
  end if;
  return new;
end $function$;

drop trigger if exists trg_sync_promo_usage on public.promo_codes;
create trigger trg_sync_promo_usage
  before insert or update on public.promo_codes
  for each row execute function public.sync_promo_usage_counts();

alter table public.deals
  add column if not exists created_at timestamptz not null default now();

create index if not exists customers_tenant_phone_idx on public.customers (tenant_id, phone);
