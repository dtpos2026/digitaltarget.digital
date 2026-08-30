-- ============================================================================
-- v1.29.9 — a rider's and an order taker's phone can be reached
--
-- ASKED FOR: "rider aur order taker ko notification aani chahiye" — "haan,
-- chahiye" when the question was put directly.
--
-- The customer app has had push since v1.27.x: customers.push_token, filled by
-- public_customer_push_token, read by the dispatch function. Staff had nothing
-- — no column, no RPC, nowhere for a token to go. So the rider's phone could
-- not be addressed at all, whatever was sent.
--
-- WHERE THE TOKEN BELONGS
-- On the SESSION, not on the user. staff_portal_sessions is already how a
-- rider and an order taker authenticate (v1.29.x, opaque token stored as a
-- sha256 hash), and it is per device and it expires. Hanging the push token
-- there means:
--
--   * a rider who signs out stops being paged — the row goes, the token goes;
--   * a rider with two phones is reachable on both, because each has a
--     session, which a single column on user_profiles could not express;
--   * an expired session cannot page a phone that left the company in March.
--
-- A token on the user row would have had to be cleaned up by hand at every one
-- of those points, and would not have been.
--
-- WHAT THIS DOES NOT DO
-- It does not SEND anything. Sending needs FCM credentials
-- (google-services.json in the APKs, FCM_SERVICE_ACCOUNT for the dispatch
-- function) which are not in the project yet. This is the half that can be
-- built and verified without them: somewhere for the token to live, a way for
-- the phone to file it, and a service_role-only way to read it back.
-- ============================================================================

alter table public.staff_portal_sessions
  add column if not exists push_token text;

-- Only rows that can actually be paged are worth scanning.
create index if not exists staff_portal_sessions_push_idx
  on public.staff_portal_sessions (tenant_id, role)
  where push_token is not null;

-- ---------------------------------------------------------------------------
-- The phone files its own token, against its own session, and nothing else.
-- p_token is the session token the rider already holds; there is no way to
-- write a push token onto somebody else's session.
-- ---------------------------------------------------------------------------
create or replace function public.portal_push_token(p_token text, p_push text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  s public.staff_portal_sessions := portal_identity(p_token);
  v_push text := nullif(btrim(coalesce(p_push, '')), '');
begin
  if s.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  -- An FCM registration token is long and opaque. Refuse anything that is
  -- obviously not one rather than storing junk that will fail at send time
  -- with no way to trace where it came from.
  if v_push is not null and length(v_push) > 4096 then
    return jsonb_build_object('ok', false, 'reason', 'bad_token');
  end if;

  update public.staff_portal_sessions
     set push_token = v_push, last_seen_at = now()
   where token_hash = s.token_hash;

  return jsonb_build_object('ok', true, 'cleared', v_push is null);
end $function$;

revoke all on function public.portal_push_token(text, text) from public;
grant execute on function public.portal_push_token(text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reading the tokens back. SERVICE ROLE ONLY.
--
-- This is the one direction that must never be reachable from a browser: a
-- list of every on-duty rider's push token is exactly what a compromised page
-- would want. The dispatch function runs with the service key; nothing else
-- may call this.
-- ---------------------------------------------------------------------------
create or replace function public.staff_push_targets(p_tenant uuid, p_role text default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId',   s.user_id,
           'role',     s.role,
           'branchId', s.branch_id,
           'token',    s.push_token)), '[]'::jsonb)
    from public.staff_portal_sessions s
    join public.user_profiles p
      on p.user_id = s.user_id and p.tenant_id = s.tenant_id and p.is_active
   where s.tenant_id = p_tenant
     and s.push_token is not null
     and s.expires_at > now()
     and (p_role is null or s.role = p_role);
$function$;

revoke all on function public.staff_push_targets(uuid, text) from public, anon, authenticated;
grant execute on function public.staff_push_targets(uuid, text) to service_role;
