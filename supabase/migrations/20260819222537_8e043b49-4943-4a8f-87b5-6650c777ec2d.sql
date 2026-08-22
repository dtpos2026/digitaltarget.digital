CREATE OR REPLACE FUNCTION public.staff_login_check(p_tenant uuid, p_username text, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_profile public.user_profiles;
BEGIN
  IF p_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_tenant');
  END IF;

  SELECT * INTO v_profile
  FROM public.user_profiles
  WHERE tenant_id = p_tenant
    AND lower(username) = lower(trim(p_username))
  LIMIT 1;

  IF v_profile.user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user');
  END IF;
  IF NOT v_profile.is_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
  END IF;
  IF v_profile.pin_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_password');
  END IF;
  IF crypt(p_pin, v_profile.pin_hash) <> v_profile.pin_hash THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_password');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_profile.user_id,
    'name', v_profile.display_name,
    'role', v_profile.role,
    'branch_id', v_profile.branch_id,
    'permissions', v_profile.permissions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_login_check(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_login_check(uuid, text, text) TO service_role;