-- portal_order_delivery and portal_upsert_order BEFORE v1.108.0 (copied from pg_get_functiondef on the live database,
-- 2026-11-06). Run this file to put both functions back exactly as they were. Grants were {postgres, anon,
-- authenticated, service_role} for both and are not changed by v1.108.0.
-- (portal_merge_order_doc, added by v1.108.0, is only called by the new portal_upsert_order; drop it afterwards:
--  drop function if exists public.portal_merge_order_doc(jsonb, jsonb);)

CREATE OR REPLACE FUNCTION public.portal_order_delivery(p_token text, p_order uuid, p_stage text, p_claim boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_tenant uuid; v_role text; v_name text; v_phone text; o record; n int;
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
   where id = p_order and tenant_id = v_tenant and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_order'); end if;

  if p_claim and coalesce(o.data->>'riderId','') not in ('', v_id::text) then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end if;
  if not p_claim and coalesce(o.data->>'riderId','') <> v_id::text then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;

  update public.orders set data = data
      || jsonb_build_object('deliveryStatus', p_stage, 'updatedAt', now())
      || case when p_claim then jsonb_build_object(
              'riderId', v_id::text, 'riderName', v_name, 'riderPhone', v_phone,
              'dispatchedAt', now())
         else '{}'::jsonb end
      || case when p_stage = 'delivered' then jsonb_build_object(
              'deliveredAt', now(), 'status', 'paid', 'paidAt', now())
         else '{}'::jsonb end,
      status = case when p_stage = 'delivered' then 'paid' else status end
   where id = p_order and tenant_id = v_tenant;
  get diagnostics n = row_count;

  return jsonb_build_object('ok', n > 0, 'reason', case when n > 0 then null else 'no_rows' end,
                            'orderId', p_order, 'stage', p_stage);
end $function$;

CREATE OR REPLACE FUNCTION public.portal_upsert_order(p_token text, p_order jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid; v_tenant uuid; v_branch uuid; v_role text;
  v_order_id uuid; v_number int; v_existing record; v_data jsonb; v_b uuid;
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
   where id = v_order_id and deleted_at is null;
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

  v_data := p_order
         || jsonb_build_object('orderNumber', v_number,
                               'takenByUserId', v_id::text,
                               '_updatedAt', (extract(epoch from now()) * 1000)::bigint);

  insert into public.orders as o (id, tenant_id, branch_id, order_number, status, data)
  values (v_order_id, v_tenant, v_b, v_number,
          coalesce(nullif(p_order->>'status',''), 'running'), v_data)
  on conflict (id) do update
     set data       = v_data,
         status     = coalesce(nullif(p_order->>'status',''), o.status),
         branch_id  = coalesce(v_b, o.branch_id),
         updated_at = now()
   where o.tenant_id = v_tenant;

  return jsonb_build_object('ok', true, 'id', v_order_id, 'order_number', v_number);
end $function$;
