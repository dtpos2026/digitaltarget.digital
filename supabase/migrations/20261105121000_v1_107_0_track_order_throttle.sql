-- v1.107.0 — S-2: public_track_order() had no throttle on the GUESSABLE lookups (order number + phone last-4, or order
-- number + table label). With a known restaurant id an attacker could walk the 10 000 last-4 combinations of an order.
--
-- What changes
--  * A lookup by the order's own uuid (what the website holds right after checkout) is unguessable and is NOT limited.
--  * A guessable lookup that finds nothing counts as a miss for that restaurant. After 60 misses inside one 10-minute
--    window the guessable path answers "not found" until the window ends (10 000 combinations would take ~28 hours).
--    A lookup that succeeds never counts, so an honest customer is not penalised by another person's mistakes.
--  * Misses are recorded only for restaurants that exist, and rows older than a day are removed, so the table cannot grow
--    by calling the function with random ids.
-- The returned JSON is identical to before. Additive: one new table (RLS on, no policy = closed to the API) and the
-- function body. Rollback: docs/rollback/2026-11-05-v1_107_0-rollback.sql.

create table if not exists public.public_track_attempts (
  tenant_id uuid        not null,
  bucket    timestamptz not null,
  misses    integer     not null default 0,
  primary key (tenant_id, bucket)
);
create index if not exists public_track_attempts_bucket_idx on public.public_track_attempts (bucket);
alter table public.public_track_attempts enable row level security;
revoke all on public.public_track_attempts from public, anon, authenticated;
comment on table public.public_track_attempts is
  'Failed guessable order lookups per restaurant per 10-minute window (written only by public_track_order). RLS on, no policy: closed to the API by design.';

create or replace function public.public_track_order(
  p_tenant uuid,
  p_order_id uuid default null,
  p_order_number integer default null,
  p_phone_last4 text default null,
  p_table_label text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o        record;
  d        jsonb;
  v_items  jsonb;
  v_bucket timestamptz;
  v_misses integer;
  c_window constant integer := 600;   -- seconds
  c_limit  constant integer := 60;    -- misses per restaurant per window
begin
  if p_order_id is null and p_order_number is null then return null; end if;
  if p_order_id is null and p_phone_last4 is null and p_table_label is null then
    return null;
  end if;

  -- Guessable lookup: throttle by restaurant.
  if p_order_id is null then
    v_bucket := to_timestamp(floor(extract(epoch from now()) / c_window) * c_window);
    select a.misses into v_misses
      from public_track_attempts a
     where a.tenant_id = p_tenant and a.bucket = v_bucket;
    if coalesce(v_misses, 0) >= c_limit then return null; end if;
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

  if not found then
    if p_order_id is null and exists (select 1 from tenants t where t.id = p_tenant) then
      insert into public_track_attempts as a (tenant_id, bucket, misses)
      values (p_tenant, v_bucket, 1)
      on conflict (tenant_id, bucket) do update set misses = a.misses + 1;
      if random() < 0.02 then
        delete from public_track_attempts where bucket < now() - interval '1 day';
      end if;
    end if;
    return null;
  end if;
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
