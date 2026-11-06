-- v1.108.0 — the Custom Website card without a web server, and the Super Admin overview.
-- Adds five functions; no table, column, policy or existing function is touched.
-- Rollback: docs/rollback/2026-11-05-v1_107_0-rollback.sql (section 3c lists the drops).
--
-- v1.107.0 ran the card's reads and writes as server functions, which the packaged Windows app does not serve, so the
-- card there said "needs the online server". These functions do the same work inside the database for the signed-in
-- owner or admin, so the card works wherever the software runs. The table that holds the key stays closed to the API:
-- the secret is returned once, by custom_site_rotate_key, and only its last four characters afterwards.

create or replace function public.custom_site_status()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := auth_tenant_id();
  r record;
  v_orders int := 0; v_unmatched int := 0; v_recent jsonb := '[]'::jsonb;
begin
  if v_tenant is null then raise exception 'not signed in to a restaurant' using errcode = '42501'; end if;
  if auth_role() not in ('owner', 'admin') then raise exception 'only the owner or an admin can use this' using errcode = '42501'; end if;

  select * into r from custom_site_intake where tenant_id = v_tenant;

  select count(*), count(*) filter (where jsonb_array_length(unmatched) > 0)
    into v_orders, v_unmatched
    from custom_site_orders where tenant_id = v_tenant and created_at > now() - interval '7 days';

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_recent from (
    select jsonb_build_object('orderNumber', o.order_number, 'name', u->>'name',
                              'quantity', coalesce((u->>'quantity')::numeric, 1),
                              'price', coalesce((u->>'price')::numeric, 0), 'at', o.created_at) as x
      from custom_site_orders o, jsonb_array_elements(o.unmatched) u
     where o.tenant_id = v_tenant and o.created_at > now() - interval '7 days'
     order by o.created_at desc limit 10) s;

  return jsonb_build_object(
    'mode', coalesce(r.mode, 'builtin'),
    'siteUrl', r.site_url, 'adminUrl', r.admin_url,
    'hasKey', r.secret_hint is not null, 'keyHint', r.secret_hint, 'keyCreatedAt', r.key_created_at,
    'lastOrderAt', r.last_order_at, 'lastError', r.last_error, 'lastErrorAt', r.last_error_at,
    'orders7d', v_orders, 'unmatched7d', v_unmatched, 'recentUnmatched', v_recent);
end $function$;

create or replace function public.custom_site_save(p_mode text, p_site_url text, p_admin_url text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := auth_tenant_id();
  v_site text; v_admin text;
  c_pattern constant text := '^https://[^/@\s?#]+\.[^/@\s?#]+(/[^\s?#]*)?(\?[^\s#]*)?$';
begin
  if v_tenant is null then raise exception 'not signed in to a restaurant' using errcode = '42501'; end if;
  if auth_role() not in ('owner', 'admin') then raise exception 'only the owner or an admin can use this' using errcode = '42501'; end if;
  if p_mode is null or p_mode not in ('builtin', 'own', 'both') then
    return jsonb_build_object('ok', false, 'reason', 'bad_mode');
  end if;

  -- An address: https only, no credentials, a real host, at most 300 characters; a scheme-less address gets https://.
  v_site  := nullif(btrim(coalesce(p_site_url, '')), '');
  v_admin := nullif(btrim(coalesce(p_admin_url, '')), '');
  if v_site  is not null and v_site  !~* '^https?://' then v_site  := 'https://' || v_site;  end if;
  if v_admin is not null and v_admin !~* '^https?://' then v_admin := 'https://' || v_admin; end if;
  if v_site  is not null and (length(v_site)  > 300 or v_site  !~* c_pattern) then
    return jsonb_build_object('ok', false, 'reason', 'bad_site_url');
  end if;
  if v_admin is not null and (length(v_admin) > 300 or v_admin !~* c_pattern) then
    return jsonb_build_object('ok', false, 'reason', 'bad_admin_url');
  end if;
  v_site  := regexp_replace(v_site,  '^(https://[^/?]+)/$', '\1');
  v_admin := regexp_replace(v_admin, '^(https://[^/?]+)/$', '\1');

  insert into custom_site_intake (tenant_id, mode, site_url, admin_url, updated_at)
  values (v_tenant, p_mode, v_site, v_admin, now())
  on conflict (tenant_id) do update
     set mode = excluded.mode, site_url = excluded.site_url, admin_url = excluded.admin_url, updated_at = now();

  return jsonb_build_object('ok', true, 'siteUrl', v_site, 'adminUrl', v_admin);
end $function$;

create or replace function public.custom_site_rotate_key()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant uuid := auth_tenant_id();
  v_secret text;
begin
  if v_tenant is null then raise exception 'not signed in to a restaurant' using errcode = '42501'; end if;
  if auth_role() not in ('owner', 'admin') then raise exception 'only the owner or an admin can use this' using errcode = '42501'; end if;

  v_secret := 'dtcs_' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  insert into custom_site_intake (tenant_id, secret, secret_hint, key_created_at, updated_at)
  values (v_tenant, v_secret, '…' || right(v_secret, 4), now(), now())
  on conflict (tenant_id) do update
     set secret = excluded.secret, secret_hint = excluded.secret_hint, key_created_at = now(),
         last_error = null, last_error_at = null, updated_at = now();

  return jsonb_build_object('secret', v_secret, 'hint', '…' || right(v_secret, 4));
end $function$;

create or replace function public.custom_site_revoke_key()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tenant uuid := auth_tenant_id();
begin
  if v_tenant is null then raise exception 'not signed in to a restaurant' using errcode = '42501'; end if;
  if auth_role() not in ('owner', 'admin') then raise exception 'only the owner or an admin can use this' using errcode = '42501'; end if;
  update custom_site_intake
     set secret = null, secret_hint = null, key_created_at = null, updated_at = now()
   where tenant_id = v_tenant;
  return jsonb_build_object('ok', true);
end $function$;

-- Super Admin: which restaurants connect their own website, and how healthy it is. No secret, no hint.
create or replace function public.sa_custom_site_overview()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not coalesce(is_super_admin(), false) then raise exception 'Super Admin only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'tenantId', i.tenant_id, 'name', t.name, 'mode', i.mode,
             'siteUrl', i.site_url, 'adminUrl', i.admin_url, 'hasKey', i.secret_hint is not null,
             'lastOrderAt', i.last_order_at, 'lastError', i.last_error, 'lastErrorAt', i.last_error_at,
             'orders7d', (select count(*) from custom_site_orders o
                           where o.tenant_id = i.tenant_id and o.created_at > now() - interval '7 days'))
           order by t.name)
      from custom_site_intake i join tenants t on t.id = i.tenant_id
     where i.mode <> 'builtin' or i.secret_hint is not null), '[]'::jsonb);
end $function$;

revoke all on function public.custom_site_status() from public, anon;
revoke all on function public.custom_site_save(text, text, text) from public, anon;
revoke all on function public.custom_site_rotate_key() from public, anon;
revoke all on function public.custom_site_revoke_key() from public, anon;
revoke all on function public.sa_custom_site_overview() from public, anon;
grant execute on function public.custom_site_status() to authenticated, service_role;
grant execute on function public.custom_site_save(text, text, text) to authenticated, service_role;
grant execute on function public.custom_site_rotate_key() to authenticated, service_role;
grant execute on function public.custom_site_revoke_key() to authenticated, service_role;
grant execute on function public.sa_custom_site_overview() to authenticated, service_role;
