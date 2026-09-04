-- ============================================================================
-- v1.43.0 — the menu, the restaurant's name, and a rider's own history
--
-- THREE REPORTED THINGS, one cause between the first two.
--
-- 1. "Order Taker App mein menu properly show nahi hota. Kabhi menu nazar nahi
--    aata lekin order phir bhi place ho jata hai."
--
--    portal_bootstrap returned me / tables / floors / riders / orders — and NO
--    MENU. The portal fell back to initStore()'s ordinary cloud load for that,
--    which is a different path with different failure modes, so the menu could
--    come back empty while the rest of the screen worked. An order still
--    places because the POS screen allows a manual line. Hence the exact
--    symptom: no menu, but orders go through.
--
--    The menu now comes back with everything else, from the same token, in the
--    same round trip. One source, so it cannot half-load.
--
-- 2. "Rider App mein wazeh hona chahiye ke ye kis restaurant ki app hai."
--    The identity was never sent. Name, logo and workspace code now ride along.
--
-- 3. "Rider ke completed orders ka record nazar nahi aata."
--    portal_orders returns LIVE orders only, which is right for the working
--    screen and useless for a history. portal_my_history is separate so the
--    live list stays small and fast.
-- ============================================================================

-- ------------------------------------------------------------------- the menu
create or replace function public.portal_menu(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare s public.staff_portal_sessions := portal_identity(p_token);
begin
  if s.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  return jsonb_build_object(
    'ok', true,
    'categories', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.sort_order nulls last, c.name)
        from public.categories c
       where c.tenant_id = s.tenant_id and c.deleted_at is null), '[]'::jsonb),
    'menuItems', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.name)
        from public.menu_items m
       where m.tenant_id = s.tenant_id and m.deleted_at is null), '[]'::jsonb));
end $function$;

-- ------------------------------------------------------- which restaurant
create or replace function public.portal_restaurant(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare s public.staff_portal_sessions := portal_identity(p_token);
        t record; b record;
begin
  if s.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  select id, name, slug, workspace_code into t from public.tenants where id = s.tenant_id;
  select name into b from public.branches where id = s.branch_id;

  return jsonb_build_object(
    'ok', true,
    'tenantId', t.id, 'name', t.name, 'slug', t.slug,
    'workspaceCode', t.workspace_code,
    'branchName', b.name,
    'logoUrl', (select coalesce(nullif(ca.logo_url,''), nullif(ca.icon_url,''))
                  from public.customer_apps ca where ca.tenant_id = t.id));
end $function$;

-- --------------------------------------------------- this rider's own history
--
-- Only this staff member's finished work, newest first. Scoped by the token, so
-- a rider cannot read a colleague's deliveries or another restaurant's book.
create or replace function public.portal_my_history(p_token text, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare s public.staff_portal_sessions := portal_identity(p_token);
begin
  if s.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  return jsonb_build_object(
    'ok', true,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'orderNumber', o.order_number,
               'grandTotal', (o.data->>'grandTotal')::numeric,
               'deliveredAt', o.data->>'deliveredAt',
               'deliveryStatus', o.data->>'deliveryStatus',
               'customerName', o.data->'customer'->>'name',
               'address', o.data->'customer'->>'address')
             order by (o.data->>'deliveredAt') desc)
        from public.orders o
       where o.tenant_id = s.tenant_id
         and o.deleted_at is null
         and o.data->>'riderId' = s.user_id::text
         and o.data->>'deliveredAt' is not null
       limit greatest(1, least(coalesce(p_limit, 100), 500))), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
               'delivered', count(*),
               'today', count(*) filter (
                 where (o.data->>'deliveredAt')::timestamptz >= date_trunc('day', now())),
               'earnings', coalesce(sum((o.data->>'grandTotal')::numeric), 0))
        from public.orders o
       where o.tenant_id = s.tenant_id
         and o.deleted_at is null
         and o.data->>'riderId' = s.user_id::text
         and o.data->>'deliveredAt' is not null));
end $function$;

-- ------------------------------------------- bootstrap carries them all now
create or replace function public.portal_bootstrap(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  s public.staff_portal_sessions := portal_identity(p_token);
  v_me jsonb; v_tf jsonb; v_menu jsonb;
begin
  if s.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  v_me := portal_me(p_token);
  if not coalesce((v_me->>'ok')::boolean, false) then
    return v_me;
  end if;

  v_tf   := portal_tables(p_token);
  v_menu := portal_menu(p_token);

  return jsonb_build_object(
    'ok', true,
    'me', v_me,
    'restaurant', portal_restaurant(p_token),
    'tables', v_tf->'tables',
    'floors', v_tf->'floors',
    'riders', portal_riders(p_token)->'riders',
    'orders', portal_orders(p_token, 150)->'orders',
    'categories', v_menu->'categories',
    'menuItems',  v_menu->'menuItems'
  );
end $function$;

revoke all on function public.portal_menu(text) from public;
revoke all on function public.portal_restaurant(text) from public;
revoke all on function public.portal_my_history(text, integer) from public;
grant execute on function public.portal_menu(text) to anon, authenticated;
grant execute on function public.portal_restaurant(text) to anon, authenticated;
grant execute on function public.portal_my_history(text, integer) to anon, authenticated;
