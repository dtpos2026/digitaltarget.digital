CREATE OR REPLACE FUNCTION public.reset_order_counter(p_branch uuid DEFAULT NULL, p_start integer DEFAULT 0)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant uuid; v_start integer := GREATEST(COALESCE(p_start, 0), 0);
BEGIN
  v_tenant := public.auth_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not permitted'; END IF;

  IF p_branch IS NULL THEN
    UPDATE public.order_counters SET last_number = v_start, updated_at = now()
    WHERE tenant_id = v_tenant;
  ELSE
    INSERT INTO public.order_counters (tenant_id, branch_id, last_number)
    VALUES (v_tenant, p_branch, v_start)
    ON CONFLICT (tenant_id, branch_id)
    DO UPDATE SET last_number = v_start, updated_at = now();
  END IF;

  RETURN v_start;
END $$;

GRANT EXECUTE ON FUNCTION public.reset_order_counter(uuid, integer) TO authenticated;