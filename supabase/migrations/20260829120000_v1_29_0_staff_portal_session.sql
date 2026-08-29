-- ============================================================================
-- v1.29.0 — the staff portals could see the menu and nothing else
--
-- REPORTED: signed into the Order Taker app with the workspace code, the menu
-- appeared, but there were no tables — and the restaurant has twelve. No riders
-- either. In the Rider app, no orders at all. All three apps then reported
-- "saved locally, cloud sync issue".
--
-- ONE CAUSE, AND RLS WAS RIGHT
--
-- portalSignIn() verifies the staff member through staff_login_global (service
-- role, SECURITY DEFINER) and then binds the device to the resolved tenant. It
-- creates no Supabase session, because POS staff are user_profiles rows and
-- have no auth.users account to sign into. So every read afterwards is made as
-- `anon`, and the policies answer exactly as written:
--
--     menu_items      menu_public_read      anon may read active rows   -> menu appeared
--     categories      categories_public_read                            -> categories appeared
--     dining_tables   authenticated only                                -> NO TABLES
--     user_profiles   authenticated only                                -> NO RIDERS
--     orders          anon may INSERT, not read                         -> NO ORDERS
--
-- Nothing leaked and nothing was broken in the data. The portals were simply
-- asking as a stranger.
--
-- THE SHAPE OF THE FIX
--
-- The same one the customer app already uses and this codebase already trusts:
-- a login mints an opaque token, the token is stored hashed, and anon-callable
-- SECURITY DEFINER functions resolve it to an identity and return only that
-- identity's rows. See public_customer_login / customer_from_token.
--
-- Deliberately NOT a Supabase session: minting one would mean creating an
-- auth.users row for every rider and order taker, which changes who the staff
-- roster IS, and it would hand a browser a token that RLS honours everywhere
-- rather than only where a portal should reach.
--
-- Nothing existing is modified. The POS, the owner login, the customer app and
-- every policy above are untouched; this only adds a path the portals can use.
-- ============================================================================

-- ---------------------------------------------------------------- the session
create table if not exists public.staff_portal_sessions (
  token_hash    text primary key,
  user_id       uuid not null,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid,
  role          text not null,
  all_branches  boolean not null default false,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '30 days'
);

comment on table public.staff_portal_sessions is
  'Opaque session tokens for the Rider and Order Taker apps. The token itself is '
  'never stored — only its sha256 — so a database copy cannot be replayed as a login.';

create index if not exists staff_portal_sessions_tenant_idx
  on public.staff_portal_sessions (tenant_id, expires_at);

-- RLS on, with no policy at all: every access goes through the SECURITY DEFINER
-- functions below. anon and authenticated can never read this table directly,
-- which is what keeps one restaurant's tokens invisible to another's.
alter table public.staff_portal_sessions enable row level security;
revoke all on public.staff_portal_sessions from anon, authenticated;

-- ------------------------------------------------------------ token -> identity
create or replace function public.portal_identity(p_token text)
returns public.staff_portal_sessions
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $$
  select s.* from public.staff_portal_sessions s
   where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and s.expires_at > now()
$$;

revoke all on function public.portal_identity(text) from public, anon, authenticated;

-- ------------------------------------------------------------------- mint one
create or replace function public.portal_session_create(
  p_user_id uuid, p_tenant_id uuid, p_branch_id uuid, p_role text, p_all_branches boolean)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare v_token text;
begin
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  -- One live session per staff member per device is not something the server
  -- can tell apart, so old ones are simply left to expire. Housekeeping instead
  -- removes what is already dead, which keeps the table from growing forever
  -- without ever invalidating a till that is mid-shift.
  delete from public.staff_portal_sessions where expires_at < now();

  insert into public.staff_portal_sessions
    (token_hash, user_id, tenant_id, branch_id, role, all_branches)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'),
          p_user_id, p_tenant_id, p_branch_id, p_role, coalesce(p_all_branches, false));

  return v_token;
end $$;

revoke all on function public.portal_session_create(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.portal_session_create(uuid, uuid, uuid, text, boolean) to service_role;

-- ------------------------------------------------------------------ who am I
create or replace function public.portal_me(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  s public.staff_portal_sessions := portal_identity(p_token);
  p public.user_profiles;
  t public.tenants;
begin
  if s.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  update public.staff_portal_sessions
     set last_seen_at = now()
   where token_hash = s.token_hash;

  select * into p from public.user_profiles where user_id = s.user_id and tenant_id = s.tenant_id;
  if p.user_id is null or not p.is_active then
    -- Deactivating a staff member has to end their app session too, or the
    -- roster stops meaning anything.
    delete from public.staff_portal_sessions where token_hash = s.token_hash;
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;

  select * into t from public.tenants where id = s.tenant_id;

  return jsonb_build_object(
    'ok', true,
    'userId', s.user_id,
    'tenantId', s.tenant_id,
    'tenantName', t.name,
    'workspaceCode', t.workspace_code,
    'branchId', s.branch_id,
    'allBranches', s.all_branches,
    'role', s.role,
    'name', p.display_name,
    'username', p.username,
    'permissions', coalesce(p.permissions, array[]::text[])
  );
end $$;

grant execute on function public.portal_me(text) to anon, authenticated, service_role;

-- ------------------------------------------------------------------- log out
create or replace function public.portal_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
begin
  delete from public.staff_portal_sessions
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.portal_logout(text) to anon, authenticated, service_role;
