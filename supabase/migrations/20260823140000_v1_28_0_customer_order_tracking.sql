-- ===========================================================================
-- v1.28.0 — Live order & rider tracking inside the customer account
--
-- The public #/track page already exists and works off order number + phone.
-- A signed-in customer should not have to retype either, so this adds the same
-- view behind their session token.
--
-- Two changes, both additive:
--   1. public_customer_orders() also returns the delivery/kitchen state, so the
--      status badge in "My Orders" stops reading a field the RPC never sent.
--   2. public_customer_order_track() returns one order's live detail, for an
--      order that belongs to the caller and nobody else.
--
-- The rider's position is only returned while the delivery is actually in
-- flight. Once it is delivered or cancelled the rider is off this customer's
-- job and their location is no longer the customer's business.
-- ===========================================================================

create or replace function public.public_customer_orders(p_token text, p_limit integer default 30)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_row public.customers := customer_from_token(p_token);
  v_out jsonb;
begin
  if v_row.id is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;

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
             -- v1.28.0 — the live state the tracking badge and panel need.
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
end $$;


create or replace function public.public_customer_order_track(p_token text, p_order uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
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
  if p_order is null   then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  -- Ownership is the whole security boundary here: the row must be this
  -- customer's, in this customer's tenant.
  select * into v_o
    from orders o
   where o.id = p_order
     and o.customer_id = v_row.id
     and o.tenant_id   = v_row.tenant_id
     and o.deleted_at is null;

  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  -- In flight = dispatched, not yet finished. `coalesce` because a NULL
  -- delivery_status must read as "not on the road", not as unknown.
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
end $$;

revoke execute on function public.public_customer_order_track(text, uuid) from public;
grant  execute on function public.public_customer_order_track(text, uuid) to anon, authenticated;
