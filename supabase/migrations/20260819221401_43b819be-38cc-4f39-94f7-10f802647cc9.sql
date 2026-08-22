CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.verify_staff_pin(
  p_tenant uuid,
  p_username text,
  p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_profile public.user_profiles;
BEGIN
  IF auth.uid() IS NULL OR p_tenant IS DISTINCT FROM public.auth_tenant_id() THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  SELECT * INTO v_profile
  FROM public.user_profiles
  WHERE tenant_id = p_tenant
    AND lower(username) = lower(trim(p_username))
    AND is_active
  LIMIT 1;

  IF v_profile.user_id IS NULL
     OR v_profile.pin_hash IS NULL
     OR crypt(p_pin, v_profile.pin_hash) <> v_profile.pin_hash THEN
    RETURN jsonb_build_object('ok', false);
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

REVOKE ALL ON FUNCTION public.verify_staff_pin(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_staff_pin(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_staff_pin(uuid, text, text) TO service_role;

UPDATE public.user_profiles p
SET username = 'admin',
    pin_hash = crypt('admin123', gen_salt('bf')),
    updated_at = now()
FROM public.tenants t
WHERE p.user_id = t.owner_user_id
  AND p.tenant_id = t.id
  AND NOT EXISTS (
    SELECT 1 FROM public.user_profiles other
    WHERE other.tenant_id = p.tenant_id
      AND lower(other.username) = 'admin'
      AND other.user_id <> p.user_id
  );