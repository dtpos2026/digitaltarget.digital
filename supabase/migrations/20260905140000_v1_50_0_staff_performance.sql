-- ============================================================================
-- v1.50.0 — a real performance profile for the Order Taker and the Rider
--
-- REQUESTED: "Order Taker ne X orders kiye aur total sales PKR X", and for the
-- rider "Total Deliveries 35, Completed 30, Pending 3, Cancelled 2, Earnings".
-- Explicitly: from the actual database, not dummy statistics.
--
-- Everything below is computed from public.orders at query time. Nothing is
-- stored, so nothing can drift from the bills, and a reinstall cannot reset it.
--
-- Two things had to be fixed first for these numbers to be true at all:
--
--   1. The money mirror (v1.49.0) — grand_total was 0 on orders the Order
--      Taker wrote, so "total sales" would have counted them as nothing.
--   2. rider_id, below. The column is empty on every row in the database while
--      the DOCUMENT carries a rider on 68 of them, so anything reading the
--      column — the live rider map, any rider report — sees no rider at all.
--      Same fault as the money columns, same fix: derive it from the document.
--
--      Guarded by a uuid regex, because 43 of those documents hold a riderId
--      that is not uuid-shaped (mostly an empty string) and an unguarded cast
--      would raise inside the trigger and block EVERY order write. The item
--      mirror in v1.34.0 hit this exact trap.
-- ============================================================================

create or replace function public.sync_order_money_mirror()
returns trigger
language plpgsql
as $function$
declare d jsonb := new.data;
begin
  if d is null or jsonb_typeof(d) <> 'object' then return new; end if;

  if d ? 'orderType'     then new.order_type     := nullif(d->>'orderType',''); end if;
  if d ? 'subtotal'      then new.subtotal       := coalesce((d->>'subtotal')::numeric,      new.subtotal); end if;
  if d ? 'discount'      then new.discount       := coalesce((d->>'discount')::numeric,      new.discount); end if;
  if d ? 'tax'           then new.tax            := coalesce((d->>'tax')::numeric,           new.tax); end if;
  if d ? 'serviceCharge' then new.service_charge := coalesce((d->>'serviceCharge')::numeric, new.service_charge); end if;
  if d ? 'grandTotal'    then new.grand_total    := coalesce((d->>'grandTotal')::numeric,    new.grand_total); end if;
  if d ? 'amountPaid'    then new.amount_paid    := coalesce((d->>'amountPaid')::numeric,    new.amount_paid); end if;
  if d ? 'paymentMethod' then new.payment_method := nullif(d->>'paymentMethod',''); end if;

  -- v1.50.0 — who delivered it. The regex is load-bearing: a document with
  -- riderId "" or a pre-uuid id must leave the column alone, not raise.
  if d ? 'riderId' then
    if d->>'riderId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      new.rider_id := (d->>'riderId')::uuid;
    elsif coalesce(btrim(d->>'riderId'), '') = '' then
      new.rider_id := null;
    end if;
  end if;
  if d ? 'riderName' then new.rider_name := nullif(btrim(d->>'riderName'), ''); end if;

  return new;
end
$function$;

-- Repair the rows whose rider is in the document but not in the column.
do $$
declare n int;
begin
  update public.orders set data = data
   where deleted_at is null
     and rider_id is null
     and data->>'riderId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  get diagnostics n = row_count;
  raise notice 'rider mirror: % row(s) repaired', n;
end $$;

-- ---------------------------------------------------------------------------
-- The staff member's own numbers.
--
-- Scoped by the TOKEN: a staff member sees their own work and nobody else's,
-- and there is no user parameter, so one cannot be supplied. An order taker
-- cannot read a colleague's sales, and neither can read another restaurant's.
-- ---------------------------------------------------------------------------
create or replace function public.portal_my_stats(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  s public.staff_portal_sessions := portal_identity(p_token);
  v_today date;
  r jsonb;
begin
  if s.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  -- The restaurant's own day, not the server's.
  v_today := (now() at time zone coalesce(
    (select nullif(ts.settings->>'timezone','') from public.tenant_settings ts
      where ts.tenant_id = s.tenant_id
      order by (ts.branch_id = s.branch_id) desc limit 1),
    'Asia/Karachi'))::date;

  if s.role = 'rider' then
    select jsonb_build_object(
      'ok', true, 'role', 'rider',
      'assigned',  count(*),
      'delivered', count(*) filter (where o.status = 'paid'),
      'pending',   count(*) filter (where o.status in ('running','hold')),
      'cancelled', count(*) filter (where o.status in ('cancelled','void')),
      'earnings',  coalesce(sum(o.grand_total) filter (where o.status = 'paid'), 0),
      'todayDelivered', count(*) filter (
        where o.status = 'paid'
          and (o.created_at at time zone 'Asia/Karachi')::date = v_today),
      'todayEarnings', coalesce(sum(o.grand_total) filter (
        where o.status = 'paid'
          and (o.created_at at time zone 'Asia/Karachi')::date = v_today), 0)
    ) into r
    from public.orders o
    where o.tenant_id = s.tenant_id
      and o.deleted_at is null
      and o.rider_id = s.user_id;
  else
    select jsonb_build_object(
      'ok', true, 'role', s.role,
      'taken',     count(*),
      'completed', count(*) filter (where o.status = 'paid'),
      'pending',   count(*) filter (where o.status in ('running','hold')),
      'cancelled', count(*) filter (where o.status in ('cancelled','void')),
      'dining',    count(*) filter (where o.order_type = 'dining'),
      'takeaway',  count(*) filter (where o.order_type = 'takeaway'),
      'delivery',  count(*) filter (where o.order_type = 'delivery'),
      'sales',     coalesce(sum(o.grand_total) filter (where o.status = 'paid'), 0),
      'todayTaken', count(*) filter (
        where (o.created_at at time zone 'Asia/Karachi')::date = v_today),
      'todaySales', coalesce(sum(o.grand_total) filter (
        where o.status = 'paid'
          and (o.created_at at time zone 'Asia/Karachi')::date = v_today), 0)
    ) into r
    from public.orders o
    where o.tenant_id = s.tenant_id
      and o.deleted_at is null
      and o.data->>'takenByUserId' = s.user_id::text;
  end if;

  return coalesce(r, jsonb_build_object('ok', true, 'role', s.role));
end
$function$;

revoke all on function public.portal_my_stats(text) from public;
grant execute on function public.portal_my_stats(text) to anon, authenticated, service_role;
