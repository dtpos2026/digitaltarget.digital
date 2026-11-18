-- v1.124.0 — product descriptions and add-on groups for the website (and the table QR menu).
--
-- menu_items gets two columns: description (a line or two shown on the item's details) and add_on_groups (jsonb: groups of priced extras —
-- [{id, name, required?, max?, options:[{id, name, price, isActive?}]}]). Both are additive, with defaults; no existing row changes.
-- public_place_order prices the add-ons ON THE SERVER: a line may carry "addOns" (the ids chosen); each id is looked up in that menu item's
-- own groups, the option's price is added to the unit price, the names are appended to the line note (so the kitchen reads them) and the
-- choices are kept on the line ("addOns"). A group's max is enforced; an id that is not offered (or no longer active) refuses the order;
-- a required group needs a choice when the order comes from the website or the QR menu (the order taker app has no add-on screen yet).
-- A line with no "addOns" on an item with no groups behaves exactly as before.
-- Rollback: docs/rollback/2026-11-18-v1_124_0-menu-addons-before.sql (restores the function; the two columns are left, they are harmless)
alter table public.menu_items add column if not exists description text;
alter table public.menu_items add column if not exists add_on_groups jsonb not null default '[]'::jsonb;

create or replace function public.public_place_order(p_tenant uuid, p_branch uuid, p_order jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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
  v_settings jsonb;
  v_min      numeric := 0;
  v_dcharge  numeric := 0;
  v_dbase    numeric := 0;
  v_dfree    numeric := 0;
  v_pcode    text;
  v_cust     public.customers;
  v_promo    jsonb;
  v_discount numeric := 0;
  v_grand    numeric;
  v_addons   jsonb;
  v_addon_total numeric;
  v_picked   text[];
  v_g        jsonb;
  v_opt      jsonb;
  v_gcount   integer;
  v_addon_note text;
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

  select ts.settings into v_settings from tenant_settings ts where ts.tenant_id = p_tenant order by (ts.branch_id = '00000000-0000-0000-0000-000000000000'::uuid) desc nulls last limit 1;
  v_settings := coalesce(v_settings, '{}'::jsonb);
  begin v_min   := greatest(coalesce((v_settings->>'minOnlineOrder')::numeric, 0), 0);          exception when others then v_min := 0; end;
  begin v_dbase := greatest(coalesce((v_settings->>'deliveryCharge')::numeric, 0), 0);          exception when others then v_dbase := 0; end;
  begin v_dfree := greatest(coalesce((v_settings->>'freeDeliveryThreshold')::numeric, 0), 0);   exception when others then v_dfree := 0; end;

  insert into order_counters (tenant_id, branch_id, current_value, reset_date)
    values (p_tenant, v_branch, 0, current_date)
  on conflict (tenant_id, branch_id) do nothing;
  update order_counters c
     set current_value = greatest(
           c.current_value,
           coalesce((select max(o.order_number) from orders o
                      where o.tenant_id = p_tenant
                        and o.branch_id is not distinct from v_branch), 0)
         ) + 1
   where c.tenant_id = p_tenant
     and c.branch_id is not distinct from v_branch
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
             m.size_variants, m.inch_variants, m.add_on_groups
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

    -- v1.124.0 — add-ons: the browser sends only the ids chosen; the price, the limits and the required groups come from the menu item itself
    v_addons := '[]'::jsonb; v_addon_total := 0;
    if jsonb_typeof(v_item->'addOns') = 'array' and jsonb_array_length(v_item->'addOns') > 0 then
      select coalesce(array_agg(distinct x.id), '{}'::text[]) into v_picked
        from (select coalesce(nullif(e->>'id', ''), case when jsonb_typeof(e) = 'string' then e #>> '{}' end) as id
                from jsonb_array_elements(v_item->'addOns') e) x
       where x.id is not null;
      for v_g in select * from jsonb_array_elements(coalesce(v_menu.add_on_groups, '[]'::jsonb)) loop
        v_gcount := 0;
        for v_opt in select * from jsonb_array_elements(coalesce(v_g->'options', '[]'::jsonb)) loop
          if (v_opt->>'id') = any (v_picked) and coalesce((v_opt->>'isActive')::boolean, true) then
            v_gcount := v_gcount + 1;
            v_addon_total := v_addon_total + greatest(coalesce((v_opt->>'price')::numeric, 0), 0);
            v_addons := v_addons || jsonb_build_object('id', v_opt->>'id', 'name', v_opt->>'name',
                          'price', greatest(coalesce((v_opt->>'price')::numeric, 0), 0), 'groupId', v_g->>'id', 'group', v_g->>'name');
          end if;
        end loop;
        if coalesce((v_g->>'max')::integer, 0) > 0 and v_gcount > (v_g->>'max')::integer then
          raise exception 'too many choices for %: %', v_g->>'name', v_menu.name using errcode = '22023';
        end if;
      end loop;
      if jsonb_array_length(v_addons) <> coalesce(array_length(v_picked, 1), 0) then
        raise exception 'an extra is no longer available: %', v_menu.name using errcode = '22023';
      end if;
    end if;
    -- a required group needs a choice from the website and the QR menu (the order taker app has no add-on screen yet)
    if v_source in ('website', 'qr') then
      for v_g in select * from jsonb_array_elements(coalesce(v_menu.add_on_groups, '[]'::jsonb)) loop
        if coalesce((v_g->>'required')::boolean, false)
           and exists (select 1 from jsonb_array_elements(coalesce(v_g->'options', '[]'::jsonb)) o where coalesce((o->>'isActive')::boolean, true))
           and not exists (select 1 from jsonb_array_elements(v_addons) a where a->>'groupId' = v_g->>'id') then
          raise exception 'choose % for %', v_g->>'name', v_menu.name using errcode = '22023';
        end if;
      end loop;
    end if;
    v_price := v_price + v_addon_total;

    v_qty      := greatest(coalesce((v_item->>'qty')::numeric,
                                    (v_item->>'quantity')::numeric, 1), 1);
    v_line     := v_price * v_qty;
    v_subtotal := v_subtotal + v_line;
    v_line_no  := v_line_no + 1;
    v_line_id  := gen_random_uuid();
    v_note     := coalesce(nullif(v_item->>'note', ''), nullif(v_item->>'notes', ''), '');
    if jsonb_array_length(v_addons) > 0 then
      select string_agg('+ ' || (a->>'name'), ', ') into v_addon_note from jsonb_array_elements(v_addons) a;
      v_note := concat_ws(' · ', nullif(v_note, ''), v_addon_note);
    end if;

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
      'variantName', v_vname,
      'addOns',      v_addons);
  end loop;

  if v_type <> 'dining' and v_min > 0 and v_subtotal < v_min then
    raise exception 'minimum order is Rs %', v_min using errcode = '22023';
  end if;

  if v_type = 'delivery' then
    v_dcharge := case when v_dfree > 0 and v_subtotal >= v_dfree then 0 else v_dbase end;
  end if;

  v_pcode := nullif(btrim(coalesce(p_order->>'promoCode', '')), '');
  if v_pcode is not null then
    if nullif(p_order->>'customerToken', '') is not null then
      v_cust := public.customer_from_token(p_order->>'customerToken');
      if v_cust.id is not null and v_cust.tenant_id is distinct from p_tenant then v_cust := null; end if;
    end if;
    v_promo := public._promo_check(p_tenant, v_pcode, v_subtotal, v_cust.id, true);
    if coalesce((v_promo->>'ok')::boolean, false) is not true then
      raise exception 'promo code not valid: %', coalesce(v_promo->>'reason', 'unknown') using errcode = '22023';
    end if;
    v_discount := (v_promo->>'discount')::numeric;
    update promo_codes set usage_count = coalesce(usage_count, 0) + 1 where id = (v_promo->>'id')::uuid;
  end if;

  v_grand := greatest(v_subtotal - v_discount, 0) + v_dcharge;

  update orders
     set subtotal    = v_subtotal,
         discount    = v_discount,
         grand_total = v_grand,
         total       = v_grand,
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
           'discount',    v_discount,
           'tax',         0,
           'deliveryCharge', v_dcharge,
           'promoCode',   case when v_discount > 0 or v_pcode is not null then upper(v_pcode) end,
           'promoCodeDiscount', v_discount,
           'grandTotal',  v_grand,
           'customer',    coalesce(p_order->'customer', '{}'::jsonb),
           'delivery',    coalesce(p_order->'delivery', '{}'::jsonb),
           'notes',       coalesce(nullif(p_order->>'notes', ''), ''),
           'createdAt',   to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           '_updatedAt',  (extract(epoch from v_now) * 1000)::bigint)
   where id = v_order_id;

  return jsonb_build_object(
    'id', v_order_id, 'order_number', v_number,
    'subtotal', v_subtotal, 'discount', v_discount, 'delivery_charge', v_dcharge, 'grand_total', v_grand,
    'order', (select to_jsonb(o) from orders o where o.id = v_order_id));
end
$function$;
