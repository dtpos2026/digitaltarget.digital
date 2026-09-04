-- ============================================================================
-- v1.42.0 — the order taker can save an order
--
-- REPORTED, screenshotted on the Order Taker screen: "1 change could not be
-- uploaded (orders). They are saved on this device."
--
-- Same defect as v1.41.0, one layer up. The Order Taker portal embeds the POS
-- screen, so its bills go through the ordinary store write — sbSaveItem() ->
-- upsert on `orders`. That app holds a portal token and no Supabase session,
-- so the insert is refused by RLS and the update matches zero rows. v1.41.0
-- gave the RIDER its delivery writes; this gives the ORDER TAKER the write it
-- exists to perform.
--
-- The server keeps every decision the phone cannot be trusted with: which
-- restaurant, which branch, and the order NUMBER — which is exactly the value
-- two devices must never mint for themselves.
-- ============================================================================
create or replace function public.portal_upsert_order(
  p_token text,
  p_order jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid; v_tenant uuid; v_branch uuid; v_role text;
  v_order_id uuid; v_number int; v_existing record; v_data jsonb;
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

  -- An order this restaurant already has? Then this is an edit, and it must be
  -- an edit of OUR order — never a way to reach into another tenant's book.
  select * into v_existing from public.orders
   where id = v_order_id and deleted_at is null;
  if found and v_existing.tenant_id <> v_tenant then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;

  -- The number is the server's to give. A device that mints its own is how two
  -- tills end up on one bill number.
  if found then
    v_number := v_existing.order_number;
  else
    -- next_order_number() guards on auth_tenant_id(), which is null for a
    -- token session, so calling it here raises 42501 "not permitted". The
    -- counter logic is repeated rather than the guard weakened: the tenant
    -- came from the TOKEN above, which is a stronger claim than a JWT the
    -- caller supplied. Same table, same greatest()-of-max reconciliation, so
    -- POS tills and the order taker keep drawing from one sequence.
    declare v_b uuid := coalesce(nullif(p_order->>'branchId','')::uuid, v_branch);
    begin
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
    end;
  end if;

  v_data := p_order
         || jsonb_build_object('orderNumber', v_number,
                               'takenByUserId', v_id::text,
                               '_updatedAt', (extract(epoch from now()) * 1000)::bigint);

  insert into public.orders as o (id, tenant_id, branch_id, order_number, status, data)
  values (v_order_id, v_tenant,
          coalesce(nullif(p_order->>'branchId','')::uuid, v_branch),
          v_number,
          coalesce(nullif(p_order->>'status',''), 'running'),
          v_data)
  on conflict (id) do update
     set data       = v_data,
         status     = coalesce(nullif(p_order->>'status',''), o.status),
         branch_id  = coalesce(nullif(p_order->>'branchId','')::uuid, o.branch_id),
         updated_at = now()
   where o.tenant_id = v_tenant;

  return jsonb_build_object('ok', true, 'id', v_order_id, 'order_number', v_number);
end $function$;

revoke all on function public.portal_upsert_order(text, jsonb) from public;
grant execute on function public.portal_upsert_order(text, jsonb) to anon, authenticated;

-- ============================================================================
-- The pretty ordering link
--
-- REPORTED: "jo link bane customer order website ka, mere domain sath ho —
-- digitaltarget.digital/buttbbqorder — koi bhi restaurant name aaye."
--
-- The link has always carried a raw uuid: /#/order/fd3ead3d-af9a-…. Every
-- tenant already has a slug ('butt'), so the only missing piece is a way for
-- an anonymous visitor to turn a slug into the id the app routes on.
--
-- Nothing new is revealed. The tenant id is already in every order link a
-- restaurant hands out, and public_customer_app_config is already anon-callable
-- with it. Only ACTIVE restaurants resolve, so a switched-off tenant's slug
-- stops working the moment it is switched off.
-- ============================================================================
create or replace function public.public_tenant_by_slug(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select jsonb_build_object('tenantId', t.id, 'name', t.name, 'slug', t.slug)
       from public.tenants t
      where lower(t.slug) = lower(btrim(p_slug))
        and t.is_active
      limit 1),
    jsonb_build_object('tenantId', null));
$function$;

revoke all on function public.public_tenant_by_slug(text) from public;
grant execute on function public.public_tenant_by_slug(text) to anon, authenticated;
