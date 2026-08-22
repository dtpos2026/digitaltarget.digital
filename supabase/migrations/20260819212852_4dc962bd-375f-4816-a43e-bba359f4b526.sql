-- helpers
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.super_admins s where s.user_id = auth.uid() and s.is_active)
$$;

create or replace function public.auth_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.tenant_id from public.user_profiles p where p.user_id = auth.uid()
$$;

grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.auth_tenant_id() to authenticated;

-- platform tables
create table if not exists public.admin_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  setup_fee numeric(12,2) not null default 0,
  monthly_fee numeric(12,2) not null default 0,
  duration_months int not null default 1,
  devices int,
  description text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_plans (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  device_limit int,
  branch_limit int,
  price numeric(12,2) not null default 0,
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  number text not null,
  issued_at timestamptz not null default now(),
  due_at timestamptz,
  line_items jsonb not null default '[]'::jsonb,
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid_total numeric(12,2) not null default 0,
  status text not null default 'unpaid' check (status in ('unpaid','partial','paid','void')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.admin_invoices(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  amount numeric(12,2) not null,
  method text, reference text,
  received_at timestamptz not null default now(),
  notes text
);

create table if not exists public.admin_marketing_contacts (
  id uuid primary key default gen_random_uuid(),
  name text, phone text, email text, city text,
  restaurant_name text, source text, status text default 'new', notes text,
  linked_tenant_id uuid references public.tenants(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_service_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  title text, description text,
  status text not null default 'open',
  priority text default 'normal',
  assigned_to text, scheduled_at timestamptz, resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  channel text not null default 'stable',
  notes text, download_url text,
  is_published boolean not null default false,
  target_tenant_ids uuid[] not null default '{}',
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_support_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  direction text not null check (direction in ('in','out','owner','support')),
  body text not null,
  author_email text,
  status text default 'new',
  category text,
  attachment_path text,
  meta jsonb not null default '{}'::jsonb,
  intent text,
  ai_generated boolean not null default false,
  is_internal boolean not null default false,
  read_by_admin boolean not null default false,
  read_by_owner boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_support_tenant on public.admin_support_messages (tenant_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['admin_packages','admin_plans','admin_invoices','admin_payments','admin_marketing_contacts','admin_service_calls','admin_releases','admin_support_messages'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists sa_all on public.%I', t);
    execute format('create policy sa_all on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())', t);
  end loop;
end $$;

-- tenant-visible slices of platform data
create policy tenant_read_invoices on public.admin_invoices
  for select to authenticated using (tenant_id = public.auth_tenant_id());
create policy tenant_read_payments on public.admin_payments
  for select to authenticated using (tenant_id = public.auth_tenant_id());
create policy tenant_read_releases on public.admin_releases
  for select to authenticated using (is_published);
create policy tenant_rw_support on public.admin_support_messages
  for select to authenticated using (tenant_id = public.auth_tenant_id() and not is_internal);
create policy tenant_send_support on public.admin_support_messages
  for insert to authenticated with check (tenant_id = public.auth_tenant_id() and not is_internal);

-- core table policies: own tenant, or super admin
do $$
declare t text;
begin
  foreach t in array array['tenants','branches','user_profiles','devices','categories','kitchens','inventory_categories','inventory_items','menu_items','deals','promo_codes','floors','dining_tables','table_sessions','customers','payment_accounts','shifts','cash_movements'] loop
    execute format('drop policy if exists tenant_all on public.%I', t);
    if t = 'tenants' then
      execute 'create policy tenant_all on public.tenants for all to authenticated using (public.is_super_admin() or id = public.auth_tenant_id()) with check (public.is_super_admin())';
    else
      execute format('create policy tenant_all on public.%I for all to authenticated using (public.is_super_admin() or tenant_id = public.auth_tenant_id()) with check (public.is_super_admin() or tenant_id = public.auth_tenant_id())', t);
    end if;
  end loop;
end $$;

alter table public.super_admins enable row level security;
grant select on public.super_admins to authenticated;
grant all on public.super_admins to service_role;
drop policy if exists sa_self on public.super_admins;
create policy sa_self on public.super_admins for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

-- RPCs
create or replace function public.sa_create_restaurant(p_name text, p_email text, p_plan text default 'basic')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_slug text; v_id uuid; n int := 0;
begin
  if not public.is_super_admin() then raise exception 'Super Admin only'; end if;
  v_slug := regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then v_slug := 'restaurant'; end if;
  while exists (select 1 from tenants where slug = v_slug) loop
    n := n + 1; v_slug := v_slug || '-' || n;
  end loop;
  insert into tenants (name, slug, plan) values (p_name, v_slug, coalesce(p_plan,'basic'))
    returning id into v_id;
  insert into branches (tenant_id, name, is_active) values (v_id, 'Main Branch', true);
  insert into admin_marketing_contacts (name, email, restaurant_name, source, status, linked_tenant_id)
    values (p_name, p_email, p_name, 'super-admin', 'converted', v_id);
  return jsonb_build_object('tenant_id', v_id, 'slug', v_slug);
end $$;

create or replace function public.sa_set_plan(p_tenant uuid, p_plan text, p_expires timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'Super Admin only'; end if;
  update tenants set plan = p_plan, plan_expires_at = p_expires, updated_at = now() where id = p_tenant;
  if not found then raise exception 'Restaurant not found'; end if;
end $$;

create or replace function public.sa_list_team()
returns table (user_id uuid, email text, can_manage_team boolean, is_active boolean, created_at timestamptz)
language sql security definer set search_path = public as $$
  select s.user_id, s.email, s.can_manage_team, s.is_active, s.created_at
  from super_admins s where public.is_super_admin() order by s.created_at
$$;

create or replace function public.sa_add_team_member(p_email text, p_can_manage boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_bootstrap boolean;
begin
  select not exists (select 1 from super_admins where is_active) into v_bootstrap;
  if not v_bootstrap and not public.is_super_admin() then raise exception 'Super Admin only'; end if;
  select id into v_uid from auth.users where lower(email) = lower(p_email) limit 1;
  if v_uid is null then raise exception 'No account exists for %. Ask them to sign up first.', p_email; end if;
  insert into super_admins (user_id, email, can_manage_team, is_active)
    values (v_uid, lower(p_email), p_can_manage, true)
  on conflict (user_id) do update set can_manage_team = excluded.can_manage_team, is_active = true;
end $$;

create or replace function public.sa_remove_team_member(p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'Super Admin only'; end if;
  delete from super_admins where lower(email) = lower(p_email);
end $$;

create or replace function public.support_mark_read(p_tenant uuid, p_side text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_side = 'admin' then
    if not public.is_super_admin() then raise exception 'Super Admin only'; end if;
    update admin_support_messages set read_by_admin = true where tenant_id = p_tenant;
  else
    if not (public.is_super_admin() or p_tenant = public.auth_tenant_id()) then raise exception 'Not permitted'; end if;
    update admin_support_messages set read_by_owner = true where tenant_id = p_tenant;
  end if;
end $$;

create or replace function public.support_unread_counts()
returns table (tenant_id uuid, unread bigint)
language sql security definer set search_path = public as $$
  select m.tenant_id, count(*) from admin_support_messages m
  where public.is_super_admin() and not m.read_by_admin and m.direction in ('in','owner') and not m.is_internal
  group by m.tenant_id
$$;

create or replace function public.register_device(
  p_hardware_id text, p_label text, p_branch_id uuid,
  p_platform text default null, p_app_version text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_row devices;
begin
  v_tenant := public.auth_tenant_id();
  if v_tenant is null then raise exception 'No restaurant for this account'; end if;
  insert into devices (tenant_id, branch_id, device_label, hardware_id, platform, app_version, last_seen_at)
    values (v_tenant, p_branch_id, p_label, p_hardware_id, p_platform, p_app_version, now())
  on conflict (tenant_id, hardware_id) do update
    set device_label = excluded.device_label, branch_id = coalesce(excluded.branch_id, devices.branch_id),
        platform = excluded.platform, app_version = excluded.app_version, last_seen_at = now()
  returning * into v_row;
  return jsonb_build_object('device_id', v_row.id, 'approved', v_row.approved);
end $$;

grant execute on function public.sa_create_restaurant(text,text,text) to authenticated;
grant execute on function public.sa_set_plan(uuid,text,timestamptz) to authenticated;
grant execute on function public.sa_list_team() to authenticated;
grant execute on function public.sa_add_team_member(text,boolean) to authenticated;
grant execute on function public.sa_remove_team_member(text) to authenticated;
grant execute on function public.support_mark_read(uuid,text) to authenticated;
grant execute on function public.support_unread_counts() to authenticated;
grant execute on function public.register_device(text,text,uuid,text,text) to authenticated;

alter publication supabase_realtime add table public.admin_support_messages;
alter publication supabase_realtime add table public.devices;

insert into public.admin_plans (code, name, device_limit, branch_limit, price, sort_order) values
  ('trial','Trial',1,1,0,0),
  ('basic','Basic',2,1,3000,1),
  ('premium','Premium',5,3,7000,2),
  ('enterprise','Enterprise',null,null,15000,3)
on conflict (code) do nothing;