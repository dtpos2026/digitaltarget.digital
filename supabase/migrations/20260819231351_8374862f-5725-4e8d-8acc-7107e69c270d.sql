CREATE OR REPLACE FUNCTION public.pos_set_staff_profile(
  p_user_id uuid,
  p_tenant uuid,
  p_username text,
  p_password text,
  p_display_name text,
  p_role text,
  p_branch_id uuid DEFAULT NULL,
  p_permissions text[] DEFAULT '{}'::text[],
  p_feature_permissions text[] DEFAULT '{}'::text[],
  p_phone text DEFAULT NULL,
  p_all_branches boolean DEFAULT false,
  p_is_active boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_user_id IS NULL OR p_tenant IS NULL THEN
    RAISE EXCEPTION 'Staff account and restaurant are required';
  END IF;
  IF trim(coalesce(p_username, '')) = '' THEN
    RAISE EXCEPTION 'Username is required';
  END IF;
  IF length(coalesce(p_password, '')) < 4 THEN
    RAISE EXCEPTION 'Password must contain at least 4 characters';
  END IF;
  IF p_role NOT IN ('admin', 'manager', 'cashier', 'rider', 'order_taker') THEN
    RAISE EXCEPTION 'Invalid staff role';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND b.tenant_id = p_tenant
  ) THEN
    RAISE EXCEPTION 'Selected branch does not belong to this restaurant';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.tenant_id = p_tenant
      AND lower(p.username) = lower(trim(p_username))
      AND p.user_id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'This username is already in use at this restaurant';
  END IF;

  INSERT INTO public.user_profiles (
    user_id, tenant_id, branch_id, username, display_name, role,
    permissions, feature_permissions, phone, pin_hash, all_branches, is_active
  ) VALUES (
    p_user_id, p_tenant, p_branch_id, lower(trim(p_username)), trim(p_display_name), p_role,
    coalesce(p_permissions, '{}'::text[]), coalesce(p_feature_permissions, '{}'::text[]),
    nullif(trim(coalesce(p_phone, '')), ''), crypt(p_password, gen_salt('bf')),
    p_all_branches, p_is_active
  )
  ON CONFLICT (user_id) DO UPDATE SET
    branch_id = excluded.branch_id,
    username = excluded.username,
    display_name = excluded.display_name,
    role = excluded.role,
    permissions = excluded.permissions,
    feature_permissions = excluded.feature_permissions,
    phone = excluded.phone,
    pin_hash = excluded.pin_hash,
    all_branches = excluded.all_branches,
    is_active = excluded.is_active,
    updated_at = now()
  WHERE public.user_profiles.tenant_id = p_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff account belongs to a different restaurant';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_set_staff_profile(uuid, uuid, text, text, text, text, uuid, text[], text[], text, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pos_set_staff_profile(uuid, uuid, text, text, text, text, uuid, text[], text[], text, boolean, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.pos_set_staff_profile(uuid, uuid, text, text, text, text, uuid, text[], text[], text, boolean, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pos_set_staff_profile(uuid, uuid, text, text, text, text, uuid, text[], text[], text, boolean, boolean) TO service_role;