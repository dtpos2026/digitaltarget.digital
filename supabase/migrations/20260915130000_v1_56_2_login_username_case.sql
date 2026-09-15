-- v1.56.2 — "Wrong username or password" for a password that is correct
--
-- REPORTED: "ksi ka user login he nhi krta koi bug ha shid jis wja sy ksi
-- resturant ka user login nhi ho rha".
--
-- The POS has TWO sign-in paths and they did not agree with each other:
--
--   staff_login_global()   where lower(u.username) = lower(btrim(p_username))
--   verify_staff_pin()     where username = p_username
--
-- LoginPage takes the second one whenever the owner's Supabase session is
-- live, and the first otherwise. So the SAME credentials worked or failed
-- depending on which path ran — and the failure came back as the flat
-- "Wrong username or password", which is the one thing it was not.
--
-- Verified against the live database as the owner, before this change:
--
--     verify_staff_pin(tenant, 'admin',   '00003354')  -> ok: true
--     verify_staff_pin(tenant, 'Admin',   '00003354')  -> ok: false
--     verify_staff_pin(tenant, 'ADMIN',   '00003354')  -> ok: false
--     verify_staff_pin(tenant, ' admin ', '00003354')  -> ok: false
--
-- On a phone or tablet the keyboard capitalises the first letter by itself, so
-- "Admin" is precisely what a cashier types. The account was never wrong.
--
-- The password itself stays EXACT — it is trimmed nowhere and compared
-- verbatim against its bcrypt hash. Only the username is normalised, and only
-- the way the other path already normalised it. Nothing is weakened: the same
-- row is found, by the same unique username, and the hash check is unchanged.
--
-- Idempotent: CREATE OR REPLACE only. No data is read or written.

create or replace function public.verify_staff_pin(p_tenant uuid, p_username text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare p record;
begin
  if not (coalesce(p_tenant = auth_tenant_id(), false) or coalesce(is_super_admin(), false)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select user_id, display_name, role, branch_id, permissions, feature_permissions,
         must_change_password
    into p
  from user_profiles
  where tenant_id = p_tenant
    -- Matched exactly as staff_login_global() matches it. The password below
    -- is still compared verbatim.
    and lower(username) = lower(btrim(p_username))
    and is_active
    and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash);

  if not found then return jsonb_build_object('ok', false); end if;

  return jsonb_build_object(
    'ok', true, 'user_id', p.user_id, 'name', p.display_name,
    'role', p.role, 'branch_id', p.branch_id,
    'permissions', p.permissions, 'feature_permissions', p.feature_permissions,
    'must_change_password', coalesce(p.must_change_password, false));
end $$;

-- staff_login_check() is the service-role path LoginPage falls back to. It
-- already lowercases, but pin_hash null and "wrong password" must stay
-- distinguishable there, so it is left exactly as it is.
