-- ===========================================================================
-- v1.25.12 — "Auth account step: Database error creating new user"
--
-- ===== THE CHAIN =====
--  1. Super Admin creates a restaurant; sa_create_restaurant leaves a row in
--     pending_owners for the owner's email.
--  2. platform.functions.ts calls auth.admin.createUser() for that email.
--  3. The AFTER INSERT trigger claim_pending_owner() runs
--         update tenants set owner_user_id = new.id ...
--  4. which fires guard_tenant_billing_columns(), refusing any ownership
--     change unless is_super_admin().
--  5. GoTrue does the insert as supabase_auth_admin with NO JWT, so auth.uid()
--     is NULL and is_super_admin() is false. The guard raises 42501 and aborts
--     the auth.users insert. GoTrue surfaces only "Database error creating new
--     user", hiding the real cause completely.
--
-- The guard is CORRECT and stays: a restaurant owner must never be able to
-- reassign their own tenant. The claim path simply has to identify itself.
--
-- claim_pending_owner() now sets a transaction-local flag around its single
-- UPDATE and clears it immediately. `set local` dies with the transaction,
-- nothing a PostgREST client can reach may set it, and both functions are
-- SECURITY DEFINER owned by the database owner.
--
-- Verified on the live project: owner created, ownership transferred, profile
-- created, pending row claimed — AND an ordinary ownership UPDATE is still
-- rejected with 42501.
-- ===========================================================================

create or replace function public.guard_tenant_billing_columns()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog', 'public' as $function$
begin
  if is_super_admin() then
    return new;
  end if;

  -- The pending-owner claim runs inside GoTrue's insert, where there is no
  -- JWT and therefore no auth.uid(). Only claim_pending_owner() sets this,
  -- and only for the duration of its own UPDATE.
  if coalesce(current_setting('app.claiming_pending_owner', true), '') = 'on' then
    return new;
  end if;

  if new.plan is distinct from old.plan then
    raise exception 'plan can only be changed by Digital Target' using errcode = '42501';
  end if;
  if new.plan_expires_at is distinct from old.plan_expires_at then
    raise exception 'plan expiry can only be changed by Digital Target' using errcode = '42501';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'account status can only be changed by Digital Target' using errcode = '42501';
  end if;
  if new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'ownership can only be changed by Digital Target' using errcode = '42501';
  end if;
  if new.slug is distinct from old.slug then
    raise exception 'slug can only be changed by Digital Target' using errcode = '42501';
  end if;

  return new;
end $function$;

create or replace function public.claim_pending_owner()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog', 'public' as $function$
declare p record;
begin
  select * into p from pending_owners
  where lower(email) = lower(new.email) and claimed_at is null;

  if found then
    -- branch_id was being discarded (hardcoded null), leaving the owner with
    -- no branch even though pending_owners records one.
    insert into user_profiles (user_id, tenant_id, branch_id, username,
                               display_name, role, all_branches)
    values (new.id, p.tenant_id, p.branch_id, 'owner', p.restaurant_name, 'owner', true)
    on conflict (user_id) do nothing;

    perform set_config('app.claiming_pending_owner', 'on', true);
    update tenants set owner_user_id = new.id where id = p.tenant_id;
    perform set_config('app.claiming_pending_owner', 'off', true);

    update pending_owners set claimed_at = now() where email = p.email;
  end if;
  return new;
end $function$;
