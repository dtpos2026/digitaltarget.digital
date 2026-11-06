-- public.public_track_order BEFORE v1.107.0 (copy of pg_get_functiondef from the live database, 2026-11-05).
-- Run this file to put the un-throttled function back. Grants were {postgres, service_role, anon, authenticated} and are unchanged.
CREATE OR REPLACE FUNCTION public.public_track_order(p_tenant uuid, p_order_id uuid DEFAULT NULL::uuid, p_order_number integer DEFAULT NULL::integer, p_phone_last4 text DEFAULT NULL::text, p_table_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o       record;
  d       jsonb;
  v_items jsonb;
begin
  if p_order_id is null and p_order_number is null then return null; end if;
  if p_order_id is null and p_phone_last4 is null and p_table_label is null then
    return null;
  end if;

  select ord.id, ord.order_number, ord.status, ord.order_type, ord.table_label,
         ord.subtotal, ord.discount, ord.grand_total, ord.total,
         ord.kitchen_status, ord.kitchen_status_at,
         ord.delivery_status, ord.delivery,
         ord.rider_name, ord.rider_phone,
         ord.dispatched_at, ord.delivered_at,
         ord.created_at, ord.updated_at,
         ord.data
    into o
  from orders ord
  where ord.tenant_id = p_tenant
    and ord.voided_at is null
    and (p_order_id is null     or ord.id = p_order_id)
    and (p_order_number is null or ord.order_number = p_order_number)
    and (p_table_label is null  or ord.table_label = p_table_label)
    and (p_phone_last4 is null
         or right(coalesce(ord.customer_snapshot->>'phone',
                           ord.delivery->>'phone', ''), 4) = p_phone_last4)
  order by ord.created_at desc
  limit 1;

  if not found then return null; end if;
  d := coalesce(o.data, '{}'::jsonb);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',        coalesce(nullif(it->>'id', ''), 'line-' || (n - 1)),
           'name',      coalesce(nullif(it->>'name', ''), 'Item'),
           'quantity',  coalesce((it->>'quantity')::numeric, 1),
           'lineTotal', coalesce((it->>'lineTotal')::numeric, 0)
         ) order by n), '[]'::jsonb)
    into v_items
  from jsonb_array_elements(
         case when jsonb_typeof(d->'items') = 'array'
              then d->'items' else '[]'::jsonb end
       ) with ordinality as t(it, n);

  return jsonb_build_object(
    'id',              o.id,
    'orderNumber',     o.order_number,
    'status',          coalesce(o.status, d->>'status', 'running'),
    'orderType',       coalesce(o.order_type, d->>'orderType'),
    'tableLabel',      coalesce(o.table_label, d->>'tableLabel'),
    'items',           coalesce(v_items, '[]'::jsonb),
    'payments',        '[]'::jsonb,
    'subtotal',        coalesce(
                         nullif(case when jsonb_typeof(d->'subtotal') = 'number'
                                     then (d->>'subtotal')::numeric end, 0),
                         nullif(o.subtotal, 0), 0),
    'discount',        coalesce(
                         nullif(case when jsonb_typeof(d->'discount') = 'number'
                                     then (d->>'discount')::numeric end, 0),
                         nullif(o.discount, 0), 0),
    'grandTotal',      coalesce(
                         nullif(case when jsonb_typeof(d->'grandTotal') = 'number'
                                     then (d->>'grandTotal')::numeric end, 0),
                         nullif(o.grand_total, 0), nullif(o.total, 0), 0),
    'kitchenStatus',   coalesce(o.kitchen_status, d->>'kitchenStatus'),
    'kitchenStatusAt', coalesce(o.kitchen_status_at,
                                nullif(d->>'kitchenStatusAt', '')::timestamptz),
    'deliveryStatus',  coalesce(o.delivery_status, d->>'deliveryStatus'),
    'riderName',       coalesce(o.rider_name, d->>'riderName'),
    'riderPhone',      coalesce(o.rider_phone, d->>'riderPhone'),
    'dispatchedAt',    o.dispatched_at,
    'deliveredAt',     o.delivered_at,
    'createdAt',       o.created_at,
    'updatedAt',       o.updated_at,
    'delivery',        jsonb_strip_nulls(jsonb_build_object(
                         'riderLat',    coalesce(o.delivery->'riderLat',    d->'delivery'->'riderLat'),
                         'riderLng',    coalesce(o.delivery->'riderLng',    d->'delivery'->'riderLng'),
                         'customerLat', coalesce(o.delivery->'customerLat', d->'delivery'->'customerLat'),
                         'customerLng', coalesce(o.delivery->'customerLng', d->'delivery'->'customerLng'),
                         'etaMinutes',  coalesce(o.delivery->'etaMinutes',  d->'delivery'->'etaMinutes'),
                         'onTheWayAt',  coalesce(o.delivery->'onTheWayAt',  d->'delivery'->'onTheWayAt')))
  );
end
$function$;
