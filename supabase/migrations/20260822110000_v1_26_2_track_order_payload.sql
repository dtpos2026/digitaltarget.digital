-- ============================================================================
-- v1.26.2 — the order tracker could not render an order, and crashed trying
--
-- THE CRASH: "Cannot read properties of undefined (reading 'length')".
--
-- TrackOrderPage renders `order.items.length`. public_track_order() selected
-- thirteen columns and returned to_jsonb() of them — and `items` was not one
-- of them. The client casts that jsonb straight to an Order with no mapping
-- and no defaults, so `order.items` was undefined and the page threw before it
-- rendered anything.
--
-- The crash was only the visible half. Every OTHER field was broken too, just
-- silently: to_jsonb() of a record yields the COLUMN names, so the payload was
-- snake_case (order_number, grand_total, order_type, kitchen_status, ...) while
-- the page reads camelCase. Order number, total, type, rider and every
-- timestamp rendered blank or NaN. And subtotal, discount, rider_phone,
-- kitchen_status_at and the delivery tracking object were never selected at
-- all, though all of them are real columns on `orders`.
--
-- TWO WRITERS, TWO DIFFERENT COLUMN SETS
-- Verified against live data: the POS writer (supabaseStore.rowToDb) fills
-- `total` and the whole bill in `data`, leaving grand_total/subtotal/discount
-- at 0. public_place_order() — the customer website path — does the opposite:
-- it fills grand_total/subtotal and leaves `data` empty. Neither writes both,
-- so whichever single source this function trusted would read 0 for half the
-- orders in the table. Every money field therefore takes the first non-zero of
-- document, then typed column, then `total`; text fields prefer the column and
-- fall back to the document.
--
-- PRIVACY: this endpoint is anonymous, gated by order number PLUS the last four
-- digits of the phone or the table label. That gate is unchanged. Items are
-- trimmed to name / quantity / line total — what a customer needs to recognise
-- their own order — and the delivery object is rebuilt from named tracking
-- keys only, so nothing else stored on it can leak.
-- ============================================================================

create or replace function public.public_track_order(
  p_tenant       uuid,
  p_order_id     uuid    default null,
  p_order_number integer default null,
  p_phone_last4  text    default null,
  p_table_label  text    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o       record;
  d       jsonb;
  v_items jsonb;
begin
  -- An order number alone is guessable, so it must be paired with the last four
  -- digits of the phone or the table it was placed from. Without that pairing a
  -- stranger could walk the numbers and read every order in the restaurant.
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

  -- The POS keeps the complete bill in `data`; the customer gets the lines
  -- only. No cost price, no internal ids, no notes.
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

  -- camelCase, because that is what the client reads. Arrays and money fields
  -- are never null: the tracker does arithmetic and .length on them.
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
    -- Rebuilt from named keys so nothing else stored on `delivery` escapes.
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
