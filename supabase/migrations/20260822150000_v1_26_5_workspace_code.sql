-- ============================================================================
-- v1.26.5 — the Workspace Code system was never actually switched on
--
-- WHAT WAS THERE
-- tenants.workspace_code exists and is uniquely indexed. WorkspaceCodeCard
-- reads it (falling back to get_workspace_code()), RiderAppPage and
-- OrderTakerPortalPage collect it at sign-in, and staff_login_global() uses it
-- to disambiguate a username that exists at more than one restaurant. The
-- design is complete and I have not replaced any of it.
--
-- WHAT WAS ACTUALLY LIVE
-- Nothing that fills the column. Migration 20260821013459 defines
-- gen_workspace_code() and the tenants_workspace_code trigger — and neither
-- exists in this database. Only the unique index made it across. So:
--
--   * every tenant has workspace_code = NULL (verified: 0 of 2)
--   * the Admin Panel card has nothing to show
--   * staff_login_global compares upper(p_code) = upper(t.workspace_code),
--     which against NULL yields NULL, so ANY sign-in that supplies a workspace
--     code matches zero rows and fails
--
-- That last one is a deadlock for the rider and order-taker portals: a
-- username used at two restaurants is reported ambiguous, the UI asks for the
-- Workspace Code, and supplying it then guarantees failure.
--
-- This is the same migration-drift documented in migrations/README.md —
-- supabase/config.toml named a project that does not exist, so `db push` never
-- reached this database. Fixed in v1.26.0; this brings the workspace code
-- across.
--
-- SECOND DEFECT: THE REASON CODES DID NOT MATCH
-- staff_login_global returns 'ambiguous' and 'no_password'. The client
-- (staffAuth.functions.ts) only has messages for no_user,
-- no_user_in_workspace, need_workspace_code, inactive and bad_password, and
-- staffPortalAuth.ts shows the Workspace Code field only when the reason is
-- exactly 'need_workspace_code'. So the one situation the field exists for
-- rendered a generic "Invalid username or password" and never revealed it.
-- The client's vocabulary is the published contract and its wording is
-- better, so the function is brought into line with it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The generator (as designed in 20260821013459).
-- ---------------------------------------------------------------------------
create or replace function public.gen_workspace_code()
returns text language plpgsql set search_path = public as $$
declare v_code text; v_try int := 0;
begin
  loop
    v_try := v_try + 1;
    -- md5 hex is 0-9A-F: no O/I/L, so it cannot be misread over a phone.
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    if length(v_code) = 6
       and not exists (select 1 from public.tenants t where t.workspace_code = v_code) then
      return v_code;
    end if;
    if v_try > 50 then return upper(substr(md5(gen_random_uuid()::text), 1, 6)); end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Every restaurant gets one, now and in future.
-- ---------------------------------------------------------------------------
create or replace function public.tenants_set_workspace_code()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.workspace_code is null or btrim(new.workspace_code) = '' then
    new.workspace_code := public.gen_workspace_code();
  else
    new.workspace_code := upper(btrim(new.workspace_code));
  end if;
  return new;
end $$;

drop trigger if exists tenants_workspace_code on public.tenants;
create trigger tenants_workspace_code
  before insert or update of workspace_code on public.tenants
  for each row execute function public.tenants_set_workspace_code();

-- Backfill. Row by row, because gen_workspace_code() checks uniqueness against
-- rows already committed and a set-based update would not see its own output.
do $$
declare r record;
begin
  for r in select id from public.tenants where workspace_code is null or btrim(workspace_code) = '' loop
    update public.tenants set workspace_code = public.gen_workspace_code() where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Reason codes the client already understands.
-- ---------------------------------------------------------------------------
create or replace function public.staff_login_global(
  p_username text, p_pin text, p_workspace_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  p        record;
  v_code   text := nullif(upper(btrim(coalesce(p_workspace_code, ''))), '');
  v_total  int;
  v_scoped int;
begin
  -- How many restaurants know this username at all.
  select count(*) into v_total
  from user_profiles u join tenants t on t.id = u.tenant_id
  where lower(u.username) = lower(btrim(p_username))
    and u.is_active and t.is_active;

  if v_total = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_user');
  end if;

  if v_code is not null then
    select count(*) into v_scoped
    from user_profiles u join tenants t on t.id = u.tenant_id
    where lower(u.username) = lower(btrim(p_username))
      and u.is_active and t.is_active
      and upper(t.workspace_code) = v_code;
    -- The username exists, but not at the restaurant this code names.
    if v_scoped = 0 then
      return jsonb_build_object('ok', false, 'reason', 'no_user_in_workspace');
    end if;
  elsif v_total > 1 then
    -- This is the reason the Workspace Code field exists. It must be spelled
    -- the way the client tests for it, or the field is never shown.
    return jsonb_build_object('ok', false, 'reason', 'need_workspace_code');
  end if;

  select u.user_id, u.display_name, u.role, u.branch_id, u.all_branches,
         u.permissions, u.feature_permissions, u.pin_hash,
         t.id as tenant_id, t.name as tenant_name, t.workspace_code
    into p
  from user_profiles u join tenants t on t.id = u.tenant_id
  where lower(u.username) = lower(btrim(p_username))
    and u.is_active and t.is_active
    and (v_code is null or upper(t.workspace_code) = v_code)
  limit 1;

  -- An account with no password set is reported as a wrong password, not as a
  -- distinct state: telling a stranger which usernames have no password is an
  -- invitation.
  if p.pin_hash is null or p.pin_hash <> crypt(p_pin, p.pin_hash) then
    return jsonb_build_object('ok', false, 'reason', 'bad_password');
  end if;

  return jsonb_build_object(
    'ok', true, 'user_id', p.user_id, 'name', p.display_name, 'role', p.role,
    'tenant_id', p.tenant_id, 'tenant_name', p.tenant_name,
    'workspace_code', p.workspace_code, 'branch_id', p.branch_id,
    'all_branches', p.all_branches, 'permissions', p.permissions,
    'feature_permissions', p.feature_permissions);
end
$function$;
