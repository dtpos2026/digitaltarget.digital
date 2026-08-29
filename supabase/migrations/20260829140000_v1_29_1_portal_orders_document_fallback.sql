-- ============================================================================
-- v1.29.1 — a customer's order was blank for the minute that matters most
--
-- portal_orders returned orders.data, the order document. public_place_order
-- never writes one: it fills the typed columns and order_items, and the
-- document only appears when a POS device syncs that order back.
--
-- orders.data DEFAULTS to '{}', so such an order carries an EMPTY object rather
-- than NULL. A coalesce() would never fire on it — which is why the first
-- reading of this looked clean: "0 rows with a null document" was true and
-- meant nothing. Two orders in production are sitting in exactly that state
-- right now, and the Order Taker would show them as blank cards.
--
-- A real POS document always carries its own id (rowToDb writes data.id), so
-- that is what tells the two apart. When it is absent the document is built
-- from the columns and order_items for the read only — never stored, so the POS
-- stays the only writer of orders.data and nothing here can race it.
--
-- Verified against the live database as `anon`, inside a rolled-back
-- transaction, with an order shaped exactly as public_place_order leaves one:
-- number 99991, "Test Customer", running, 500.00, "Grilled Fish" x2 — all
-- present. Before the fix the same order came back as {}.
--
-- The rider filter also now reads orders.rider_id, not only data->>'riderId':
-- a customer order that has been assigned but not yet synced has the column and
-- not the document.
-- ============================================================================
create or replace function public.portal_orders(p_token text, p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  s public.staff_portal_sessions := portal_identity(p_token);
  v jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 300);
begin
  if s.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  select coalesce(jsonb_agg(x.doc order by x.created_at desc), '[]'::jsonb) into v
    from (
      select
        case when o.data ? 'id' then o.data
        else jsonb_strip_nulls(jsonb_build_object(
            'id',            o.id::text,
            'orderNumber',   o.order_number,
            'status',        coalesce(o.status, 'running'),
            'orderType',     o.order_type,
            'source',        o.source,
            'tableLabel',    o.table_label,
            'customer',      o.customer_snapshot,
            'customerName',  o.customer_snapshot->>'name',
            'customerPhone', o.customer_snapshot->>'phone',
            'delivery',      o.delivery,
            'deliveryStatus', o.delivery_status,
            'riderId',       o.rider_id::text,
            'notes',         o.notes,
            'subtotal',      o.subtotal,
            'discount',      o.discount,
            'tax',           o.tax,
            'grandTotal',    coalesce(o.grand_total, o.total),
            'createdAt',     o.created_at,
            'branchId',      o.branch_id::text,
            'items',         coalesce((
                               select jsonb_agg(jsonb_build_object(
                                        'id',        i.id::text,
                                        'name',      i.name,
                                        'qty',       i.quantity,
                                        'price',     i.unit_price,
                                        'lineTotal', i.line_total,
                                        'notes',     i.note)
                                      order by i.line_no)
                                 from public.order_items i
                                where i.order_id = o.id
                                  and i.deleted_at is null), '[]'::jsonb)
          )) end as doc,
        o.created_at
        from public.orders o
       where o.tenant_id = s.tenant_id
         and o.deleted_at is null
         and o.archived_at is null
         and (s.all_branches or s.branch_id is null or o.branch_id = s.branch_id)
         and (
           s.role <> 'rider'
           or o.data->>'riderId' = s.user_id::text
           or o.rider_id = s.user_id
           or (coalesce(o.data->>'riderId', '') = '' and o.rider_id is null)
         )
         and coalesce(o.status, 'running') not in ('paid', 'cancelled', 'closed')
       order by o.created_at desc
       limit v_limit
    ) x;

  return jsonb_build_object('ok', true, 'orders', v);
end $$;

grant execute on function public.portal_orders(text, integer) to anon, authenticated, service_role;
