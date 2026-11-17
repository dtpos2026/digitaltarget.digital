-- v1.115.0 — the server now owns a website order's money.
--
-- FOUND: public_place_order priced the items correctly but wrote discount 0 and no delivery charge, and ignored the promo code the page
-- sent; the page showed the customer a discount and a delivery fee that the restaurant's till never saw (the order arrived at the bare
-- subtotal), a code's use was counted only in the visitor's own browser (so a usage limit could never hold), the minimum order and the
-- "accounts only" rule (v1.113.0) were checked only on the page, and the bill number came from a counter that only ever went up by one
-- (it could fall behind a till that numbered locally, and the unique index then refused the website order).
--
-- Additive and replaceable: one new column (promo_codes.show_on_website, default false = nothing becomes public), three helper / public
-- functions, and public_place_order replaced in place (same name, same arguments, same first four answers; it now also answers the totals).
-- Rollback: docs/rollback/2026-11-17-v1_115_0-server-side-promo-before.sql
alter table public.promo_codes
  add column if not exists show_on_website boolean not null default false;
comment on column public.promo_codes.show_on_website is 'v1.115.0 — list this code on the ordering site''s Offers page (public_offers). Off by default: a code is never public unless the owner says so.';

-- ---------------------------------------------------------------- one rule for a promo code (internal: not callable by the public)
create or replace function public._promo_check(p_tenant uuid, p_code text, p_subtotal numeric, p_customer uuid, p_lock boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r public.promo_codes;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_disc numeric;
begin
  if v_code = '' then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  if p_lock then
    select * into r from public.promo_codes where tenant_id = p_tenant and upper(code) = v_code and deleted_at is null for update;
  else
    select * into r from public.promo_codes where tenant_id = p_tenant and upper(code) = v_code and deleted_at is null;
  end if;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not r.is_active then return jsonb_build_object('ok', false, 'reason', 'inactive'); end if;
  if r.valid_from is not null and r.valid_from > now() then return jsonb_build_object('ok', false, 'reason', 'not_started'); end if;
  if r.valid_until is not null and r.valid_until + interval '1 day' < now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if r.max_uses is not null and r.max_uses > 0 and coalesce(r.usage_count, r.used_count, 0) >= r.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'limit_reached');
  end if;
  if r.accounts_only and p_customer is null then return jsonb_build_object('ok', false, 'reason', 'account_required'); end if;
  if r.min_order_amount is not null and r.min_order_amount > 0 and coalesce(p_subtotal, 0) < r.min_order_amount then
    return jsonb_build_object('ok', false, 'reason', 'min_order', 'minOrder', r.min_order_amount);
  end if;
  v_disc := case when r.discount_type = 'percent'
                 then round(coalesce(p_subtotal, 0) * r.discount_value / 100)
                 else least(coalesce(p_subtotal, 0), r.discount_value) end;
  return jsonb_build_object('ok', true, 'id', r.id, 'code', r.code, 'discount', greatest(v_disc, 0),
                            'type', r.discount_type, 'value', r.discount_value);
end $function$;
revoke all on function public._promo_check(uuid, text, numeric, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- the customer's cart asks "is this code good, and what does it take off?"
create or replace function public.public_check_promo(p_tenant uuid, p_code text, p_subtotal numeric, p_token text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_cust public.customers;
begin
  if not exists (select 1 from public.tenants where id = p_tenant and is_active) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if p_token is not null then
    v_cust := public.customer_from_token(p_token);
    if v_cust.id is not null and v_cust.tenant_id is distinct from p_tenant then v_cust := null; end if;
  end if;
  return public._promo_check(p_tenant, p_code, p_subtotal, v_cust.id, false);
end $function$;
revoke all on function public.public_check_promo(uuid, text, numeric, text) from public;
grant execute on function public.public_check_promo(uuid, text, numeric, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- the Offers page: only what the owner chose to show
create or replace function public.public_offers(p_tenant uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.tenants where id = p_tenant and is_active) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true,
    'codes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', c.code, 'discountType', case when c.discount_type = 'percent' then 'percent' else 'pkr' end,
               'discountValue', c.discount_value, 'minOrder', c.min_order_amount,
               'validUntil', c.valid_until, 'accountsOnly', c.accounts_only, 'notes', c.notes)
             order by c.created_at desc)
        from public.promo_codes c
       where c.tenant_id = p_tenant and c.deleted_at is null and c.is_active and c.show_on_website
         and (c.valid_from is null or c.valid_from <= now())
         and (c.valid_until is null or c.valid_until + interval '1 day' >= now())
         and (c.max_uses is null or c.max_uses <= 0 or coalesce(c.usage_count, c.used_count, 0) < c.max_uses)), '[]'::jsonb),
    'deals', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'price', d.price, 'items', d.items, 'image', d.image_path)
             order by d.created_at desc)
        from public.deals d
       where d.tenant_id = p_tenant and d.deleted_at is null and d.is_active), '[]'::jsonb));
end $function$;
revoke all on function public.public_offers(uuid) from public;
grant execute on function public.public_offers(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- a website order, priced by the server
create or replace function public.public_place_order(p_tenant uuid, p_branch uuid, p_order jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
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

  -- the restaurant's own rules for delivery and a minimum order (the owner's Settings document)
  select ts.settings into v_settings from tenant_settings ts where ts.tenant_id = p_tenant limit 1;
  v_settings := coalesce(v_settings, '{}'::jsonb);
  begin v_min   := greatest(coalesce((v_settings->>'minOnlineOrder')::numeric, 0), 0);          exception when others then v_min := 0; end;
  begin v_dbase := greatest(coalesce((v_settings->>'deliveryCharge')::numeric, 0), 0);          exception when others then v_dbase := 0; end;
  begin v_dfree := greatest(coalesce((v_settings->>'freeDeliveryThreshold')::numeric, 0), 0);   exception when others then v_dfree := 0; end;

  -- the bill number: never behind anything already issued for this branch (a till that numbered locally may be ahead)
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

  -- the minimum order (not for a table: a guest at a table is already seated)
  if v_type <> 'dining' and v_min > 0 and v_subtotal < v_min then
    raise exception 'minimum order is Rs %', v_min using errcode = '22023';
  end if;

  -- the delivery charge: free above the restaurant's threshold, judged on the bill before any discount (the page's own rule)
  if v_type = 'delivery' then
    v_dcharge := case when v_dfree > 0 and v_subtotal >= v_dfree then 0 else v_dbase end;
  end if;

  -- the promo code: re-checked here, and its use counted here, in the same transaction as the order
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
