-- ============================================================================
-- v1.39.0 — a staff login can read its own restaurant's Workspace Code
--
-- REPORTED: "Workspace Code dashboard me bhi nazar aaye us restaurant ka,
-- POS me bhi."
--
-- WorkspaceCodeCard reads tenants.workspace_code directly, and falls back to
-- get_workspace_code(). Both are gated on auth_tenant_id(), which resolves
-- through auth.uid(). A POS staff member signs in with a username and a PIN
-- and has NO Supabase auth session at all — user_profiles rows are not
-- auth.users accounts — so auth.uid() is null, both reads return nothing, and
-- the card says "Sign in with the owner email to read it (a staff PIN login
-- cannot)". Which was true, and useless: the code is what a rider or an order
-- taker needs to sign in, and the person at the till is the one being asked
-- for it.
--
-- NOT loosened. get_workspace_code stays exactly as it is, and nothing new is
-- readable by knowing a tenant id — that is precisely the "change the
-- Workspace Code on the client" attack, and it stays closed.
--
-- Instead the code rides back on the login that already proved who the caller
-- is. staff_login_global ALREADY returns workspace_code on success, to the
-- same username+password proof; staff_login_check, which the POS screen uses,
-- verified the identical credential against the identical bcrypt hash and then
-- withheld it. This makes the two agree.
--
-- It is returned ONLY inside the ok:true branch, after the password check —
-- never alongside a failure reason, so it cannot be used to probe.
-- ============================================================================
create or replace function public.staff_login_check(p_tenant uuid, p_username text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare p record;
begin
  select u.user_id, u.display_name, u.role, u.branch_id, u.permissions,
         u.feature_permissions, u.pin_hash, u.is_active,
         t.is_active as tenant_active, t.workspace_code
    into p
  from user_profiles u
  join tenants t on t.id = u.tenant_id
  where u.tenant_id = p_tenant and lower(u.username) = lower(btrim(p_username));

  if not found                     then return jsonb_build_object('ok', false, 'reason', 'no_user'); end if;
  if not p.is_active               then return jsonb_build_object('ok', false, 'reason', 'inactive'); end if;
  if not p.tenant_active           then return jsonb_build_object('ok', false, 'reason', 'tenant_inactive'); end if;
  if p.pin_hash is null            then return jsonb_build_object('ok', false, 'reason', 'no_password'); end if;
  if p.pin_hash <> crypt(p_pin, p.pin_hash)
                                   then return jsonb_build_object('ok', false, 'reason', 'bad_password'); end if;

  return jsonb_build_object(
    'ok', true, 'user_id', p.user_id, 'name', p.display_name, 'role', p.role,
    'branch_id', p.branch_id, 'permissions', p.permissions,
    'workspace_code', p.workspace_code);
end $function$;
