-- ============================================================================
-- v1.34.0-.5 — order_items was only ever filled for a third of the business
--
-- Measured live BEFORE:
--     orders WITH order_items ....... website 25, qr 7
--     orders WITHOUT ................ pos 228, order_taker 1
--
-- public_place_order fans the items out; the POS sync path never did. So any
-- SQL or BI report written against order_items — item sales, category sales,
-- best sellers, recipe costing — saw about 12% of the trade. The in-app reports
-- were never wrong (salesReport.ts reads the order document); the normalised
-- mirror was a trap for anything else.
--
-- Fixed in the DATABASE, not the POS client, so EVERY source is covered at
-- once — POS, order taker, website, QR, and anything added later — with no
-- client release and no chance of one writer being forgotten again.
--
-- Idempotent by construction: the mirror is rebuilt from the document, so
-- re-saving a bill (running -> paid) cannot duplicate a line. Verified on one
-- order: 0 -> 2 rows, then 2 -> 2 -> 2 across three more saves, mirror total
-- 1299.00 against subtotal 1299.00.
--
-- TWO THINGS FOUND BY RUNNING THE BACKFILL, both fixed here:
--   * some historical lines point at a menu item that has since been DELETED
--       ERROR: violates order_items_menu_item_id_fkey
--   * some carry a PRE-UUID local id
--       ERROR: invalid input syntax for type uuid: "mqpmxvdhsze60v"
-- Both now drop the link and keep the line. The name, price and total live on
-- the row, so a report loses nothing — the same reasoning ensure_menu_item_
-- parents already uses for a stale inventory link.
--
-- Without those two guards the trigger would still have "worked": its exception
-- handler would have swallowed the error and the mirror would silently never
-- have filled for exactly the orders with an older menu.
-- ============================================================================

create or replace function public.sync_order_items_mirror()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_items jsonb := coalesce(new.data->'items', '[]'::jsonb);
  v_seq bigint := coalesce(new.client_seq, 0);
begin
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    return new;
  end if;

  delete from public.order_items where order_id = new.id;

  insert into public.order_items (
    id, tenant_id, branch_id, order_id, menu_item_id, name,
    category_id, category_name, kitchen_id, station, pricing_type,
    unit_price, quantity, weight_grams, line_total,
    variant_type, variant_name, note, printed_qty, refunded_qty,
    line_no, data, client_seq, updated_at)
  select
    gen_random_uuid(), new.tenant_id, new.branch_id, new.id,
    case when it->>'menuItemId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then (select m.id from public.menu_items m
                where m.id = (it->>'menuItemId')::uuid and m.tenant_id = new.tenant_id) end,
    nullif(it->>'name', ''),
    case when it->>'categoryId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then (select c.id from public.categories c
                where c.id = (it->>'categoryId')::uuid and c.tenant_id = new.tenant_id) end,
    nullif(it->>'categoryName', ''),
    case when it->>'kitchenId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then (select k.id from public.kitchens k
                where k.id = (it->>'kitchenId')::uuid and k.tenant_id = new.tenant_id) end,
    nullif(it->>'station', ''),
    nullif(it->>'pricingType', ''),
    coalesce(nullif(it->>'unitPrice','')::numeric, nullif(it->>'price','')::numeric),
    coalesce(nullif(it->>'quantity','')::numeric, 0),
    nullif(it->>'weightGrams','')::numeric,
    coalesce(nullif(it->>'lineTotal','')::numeric, 0),
    nullif(it->>'variantType', ''),
    nullif(it->>'variantName', ''),
    nullif(it->>'note', ''),
    coalesce(nullif(it->>'printedQty','')::numeric, 0),
    coalesce(nullif(it->>'refundedQty','')::numeric, 0),
    (ord - 1)::int, it, v_seq, now()
  from jsonb_array_elements(v_items) with ordinality as t(it, ord);

  return new;
exception
  when others then
    raise warning 'order_items mirror failed for order %: %', new.id, sqlerrm;
    return new;
end $function$;

drop trigger if exists trg_sync_order_items_mirror on public.orders;
create trigger trg_sync_order_items_mirror
  after insert or update of data on public.orders
  for each row execute function public.sync_order_items_mirror();

-- Backfill. Derived data only: every value comes from the order's OWN document.
-- orders.updated_at is deliberately NOT bumped — that would look like 228 edits
-- to every till and start a resync storm for nothing.
insert into public.order_items (
  id, tenant_id, branch_id, order_id, menu_item_id, name,
  category_id, category_name, kitchen_id, station, pricing_type,
  unit_price, quantity, weight_grams, line_total,
  variant_type, variant_name, note, printed_qty, refunded_qty,
  line_no, data, client_seq, updated_at)
select
  gen_random_uuid(), o.tenant_id, o.branch_id, o.id,
  case when it->>'menuItemId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       then (select m.id from public.menu_items m
              where m.id = (it->>'menuItemId')::uuid and m.tenant_id = o.tenant_id) end,
  nullif(it->>'name', ''),
  case when it->>'categoryId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       then (select c.id from public.categories c
              where c.id = (it->>'categoryId')::uuid and c.tenant_id = o.tenant_id) end,
  nullif(it->>'categoryName', ''),
  case when it->>'kitchenId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       then (select k.id from public.kitchens k
              where k.id = (it->>'kitchenId')::uuid and k.tenant_id = o.tenant_id) end,
  nullif(it->>'station', ''),
  nullif(it->>'pricingType', ''),
  coalesce(nullif(it->>'unitPrice','')::numeric, nullif(it->>'price','')::numeric),
  coalesce(nullif(it->>'quantity','')::numeric, 0),
  nullif(it->>'weightGrams','')::numeric,
  coalesce(nullif(it->>'lineTotal','')::numeric, 0),
  nullif(it->>'variantType', ''),
  nullif(it->>'variantName', ''),
  nullif(it->>'note', ''),
  coalesce(nullif(it->>'printedQty','')::numeric, 0),
  coalesce(nullif(it->>'refundedQty','')::numeric, 0),
  (ord - 1)::int, it, coalesce(o.client_seq, 0), now()
from public.orders o
cross join lateral jsonb_array_elements(o.data->'items') with ordinality as t(it, ord)
where jsonb_typeof(o.data->'items') = 'array'
  and jsonb_array_length(o.data->'items') > 0
  and not exists (select 1 from public.order_items i where i.order_id = o.id);

-- AFTER: pos=234, website=25, qr=7, order_taker=2; 632 line items; and zero
-- orders where the mirror disagrees with the bill's own subtotal.

-- The weekly cleanup recycle_bin_purge was written for in v1.29.3 and which
-- NOTHING had ever called: pg_cron was not installed, so the retention the
-- recycle bin promised was never enforced. Safe to schedule only because
-- v1.33.0 taught the purge to refuse the books — scheduling it before that
-- would have destroyed 23 real bills on its first run.
create extension if not exists pg_cron with schema pg_catalog;
select cron.unschedule(jobid) from cron.job where jobname = 'recycle-bin-weekly-purge';
select cron.schedule('recycle-bin-weekly-purge', '17 3 * * 0',
                     $cron$select public.recycle_bin_purge(7)$cron$);
