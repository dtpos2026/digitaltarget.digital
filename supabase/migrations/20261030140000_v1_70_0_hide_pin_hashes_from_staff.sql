-- ============================================================================
-- v1.70.0 — staff can no longer read each other's PIN hashes
--
-- FOUND (read-only probe, rolled back, 2026-10-30): signed in as a branch cashier,
--
--     select pin_hash from user_profiles   ->  4 other users' hashes came back
--
-- `profiles_read` lets every member of a tenant read every profile in it, and
-- `authenticated` held SELECT on the whole table, so that included `pin_hash`.
-- The hashes are bcrypt ($2a$, cost-factored, so not trivially reversible) — but a
-- POS PIN is four digits. Ten thousand candidates against a bcrypt hash is minutes
-- of work, so a readable PIN hash is a readable PIN. The lowest role could read the
-- admin's, learn their username from the same table, and sign in as them.
--
-- WHAT THIS DOES
-- Takes table-level SELECT away from `authenticated` on user_profiles and grants
-- SELECT back on every column EXCEPT pin_hash. Nothing else changes: rows, RLS
-- policies, INSERT/UPDATE/DELETE grants, `anon`, `service_role`, `postgres`.
--
-- WHY IT IS SAFE (checked before applying)
--   * Only SECURITY DEFINER functions read pin_hash (staff_login_global,
--     staff_login_check, verify_staff_pin, pos_set_user_pin, portal_verify_manager,
--     verify_manager_password, …). They run as their owner (postgres), which this
--     does not touch.
--   * The browser never reads pin_hash, and never `select *`s user_profiles: its
--     three reads name their columns (authProvider.ts, supabase.ts, LoginPage.tsx).
--     Every other user_profiles access in src/ goes through the service-role client.
--   * No view depends on user_profiles. No browser code subscribes to its changes.
--   * supabase_auth_admin has its own policy and is a different role.
--
-- A NEW COLUMN on user_profiles is not readable by `authenticated` until it is
-- granted here. That is deliberate: the safe default is "hidden".
--
-- ROLLBACK (one statement; restores exactly the previous grant):
--     grant select on public.user_profiles to authenticated;
-- (the column-level grants left behind are then redundant and harmless; to remove
--  them as well:  revoke select (<each column>) on public.user_profiles from authenticated; )
--
-- IMPACT ON DATA: none. No row is read, written or moved.
-- ============================================================================

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'user_profiles'
     and column_name <> 'pin_hash';

  if cols is null then
    raise exception 'user_profiles has no readable columns — refusing to change grants';
  end if;

  -- Order matters only for the failure case: if the grant below failed after the
  -- revoke, the whole DO block (one transaction) rolls back and nothing changes.
  execute 'revoke select on public.user_profiles from authenticated';
  execute 'grant select (' || cols || ') on public.user_profiles to authenticated';
end
$$;
