-- ===========================================================================
-- v1.25.17 / v1.25.18 — two RPC signature breaks
--
-- BUG 1: staff users could not be created.
--   "Could not find the function public.pos_set_staff_profile(...)"
--   The code sends TWELVE arguments; the function declared eleven — it had no
--   p_is_active. PostgREST matches by argument NAME, so one unknown name means
--   NO candidate matches, and the error lists all twelve, making it look as
--   though the whole function is missing when only one parameter was.
--
-- BUG 1b (hidden behind it): the old body hardcoded is_active = true on both
--   insert and update. Even once the call worked, DEACTIVATING A STAFF MEMBER
--   WOULD NOT HAVE — a dismissed employee's login would be silently
--   reactivated by the next edit of their profile. An access-control problem,
--   invisible while the signature error masked it.
--
-- BUG 2: resetting the order-number counter could never work.
--   The function took (p_tenant, p_branch); the code calls it with
--   { p_branch, p_start } — no p_tenant, plus a p_start it had never heard of.
--   The tenant now comes from auth_tenant_id() instead of being named by the
--   client, and p_start sets the next number to issue (current_value holds the
--   LAST issued number, so it is set to p_start - 1) instead of hardcoding 0.
--
-- HOW THESE WERE FOUND: by extracting every .rpc() call out of the source and
-- diffing the whole set against pg_proc. The earlier audit compared argument
-- lists transcribed BY HAND, and pos_set_staff_profile's were not among them.
-- That gap is what let this reach a live restaurant.
--
-- NOTE: CREATE OR REPLACE cannot change a signature — it adds a SECOND
-- overload and PostgREST then refuses to choose. Old versions are dropped
-- explicitly below.
-- ===========================================================================

drop function if exists public.pos_set_staff_profile(
  uuid, uuid, text, text, text, text, uuid, text[], text[], text, boolean);

create or replace function public.pos_set_staff_profile(
  p_user_id uuid, p_tenant uuid, p_username text, p_password text,
  p_display_name text, p_role text, p_branch_id uuid, p_permissions text[],
  p_feature_permissions text[], p_phone text,
  p_all_branches boolean default false, p_is_active boolean default true
) returns void language plpgsql security definer
set search_path to 'public', 'extensions' as $function$
begin
  if exists (select 1 from user_profiles
              where tenant_id = p_tenant
                and lower(username) = lower(btrim(p_username))
                and user_id <> p_user_id) then
    raise exception 'username already in use in this restaurant' using errcode = '23505';
  end if;

  insert into user_profiles (
    user_id, tenant_id, branch_id, username, display_name, role,
    permissions, feature_permissions, phone, pin_hash, all_branches,
    is_active, is_pos_user)
  values (
    p_user_id, p_tenant, p_branch_id, btrim(p_username), p_display_name, p_role,
    coalesce(p_permissions, '{}'), coalesce(p_feature_permissions, '{}'),
    p_phone, crypt(p_password, gen_salt('bf')), coalesce(p_all_branches, false),
    coalesce(p_is_active, true), true)
  on conflict (user_id) do update set
    tenant_id           = excluded.tenant_id,
    branch_id           = excluded.branch_id,
    username            = excluded.username,
    display_name        = excluded.display_name,
    role                = excluded.role,
    permissions         = excluded.permissions,
    feature_permissions = excluded.feature_permissions,
    phone               = excluded.phone,
    all_branches        = excluded.all_branches,
    -- An empty password means "leave it alone", so editing a cashier's name
    -- does not silently wipe the PIN they log in with.
    pin_hash            = case when coalesce(p_password, '') = ''
                               then user_profiles.pin_hash
                               else excluded.pin_hash end,
    -- Honour the caller instead of forcing true.
    is_active           = excluded.is_active,
    updated_at          = now();
end $function$;

drop function if exists public.reset_order_counter(uuid, uuid);

create or replace function public.reset_order_counter(
  p_branch uuid, p_start integer default 0
) returns void language plpgsql security definer
set search_path to 'public' as $function$
declare v_tenant uuid := auth_tenant_id();
begin
  if v_tenant is null then
    raise exception 'no tenant for caller' using errcode = '42501';
  end if;
  if auth_role() not in ('owner','admin','manager') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not can_access_branch(p_branch) then
    raise exception 'branch not permitted' using errcode = '42501';
  end if;

  update order_counters
     set current_value = greatest(coalesce(p_start, 0) - 1, 0),
         reset_date    = current_date
   where tenant_id = v_tenant and branch_id is not distinct from p_branch;

  if not found then
    insert into order_counters (tenant_id, branch_id, current_value, reset_date)
    values (v_tenant, p_branch, greatest(coalesce(p_start, 0) - 1, 0), current_date)
    on conflict do nothing;
  end if;
end $function$;
