-- v1.108.0 — two sync defects in the phone-app (portal) write functions, found by reading the live database.
-- Replaces two function bodies and adds one helper. No table, column, policy or grant is touched.
-- Rollback: docs/rollback/2026-11-06-v1_108_0-portal-functions-before.sql (the exact previous bodies).
--
-- 1) portal_order_delivery (the Rider app)
--    * "Delivered" marked the bill PAID but never recorded the payment: in the last 60 days both delivered orders on the
--      live database read status paid, payments [], amount_paid 0 — so cash taken at the door was missing from every
--      payment report. It now records what was still due as a payment by the rider (cash on delivery unless the bill says
--      otherwise); a credit bill or a complimentary bill takes no payment, and a bill already paid in full is not paid twice.
--    * Two riders claiming the same delivery at the same moment both read "unclaimed" and both succeeded (the second
--      silently replaced the first). The order row is now locked while the claim is decided.
--    * The typed columns the customer's tracking page reads (dispatched_at, delivered_at, rider_phone, paid_at) stayed empty
--      for rider-driven orders; they are now set, and client_seq follows like every other writer.
-- 2) portal_upsert_order (the Order Taker app)
--    * Saving an existing bill replaced its whole document with the phone's copy, so anything another device had done
--      meanwhile — a payment at the till, the kitchen starting, a rider assigned — was wiped. The fields another device owns
--      are now kept from the server copy (portal_merge_order_doc), and a bill already paid or voided stays paid or voided.

create or replace function public.portal_merge_order_doc(p_existing jsonb, p_incoming jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select p_incoming
         || jsonb_strip_nulls(jsonb_build_object(
              'payments',            p_existing->'payments',
              'amountPaid',          p_existing->'amountPaid',
              'cashReceived',        p_existing->'cashReceived',
              'changeReturned',      p_existing->'changeReturned',
              'paidAt',              p_existing->'paidAt',
              'paymentAccountId',    p_existing->'paymentAccountId',
              'paymentAccountName',  p_existing->'paymentAccountName',
              'kitchenStatus',       p_existing->'kitchenStatus',
              'kitchenStatusAt',     p_existing->'kitchenStatusAt',
              'deliveryStatus',      p_existing->'deliveryStatus',
              'riderId',             p_existing->'riderId',
              'riderName',           p_existing->'riderName',
              'riderPhone',          p_existing->'riderPhone',
              'dispatchedAt',        p_existing->'dispatchedAt',
              'deliveredAt',         p_existing->'deliveredAt',
              'archivedAt',          p_existing->'archivedAt'))
         || case when p_existing->>'status' in ('paid', 'void')
                 then jsonb_build_object('status', p_existing->'status')
                 else '{}'::jsonb end
$$;
revoke all on function public.portal_merge_order_doc(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.portal_merge_order_doc(jsonb, jsonb) to service_role;

create or replace function public.portal_order_delivery(p_token text, p_order uuid, p_stage text, p_claim boolean default false)
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

  -- Locked: two riders claiming at once must be decided one after the other.
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
    -- A credit bill is the customer's account and a complimentary bill is free: the rider takes nothing for either.
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

create or replace function public.portal_upsert_order(p_token text, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid; v_tenant uuid; v_branch uuid; v_role text;
  v_order_id uuid; v_number int; v_existing record; v_data jsonb; v_b uuid; v_status text;
begin
  select user_id, tenant_id, branch_id, role into v_id, v_tenant, v_branch, v_role
  from public.portal_identity(p_token);
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if v_role not in ('order_taker','rider') then
    return jsonb_build_object('ok', false, 'reason', 'wrong_role');
  end if;
  if p_order is null or jsonb_typeof(p_order) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'bad_order');
  end if;

  v_order_id := nullif(p_order->>'id','')::uuid;
  if v_order_id is null then return jsonb_build_object('ok', false, 'reason', 'no_id'); end if;
  v_b := coalesce(nullif(p_order->>'branchId','')::uuid, v_branch);

  select * into v_existing from public.orders
   where id = v_order_id and deleted_at is null
   for update;
  if found and v_existing.tenant_id <> v_tenant then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;

  if found then
    v_number := v_existing.order_number;
  else
    insert into public.order_counters (tenant_id, branch_id, current_value, reset_date)
    values (v_tenant, v_b, 0, current_date)
    on conflict (tenant_id, branch_id) do nothing;

    update public.order_counters c
       set current_value = greatest(
             c.current_value,
             coalesce((select max(o2.order_number) from public.orders o2
                        where o2.tenant_id = v_tenant
                          and o2.branch_id is not distinct from v_b), 0)
           ) + 1
     where c.tenant_id = v_tenant
       and c.branch_id is not distinct from v_b
    returning c.current_value into v_number;
  end if;

  v_data := (case when v_existing.id is not null and v_existing.tenant_id = v_tenant
                  then public.portal_merge_order_doc(v_existing.data, p_order)
                  else p_order end)
         || jsonb_build_object('orderNumber', v_number,
                               'takenByUserId', v_id::text,
                               '_updatedAt', (extract(epoch from now()) * 1000)::bigint);

  -- A bill already paid or voided stays so; otherwise the phone's status stands.
  v_status := case when v_existing.status in ('paid', 'void') then v_existing.status
                   else coalesce(nullif(p_order->>'status',''), v_existing.status, 'running') end;

  insert into public.orders as o (id, tenant_id, branch_id, order_number, status, data)
  values (v_order_id, v_tenant, v_b, v_number,
          coalesce(nullif(p_order->>'status',''), 'running'), v_data)
  on conflict (id) do update
     set data       = v_data,
         status     = v_status,
         branch_id  = coalesce(v_b, o.branch_id),
         updated_at = now()
   where o.tenant_id = v_tenant;

  return jsonb_build_object('ok', true, 'id', v_order_id, 'order_number', v_number);
end $function$;
