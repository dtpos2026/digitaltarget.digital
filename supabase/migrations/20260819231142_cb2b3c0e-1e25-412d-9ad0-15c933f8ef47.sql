CREATE OR REPLACE FUNCTION public.pos_list_users()
RETURNS TABLE(
  user_id uuid,
  username text,
  display_name text,
  role text,
  branch_id uuid,
  permissions text[],
  feature_permissions text[],
  phone text,
  all_branches boolean,
  is_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_role text;
BEGIN
  v_tenant := public.auth_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No restaurant is linked to this account';
  END IF;

  SELECT p.role INTO v_role
  FROM public.user_profiles p
  WHERE p.user_id = auth.uid()
    AND p.tenant_id = v_tenant
    AND p.is_active;

  IF v_role NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'Only an owner, admin, or manager can view staff users';
  END IF;

  RETURN QUERY
  SELECT p.user_id, p.username, p.display_name, p.role, p.branch_id,
         p.permissions, p.feature_permissions, p.phone,
         p.all_branches, p.is_active
  FROM public.user_profiles p
  WHERE p.tenant_id = v_tenant
  ORDER BY CASE WHEN p.role = 'owner' THEN 0 ELSE 1 END, lower(p.display_name);
END;
$$;

REVOKE ALL ON FUNCTION public.pos_list_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pos_list_users() FROM anon;
GRANT EXECUTE ON FUNCTION public.pos_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pos_list_users() TO service_role;