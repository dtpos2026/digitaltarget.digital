-- v1.109.0 — "Check connection" on the Custom Website card, as a database function.
-- One new function; nothing else is touched. Rollback: drop function if exists public.custom_site_check();
--
-- It was a server function in v1.107.0 (customSite.functions.ts), and that one file made the production worker fail to
-- start (two bundle chunks imported each other and the SSR entry died on "__exportAll2 is not a function"), so the site
-- answered "This page didn't load". The check now reads the same facts inside the database for the signed-in owner or admin:
-- is the own site switched on, is there a key, would the owner's own switches refuse orders, and what happened last.
-- Signing a real request is done from the website itself with the header x-dt-dry-run: 1 (nothing is placed).

create or replace function public.custom_site_check()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := auth_tenant_id();
  r record;
  s jsonb;
  v_note text := '';
begin
  if v_tenant is null then raise exception 'not signed in to a restaurant' using errcode = '42501'; end if;
  if auth_role() not in ('owner', 'admin') then raise exception 'only the owner or an admin can use this' using errcode = '42501'; end if;

  select * into r from custom_site_intake where tenant_id = v_tenant;
  if r.tenant_id is null or r.mode = 'builtin' then
    return jsonb_build_object('ok', false, 'message', 'Own-website orders are switched off. Choose "My own website" or "Both" and press Save.');
  end if;
  if r.secret_hint is null then
    return jsonb_build_object('ok', false, 'message', 'Create a key first.');
  end if;

  select ts.settings into s from tenant_settings ts
   where ts.tenant_id = v_tenant and ts.branch_id = '00000000-0000-0000-0000-000000000000';
  s := coalesce(s, '{}'::jsonb);

  if s->>'onlineOrderEnabled' = 'false' then
    return jsonb_build_object('ok', false, 'message', 'Online ordering is switched off in Settings, so every order from your website would be refused.');
  end if;
  if s->>'onlineDeliveryEnabled' = 'false' and s->>'onlinePickupEnabled' = 'false' then
    return jsonb_build_object('ok', false, 'message', 'Delivery and Pickup are both switched off in Settings, so every order from your website would be refused.');
  end if;
  if s->>'onlineDeliveryEnabled' = 'false' then v_note := ' Delivery is off, so delivery orders will be refused.'; end if;
  if s->>'onlinePickupEnabled' = 'false' then v_note := ' Pickup is off, so pickup orders will be refused.'; end if;
  if r.last_error is not null and (r.last_order_at is null or r.last_error_at > r.last_order_at) then
    v_note := v_note || ' The last problem was: ' || r.last_error;
  end if;

  return jsonb_build_object('ok', true, 'message',
    'Ready: the address accepts signed orders.' || v_note ||
    ' To test the whole path from your website, send an order with the header x-dt-dry-run: 1 — nothing is placed.');
end $function$;

revoke all on function public.custom_site_check() from public, anon;
grant execute on function public.custom_site_check() to authenticated, service_role;
