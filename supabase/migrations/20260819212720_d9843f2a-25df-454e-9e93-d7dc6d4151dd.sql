create extension if not exists "pgcrypto";

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  owner_user_id uuid references auth.users(id) on delete restrict,
  plan text not null default 'basic',
  plan_expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  address text, phone text, city text,
  lat double precision, lng double precision,
  service_radius_km numeric(6,2),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_branches_tenant on public.branches (tenant_id);

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  username text not null,
  display_name text not null,
  role text not null check (role in ('owner','admin','manager','cashier','waiter','rider','order_taker')),
  permissions text[] not null default '{}',
  feature_permissions text[] not null default '{}',
  phone text,
  pin_hash text,
  all_branches boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, username)
);
create index if not exists idx_user_profiles_tenant on public.user_profiles (tenant_id, branch_id);

create table if not exists public.super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  can_manage_team boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  device_label text not null,
  hardware_id text not null,
  platform text,
  app_version text,
  approved boolean not null default false,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  last_seen_at timestamptz,
  last_sync_at timestamptz,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  unique (tenant_id, hardware_id)
);
create index if not exists idx_devices_tenant_branch on public.devices (tenant_id, branch_id);
create index if not exists idx_devices_approved on public.devices (approved, created_at desc);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_categories_tenant on public.categories (tenant_id) where deleted_at is null;

create table if not exists public.kitchens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  name text not null,
  printer_role text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
create index if not exists idx_kitchens_tenant on public.kitchens (tenant_id, branch_id);

create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sort_order int not null default 0
);
create index if not exists idx_invcat_tenant on public.inventory_categories (tenant_id);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  category_id uuid references public.inventory_categories(id) on delete set null,
  name text not null,
  sku text,
  base_unit text not null default 'pcs' check (base_unit in ('kg','g','l','ml','pcs')),
  unit text,
  quantity numeric(14,4) not null default 0,
  cost_price numeric(12,4) not null default 0,
  avg_cost_price numeric(12,4),
  sale_price numeric(12,2) not null default 0,
  low_stock_threshold numeric(14,4) not null default 0,
  conversions jsonb not null default '[]'::jsonb,
  image_path text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
create index if not exists idx_inv_tenant_branch on public.inventory_items (tenant_id, branch_id);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  kitchen_id uuid references public.kitchens(id) on delete set null,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  name text not null,
  barcode text, sku text,
  pricing_type text not null default 'fixed' check (pricing_type in ('fixed','weight')),
  price numeric(12,2) not null default 0,
  rate_per_kg numeric(12,2) not null default 0,
  stock_per_unit numeric(12,4),
  image_path text, sub_category text, flavor_group text,
  flavors text[] not null default '{}',
  size_variants jsonb not null default '[]'::jsonb,
  inch_variants jsonb not null default '[]'::jsonb,
  is_token_item boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_menu_tenant_cat on public.menu_items (tenant_id, category_id) where deleted_at is null;

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  price numeric(12,2) not null,
  items jsonb not null default '[]'::jsonb,
  image_path text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  discount_type text not null check (discount_type in ('fixed','percent')),
  discount_value numeric(12,2) not null,
  max_uses int,
  used_count int not null default 0,
  valid_from timestamptz, valid_until timestamptz,
  is_active boolean not null default true,
  unique (tenant_id, code)
);

create table if not exists public.floors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  name text not null,
  sort_order int not null default 0
);

create table if not exists public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  floor_id uuid references public.floors(id) on delete set null,
  name text not null,
  seats int not null default 4,
  shape text default 'square',
  status text not null default 'free' check (status in ('free','running','pending-payment','closed')),
  current_order_id uuid,
  seated_at timestamptz,
  seated_guests int,
  pos_x double precision, pos_y double precision,
  updated_at timestamptz not null default now()
);
create index if not exists idx_tables_tenant_branch on public.dining_tables (tenant_id, branch_id);

create table if not exists public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  table_id uuid not null references public.dining_tables(id) on delete cascade,
  seated_at timestamptz not null,
  freed_at timestamptz not null,
  duration_minutes int not null,
  guests int, order_id uuid, order_number int,
  total numeric(12,2)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text, phone text, address text, city text,
  lat double precision, lng double precision,
  loyalty_points int not null default 0,
  credit_balance numeric(12,2) not null default 0,
  is_blocked boolean not null default false,
  pin_hash text,
  total_orders int not null default 0,
  total_spent numeric(14,2) not null default 0,
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, phone)
);

create table if not exists public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  name text not null,
  type text not null,
  account_number text,
  is_active boolean not null default true,
  sort_order int not null default 0
);

create table if not exists public.shifts (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  opened_by uuid, opened_by_name text,
  opened_at timestamptz not null default now(),
  starting_cash numeric(12,2) not null default 0,
  closed_by uuid, closed_by_name text,
  closed_at timestamptz,
  ending_cash numeric(12,2), expected_cash numeric(12,2), variance numeric(12,2),
  status text not null default 'open' check (status in ('open','closed'))
);
create index if not exists idx_shifts on public.shifts (tenant_id, branch_id, opened_at desc);

create table if not exists public.cash_movements (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  shift_id uuid references public.shifts(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  amount numeric(12,2) not null check (amount > 0),
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid
);

do $$
declare t text;
begin
  foreach t in array array['tenants','branches','user_profiles','super_admins','devices','categories','kitchens','inventory_categories','inventory_items','menu_items','deals','promo_codes','floors','dining_tables','table_sessions','customers','payment_accounts','shifts','cash_movements'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;