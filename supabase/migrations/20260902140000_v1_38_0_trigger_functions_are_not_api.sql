-- ============================================================================
-- v1.38.0 — a trigger function is not a public API
--
-- The Supabase linter flags 17 SECURITY DEFINER functions in `public` that
-- return `trigger` yet carry EXECUTE for `anon` and `authenticated`, so
-- PostgREST publishes each of them at /rest/v1/rpc/<name>. Nothing in the
-- product calls them that way: they exist only to be fired by a trigger.
--
-- Firing a trigger does NOT check EXECUTE on the trigger function — that
-- privilege is checked when the trigger is CREATED, not when it runs. This was
-- confirmed against the live database inside a rolled-back transaction before
-- this migration was written: with EXECUTE revoked, `authenticated` updated a
-- menu item and both touch_updated_at and stamp_deleted_by still fired, the
-- latter correctly recording the user.
--
-- The revoke has to name PUBLIC, not just the two API roles. These functions
-- carry the default `=X/postgres` ACL, so anon and authenticated hold EXECUTE
-- through PUBLIC; revoking from the roles alone changes nothing and leaves the
-- RPC exposed. enqueue_order_push in this same database already has the PUBLIC
-- grant removed, so this follows an existing pattern rather than inventing one.
--
-- Catalogue-driven rather than a hand-written list, so a trigger function added
-- later is covered by re-running this file.
-- ============================================================================
do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::regtype
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    n := n + 1;
  end loop;
  raise notice 'v1.38.0: revoked EXECUTE on % trigger function(s)', n;
end $$;

-- Deliberately NOT using ALTER DEFAULT PRIVILEGES here: that would strip
-- EXECUTE from every future function in `public`, including the anon RPCs the
-- customer app depends on (public_customer_login and friends), and would do it
-- silently. Re-running this file is the intended way to cover new triggers.
