-- v1.55.1 — the Order Taker showed no riders and no waiters
--
-- REPORTED: "order taker me big ha ky rider or waiter show nhi hoty" — in the
-- Order Taker app neither the riders nor the waiters appear.
--
-- TWO faults, found by comparing what the portal reads against what the POS
-- actually stores for this restaurant:
--
--   1. There was no portal_waiters at all, and portal_bootstrap never sent a
--      'waiters' key. The waiter picker had nothing to fill it with, ever.
--
--   2. portal_riders read the WRONG TABLE. It read user_profiles WHERE
--      role = 'rider'. But Settings -> Staff -> Riders/Waiters writes to
--      module_documents (kind 'riders' / 'waiters') — that is the POS's own
--      roster, and it is what getRiders()/getWaiters() render and what an
--      order's riderId/waiterId points at. For the live restaurant the two
--      disagree completely:
--
--          module_documents kind='riders'   11 rows   (tami, Waqas, Umair,
--                                                      Usama, Haider, Ahsan, …)
--          module_documents kind='waiters'   4 rows   (Hamza, …)
--          user_profiles    role='rider'     1 row
--          user_profiles    role='waiter'    0 rows
--
--      So the portal answered "ok" with one rider nobody recognised, and no
--      waiters. Worse, the id it returned was user_profiles.user_id, which
--      matches no existing order's riderId — assigning from the portal could
--      not have lined up with the POS's own history.
--
-- Both functions now read the POS roster and UNION it with any user_profiles
-- staff carrying that role, deduplicated by id, so a restaurant that manages
-- staff either way gets the same answer.
--
-- Inactive rows are returned as-is rather than filtered out. The client already
-- filters on isActive, and keeping them lets the picker say WHICH of the two
-- empty cases it is ("none created" vs "all switched off") instead of showing a
-- blank dropdown that explains nothing.
--
-- The rider PIN in module_documents is never returned: an order taker must not
-- learn every rider's login PIN. Fields are listed explicitly, not splatted.
--
-- Idempotent: CREATE OR REPLACE only. No data is read or written.

-- ---------------------------------------------------------------- riders
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

  with pos as (
    -- The POS's own roster (Settings -> Staff -> Riders). This is the source
    -- an order's riderId points at, so it wins every collision.
    select m.data->>'id'                                as id,
           coalesce(m.data->>'name', 'Rider')           as name,
           nullif(m.data->>'username', '')              as username,
           nullif(m.data->>'phone', '')                 as phone,
           m.branch_id                                  as branch_id,
           coalesce((m.data->>'isActive')::boolean, true) as is_active,
           nullif(m.data->>'bikeNumber', '')            as bike_number,
           nullif(m.data->>'lastSeenAt', '')            as last_seen_at
      from public.module_documents m
     where m.tenant_id = s.tenant_id
       and m.kind = 'riders'
       and m.deleted_at is null
       and m.data->>'id' is not null
       and (s.all_branches or s.branch_id is null
            or m.branch_id is null or m.branch_id = s.branch_id)
  ), accts as (
    -- Restaurants that gave riders a login account instead.
    select u.user_id::text as id, u.display_name as name, u.username, u.phone,
           u.branch_id, u.is_active, null::text as bike_number, null::text as last_seen_at
      from public.user_profiles u
     where u.tenant_id = s.tenant_id
       and u.role = 'rider'
       and (s.all_branches or s.branch_id is null
            or u.branch_id = s.branch_id or u.all_branches)
  ), deduped as (
    -- Deduplicate ACROSS the two sources only, never within one. A person who
    -- is both a POS roster entry and a login account appeared twice in the
    -- picker under the same name, and the two rows carry different ids — so
    -- picking the account one stamped an id the POS roster does not know. The
    -- roster row is kept. Rows are matched by id or by name, and only a
    -- user_profiles row is ever dropped, so four distinct riders all called
    -- "New Rider" in the roster still show as four.
    select * from pos
    union all
    select a.* from accts a
     where not exists (
       select 1 from pos p
        where p.id = a.id
           or lower(btrim(p.name)) = lower(btrim(coalesce(a.name, '')))
     )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'userId', id,
           'name', name, 'username', username, 'phone', phone,
           'role', 'rider',
           'branchId', branch_id,
           'isActive', is_active,
           'bikeNumber', bike_number,
           'lastSeenAt', last_seen_at
         ) order by is_active desc, name), '[]'::jsonb) into v
    from deduped;

  return jsonb_build_object('ok', true, 'riders', v);
end
$$;

-- --------------------------------------------------------------- waiters
create or replace function public.portal_waiters(p_token text)
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

  with pos as (
    select m.data->>'id'                                as id,
           coalesce(m.data->>'name', 'Waiter')          as name,
           nullif(m.data->>'username', '')              as username,
           nullif(m.data->>'phone', '')                 as phone,
           m.branch_id                                  as branch_id,
           coalesce((m.data->>'isActive')::boolean, true) as is_active
      from public.module_documents m
     where m.tenant_id = s.tenant_id
       and m.kind = 'waiters'
       and m.deleted_at is null
       and m.data->>'id' is not null
       and (s.all_branches or s.branch_id is null
            or m.branch_id is null or m.branch_id = s.branch_id)
  ), accts as (
    select u.user_id::text as id, u.display_name as name, u.username, u.phone,
           u.branch_id, u.is_active
      from public.user_profiles u
     where u.tenant_id = s.tenant_id
       and u.role = 'waiter'
       and (s.all_branches or s.branch_id is null
            or u.branch_id = s.branch_id or u.all_branches)
  ), deduped as (
    -- Across the two sources only; see portal_riders above.
    select * from pos
    union all
    select a.* from accts a
     where not exists (
       select 1 from pos p
        where p.id = a.id
           or lower(btrim(p.name)) = lower(btrim(coalesce(a.name, '')))
     )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'userId', id,
           'name', name, 'username', username, 'phone', phone,
           'role', 'waiter',
           'branchId', branch_id,
           'isActive', is_active
         ) order by is_active desc, name), '[]'::jsonb) into v
    from deduped;

  return jsonb_build_object('ok', true, 'waiters', v);
end
$$;

revoke all on function public.portal_waiters(text) from public;
grant execute on function public.portal_waiters(text) to anon, authenticated, service_role;
grant execute on function public.portal_riders(text)  to anon, authenticated, service_role;

-- One round trip on the way in, as before — now carrying the waiters too.
create or replace function public.portal_bootstrap(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare s public.staff_portal_sessions := portal_identity(p_token);
        v_me jsonb; v_tf jsonb; v_menu jsonb;
begin
  if s.user_id is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  v_me := portal_me(p_token);
  if not coalesce((v_me->>'ok')::boolean, false) then return v_me; end if;
  v_tf := portal_tables(p_token);
  v_menu := portal_menu(p_token);
  return jsonb_build_object('ok', true, 'me', v_me,
    'restaurant', portal_restaurant(p_token),
    'tables', v_tf->'tables', 'floors', v_tf->'floors',
    'riders', portal_riders(p_token)->'riders',
    'waiters', portal_waiters(p_token)->'waiters',
    'orders', portal_orders(p_token, 150)->'orders',
    'categories', v_menu->'categories', 'menuItems', v_menu->'menuItems');
end
$$;

grant execute on function public.portal_bootstrap(text) to anon, authenticated, service_role;
