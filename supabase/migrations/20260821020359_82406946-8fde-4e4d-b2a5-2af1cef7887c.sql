CREATE OR REPLACE FUNCTION public.update_own_tenant_name(p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_tenant := public.auth_tenant_id();
  v_name := btrim(coalesce(p_name, ''));

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Restaurant identity not found';
  END IF;
  IF NOT public.auth_is_tenant_admin() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a restaurant admin can update the restaurant profile';
  END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'Restaurant name must be between 2 and 120 characters';
  END IF;

  UPDATE public.tenants
  SET name = v_name, updated_at = now()
  WHERE id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_own_tenant_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_own_tenant_name(text) TO authenticated;