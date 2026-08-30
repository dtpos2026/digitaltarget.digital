-- ============================================================================
-- v1.29.8 — switching the customer app OFF actually switches it off
--
-- REPORTED: "agar app module off kar dein to app chalni nahi chahiye."
--
-- customer_apps.enabled has existed since v1.27.0 and Super Admin has had a
-- toggle for it. Turning it off did almost nothing.
--
-- WHAT IT DID DO: sign-in, sign-up and OTP already refused — those three
-- functions consult customer_apps.enabled. So nobody NEW could get in.
--
-- WHAT IT DID NOT DO: every customer already signed in kept working. The three
-- session-scoped functions (me, orders, order_track) only ever checked the
-- token, so an app switched off on Monday carried on serving everyone who had
-- signed in before Monday, indefinitely.
--
-- And the client could not tell either way. public_customer_app_config()
-- returned NO ROW for a disabled app, which is the same answer it gives for a
-- restaurant that never configured a customer app at all — and the second of
-- those has to keep working, because it is how plain online ordering behaves.
-- One null could not mean both, so the app treated "off" as "not configured"
-- and carried on with permissive defaults.
--
-- TWO CHANGES, AND ONE THING DELIBERATELY LEFT ALONE
--
-- 1. The config now answers with an explicit {enabled:false} row when a
--    customer_apps row exists and is switched off. NO row still means "never
--    configured", so a restaurant that never opened the module is untouched.
--
-- 2. me / orders / order_track refuse with reason 'app_disabled' once the
--    module is off, so existing sessions stop too. The client already routes
--    an {ok:false, reason} answer the same way it routes 'no_session'.
--
-- LEFT ALONE ON PURPOSE: public_place_order and public_track_order. Those serve
-- the restaurant's PUBLIC WEBSITE ordering, not only the app. Gating them here
-- would take a restaurant's website down whenever the app module was switched
-- off — a far worse outcome than the bug being fixed, and not what was asked.
--
-- This is server-side. The block screen in the client is a courtesy so the
-- customer sees a sentence instead of an empty list; it is not the gate.
-- ============================================================================

-- "Explicitly switched off" — not "not configured". A restaurant with no
-- customer_apps row at all is not blocked, because it never had an app to
-- block, and plain website ordering must keep working for it.
create or replace function public.customer_app_blocked(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
           select 1 from public.customer_apps c
            where c.tenant_id = p_tenant and c.enabled is not true)
      or exists (
           select 1 from public.tenants t
            where t.id = p_tenant and t.is_active is not true);
$$;

grant execute on function public.customer_app_blocked(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The config: an explicit "off" instead of silence.
-- ---------------------------------------------------------------------------
create or replace function public.public_customer_app_config(p_tenant uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when c.enabled and t.is_active then
      jsonb_build_object(
        'tenantId',        c.tenant_id,
        'enabled',         true,
        'appName',         coalesce(
                             nullif(c.app_name, ''),
                             nullif(ts.settings->>'name', ''),
                             t.name),
        'logoUrl',         coalesce(
                             nullif(c.logo_url, ''),
                             nullif(ts.settings->>'webPortalLogo', ''),
                             nullif(ts.settings->>'appLogo', ''),
                             nullif(ts.settings->>'logo', '')),
        'iconUrl',         coalesce(
                             nullif(c.icon_url, ''),
                             nullif(ts.settings->>'appLogo', ''),
                             nullif(ts.settings->>'logo', '')),
        'theme',           c.theme,
        'whatsappNumber',  c.whatsapp_number,
        'features',        c.features,
        'appVersion',      c.app_version,
        'minSupportedVersion', c.min_supported_version,
        'updateUrl',       c.update_url,
        'updateRequired',  c.update_required,
        'requireClaimOtp', c.require_claim_otp)
    else
      -- Enough to name the restaurant on the block screen and nothing more:
      -- no theme, no feature switches, no update URL for an app that is off.
      jsonb_build_object(
        'tenantId', c.tenant_id,
        'enabled',  false,
        'appName',  coalesce(
                      nullif(c.app_name, ''),
                      nullif(ts.settings->>'name', ''),
                      t.name))
  end
  from public.customer_apps c
  join public.tenants t on t.id = c.tenant_id
  left join public.tenant_settings ts on ts.tenant_id = c.tenant_id
  where c.tenant_id = p_tenant;
$function$;

grant execute on function public.public_customer_app_config(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Existing sessions stop too.
-- ---------------------------------------------------------------------------
create or replace function public.public_customer_me(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row public.customers := customer_from_token(p_token);
begin
  if v_row.id is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if customer_app_blocked(v_row.tenant_id) then
    return jsonb_build_object('ok', false, 'reason', 'app_disabled');
  end if;
  return jsonb_build_object('ok', true, 'customer', customer_public_json(v_row));
end $function$;

grant execute on function public.public_customer_me(text) to anon, authenticated, service_role;

create or replace function public.public_customer_orders(p_token text, p_limit integer default 30)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.customers := customer_from_token(p_token);
  v_out jsonb;
begin
  if v_row.id is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if customer_app_blocked(v_row.tenant_id) then
    return jsonb_build_object('ok', false, 'reason', 'app_disabled');
  end if;

  select coalesce(jsonb_agg(x order by x->>'createdAt' desc), '[]'::jsonb) into v_out
  from (
    select jsonb_build_object(
             'id',             o.id,
             'orderNumber',    o.order_number,
             'status',         o.status,
             'orderType',      o.order_type,
             'source',         o.source,
             'grandTotal',     o.grand_total,
             'createdAt',      o.created_at,
             'branchId',       o.branch_id,
             'riderName',      o.rider_name,
             'kitchenStatus',  o.kitchen_status,
             'deliveryStatus', o.delivery_status,
             'dispatchedAt',   o.dispatched_at,
             'deliveredAt',    o.delivered_at,
             'items',          coalesce(o.data->'items', '[]'::jsonb)) as x
      from orders o
     where o.customer_id = v_row.id
       and o.tenant_id  = v_row.tenant_id
       and o.deleted_at is null
     order by o.created_at desc
     limit greatest(1, least(coalesce(p_limit, 30), 100))
  ) s;

  return jsonb_build_object('ok', true, 'orders', v_out);
end $function$;

grant execute on function public.public_customer_orders(text, integer) to anon, authenticated, service_role;

-- The tracking panel too. Body is otherwise byte-for-byte what was deployed;
-- only the guard is new.
create or replace function public.public_customer_order_track(p_token text, p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row      public.customers := customer_from_token(p_token);
  v_o        public.orders%rowtype;
  v_live     boolean;
  v_branch   jsonb := null;
  v_rider    jsonb := null;
  v_customer jsonb := null;
  v_blat     double precision;
  v_blng     double precision;
begin
  if v_row.id is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if customer_app_blocked(v_row.tenant_id) then
    return jsonb_build_object('ok', false, 'reason', 'app_disabled');
  end if;
  if p_order is null   then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  select * into v_o
    from orders o
   where o.id = p_order
     and o.customer_id = v_row.id
     and o.tenant_id   = v_row.tenant_id
     and o.deleted_at is null;

  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  v_live := coalesce(v_o.delivery_status, '') in ('onway', 'rider_assigned', 'rider_picked', 'rider_reached')
            and v_o.delivered_at is null
            and v_o.cancelled_at is null;

  if v_live
     and (v_o.delivery->>'riderLat') is not null
     and (v_o.delivery->>'riderLng') is not null then
    v_rider := jsonb_build_object(
      'lat',      (v_o.delivery->>'riderLat')::double precision,
      'lng',      (v_o.delivery->>'riderLng')::double precision,
      'pingedAt', v_o.delivery->>'riderPingedAt');
  end if;

  if (v_o.delivery->>'customerLat') is not null
     and (v_o.delivery->>'customerLng') is not null then
    v_customer := jsonb_build_object(
      'lat', (v_o.delivery->>'customerLat')::double precision,
      'lng', (v_o.delivery->>'customerLng')::double precision);
  end if;

  select b.lat, b.lng into v_blat, v_blng
    from branches b
   where b.id = v_o.branch_id and b.tenant_id = v_o.tenant_id;

  if v_blat is not null and v_blng is not null then
    v_branch := jsonb_build_object('lat', v_blat, 'lng', v_blng);
  end if;

  return jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id',             v_o.id,
      'orderNumber',    v_o.order_number,
      'status',         v_o.status,
      'orderType',      v_o.order_type,
      'grandTotal',     v_o.grand_total,
      'createdAt',      v_o.created_at,
      'kitchenStatus',  v_o.kitchen_status,
      'deliveryStatus', v_o.delivery_status,
      'dispatchedAt',   v_o.dispatched_at,
      'deliveredAt',    v_o.delivered_at,
      'cancelledAt',    v_o.cancelled_at,
      'riderName',      case when v_live then v_o.rider_name  else null end,
      'riderPhone',     case when v_live then v_o.rider_phone else null end,
      'etaMinutes',     nullif(v_o.delivery->>'etaMinutes', '')::numeric,
      'rider',          v_rider,
      'customer',       v_customer,
      'branch',         v_branch,
      'items',          coalesce(v_o.data->'items', '[]'::jsonb)));
end $function$;

grant execute on function public.public_customer_order_track(text, uuid) to anon, authenticated, service_role;
