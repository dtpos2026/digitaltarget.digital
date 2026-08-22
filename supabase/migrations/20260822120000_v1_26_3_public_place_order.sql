-- ============================================================================
-- v1.26.3 — customer website orders never really arrived in the POS
--
-- Three defects, each independently enough to make an online order useless.
--
-- 1. THE ITEMS WERE NOWHERE THE POS LOOKS.
--    The function writes each line into `order_items`. The POS does not read
--    that table — nothing in the client does; the whole order_items/
--    order_payments path belongs to supabaseSync.ts, whose flusher is never
--    installed. The POS reads items from the `orders.data` document, and this
--    function never wrote `data` at all. So a customer order showed up on the
--    till with ZERO items: an order number, a total, and nothing to cook.
--
-- 2. THE STATUS WAS NOT A STATUS.
--    It wrote status = 'pending'. The application's OrderStatus union is
--    running | hold | paid | partial | void | complimentary | cancelled |
--    credit_pending | credit_received | pending_approval | rejected.
--    'pending' is not a member, so the order matched no screen's filter and
--    sat in limbo. The orders_public_insert RLS policy also expects 'running',
--    so the function disagreed with the project's own contract.
--
-- 3. THE SOURCE WAS OVERWRITTEN, WHICH SWITCHED OFF THE WHOLE WORKFLOW.
--    OnlineOrderPage sends source 'website' or 'qr'. This function ignored
--    that and hardcoded 'online'. NewOrderNotifier only reacts to
--    ['website','qr','order_taker'], and onlineApproval.sourceKeyForOrder()
--    returns null for anything else. So an online order produced NO alert, NO
--    approval gate and NO auto-KOT — it was silently invisible to the people
--    meant to cook it.
--
-- WHAT IS DELIBERATELY KEPT
-- Prices are still re-read from menu_items and never taken from the request.
-- The order arrives from an unauthenticated customer; trusting a client-sent
-- price would let anyone buy a PKR 5000 meal for PKR 1. The tenant/branch
-- ownership check is kept for the same reason. order_items is still written,
-- so nothing that may read it later loses its rows.
--
-- Status is 'running', not 'pending_approval': whether an order needs manual
-- approval is the restaurant's setting, and NewOrderNotifier already applies
-- it on arrival (holdForApproval when the mode is manual). Deciding it here
-- would duplicate that policy in a second place and get it wrong when the
-- setting changes.
-- ============================================================================

create or replace function public.public_place_order(
  p_tenant uuid, p_branch uuid, p_order jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id uuid := gen_random_uuid();
  v_number   integer;
  v_branch   uuid := p_branch;
  v_item     jsonb;
  v_menu     record;
  v_qty      numeric;
  v_subtotal numeric := 0;
  v_line     numeric;
  v_line_no  integer := 0;
  v_line_id  uuid;
  v_source   text;
  v_type     text;
  v_table    text;
  v_lines    jsonb := '[]'::jsonb;
  v_now      timestamptz := now();
begin
  if not exists (select 1 from tenants where id = p_tenant and is_active) then
    raise exception 'restaurant not available' using errcode = '42501';
  end if;

  if v_branch is null then
    select id into v_branch from branches
     where tenant_id = p_tenant order by sort_order limit 1;
  end if;
  -- The branch must belong to THIS restaurant. Without this check a caller
  -- could file an order against another tenant's branch.
  if v_branch is null
     or not exists (select 1 from branches
                     where id = v_branch and tenant_id = p_tenant) then
    raise exception 'branch not valid for this restaurant' using errcode = '22023';
  end if;

  if jsonb_typeof(p_order->'items') <> 'array'
     or jsonb_array_length(p_order->'items') = 0 then
    raise exception 'order has no items' using errcode = '22023';
  end if;

  v_table := nullif(p_order->>'tableLabel', '');
  v_type  := coalesce(nullif(p_order->>'orderType', ''), 'takeaway');

  -- Honour the source the customer portal actually sent. Anything unrecognised
  -- falls back to the same rule OnlineOrderPage uses, so the order still lands
  -- in a bucket the notifier and the approval screen understand.
  v_source := case
    when p_order->>'source' in ('website', 'qr', 'order_taker') then p_order->>'source'
    when v_table is not null then 'qr'
    else 'website'
  end;

  -- Same sequence the tills use, so online and counter orders never collide.
  insert into order_counters (tenant_id, branch_id, current_value)
    values (p_tenant, v_branch, 1)
  on conflict (tenant_id, branch_id)
    do update set current_value = order_counters.current_value + 1
  returning current_value into v_number;

  insert into orders (
    id, tenant_id, branch_id, order_number, order_type, status, source,
    table_label, customer_snapshot, delivery, notes,
    subtotal, discount, tax, service_charge, grand_total, total,
    created_at, updated_at)
  values (
    v_order_id, p_tenant, v_branch, v_number,
    v_type, 'running', v_source,
    v_table,
    coalesce(p_order->'customer', '{}'::jsonb),
    coalesce(p_order->'delivery', '{}'::jsonb),
    nullif(p_order->>'notes', ''),
    0, 0, 0, 0, 0, 0, v_now, v_now);

  for v_item in select * from jsonb_array_elements(p_order->'items') loop
    -- Prices re-read from menu_items on purpose: the order arrives from an
    -- unauthenticated customer, so a client-supplied price would let anyone buy
    -- a PKR 5000 meal for PKR 1 by editing the request.
    select m.id, m.name, m.price, m.category_id, m.kitchen_id
      into v_menu
      from menu_items m
     where m.tenant_id = p_tenant
       and m.id = (v_item->>'menuItemId')::uuid
       and m.is_active and m.deleted_at is null;

    if not found then
      raise exception 'item not available: %',
        coalesce(v_item->>'name', v_item->>'menuItemId') using errcode = '22023';
    end if;

    v_qty      := greatest(coalesce((v_item->>'qty')::numeric,
                                    (v_item->>'quantity')::numeric, 1), 1);
    v_line     := v_menu.price * v_qty;
    v_subtotal := v_subtotal + v_line;
    v_line_no  := v_line_no + 1;
    v_line_id  := gen_random_uuid();

    insert into order_items (
      id, tenant_id, branch_id, order_id, menu_item_id, name,
      category_id, kitchen_id, pricing_type,
      unit_price, quantity, line_total, note, line_no)
    values (
      v_line_id, p_tenant, v_branch, v_order_id, v_menu.id, v_menu.name,
      v_menu.category_id, v_menu.kitchen_id, 'fixed',
      v_menu.price, v_qty, v_line, coalesce(v_item->>'notes', ''), v_line_no);

    -- The same line in the shape the POS reads (types.ts CartItem). Server
    -- prices, not the customer's.
    v_lines := v_lines || jsonb_build_object(
      'id',          v_line_id,
      'menuItemId',  v_menu.id,
      'name',        v_menu.name,
      'pricingType', 'fixed',
      'price',       v_menu.price,
      'quantity',    v_qty,
      'lineTotal',   v_line,
      'note',        coalesce(v_item->>'notes', ''),
      'categoryId',  v_menu.category_id,
      'kitchenId',   v_menu.kitchen_id);
  end loop;

  -- The POS document. Without this the till receives an order with no items.
  update orders
     set subtotal    = v_subtotal,
         grand_total = v_subtotal,
         total       = v_subtotal,
         updated_at  = v_now,
         client_seq  = (extract(epoch from v_now) * 1000)::bigint,
         data = jsonb_build_object(
           'id',          v_order_id,
           'orderNumber', v_number,
           'orderType',   v_type,
           'status',      'running',
           'source',      v_source,
           'tableLabel',  v_table,
           'items',       v_lines,
           'payments',    '[]'::jsonb,
           'subtotal',    v_subtotal,
           'discount',    0,
           'tax',         0,
           'grandTotal',  v_subtotal,
           'customer',    coalesce(p_order->'customer', '{}'::jsonb),
           'delivery',    coalesce(p_order->'delivery', '{}'::jsonb),
           'notes',       coalesce(nullif(p_order->>'notes', ''), ''),
           'createdAt',   to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           '_updatedAt',  (extract(epoch from v_now) * 1000)::bigint)
   where id = v_order_id;

  return jsonb_build_object(
    'id', v_order_id, 'order_number', v_number,
    'order', (select to_jsonb(o) from orders o where o.id = v_order_id));
end
$function$;
