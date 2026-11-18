-- v1.125.1 — the Users screen could not see a person's action rights, phone or "all branches".
--
-- pos_list_users() returns only 7 columns (no feature_permissions, phone, all_branches). The Users screen therefore showed the ROLE DEFAULTS
-- for the actions a person may do, and saving a person wrote those defaults (and an empty phone, and all_branches = false) back over what was
-- stored (pos_set_staff_profile overwrites all three on conflict). This adds a read-only sibling that returns the stored values.
-- Same rule as pos_list_users: only a signed-in member of a restaurant, only that restaurant's people; the password hash is never returned.
-- Additive: pos_list_users is left exactly as it is (older apps keep using it). Rollback: docs/rollback/2026-11-18-v1_125_1-pos-list-staff-before.sql
create or replace function public.pos_list_staff()
 returns table(user_id uuid, username text, display_name text, role text, branch_id uuid, is_active boolean,
               permissions text[], feature_permissions text[], phone text, all_branches boolean)
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
begin
  if auth_tenant_id() is null then
    raise exception 'not signed in to a restaurant' using errcode = '42501';
  end if;
  return query
    select p.user_id, p.username, p.display_name, p.role, p.branch_id, p.is_active,
           p.permissions, p.feature_permissions, p.phone, p.all_branches
    from user_profiles p
    where p.tenant_id = auth_tenant_id()
    order by p.role, p.username;
end $function$;

revoke all on function public.pos_list_staff() from public, anon;
grant execute on function public.pos_list_staff() to authenticated, service_role;
