CREATE OR REPLACE FUNCTION public.set_default_owner_pos_login(
  p_user_id uuid,
  p_tenant uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE public.user_profiles
  SET username = 'admin',
      pin_hash = crypt('admin123', gen_salt('bf')),
      updated_at = now()
  WHERE user_id = p_user_id
    AND tenant_id = p_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owner profile not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_owner_pos_login(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_default_owner_pos_login(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.set_default_owner_pos_login(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_default_owner_pos_login(uuid, uuid) TO service_role;