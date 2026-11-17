-- Rollback for 20261117100000_v1_115_0_server_side_promo_and_offers.sql.
-- Restores public_place_order exactly as it was before v1.115.0 (verbatim), and removes what the migration added.
-- Running it puts website orders back to "priced by the server, discount 0, no delivery charge, promo ignored".
drop function if exists public.public_check_promo(uuid, text, numeric, text);
drop function if exists public.public_offers(uuid);
drop function if exists public._promo_check(uuid, text, numeric, uuid, boolean);
alter table public.promo_codes drop column if exists show_on_website;

CREATE OR REPLACE FUNCTION public.public_place_order(p_tenant uuid, p_branch uuid, p_order jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_mid      uuid;
  v_vtype    text;
  v_vname    text;
  v_vprice   numeric;
  v_price    numeric;
  v_name     text;
  v_note     text;
  v_found    boolean;
begin
  if not exists (select 1 from tenants where id = p_tenant and is_active) then
    raise exception 'restaurant not available' using errcode = '42501';
  end if;

  if jsonb_typeof(p_order->'items') <> 'array'
     or jsonb_array_length(p_order->'items') = 0 then
    raise exception 'order has no items' using errcode = '22023';
  end if;

  v_table := nullif(p_order->>'tableLabel', '');
  v_type  := coalesce(nullif(p_order->>'orderType', ''), 'takeaway');

  if nullif(p_order->>'tableId', '') is not null then
    begin
      select dt.branch_id into v_branch
        from dining_tables dt
       where dt.tenant_id = p_tenant
         and dt.id = (p_order->>'tableId')::uuid
         and dt.deleted_at is null;
    exception when others then
      v_branch := p_branch;
    end;
    if v_branch is null then v_branch := p_branch; end if;
  end if;

  if v_branch is null then
    select id into v_branch from branches
     where tenant_id = p_tenant order by sort_order limit 1;
  end if;
  if v_branch is null
     or not exists (select 1 from branches
                     where id = v_branch and tenant_id = p_tenant) then
    raise exception 'branch not valid for this restaurant' using errcode = '22023';
  end if;

  v_source := case
    when p_order->>'source' in ('website', 'qr', 'order_taker') then p_order->>'source'
    when v_table is not null then 'qr'
    else 'website'
  end;

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
    v_mid := null;
    begin
      v_mid := (v_item->>'menuItemId')::uuid;
    exception when others then
      v_mid := null;
    end;

    v_found := false;
    if v_mid is not null then
      select m.id, m.name, m.price, m.category_id, m.kitchen_id,
             m.size_variants, m.inch_variants
        into v_menu
        from menu_items m
       where m.tenant_id = p_tenant
         and m.id = v_mid
         and m.is_active and m.deleted_at is null;
      v_found := found;
    end if;

    if not v_found then
      raise exception 'item not available: %',
        coalesce(nullif(v_item->>'name', ''), v_item->>'menuItemId', 'unknown item')
        using errcode = '22023';
    end if;

    v_vtype := nullif(v_item->>'variantType', '');
    v_vname := nullif(v_item->>'variantName', '');
    v_price := v_menu.price;
    v_name  := v_menu.name;

    if v_vname is not null then
      v_vprice := null;
      select (x->>'price')::numeric into v_vprice
        from jsonb_array_elements(
               case when v_vtype = 'inch'
                    then coalesce(v_menu.inch_variants, '[]'::jsonb)
                    else coalesce(v_menu.size_variants, '[]'::jsonb) end) x
       where x->>'name' = v_vname
       limit 1;

      if v_vprice is null then
        raise exception 'that size is no longer available: % (%)', v_menu.name, v_vname
          using errcode = '22023';
      end if;

      v_price := v_vprice;
      v_name  := v_menu.name || ' (' || v_vname || ')';
    end if;

    v_qty      := greatest(coalesce((v_item->>'qty')::numeric,
                                    (v_item->>'quantity')::numeric, 1), 1);
    v_line     := v_price * v_qty;
    v_subtotal := v_subtotal + v_line;
    v_line_no  := v_line_no + 1;
    v_line_id  := gen_random_uuid();
    v_note     := coalesce(nullif(v_item->>'note', ''), nullif(v_item->>'notes', ''), '');

    insert into order_items (
      id, tenant_id, branch_id, order_id, menu_item_id, name,
      category_id, kitchen_id, pricing_type,
      unit_price, quantity, line_total, note, line_no,
      variant_type, variant_name)
    values (
      v_line_id, p_tenant, v_branch, v_order_id, v_menu.id, v_name,
      v_menu.category_id, v_menu.kitchen_id, 'fixed',
      v_price, v_qty, v_line, v_note, v_line_no,
      v_vtype, v_vname);

    v_lines := v_lines || jsonb_build_object(
      'id',          v_line_id,
      'menuItemId',  v_menu.id,
      'name',        v_name,
      'pricingType', 'fixed',
      'price',       v_price,
      'quantity',    v_qty,
      'lineTotal',   v_line,
      'note',        v_note,
      'categoryId',  v_menu.category_id,
      'kitchenId',   v_menu.kitchen_id,
      'variantType', v_vtype,
      'variantName', v_vname);
  end loop;

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
           'tableId',     nullif(p_order->>'tableId', ''),
           'tableName',   nullif(p_order->>'tableName', ''),
           'branchId',    v_branch,
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
