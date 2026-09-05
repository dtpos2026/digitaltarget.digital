-- ============================================================================
-- v1.49.0 — "Order Taker payment pe admin/manager password sahi daalo to bhi
--            'Not Valid' aata hai"
--
-- THE PASSWORD WAS ALWAYS CORRECT. THERE WAS NO WAY TO ASK.
--
-- The dialog calls verify_manager_password(p_tenant, p_password), which is:
--
--   * granted to `authenticated` and `service_role` — NOT to `anon`, and
--   * guarded by  `if p_tenant is distinct from auth_tenant_id() then
--                    raise exception ... errcode 42501`
--
-- The Order Taker holds an opaque portal token, not a Supabase session. It is
-- `anon`, and auth.uid() is null. So the call was refused before it ever
-- reached the password comparison, the client's catch turned that into
-- { ok: false }, and the manager standing at the till was told their own
-- password was wrong. Every time, on every Order Taker device.
--
-- This is the portal's own door, built like every other portal RPC: the tenant
-- comes from the TOKEN and is never accepted from the caller, so an Order Taker
-- at one restaurant cannot test passwords against another's managers.
--
-- WHY A LOCKOUT, AND WHY ON THE SESSION
--
-- This endpoint is reachable by anyone holding a staff token, so it must not
-- become a password oracle. The lockout is on the SESSION — the device doing
-- the guessing — and deliberately NOT on the manager's account: locking the
-- account would let any order taker lock their own manager out of the till at
-- will, which trades a small risk for a bigger one.
-- ============================================================================

alter table public.staff_portal_sessions
  add column if not exists manager_auth_attempts     int not null default 0,
  add column if not exists manager_auth_locked_until timestamptz;

create or replace function public.portal_verify_manager(
  p_token    text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  s public.staff_portal_sessions := portal_identity(p_token);
  r record;
  v_attempts int;
  c_max_attempts constant int      := 5;
  c_lockout      constant interval := interval '15 minutes';
begin
  if s.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  if s.manager_auth_locked_until is not null and s.manager_auth_locked_until > now() then
    return jsonb_build_object(
      'ok', false, 'reason', 'locked',
      'retryAfterSeconds', ceil(extract(epoch from (s.manager_auth_locked_until - now())))::int);
  end if;

  if coalesce(btrim(p_password), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  -- The tenant comes from the token. There is no tenant parameter, so one
  -- cannot be supplied.
  select display_name, username into r
    from public.user_profiles
   where tenant_id = s.tenant_id
     and is_active
     and role in ('owner', 'admin', 'manager')
     and pin_hash is not null
     and pin_hash = extensions.crypt(p_password, pin_hash)
   limit 1;

  if found then
    update public.staff_portal_sessions
       set manager_auth_attempts = 0, manager_auth_locked_until = null
     where token_hash = s.token_hash;
    return jsonb_build_object('ok', true, 'name', coalesce(r.display_name, r.username));
  end if;

  update public.staff_portal_sessions
     set manager_auth_attempts = manager_auth_attempts + 1
   where token_hash = s.token_hash
  returning manager_auth_attempts into v_attempts;

  if coalesce(v_attempts, 0) >= c_max_attempts then
    update public.staff_portal_sessions
       set manager_auth_locked_until = now() + c_lockout,
           manager_auth_attempts     = 0
     where token_hash = s.token_hash;
    return jsonb_build_object(
      'ok', false, 'reason', 'locked',
      'retryAfterSeconds', extract(epoch from c_lockout)::int);
  end if;

  return jsonb_build_object(
    'ok', false, 'reason', 'wrong',
    'attemptsLeft', greatest(0, c_max_attempts - coalesce(v_attempts, 0)));
end
$function$;

revoke all on function public.portal_verify_manager(text, text) from public;
grant execute on function public.portal_verify_manager(text, text) to anon, authenticated, service_role;
