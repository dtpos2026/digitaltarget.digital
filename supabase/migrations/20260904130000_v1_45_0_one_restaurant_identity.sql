-- ============================================================================
-- v1.45.0 — "her fountion ko pta ho mera resrurant ye ha"
--
-- portal_restaurant() answered from tenants.name. That column holds the name
-- the row was CREATED with; the name the owner actually works under is the one
-- they type into POS Settings, which lands in tenant_settings.settings->>'name'.
--
-- Proven on the live database before this migration:
--
--   tenants.name                     tenant_settings name
--   ---------------------------      ------------------------------
--   My Restaurant                    My Restaurant
--   Butt Grilled fish & Restaurant   Butt Grilled fish & Restaurant
--
-- They agree today, which is exactly why this is worth fixing NOW: the moment
-- an owner renames their restaurant in Settings, the POS header changes and
-- the rider's phone does not, and the two apps start disagreeing about which
-- restaurant the staff member is working for. The identity has to have one
-- source, and the owner's own setting is it.
--
-- Read-only change. Same guard (portal_identity(p_token)), same tenant scope,
-- no new grants, no data touched.
-- ============================================================================

create or replace function public.portal_restaurant(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  s public.staff_portal_sessions := portal_identity(p_token);
  t record;
  b record;
  v_name text;
  v_logo text;
begin
  if s.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  select id, name, slug, workspace_code into t
    from public.tenants where id = s.tenant_id;

  select name into b from public.branches where id = s.branch_id;

  -- The owner's own setting wins. Branch-level first (a branch may trade under
  -- its own name), then the tenant-wide row, then the name the tenant was
  -- created with — never blank, so the header cannot end up empty.
  select nullif(btrim(ts.settings->>'name'), '') into v_name
    from public.tenant_settings ts
   where ts.tenant_id = s.tenant_id
     and (ts.branch_id = s.branch_id
          or ts.branch_id = '00000000-0000-0000-0000-000000000000'::uuid)
   order by (ts.branch_id = s.branch_id) desc
   limit 1;

  select nullif(btrim(ts.settings->>'logo'), '') into v_logo
    from public.tenant_settings ts
   where ts.tenant_id = s.tenant_id
     and (ts.branch_id = s.branch_id
          or ts.branch_id = '00000000-0000-0000-0000-000000000000'::uuid)
   order by (ts.branch_id = s.branch_id) desc
   limit 1;

  return jsonb_build_object(
    'ok',            true,
    'tenantId',      t.id,
    'name',          coalesce(v_name, t.name),
    'slug',          t.slug,
    'workspaceCode', t.workspace_code,
    'branchName',    b.name,
    'logoUrl',       coalesce(
                       v_logo,
                       (select coalesce(nullif(ca.logo_url, ''), nullif(ca.icon_url, ''))
                          from public.customer_apps ca
                         where ca.tenant_id = t.id))
  );
end
$function$;

-- portal_bootstrap carries the same block, so it must not drift from the RPC
-- above. It calls it rather than repeating the query.
do $$
declare src text;
begin
  select prosrc into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_bootstrap';
  if src is null then
    raise notice 'portal_bootstrap absent — nothing to keep in step';
  elsif src not like '%portal_restaurant%' then
    raise warning 'portal_bootstrap builds its own restaurant block; it will not pick up the settings name';
  end if;
end $$;
