-- ============================================================================
-- v1.36.0 — a restaurant can brand its own customer app
--
-- customer_apps had two policies: super admin does everything, tenant may READ.
-- So every colour, name and logo change had to go through Digital Target, and a
-- restaurant could look at its own branding but not touch it.
--
-- The columns are not equal, and a blanket write policy would hand a restaurant
-- control of things that are not branding at all:
--     enabled                 whether the module is sold to them
--     app_version / min_supported_version / update_url / update_required
--                             the release train — a restaurant that could set
--                             min_supported_version could lock every one of its
--                             own customers out of the app
--     require_claim_otp       a security control
--
-- Postgres has no column-level WITH CHECK, so the split is enforced by a
-- trigger, and refused LOUDLY rather than silently ignored — a UI that tries is
-- corrected instead of left believing it worked.
--
-- VERIFIED LIVE as a signed-in owner (rolled back):
--   edits its own branding ............ ALLOWED, app_name became "My New Brand"
--   switches the module off ........... REFUSED
--   sets min_supported_version ........ REFUSED
--   edits restaurant B's branding ..... no rows affected
-- ============================================================================

create or replace function public.guard_customer_app_columns()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if is_super_admin() then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'a restaurant cannot move its app to another restaurant' using errcode='42501';
  end if;
  if new.enabled is distinct from old.enabled then
    raise exception 'the customer app module can only be switched by Digital Target' using errcode='42501';
  end if;
  if new.app_version is distinct from old.app_version
     or new.min_supported_version is distinct from old.min_supported_version
     or new.update_url is distinct from old.update_url
     or new.update_required is distinct from old.update_required then
    raise exception 'app release settings can only be changed by Digital Target' using errcode='42501';
  end if;
  if new.require_claim_otp is distinct from old.require_claim_otp then
    raise exception 'the account-claim check can only be changed by Digital Target' using errcode='42501';
  end if;

  return new;
end $function$;

drop trigger if exists trg_guard_customer_app_columns on public.customer_apps;
create trigger trg_guard_customer_app_columns
  before update on public.customer_apps
  for each row execute function public.guard_customer_app_columns();

drop policy if exists customer_apps_tenant_brand on public.customer_apps;
create policy customer_apps_tenant_brand on public.customer_apps
  for update to authenticated
  using      (tenant_id = auth_tenant_id() and auth_role() in ('owner','admin','manager'))
  with check (tenant_id = auth_tenant_id());
