-- ============================================================================
-- v1.27.0 — an order now finds its customer profile
--
-- orders.customer_id has existed all along and was never populated by the
-- customer-facing paths: public_place_order() writes customer_snapshot and
-- stops there. So a customer who ordered five times had five orders and no
-- profile, no history to show them in the app, and nothing for the restaurant's
-- CRM to grade.
--
-- ===== WHY A TRIGGER, NOT A CHANGE TO public_place_order() =====
-- The website is not the only door. QR dine-in, the order-taker portal and the
-- POS itself all write orders with a customer_snapshot. Putting the link in one
-- writer would fix one door and quietly leave the others; a trigger covers
-- every path, including any added later, without touching a line of the
-- existing order logic.
--
-- ===== WHAT IT DELIBERATELY DOES NOT DO =====
-- It does not touch total_orders, total_spent, avg_order_value or grade. Those
-- are DERIVED from the order list in src/lib/customers.ts, and writing them
-- here would put two sources of truth in disagreement. Linking the order is
-- precisely what makes that derivation correct.
--
-- ===== IT CAN NEVER FAIL AN ORDER =====
-- Taking the bill is the one thing a POS must always be able to do. Every
-- failure path returns NEW unchanged, so a malformed snapshot costs the link,
-- never the sale.
-- ============================================================================

create or replace function public.link_order_customer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_snap   jsonb := coalesce(new.customer_snapshot, '{}'::jsonb);
  v_phone  text;
  v_digits text;
  v_name   text;
  v_addr   text;
  v_city   text;
  v_lat    double precision;
  v_lng    double precision;
  v_id     uuid;
  v_at     timestamptz := coalesce(new.created_at, now());
begin
  if new.customer_id is not null then return new; end if;

  v_phone := nullif(btrim(coalesce(v_snap->>'phone', '')), '');
  if v_phone is null then return new; end if;

  -- Match on digits only. The POS, the website and the order taker each format
  -- a number differently, and matching literally would mint a second profile
  -- for the same person on their next order.
  v_digits := regexp_replace(v_phone, '\D', '', 'g');
  if length(v_digits) < 7 then return new; end if;

  v_name := nullif(btrim(coalesce(v_snap->>'name', '')), '');
  v_addr := nullif(btrim(coalesce(v_snap->>'address', '')), '');
  v_city := nullif(btrim(coalesce(v_snap->>'city', '')), '');
  -- A snapshot is client-supplied; a non-numeric lat must not raise.
  begin v_lat := (v_snap->>'lat')::double precision; exception when others then v_lat := null; end;
  begin v_lng := (v_snap->>'lng')::double precision; exception when others then v_lng := null; end;

  select id into v_id
    from customers
   where tenant_id = new.tenant_id
     and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_digits
     and deleted_at is null
   order by created_at
   limit 1;

  if v_id is null then
    insert into customers (tenant_id, name, phone, address, city, lat, lng,
                           location_captured_at, last_order_at)
    values (new.tenant_id, v_name, v_phone, v_addr, v_city, v_lat, v_lng,
            case when v_lat is not null then v_at end, v_at)
    on conflict (tenant_id, phone) do update set updated_at = now()
    returning id into v_id;
  else
    -- Fill blanks only. A restaurant that has corrected a customer's name or
    -- address must not have it overwritten by whatever they typed this time.
    update customers c
       set name    = coalesce(nullif(btrim(coalesce(c.name, '')), ''), v_name),
           address = coalesce(nullif(btrim(coalesce(c.address, '')), ''), v_addr),
           city    = coalesce(nullif(btrim(coalesce(c.city, '')), ''), v_city),
           -- Location is the exception: a newer fix is better than an older one.
           lat     = coalesce(v_lat, c.lat),
           lng     = coalesce(v_lng, c.lng),
           location_captured_at = case when v_lat is not null then v_at
                                       else c.location_captured_at end,
           last_order_at = greatest(coalesce(c.last_order_at, v_at), v_at),
           updated_at = now()
     where c.id = v_id;
  end if;

  new.customer_id := v_id;
  return new;
exception when others then
  -- Never cost the restaurant a sale over a profile link.
  return new;
end $$;

drop trigger if exists trg_link_order_customer on public.orders;
create trigger trg_link_order_customer
  before insert or update of customer_snapshot on public.orders
  for each row execute function public.link_order_customer();

comment on function public.link_order_customer() is
  'Attaches an order to its customer profile, creating one from customer_snapshot if needed. Covers every order source. Never raises: a bad snapshot costs the link, not the sale.';
