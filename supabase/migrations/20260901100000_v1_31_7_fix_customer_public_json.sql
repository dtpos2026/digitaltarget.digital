-- ============================================================================
-- v1.31.7 — REGRESSION FIX, self-inflicted in v1.30.0
--
-- v1.30.0 dropped customers.push_token when FCM was removed.
-- customer_public_json still read it:
--     'pushEnabled', nullif(btrim(coalesce(c.push_token, '')), '') is not null
--
-- PostgreSQL does not track that dependency for a SQL-language function, so
-- the ALTER TABLE succeeded and the function broke at RUNTIME instead:
--     ERROR:  missing FROM-clause entry for table "c"
--     CONTEXT: SQL function "customer_public_json" during startup
--
-- Every customer-app entry point calls it — public_customer_me, _login,
-- _signup, _update — so customer sign-in was DEAD on the live database from
-- that migration until this one. Found while adding an unrelated feature.
--
-- WHY IT WAS MISSED: the v1.30.0 verification tested the order trigger and the
-- outbox, which is where the change was, and never re-ran the customer login
-- path after the column went. A migration that drops a column has to re-test
-- everything that READ it, not everything it edited.
--
-- pushEnabled is removed rather than faked: there is no push any more, and
-- reporting a field that can never be true is worse than dropping it. The
-- client reads `raw?.pushEnabled === true`, so an absent key is simply false.
--
-- VERIFIED AFTER, as anon with a real minted session, rolled back:
--   public_customer_me      -> ok:true, real customer returned
--   public_customer_orders  -> ok:true
--   public_customer_login   -> clean bad_credentials on a wrong PIN
-- And swept the whole database: no other function, view or trigger still
-- names push_token.
-- ============================================================================

create or replace function public.customer_public_json(c public.customers)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id',            c.id,
    'name',          c.name,
    'phone',         c.phone,
    'email',         c.email,
    'address',       c.address,
    'city',          c.city,
    'area',          c.area,
    'fullAddress',   c.full_address,
    'addresses',     coalesce(c.addresses, '[]'::jsonb),
    'dateOfBirth',   c.date_of_birth,
    'gender',        c.gender,
    'lat',           c.lat,
    'lng',           c.lng,
    'loyaltyPoints', c.loyalty_points,
    'totalOrders',   c.total_orders,
    'lastOrderAt',   c.last_order_at);
$function$;
