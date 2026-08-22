-- ============================================================================
-- v1.26.3 — recover the customer orders that were never visible to the till
--
-- The previous public_place_order() wrote its line items to `order_items` and
-- left `orders.data` empty, stamped status 'pending' (not a member of the
-- application's OrderStatus union) and source 'online' (not a source
-- NewOrderNotifier reacts to). Those orders therefore appeared on no screen at
-- all. On this database that is 9 real orders holding 22 item rows.
--
-- The information was never lost — it was in the wrong place. This rebuilds
-- the POS document from the order_items rows that already exist.
--
-- STATUS: these become 'pending_approval', not 'running'. They are historic
-- orders that nobody ever accepted, so putting them straight into the live
-- bill list would assert something untrue. 'pending_approval' routes them to
-- the Online Order Approval screen, which is exactly the place a cashier
-- decides whether to accept or reject one, and it is a status every screen
-- already understands.
--
-- Idempotent and narrow: it only touches rows carrying the broken writer's
-- exact signature, and only fills a document that is missing or empty. Running
-- it twice changes nothing. No row is deleted and no money value is invented —
-- totals come from the existing columns and the existing item rows.
-- ============================================================================

with broken as (
  select o.id
  from orders o
  where o.status = 'pending'
    and o.source = 'online'
),
lines as (
  select oi.order_id,
         jsonb_agg(jsonb_build_object(
           'id',          oi.id,
           'menuItemId',  oi.menu_item_id,
           'name',        oi.name,
           'pricingType', coalesce(oi.pricing_type, 'fixed'),
           'price',       coalesce(oi.unit_price, 0),
           'quantity',    coalesce(oi.quantity, 1),
           'lineTotal',   coalesce(oi.line_total, 0),
           'note',        coalesce(oi.note, ''),
           'categoryId',  oi.category_id,
           'kitchenId',   oi.kitchen_id
         ) order by oi.line_no, oi.id) as items,
         sum(coalesce(oi.line_total, 0)) as items_total
  from order_items oi
  join broken b on b.id = oi.order_id
  group by oi.order_id
)
update orders o
   set status = 'pending_approval',
       -- Back to a source the notifier and the approval screen recognise.
       source = case when nullif(o.table_label, '') is not null then 'qr' else 'website' end,
       subtotal    = coalesce(nullif(o.subtotal, 0),    l.items_total, 0),
       grand_total = coalesce(nullif(o.grand_total, 0), l.items_total, 0),
       total       = coalesce(nullif(o.total, 0), nullif(o.grand_total, 0), l.items_total, 0),
       updated_at  = now(),
       data = coalesce(o.data, '{}'::jsonb) || jsonb_build_object(
         'id',          o.id,
         'orderNumber', o.order_number,
         'orderType',   coalesce(o.order_type, 'takeaway'),
         'status',      'pending_approval',
         'source',      case when nullif(o.table_label, '') is not null then 'qr' else 'website' end,
         'tableLabel',  o.table_label,
         'items',       coalesce(l.items, '[]'::jsonb),
         'payments',    '[]'::jsonb,
         'subtotal',    coalesce(nullif(o.subtotal, 0), l.items_total, 0),
         'discount',    coalesce(o.discount, 0),
         'tax',         coalesce(o.tax, 0),
         'grandTotal',  coalesce(nullif(o.grand_total, 0), l.items_total, 0),
         'customer',    coalesce(o.customer_snapshot, '{}'::jsonb),
         'delivery',    coalesce(o.delivery, '{}'::jsonb),
         'notes',       coalesce(o.notes, ''),
         'createdAt',   to_char(o.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         '_updatedAt',  (extract(epoch from now()) * 1000)::bigint,
         'approvalRequired', true)
  from lines l
 where o.id = l.order_id
   and o.status = 'pending' and o.source = 'online';

-- Orders that carry the broken signature but have no item rows either: still
-- give them a status and source the application understands, so they stop
-- being invisible. Their emptiness is then a visible fact rather than a
-- silently skipped row.
update orders o
   set status = 'pending_approval',
       source = case when nullif(o.table_label, '') is not null then 'qr' else 'website' end,
       updated_at = now(),
       data = coalesce(o.data, '{}'::jsonb) || jsonb_build_object(
         'id',          o.id,
         'orderNumber', o.order_number,
         'orderType',   coalesce(o.order_type, 'takeaway'),
         'status',      'pending_approval',
         'source',      case when nullif(o.table_label, '') is not null then 'qr' else 'website' end,
         'items',       coalesce(o.data->'items', '[]'::jsonb),
         'payments',    '[]'::jsonb,
         'subtotal',    coalesce(o.subtotal, 0),
         'discount',    coalesce(o.discount, 0),
         'tax',         coalesce(o.tax, 0),
         'grandTotal',  coalesce(nullif(o.grand_total, 0), nullif(o.total, 0), 0),
         'customer',    coalesce(o.customer_snapshot, '{}'::jsonb),
         'delivery',    coalesce(o.delivery, '{}'::jsonb),
         'notes',       coalesce(o.notes, ''),
         'createdAt',   to_char(o.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         '_updatedAt',  (extract(epoch from now()) * 1000)::bigint,
         'approvalRequired', true)
 where o.status = 'pending' and o.source = 'online';
