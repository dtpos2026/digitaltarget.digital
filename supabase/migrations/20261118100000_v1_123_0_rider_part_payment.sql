-- v1.123.0 — a rider can take LESS than what is due at the door.
--
-- portal_order_delivery(…, 'delivered') used to book the whole amount still due as a payment "by the rider" and mark the bill paid, whatever the
-- customer really handed over. A new optional argument p_cash says how much the rider actually took:
--   • p_cash omitted (null)  → exactly what it did before: the whole amount due is booked and the bill is paid;
--   • 0 <= p_cash < due      → only p_cash is booked (nothing when 0), the bill becomes 'partial' (not paid), the rest stays due and shows in
--                              Pending Payments; the rider's cash-to-hand-over (portal_my_history) is what was really taken;
--   • p_cash > due, or < 0   → refused ('amount_too_high' / 'bad_amount'), nothing is changed.
-- A credit bill or a complimentary bill books nothing, as before. Everything else in the function is unchanged.
-- The argument list changes, so the old four-argument function is dropped in the same transaction (two overloads would make a call without
-- p_cash ambiguous) and the same grants are given to the new one.
-- Rollback: docs/rollback/2026-11-18-v1_123_0-rider-part-payment-before.sql
drop function if exists public.portal_order_delivery(text, uuid, text, boolean);

create or replace function public.portal_order_delivery(p_token text, p_order uuid, p_stage text, p_claim boolean default false, p_cash numeric default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid; v_tenant uuid; v_role text; v_name text; v_phone text; o record; n int;
  v_now   timestamptz := now();
  v_ms    bigint := (extract(epoch from now()) * 1000)::bigint;
  v_iso   text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_total numeric; v_paid numeric; v_due numeric; v_method text;
  v_pays  jsonb;
  v_extra jsonb := '{}'::jsonb;
  v_take  numeric := 0;
  v_status text := 'paid';
begin
  select user_id, tenant_id, role into v_id, v_tenant, v_role
  from public.portal_identity(p_token);
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if v_role not in ('rider','order_taker') then
    return jsonb_build_object('ok', false, 'reason', 'wrong_role');
  end if;
  if p_stage is null or p_stage !~ '^[a-z_]{3,32}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_stage');
  end if;

  select display_name, phone into v_name, v_phone
  from public.user_profiles where user_id = v_id;

  select * into o from public.orders
   where id = p_order and tenant_id = v_tenant and deleted_at is null
   for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_order'); end if;

  if p_claim and coalesce(o.data->>'riderId','') not in ('', v_id::text) then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end if;
  if not p_claim and coalesce(o.data->>'riderId','') <> v_id::text then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;

  if p_stage = 'delivered' then
    v_pays := case when jsonb_typeof(o.data->'payments') = 'array' then o.data->'payments' else '[]'::jsonb end;
    select coalesce(sum(case when jsonb_typeof(pm->'amount') = 'number' then (pm->>'amount')::numeric else 0 end), 0)
      into v_paid from jsonb_array_elements(v_pays) pm;
    v_total := coalesce(case when jsonb_typeof(o.data->'grandTotal') = 'number' then (o.data->>'grandTotal')::numeric end,
                        nullif(o.grand_total, 0), nullif(o.total, 0), 0);
    v_due    := greatest(v_total - v_paid, 0);
    v_method := coalesce(nullif(o.data->>'paymentMethod', ''), 'cash');
    if p_cash is not null then
      if p_cash < 0 then return jsonb_build_object('ok', false, 'reason', 'bad_amount'); end if;
      if p_cash > v_due + 0.005 then return jsonb_build_object('ok', false, 'reason', 'amount_too_high', 'due', v_due); end if;
    end if;
    if v_due > 0 and v_method <> 'credit' and coalesce(o.data->>'status', o.status) <> 'complimentary' then
      v_take := case when p_cash is null then v_due else least(p_cash, v_due) end;
      if v_take < v_due - 0.005 then v_status := 'partial'; end if;
      v_extra := jsonb_build_object(
        'payments', case when v_take > 0 then
                      v_pays || jsonb_build_array(jsonb_build_object(
                        'id', gen_random_uuid()::text, 'amount', v_take, 'method', v_method,
                        'at', v_iso, 'by', 'rider', 'riderId', v_id::text, 'riderName', v_name))
                    else v_pays end,
        'amountPaid', v_paid + v_take,
        'paymentMethod', v_method);
    end if;
  end if;

  update public.orders set
      data = data
        || jsonb_build_object('deliveryStatus', p_stage, 'updatedAt', v_now, '_updatedAt', v_ms)
        || case when p_claim then jsonb_build_object(
                'riderId', v_id::text, 'riderName', v_name, 'riderPhone', v_phone,
                'dispatchedAt', v_now)
           else '{}'::jsonb end
        || case when p_stage = 'delivered' then
                jsonb_build_object('deliveredAt', v_now, 'status', v_status)
                || case when v_status = 'paid' then jsonb_build_object('paidAt', v_now) else '{}'::jsonb end
                || v_extra
           else '{}'::jsonb end,
      status        = case when p_stage = 'delivered' then v_status else status end,
      dispatched_at = case when p_claim then v_now else dispatched_at end,
      rider_phone   = case when p_claim then v_phone else rider_phone end,
      delivered_at  = case when p_stage = 'delivered' then v_now else delivered_at end,
      paid_at       = case when p_stage = 'delivered' and v_status = 'paid' then coalesce(paid_at, v_now) else paid_at end,
      client_seq    = v_ms
   where id = p_order and tenant_id = v_tenant;
  get diagnostics n = row_count;

  return jsonb_build_object('ok', n > 0, 'reason', case when n > 0 then null else 'no_rows' end,
                            'orderId', p_order, 'stage', p_stage,
                            'taken', v_take, 'due', coalesce(v_due, 0), 'status', case when p_stage = 'delivered' then v_status else null end);
end $function$;

revoke all on function public.portal_order_delivery(text, uuid, text, boolean, numeric) from public;
grant execute on function public.portal_order_delivery(text, uuid, text, boolean, numeric) to anon, authenticated, service_role;
