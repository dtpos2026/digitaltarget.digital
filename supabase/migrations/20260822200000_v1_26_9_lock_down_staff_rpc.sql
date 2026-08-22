-- ============================================================================
-- v1.26.9 — the staff-profile RPC must not be callable by anon
--
-- pos_set_staff_profile() writes a user_profiles row: tenant, role,
-- all_branches and the bcrypt pin_hash a cashier logs in with. It is
-- SECURITY DEFINER, it takes the tenant as an ARGUMENT rather than deriving it
-- from the caller, and it performs no authorization check of its own.
--
-- EXECUTE was granted to `anon` and `authenticated`. The publishable key ships
-- in the browser bundle by design, so anyone holding it could POST directly to
-- /rest/v1/rpc/pos_set_staff_profile and write an owner-role staff profile
-- into ANY restaurant, bypassing the app entirely.
--
-- The application path was never the weak part: saveStaffUser() checks that the
-- caller is an active owner/admin/manager and passes the caller's OWN tenant,
-- then calls this with the service-role key. That check simply lived only in
-- the application, and a privilege boundary cannot.
--
-- service_role keeps its grant, so the app path is unaffected. PostgREST
-- executes as anon or authenticated for every browser request, so revoking
-- those two closes the route completely.
--
-- Idempotent: REVOKE on a privilege that is already absent is a no-op.
-- ============================================================================

-- NOTE: revoking from anon and authenticated alone is NOT enough. The function
-- also carried an EXECUTE grant to PUBLIC, which both roles inherit, so anon
-- could still call it. PUBLIC has to go too, and service_role re-granted after.
revoke execute on function public.pos_set_staff_profile(
  uuid, uuid, text, text, text, text, uuid, text[], text[], text, boolean, boolean
) from anon, authenticated, public;

grant execute on function public.pos_set_staff_profile(
  uuid, uuid, text, text, text, text, uuid, text[], text[], text, boolean, boolean
) to service_role;

-- ---------------------------------------------------------------------------
-- Pin the search_path on the three functions still resolving it at call time.
-- A SECURITY DEFINER function with a mutable search_path can be induced to
-- resolve an unqualified name against a schema the caller controls.
-- ---------------------------------------------------------------------------
alter function public.normalise_free_table()            set search_path = public, pg_temp;
alter function public.sync_promo_usage_counts()         set search_path = public, pg_temp;
alter function public.resolve_order_number_collision()  set search_path = public, pg_temp;
