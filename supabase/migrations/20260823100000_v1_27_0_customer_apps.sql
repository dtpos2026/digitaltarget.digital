-- ============================================================================
-- v1.27.0 — Premium Customer App: per-restaurant configuration
--
-- One row per restaurant, owned by the Super Admin. It holds only what the
-- customer-facing app needs to brand and configure itself: name, icon, theme,
-- the WhatsApp number to float, which features are on, and the current app
-- version. No secrets, no keys.
--
-- The customer app is NOT a second ordering system. It is the existing customer
-- order website, themed per tenant and packaged. This table is the only new
-- state it needs.
-- ============================================================================

create table if not exists public.customer_apps (
  tenant_id            uuid primary key references public.tenants(id) on delete cascade,
  enabled              boolean     not null default false,
  app_name             text,
  logo_url             text,
  icon_url             text,
  -- { "primary": "#7c3aed", "background": "#0f172a", "mode": "dark" }
  theme                jsonb       not null default '{}'::jsonb,
  whatsapp_number      text,
  -- { "ordering": true, "tracking": true, "support": true, "offers": true,
  --   "loyalty": false, "reorder": true }
  features             jsonb       not null default '{}'::jsonb,
  app_version          text,
  min_supported_version text,
  update_url           text,
  update_required      boolean     not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.customer_apps enable row level security;

-- Super Admin owns this table outright.
drop policy if exists customer_apps_super_admin on public.customer_apps;
create policy customer_apps_super_admin on public.customer_apps
  for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- A restaurant may READ its own configuration (so the POS can show what its
-- customer app is set to) but not change it — the plan is sold, not self-served.
drop policy if exists customer_apps_tenant_read on public.customer_apps;
create policy customer_apps_tenant_read on public.customer_apps
  for select to authenticated
  using (tenant_id = auth_tenant_id());

-- NOTE: there is deliberately NO anon policy. A customer's app reads its
-- branding through public_customer_app_config() below, which returns exactly
-- one tenant's row. A blanket anon SELECT would let anyone enumerate every
-- restaurant on the platform along with its WhatsApp number.

drop trigger if exists trg_customer_apps_touch on public.customer_apps;
create trigger trg_customer_apps_touch
  before update on public.customer_apps
  for each row execute function touch_updated_at();

-- ============================================================================
-- Customer profile fields the app collects at signup.
--
-- Everything else it needs — name, phone, address, city, area, lat/lng,
-- addresses jsonb, pin_hash, loyalty, spend and order analytics — is ALREADY on
-- this table. Only these four are new.
-- ============================================================================
alter table public.customers add column if not exists email          text;
alter table public.customers add column if not exists date_of_birth  date;
-- Push delivery. Stored per customer, cleared when they sign out of a device.
alter table public.customers add column if not exists push_token     text;
alter table public.customers add column if not exists last_login_at  timestamptz;

-- Birthday campaigns look up "who has a birthday this week" across a tenant,
-- which is a month/day question, not a date one.
create index if not exists idx_customers_birthday
  on public.customers (tenant_id, (extract(month from date_of_birth)), (extract(day from date_of_birth)))
  where date_of_birth is not null and deleted_at is null;

-- ============================================================================
-- Branding for ONE restaurant, readable before anybody has signed in.
--
-- Returns nothing for a restaurant whose app is switched off, so disabling it
-- in the Super Admin panel actually takes the app dark rather than merely
-- hiding a button.
-- ============================================================================
create or replace function public.public_customer_app_config(p_tenant uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'tenantId',        c.tenant_id,
    'enabled',         c.enabled,
    'appName',         coalesce(nullif(c.app_name, ''), t.name),
    'logoUrl',         c.logo_url,
    'iconUrl',         c.icon_url,
    'theme',           c.theme,
    'whatsappNumber',  c.whatsapp_number,
    'features',        c.features,
    'appVersion',      c.app_version,
    'minSupportedVersion', c.min_supported_version,
    'updateUrl',       c.update_url,
    'updateRequired',  c.update_required)
  from public.customer_apps c
  join public.tenants t on t.id = c.tenant_id
  where c.tenant_id = p_tenant
    and c.enabled
    and t.is_active;
$$;

revoke execute on function public.public_customer_app_config(uuid) from public;
grant  execute on function public.public_customer_app_config(uuid) to anon, authenticated, service_role;

comment on function public.public_customer_app_config(uuid) is
  'Branding for one restaurant''s customer app. Anon-callable by design: the app must theme itself before anyone signs in. Returns nothing when the app is disabled.';
