-- ============================================================================
-- v1.31.1 — CRITICAL: every restaurant shipped with the same known password
--
-- FOUND BY TESTING IT, not by reading. Against the live database:
--
--   select pin_hash = crypt('admin123', pin_hash) from user_profiles
--    where username = 'admin';
--   -> true, true
--
-- Both live restaurants' `admin` accounts — role 'admin', permissions ['*'],
-- all_branches true — open with the password `admin123`. That string is:
--   * the DEFAULT VALUE of sa_create_restaurant's p_admin_password parameter,
--   * hardcoded again in src/lib/seed-data.ts,
--   * printed in the Super Admin UI as "Default staff login: admin / admin123",
--   * and therefore in a GitHub repository.
--
-- Anyone who knows a restaurant's workspace code can sign in as its
-- administrator. This is the most serious finding of the audit.
--
-- THE FLAG THAT WAS ALREADY THERE AND NEVER READ
-- user_profiles.must_change_password exists, and sa_create_restaurant already
-- sets it to true for the admin it creates. Both live admins have it set. But
-- grep across the whole client returns ZERO references: verify_staff_pin never
-- returned it, staffSignIn never returned it, and LoginPage never checked it.
-- The safety mechanism was built, wired to nothing, and shipped.
--
-- THREE CHANGES
--
-- 1. No shared default. p_admin_password now defaults to NULL and a random
--    password is generated per restaurant, returned ONCE as `pos_password` so
--    the Super Admin can hand it over. A caller that passes a password still
--    gets that password. There is no constant left to guess.
--
-- 2. verify_staff_pin returns must_change_password, so the client can act on
--    it. This is what makes the existing flag mean something.
--
-- 3. pos_change_own_password lets a user change their OWN password by proving
--    the current one. pos_set_user_pin requires owner/admin/manager, so a
--    cashier forced to change theirs had no way to do it.
--
-- NOT DONE HERE, DELIBERATELY: the two live admin passwords are NOT rewritten.
-- Changing a live credential from a migration risks locking the owner out of
-- their own POS. must_change_password is already true on both, so change 2 and
-- the client enforcement force the change at their next sign-in instead —
-- which fixes it without anyone losing access.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A readable one-time password. No ambiguous glyphs (0/O, 1/l/I), because a
-- human reads this off a screen and types it into a till.
-- ---------------------------------------------------------------------------
create or replace function public.generate_initial_password(p_len integer default 12)
returns text
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  out text := '';
  i integer;
  n integer := greatest(coalesce(p_len, 12), 10);
begin
  for i in 1..n loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end $function$;

revoke all on function public.generate_initial_password(integer) from public, anon, authenticated;
grant execute on function public.generate_initial_password(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 1. Restaurant creation: no shared default password, ever again.
-- ---------------------------------------------------------------------------
create or replace function public.sa_create_restaurant(
  p_name text, p_email text, p_slug text default null,
  p_plan text default 'trial', p_branch_name text default 'Main Branch',
  p_phone text default null, p_address text default null,
  p_admin_password text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_tenant uuid; v_branch uuid; v_slug text; v_admin uuid; v_linked boolean;
  v_code text; v_password text; v_generated boolean;
begin
  if not is_super_admin() then
    raise exception 'super admin only' using errcode = '42501';
  end if;
  if coalesce(trim(p_name),'') = '' or coalesce(trim(p_email),'') = '' then
    raise exception 'restaurant name and email are required' using errcode = '22023';
  end if;

  -- The whole point of this migration: when the caller supplies nothing, the
  -- password is RANDOM, not a constant every restaurant on the platform shares.
  v_generated := coalesce(nullif(trim(p_admin_password), ''), '') = '';
  v_password  := case when v_generated
                      then generate_initial_password(12)
                      else trim(p_admin_password) end;
  if length(v_password) < 6 then
    raise exception 'the admin password must be at least 6 characters' using errcode = '22023';
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

  v_admin := gen_random_uuid();
  insert into user_profiles (
    user_id, tenant_id, branch_id, username, display_name, role,
    permissions, pin_hash, is_active, all_branches, must_change_password, is_pos_user)
  values (
    v_admin, v_tenant, v_branch, 'admin', 'Administrator', 'admin',
    array['*'],
    crypt(v_password, gen_salt('bf')),
    true, true, true, true);

  perform seed_default_account_categories(v_tenant);

  insert into pending_owners (email, tenant_id, branch_id, restaurant_name, created_by)
  values (lower(trim(p_email)), v_tenant, v_branch, p_name, auth.uid())
  on conflict (email) do update
    set tenant_id = excluded.tenant_id, branch_id = excluded.branch_id,
        restaurant_name = excluded.restaurant_name, claimed_at = null;

  v_linked := link_owner_if_account_exists(p_email, v_tenant, p_name);

  select workspace_code into v_code from tenants where id = v_tenant;

  return jsonb_build_object(
    'tenant_id', v_tenant, 'branch_id', v_branch, 'slug', v_slug,
    'email', lower(trim(p_email)), 'pos_username', 'admin',
    -- Shown once, to the super admin who just created the restaurant. It is
    -- not stored anywhere in readable form — only the bcrypt hash is kept.
    'pos_password', v_password,
    'pos_password_generated', v_generated,
    'must_change_password', true,
    'workspace_code', v_code,
    'owner_linked', v_linked);
end $function$;

-- ---------------------------------------------------------------------------
-- 2. Login learns that the password must change.
--    Body is otherwise exactly what was deployed.
-- ---------------------------------------------------------------------------
create or replace function public.verify_staff_pin(p_tenant uuid, p_username text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare p record;
begin
  -- NULL-safe on purpose. `p_tenant = auth_tenant_id()` yields NULL, not false,
  -- when the caller has no tenant, and `not NULL` is NULL — so the plain form
  -- of this guard silently let an unscoped caller straight through.
  if not (coalesce(p_tenant = auth_tenant_id(), false) or coalesce(is_super_admin(), false)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select user_id, display_name, role, branch_id, permissions, feature_permissions,
         must_change_password
    into p
  from user_profiles
  where tenant_id = p_tenant and username = p_username and is_active
    and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash);

  if not found then return jsonb_build_object('ok', false); end if;

  return jsonb_build_object(
    'ok', true, 'user_id', p.user_id, 'name', p.display_name,
    'role', p.role, 'branch_id', p.branch_id,
    'permissions', p.permissions, 'feature_permissions', p.feature_permissions,
    'must_change_password', coalesce(p.must_change_password, false));
end $function$;

-- ---------------------------------------------------------------------------
-- 3. Changing your own password, by proving you know the current one.
--
-- pos_set_user_pin requires owner/admin/manager. A cashier told to change
-- their password had no way to do it, which is how a forced change turns into
-- a support call and then into "just leave it as it is".
-- ---------------------------------------------------------------------------
create or replace function public.pos_change_own_password(
  p_tenant uuid, p_username text, p_current text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare v_uid uuid;
begin
  if not (coalesce(p_tenant = auth_tenant_id(), false) or coalesce(is_super_admin(), false)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if length(coalesce(p_new, '')) < 6 then
    return jsonb_build_object('ok', false, 'reason', 'too_short');
  end if;
  if p_new = p_current then
    return jsonb_build_object('ok', false, 'reason', 'same_password');
  end if;

  -- The current password is the authorisation. Without this check, anyone who
  -- could call the RPC could set anyone else's password.
  select user_id into v_uid
    from user_profiles
   where tenant_id = p_tenant
     and username  = lower(trim(p_username))
     and is_active
     and pin_hash is not null
     and pin_hash = extensions.crypt(coalesce(p_current, ''), pin_hash);

  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_current_password');
  end if;

  update user_profiles
     set pin_hash = extensions.crypt(p_new, extensions.gen_salt('bf')),
         must_change_password = false,
         updated_at = now()
   where user_id = v_uid and tenant_id = p_tenant;

  return jsonb_build_object('ok', true);
end $function$;

revoke all on function public.pos_change_own_password(uuid, text, text, text) from public;
grant execute on function public.pos_change_own_password(uuid, text, text, text)
  to authenticated, service_role;
