-- ============================================================================
-- v1.28.4 — default account categories belong to the restaurant, not to the app
--
-- THE FAILURE THIS FIXES
--
-- A newly created restaurant showed "⚠ Stuck (8)" in the POS header within
-- minutes of the owner's first login, and never synced anything. The eight
-- were always the same eight: the default account categories.
--
-- seed-data.ts gives every device those categories with the FIXED local ids
-- 'ac1'..'ac8'. The client derives a cloud primary key from the local id
-- (cloudId -> stableUuid), and that derivation hashes the id and nothing else,
-- so 'ac1' is the same uuid for every restaurant. The first restaurant to sync
-- owned those eight rows; every restaurant created afterwards upserted onto
-- them. PostgREST sends INSERT ... ON CONFLICT (id) DO UPDATE, the conflict
-- fired, and RLS judged the UPDATE against the other tenant's row:
--
--     new row violates row-level security policy (USING expression)
--     for table "account_categories"
--
-- The production logs show that message eight at a time, on every 20-second
-- flush, from the moment the restaurant was created. After six attempts each
-- the ops were dead-lettered, which is the "Stuck (8)" badge.
--
-- RLS behaved correctly and no data crossed between restaurants. The mistake
-- was giving separate tenants the same row identity.
--
-- THE FIX
--
-- The client no longer ships those rows to a cloud tenant (store.ts,
-- emptyRuntimeData). The defaults are created HERE instead, once per
-- restaurant, each with its own gen_random_uuid() — so two restaurants can
-- never contend for one row again.
--
-- Idempotent, and additive only: no existing row is modified or removed. A
-- restaurant that already has account categories (including the one whose
-- eight derived rows started this) is left exactly as it is.
-- ============================================================================

-- ---------------------------------------------------------------- the defaults
create or replace function public.seed_default_account_categories(_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_added integer := 0;
begin
  if _tenant_id is null then
    return 0;
  end if;

  -- Only ever seeds an empty ledger. A restaurant that has renamed, deleted or
  -- added categories keeps its own set untouched.
  if exists (select 1 from public.account_categories where tenant_id = _tenant_id) then
    return 0;
  end if;

  insert into public.account_categories (id, tenant_id, name, kind, data)
  select gen_random_uuid(), _tenant_id, d.name, d.kind,
         jsonb_build_object('name', d.name, 'type', d.kind)
    from (values
      ('Sales',        'income'),
      ('Other Income', 'income'),
      ('Rent',         'expense'),
      ('Utilities',    'expense'),
      ('Salaries',     'expense'),
      ('Raw Material', 'expense'),
      ('Maintenance',  'expense'),
      ('Misc',         'expense')
    ) as d(name, kind);

  get diagnostics v_added = row_count;

  -- The POS keys a record by data->>'id'; make it the row's own uuid so the
  -- device and the server agree on one identity from the first read.
  update public.account_categories
     set data = data || jsonb_build_object('id', id::text)
   where tenant_id = _tenant_id
     and coalesce(data->>'id', '') = '';

  return v_added;
end $$;

revoke all on function public.seed_default_account_categories(uuid) from public, anon, authenticated;

-- ------------------------------------------------- new restaurants get them
--
-- sa_create_restaurant already provisions the branch, counters, settings and
-- the default POS admin. The account categories are the same kind of thing,
-- and doing it here is what makes them per-tenant rather than shared.
--
-- The workspace code is also returned now. The trigger has always minted one,
-- but nothing showed it: the Super Admin finished creating a restaurant with
-- no way to see the code its staff apps need, which read as "the workspace
-- code is not created".
create or replace function public.sa_create_restaurant(
  p_name text,
  p_email text,
  p_slug text default null,
  p_plan text default 'trial',
  p_branch_name text default 'Main Branch',
  p_phone text default null,
  p_address text default null,
  p_admin_password text default 'admin123')
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare
  v_tenant uuid; v_branch uuid; v_slug text; v_admin uuid; v_linked boolean;
  v_code text;
begin
  if not is_super_admin() then
    raise exception 'super admin only' using errcode = '42501';
  end if;
  if coalesce(trim(p_name),'') = '' or coalesce(trim(p_email),'') = '' then
    raise exception 'restaurant name and email are required' using errcode = '22023';
  end if;

  v_slug := coalesce(nullif(trim(p_slug),''),
                     regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if exists (select 1 from tenants where slug = v_slug) then
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
  end if;

  insert into tenants (name, slug, owner_user_id, plan)
  values (p_name, v_slug, auth.uid(), p_plan) returning id into v_tenant;

  insert into branches (tenant_id, name, phone, address, is_active)
  values (v_tenant, p_branch_name, p_phone, p_address, true) returning id into v_branch;

  insert into order_counters (tenant_id, branch_id, current_value) values (v_tenant, v_branch, 0);
  insert into token_counters (tenant_id, branch_id, current_value) values (v_tenant, v_branch, 0);

  insert into tenant_settings (tenant_id, settings)
  values (v_tenant, jsonb_build_object(
    'name', p_name, 'restaurantName', p_name,
    'phone1', p_phone, 'address', p_address,
    'plan', p_plan,
    'supabaseBackendEnabled', true));

  -- Default POS admin: every module, spans branches.
  v_admin := gen_random_uuid();
  insert into user_profiles (
    user_id, tenant_id, branch_id, username, display_name, role,
    permissions, pin_hash, is_active, all_branches, must_change_password, is_pos_user)
  values (
    v_admin, v_tenant, v_branch, 'admin', 'Administrator', 'admin',
    array['*'],
    crypt(coalesce(nullif(p_admin_password,''), 'admin123'), gen_salt('bf')),
    true, true, true, true);

  -- v1.28.4 — the restaurant's own account categories, each with its own uuid.
  perform seed_default_account_categories(v_tenant);

  insert into pending_owners (email, tenant_id, branch_id, restaurant_name, created_by)
  values (lower(trim(p_email)), v_tenant, v_branch, p_name, auth.uid())
  on conflict (email) do update
    set tenant_id = excluded.tenant_id, branch_id = excluded.branch_id,
        restaurant_name = excluded.restaurant_name, claimed_at = null;

  -- Link NOW if the account already exists. Without this the owner could
  -- authenticate but arrive with no tenant.
  v_linked := link_owner_if_account_exists(p_email, v_tenant, p_name);

  select workspace_code into v_code from tenants where id = v_tenant;

  return jsonb_build_object(
    'tenant_id', v_tenant, 'branch_id', v_branch, 'slug', v_slug,
    'email', lower(trim(p_email)), 'pos_username', 'admin',
    'workspace_code', v_code,
    'owner_linked', v_linked);
end $$;

-- ------------------------------------------ restaurants created before today
--
-- The two restaurants that already exist with no account categories get the
-- same set, so their Accounts module is not empty. A restaurant that has any
-- is skipped by the guard inside the function.
do $$
declare t record;
begin
  for t in select id from public.tenants loop
    perform public.seed_default_account_categories(t.id);
  end loop;
end $$;
