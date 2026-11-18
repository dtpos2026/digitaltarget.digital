-- Rollback for 20261118100000_v1_123_0_rider_part_payment.sql: puts back the four-argument portal_order_delivery exactly as it was in v1.122
-- (a delivery books the whole amount still due and marks the bill paid). Bills already delivered with a part-payment keep their 'partial' status.
drop function if exists public.portal_order_delivery(text, uuid, text, boolean, numeric);

CREATE OR REPLACE FUNCTION public.portal_order_delivery(p_token text, p_order uuid, p_stage text, p_claim boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid; v_tenant uuid; v_role text; v_name text; v_phone text; o record; n int;
  v_now   timestamptz := now();
  v_ms    bigint := (extract(epoch from now()) * 1000)::bigint;
  v_iso   text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_total numeric; v_paid numeric; v_due numeric; v_method text;
  v_pays  jsonb;
  v_extra jsonb := '{}'::jsonb;
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
    if v_due > 0 and v_method <> 'credit' and coalesce(o.data->>'status', o.status) <> 'complimentary' then
      v_extra := jsonb_build_object(
        'payments', v_pays || jsonb_build_array(jsonb_build_object(
                      'id', gen_random_uuid()::text, 'amount', v_due, 'method', v_method,
                      'at', v_iso, 'by', 'rider', 'riderId', v_id::text, 'riderName', v_name)),
        'amountPaid', v_paid + v_due,
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
        || case when p_stage = 'delivered' then jsonb_build_object(
                'deliveredAt', v_now, 'status', 'paid', 'paidAt', v_now) || v_extra
           else '{}'::jsonb end,
      status        = case when p_stage = 'delivered' then 'paid' else status end,
      dispatched_at = case when p_claim then v_now else dispatched_at end,
      rider_phone   = case when p_claim then v_phone else rider_phone end,
      delivered_at  = case when p_stage = 'delivered' then v_now else delivered_at end,
      paid_at       = case when p_stage = 'delivered' then coalesce(paid_at, v_now) else paid_at end,
      client_seq    = v_ms
   where id = p_order and tenant_id = v_tenant;
  get diagnostics n = row_count;

  return jsonb_build_object('ok', n > 0, 'reason', case when n > 0 then null else 'no_rows' end,
                            'orderId', p_order, 'stage', p_stage);
end $function$;

revoke all on function public.portal_order_delivery(text, uuid, text, boolean) from public;
grant execute on function public.portal_order_delivery(text, uuid, text, boolean) to anon, authenticated, service_role;
