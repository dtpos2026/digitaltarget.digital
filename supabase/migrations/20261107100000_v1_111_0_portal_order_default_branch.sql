-- v1.111.0 — Order Taker "send to kitchen" never arrived: portal_upsert_order inserted a NULL branch into order_counters (NOT NULL).
-- Additive: only this one function is replaced; no table, column or policy changes. Rollback: docs/rollback/2026-11-07-v1_111_0-portal-upsert-order-before.sql
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

  -- v1.111.0 — a session that works for ALL branches (or an older one) carries no branch, and the order did not name one. The bill
  -- counter is kept per branch and its branch column is NOT NULL, so the insert failed with a 400 on every attempt and the order
  -- never left the phone ("1 change could not be sent"). Use the restaurant's first active branch, the same default every till has.
  if v_b is null then
    select b.id into v_b from public.branches b
     where b.tenant_id = v_tenant and b.deleted_at is null
     order by b.is_active desc nulls last, b.sort_order nulls last, b.created_at nulls last
     limit 1;
  end if;
  if v_b is null then
    return jsonb_build_object('ok', false, 'reason', 'no_branch');
  end if;

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
