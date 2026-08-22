-- ============================================================================
-- v1.26.9 — four SECURITY DEFINER functions trusted a tenant id from the caller
--
-- Each of these takes p_tenant as an ARGUMENT and never checks it against the
-- caller's own tenant. All four were executable by `authenticated`, which is
-- any signed-in staff member of any restaurant on the platform. Changing one
-- uuid in a request body was enough to act on somebody else's restaurant:
--
--   link_owner_if_account_exists  make your own account the OWNER of any
--                                 tenant, and set tenants.owner_user_id
--   seed_default_pos_user         create/reset an 'admin' POS user with
--                                 permissions ['*'], all_branches, and a
--                                 password of your choosing, in any tenant
--   verify_staff_pin              a PIN oracle against any tenant's staff
--   next_order_number             advance another restaurant's bill numbering
--
-- The app never did any of this — it always passes the caller's own tenant.
-- That is exactly the problem: the boundary existed only in the application.
--
-- Two are provisioning helpers with no caller anywhere in the client code, so
-- they are taken away from the browser roles entirely. Two are called from the
-- browser on every shift, so they keep their grant and gain a guard instead.
-- Legitimate calls are unchanged; only a mismatched tenant is refused.
-- ============================================================================

-- ---- 1. Provisioning helpers: service_role only -----------------------------
revoke execute on function public.link_owner_if_account_exists(text, uuid, text)
  from anon, authenticated, public;
grant  execute on function public.link_owner_if_account_exists(text, uuid, text)
  to service_role;

revoke execute on function public.seed_default_pos_user(uuid, uuid, text)
  from anon, authenticated, public;
grant  execute on function public.seed_default_pos_user(uuid, uuid, text)
  to service_role;

-- ---- 2. verify_staff_pin: only for your own restaurant ----------------------
create or replace function public.verify_staff_pin(p_tenant uuid, p_username text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare p record;
begin
  -- The PIN may only be checked against the restaurant the caller belongs to.
  --
  -- NULL-safe on purpose. `p_tenant = auth_tenant_id()` yields NULL, not false,
  -- when the caller has no tenant, and `not NULL` is NULL — so the plain form
  -- of this guard silently lets an unscoped caller straight through. This is
  -- the same three-valued-logic trap as the can_access_branch(NULL) hole.
  if not (coalesce(p_tenant = auth_tenant_id(), false) or coalesce(is_super_admin(), false)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select user_id, display_name, role, branch_id, permissions, feature_permissions
    into p
  from user_profiles
  where tenant_id = p_tenant and username = p_username and is_active
    and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash);

  if not found then return jsonb_build_object('ok', false); end if;

  return jsonb_build_object(
    'ok', true, 'user_id', p.user_id, 'name', p.display_name,
    'role', p.role, 'branch_id', p.branch_id,
    'permissions', p.permissions, 'feature_permissions', p.feature_permissions);
end $function$;

-- ---- 3. next_order_number: only for your own restaurant and branch ----------
create or replace function public.next_order_number(p_tenant uuid, p_branch uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_next integer;
begin
  -- IS DISTINCT FROM is already null-safe: a caller with no tenant is refused.
  if p_tenant is distinct from auth_tenant_id() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  -- A single-branch restaurant legitimately passes null, so the branch is only
  -- checked when one was actually given.
  if p_branch is not null and not can_access_branch(p_branch) then
    raise exception 'branch not permitted' using errcode = '42501';
  end if;

  -- The counter alone is not trustworthy: orders can arrive from a till with
  -- numbers it minted while offline. Take the higher of the two sources.
  insert into order_counters (tenant_id, branch_id, current_value, reset_date)
  values (p_tenant, p_branch, 0, current_date)
  on conflict (tenant_id, branch_id) do nothing;

  update order_counters c
     set current_value = greatest(
           c.current_value,
           coalesce((select max(o.order_number) from orders o
                      where o.tenant_id = p_tenant
                        and o.branch_id is not distinct from p_branch), 0)
         ) + 1
   where c.tenant_id = p_tenant
     and c.branch_id is not distinct from p_branch
  returning c.current_value into v_next;

  return v_next;
end $function$;
