-- v1.107.0 — Custom Website (docs/MASTER-PLAN-2026-11-02.md §5): a restaurant's OWN website sends its orders here.
-- ADDITIVE: two new tables and one new function. No existing table, column, policy or function is changed.
--
--  custom_site_intake  one row per restaurant: mode, the site's addresses, the intake secret (HMAC key) and its health.
--                      The secret is needed in clear text to verify a signature, so the table is closed to the API
--                      (RLS on, no policy, no grants except service_role) and the secret is never sent back to a browser.
--  custom_site_orders  idempotency ledger: one row per (restaurant, key) so a repeated request is accepted once.
--  custom_site_place_order()  like public_place_order(), plus: a line is matched by menuItemId, then SKU/barcode, then
--                      exact name; a line that matches nothing is kept as a CUSTOM line with the site's own name and price
--                      (a sale is never lost) and reported back so it can be matched later; the site's delivery fee and
--                      discount are carried into the total. Callable by service_role only (the intake endpoint).
-- Rollback: docs/rollback/2026-11-05-v1_107_0-rollback.sql (drop the two tables and the function).

create table if not exists public.custom_site_intake (
  tenant_id      uuid primary key references public.tenants(id) on delete cascade,
  mode           text not null default 'builtin' check (mode in ('builtin', 'own', 'both')),
  site_url       text,
  admin_url      text,
  secret         text,
  secret_hint    text,
  key_created_at timestamptz,
  last_order_at  timestamptz,
  last_error     text,
  last_error_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.custom_site_orders (
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  idempotency_key text not null,
  order_id        uuid,
  order_number    integer,
  unmatched       jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  primary key (tenant_id, idempotency_key)
);
create index if not exists custom_site_orders_recent_idx on public.custom_site_orders (tenant_id, created_at desc);

alter table public.custom_site_intake enable row level security;
alter table public.custom_site_orders enable row level security;
revoke all on public.custom_site_intake from public, anon, authenticated;
revoke all on public.custom_site_orders from public, anon, authenticated;
grant all on public.custom_site_intake to service_role;
grant all on public.custom_site_orders to service_role;
comment on table public.custom_site_intake is 'Own-website connection per restaurant. Holds the HMAC secret: RLS on, no policy; only the server (service_role) reads it.';
comment on table public.custom_site_orders is 'Idempotency ledger for orders posted by a restaurant''s own website. RLS on, no policy.';

create or replace function public.custom_site_place_order(p_tenant uuid, p_branch uuid, p_order jsonb)
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
  v_found    boolean;
  v_qty      numeric;
  v_price    numeric;
  v_name     text;
  v_key      text;
  v_note     text;
  v_subtotal numeric := 0;
  v_line     numeric;
  v_line_no  integer := 0;
  v_line_id  uuid;
  v_type     text;
  v_table    text;
  v_lines    jsonb := '[]'::jsonb;
  v_unmatched jsonb := '[]'::jsonb;
  v_now      timestamptz := now();
  v_fee      numeric;
  v_disc     numeric;
  v_total    numeric;
  v_customer jsonb;
  v_delivery jsonb;
  v_ref      text;
begin
  if not exists (select 1 from tenants where id = p_tenant and is_active) then
    raise exception 'restaurant not available' using errcode = '42501';
  end if;
  if jsonb_typeof(p_order->'items') <> 'array'
     or jsonb_array_length(p_order->'items') = 0
     or jsonb_array_length(p_order->'items') > 100 then
    raise exception 'order must have between 1 and 100 items' using errcode = '22023';
  end if;

  v_type  := case p_order->>'orderType'
               when 'delivery' then 'delivery'
               when 'dining'   then 'dining'
               else 'takeaway' end;
  v_table := left(nullif(p_order->>'tableLabel', ''), 100);
  v_ref   := left(nullif(p_order->>'externalRef', ''), 120);
  v_customer := case when jsonb_typeof(p_order->'customer') = 'object' then p_order->'customer' else '{}'::jsonb end;
  v_delivery := case when jsonb_typeof(p_order->'delivery') = 'object' then p_order->'delivery' else '{}'::jsonb end;

  if v_branch is null then
    select id into v_branch from branches where tenant_id = p_tenant order by sort_order limit 1;
  end if;
  if v_branch is null
     or not exists (select 1 from branches where id = v_branch and tenant_id = p_tenant) then
    raise exception 'branch not valid for this restaurant' using errcode = '22023';
  end if;

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
    v_type, 'running', 'website',
    v_table, v_customer, v_delivery,
    left(nullif(p_order->>'notes', ''), 500),
    0, 0, 0, 0, 0, 0, v_now, v_now);

  for v_item in select * from jsonb_array_elements(p_order->'items') loop
    v_found := false;

    -- 1) by the software's own item id
    begin
      select m.id, m.name, m.price, m.category_id, m.kitchen_id into v_menu
        from menu_items m
       where m.tenant_id = p_tenant and m.id = (v_item->>'menuItemId')::uuid
         and m.is_active and m.deleted_at is null;
      v_found := found;
    exception when others then v_found := false;
    end;
    -- 2) by SKU / barcode (the site's product code)
    v_key := nullif(btrim(coalesce(v_item->>'sku', v_item->>'code', '')), '');
    if not v_found and v_key is not null then
      select m.id, m.name, m.price, m.category_id, m.kitchen_id into v_menu
        from menu_items m
       where m.tenant_id = p_tenant and (m.sku = v_key or m.barcode = v_key)
         and m.is_active and m.deleted_at is null
       order by m.id limit 1;
      v_found := found;
    end if;
    -- 3) by exact name
    v_name := nullif(btrim(coalesce(v_item->>'name', '')), '');
    if not v_found and v_name is not null then
      select m.id, m.name, m.price, m.category_id, m.kitchen_id into v_menu
        from menu_items m
       where m.tenant_id = p_tenant and lower(btrim(m.name)) = lower(v_name)
         and m.is_active and m.deleted_at is null
       order by m.id limit 1;
      v_found := found;
    end if;

    begin
      v_qty := least(greatest(coalesce((v_item->>'quantity')::numeric, (v_item->>'qty')::numeric, 1), 1), 999);
    exception when others then v_qty := 1;
    end;
    begin
      v_price := (v_item->>'price')::numeric;
    exception when others then v_price := null;
    end;
    if v_price is not null and (v_price < 0 or v_price > 10000000) then v_price := null; end if;
    v_note := left(coalesce(nullif(v_item->>'note', ''), ''), 200);

    if v_found then
      v_price := coalesce(v_price, v_menu.price);
      v_name  := v_menu.name;
    else
      if v_name is null then
        raise exception 'every line needs a name' using errcode = '22023';
      end if;
      if v_price is null then
        raise exception 'line "%" is not on the menu, so it needs a price', left(v_name, 60) using errcode = '22023';
      end if;
      v_name := left(v_name, 120);
      v_unmatched := v_unmatched || jsonb_build_object('name', v_name, 'quantity', v_qty, 'price', v_price);
    end if;

    v_line     := v_price * v_qty;
    v_subtotal := v_subtotal + v_line;
    v_line_no  := v_line_no + 1;
    v_line_id  := gen_random_uuid();

    insert into order_items (
      id, tenant_id, branch_id, order_id, menu_item_id, name,
      category_id, kitchen_id, pricing_type, unit_price, quantity, line_total, note, line_no)
    values (
      v_line_id, p_tenant, v_branch, v_order_id,
      case when v_found then v_menu.id end, v_name,
      case when v_found then v_menu.category_id end,
      case when v_found then v_menu.kitchen_id end,
      'fixed', v_price, v_qty, v_line, v_note, v_line_no);

    v_lines := v_lines || jsonb_strip_nulls(jsonb_build_object(
      'id',          v_line_id,
      'menuItemId',  case when v_found then v_menu.id end,
      'name',        v_name,
      'pricingType', 'fixed',
      'price',       v_price,
      'quantity',    v_qty,
      'lineTotal',   v_line,
      'note',        v_note,
      'categoryId',  case when v_found then v_menu.category_id end,
      'kitchenId',   case when v_found then v_menu.kitchen_id end,
      'custom',      case when v_found then null else true end));
  end loop;

  begin v_fee := least(greatest(coalesce((p_order->>'deliveryFee')::numeric, 0), 0), 1000000);
  exception when others then v_fee := 0; end;
  begin v_disc := least(greatest(coalesce((p_order->>'discount')::numeric, 0), 0), v_subtotal);
  exception when others then v_disc := 0; end;
  v_total := v_subtotal + v_fee - v_disc;

  update orders
     set subtotal    = v_subtotal,
         discount    = v_disc,
         grand_total = v_total,
         total       = v_total,
         updated_at  = v_now,
         client_seq  = (extract(epoch from v_now) * 1000)::bigint,
         data = jsonb_strip_nulls(jsonb_build_object(
           'id',          v_order_id,
           'orderNumber', v_number,
           'orderType',   v_type,
           'status',      'running',
           'source',      'website',
           'ownWebsite',  true,
           'externalRef', v_ref,
           'tableLabel',  v_table,
           'branchId',    v_branch,
           'items',       v_lines,
           'payments',    '[]'::jsonb,
           'subtotal',    v_subtotal,
           'discount',    v_disc,
           'tax',         0,
           'deliveryChargeAmount', nullif(v_fee, 0),
           'grandTotal',  v_total,
           'paymentMethod', left(nullif(p_order->>'paymentMethod', ''), 40),
           'customer',    v_customer,
           'delivery',    v_delivery,
           'notes',       coalesce(left(nullif(p_order->>'notes', ''), 500), ''),
           'unmatchedLines', case when jsonb_array_length(v_unmatched) > 0 then v_unmatched end,
           'createdAt',   to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           '_updatedAt',  (extract(epoch from v_now) * 1000)::bigint))
   where id = v_order_id;

  return jsonb_build_object(
    'id', v_order_id, 'order_number', v_number, 'total', v_total, 'unmatched', v_unmatched);
end
$function$;

revoke all on function public.custom_site_place_order(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.custom_site_place_order(uuid, uuid, jsonb) to service_role;
