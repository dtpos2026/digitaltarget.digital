-- Rollback for 20261107100000_v1_111_0_portal_order_default_branch.sql: the function exactly as it was in the live database on 2026-11-07.
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
