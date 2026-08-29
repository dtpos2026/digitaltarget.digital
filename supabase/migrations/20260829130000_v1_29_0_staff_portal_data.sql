-- ============================================================================
-- v1.29.0 — what the Order Taker and Rider apps are allowed to see
--
-- Every one of these resolves the caller from the portal token and NOTHING
-- else. The tenant is never taken from the request: a token belongs to one
-- restaurant, so passing a different tenant id changes nothing at all. That is
-- the same guarantee the customer functions give, and it is why these can be
-- granted to anon safely.
--
-- Branch scoping follows the staff member's own record: all_branches sees the
-- restaurant, anyone else sees their branch. That is the rule the POS already
-- applies through can_access_branch(); it is restated here because these run as
-- definer and RLS is therefore not consulted.
-- ============================================================================

-- --------------------------------------------------------- tables and floors
--
-- REPORTED: "table nahi ji, maine restaurant me add kiye hue hain." Twelve of
-- them, and dining_tables is authenticated-only, so the portal saw none.
create or replace function public.portal_tables(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  s public.staff_portal_sessions := portal_identity(p_token);
  v_tables jsonb;
  v_floors jsonb;
begin
  if s.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.name), '[]'::jsonb) into v_tables
    from public.dining_tables d
   where d.tenant_id = s.tenant_id
     and d.deleted_at is null
     and (s.all_branches or s.branch_id is null or d.branch_id = s.branch_id);

  select coalesce(jsonb_agg(to_jsonb(f) order by f.sort_order, f.name), '[]'::jsonb) into v_floors
    from public.floors f
   where f.tenant_id = s.tenant_id
     and f.deleted_at is null
     and (s.all_branches or s.branch_id is null or f.branch_id = s.branch_id);

  return jsonb_build_object('ok', true, 'tables', v_tables, 'floors', v_floors);
end $$;

grant execute on function public.portal_tables(text) to anon, authenticated, service_role;

-- -------------------------------------------------------------------- riders
--
-- REPORTED: "na hi rider dekhy mujy order taker me." user_profiles is
-- authenticated-only, so the order taker had nobody to hand a delivery to.
--
-- Only what a colleague needs to assign work: no password hash, no pin hash,
-- no email. A rider's phone number is included because the order taker has to
-- be able to call them.
create or replace function public.portal_riders(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  s public.staff_portal_sessions := portal_identity(p_token);
  v jsonb;
begin
  if s.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', u.user_id,
           'userId', u.user_id,
           'name', u.display_name,
           'username', u.username,
           'phone', u.phone,
           'role', u.role,
           'branchId', u.branch_id,
           'isActive', u.is_active
         ) order by u.display_name), '[]'::jsonb) into v
    from public.user_profiles u
   where u.tenant_id = s.tenant_id
     and u.role = 'rider'
     and u.is_active
     and (s.all_branches or s.branch_id is null or u.branch_id = s.branch_id or u.all_branches);

  return jsonb_build_object('ok', true, 'riders', v);
end $$;

grant execute on function public.portal_riders(text) to anon, authenticated, service_role;

-- -------------------------------------------------------------------- orders
--
-- REPORTED: "rider me mujhe koi order hi nahi aaya." orders lets anon INSERT
-- (that is how a customer places one) but never SELECT, so the rider app had
-- nothing to show.
--
-- A rider sees the deliveries that are theirs, plus unassigned ones they could
-- take. An order taker sees the branch's live orders. Neither sees history: an
-- app that pulls two hundred settled bills onto a phone is slow and tells its
-- user nothing.
create or replace function public.portal_orders(p_token text, p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  s public.staff_portal_sessions := portal_identity(p_token);
  v jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 300);
begin
  if s.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  select coalesce(jsonb_agg(o.data order by o.created_at desc), '[]'::jsonb) into v
    from (
      select o.data, o.created_at
        from public.orders o
       where o.tenant_id = s.tenant_id
         and o.deleted_at is null
         and o.archived_at is null
         and (s.all_branches or s.branch_id is null or o.branch_id = s.branch_id)
         and (
           -- A rider's own work, and anything not yet handed to anyone.
           s.role <> 'rider'
           or o.data->>'riderId' = s.user_id::text
           or coalesce(o.data->>'riderId', '') = ''
         )
         and coalesce(o.status, 'running') not in ('paid', 'cancelled', 'closed')
       order by o.created_at desc
       limit v_limit
    ) o;

  return jsonb_build_object('ok', true, 'orders', v);
end $$;

grant execute on function public.portal_orders(text, integer) to anon, authenticated, service_role;

-- ---------------------------------------------------- everything, in one call
--
-- The portals need all of it at once on the way in, and four round trips on a
-- phone over a restaurant's wifi is three too many.
create or replace function public.portal_bootstrap(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  s public.staff_portal_sessions := portal_identity(p_token);
  v_me jsonb;
begin
  if s.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  v_me := portal_me(p_token);
  if not coalesce((v_me->>'ok')::boolean, false) then
    return v_me;
  end if;

  return jsonb_build_object(
    'ok', true,
    'me', v_me,
    'tables', portal_tables(p_token)->'tables',
    'floors', portal_tables(p_token)->'floors',
    'riders', portal_riders(p_token)->'riders',
    'orders', portal_orders(p_token, 150)->'orders'
  );
end $$;

grant execute on function public.portal_bootstrap(text) to anon, authenticated, service_role;
