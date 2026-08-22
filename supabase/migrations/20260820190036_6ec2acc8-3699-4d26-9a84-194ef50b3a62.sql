CREATE TABLE public.service_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  table_label text NOT NULL,
  floor_name text,
  message text NOT NULL DEFAULT 'Call Waiter',
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE, DELETE ON public.service_calls TO authenticated;
GRANT ALL ON public.service_calls TO service_role;

ALTER TABLE public.service_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Restaurant staff view own service calls"
ON public.service_calls FOR SELECT TO authenticated
USING (tenant_id = public.auth_tenant_id() OR public.is_super_admin());

CREATE POLICY "Restaurant staff update own service calls"
ON public.service_calls FOR UPDATE TO authenticated
USING (tenant_id = public.auth_tenant_id())
WITH CHECK (tenant_id = public.auth_tenant_id());

CREATE POLICY "Restaurant staff delete own service calls"
ON public.service_calls FOR DELETE TO authenticated
USING (tenant_id = public.auth_tenant_id());

CREATE TRIGGER update_service_calls_updated_at
BEFORE UPDATE ON public.service_calls
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.public_place_order(
  p_tenant uuid,
  p_branch uuid,
  p_order jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_branch uuid;
  v_number integer;
  v_total numeric;
  v_status text;
  v_data jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant AND is_active) THEN
    RAISE EXCEPTION 'Restaurant is not available';
  END IF;

  v_id := COALESCE(NULLIF(p_order->>'id', '')::uuid, gen_random_uuid());
  v_branch := p_branch;
  IF v_branch IS NULL THEN
    SELECT id INTO v_branch FROM public.branches
    WHERE tenant_id = p_tenant AND is_active
    ORDER BY sort_order, created_at LIMIT 1;
  END IF;
  IF v_branch IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches WHERE id = v_branch AND tenant_id = p_tenant AND is_active
  ) THEN
    RAISE EXCEPTION 'Branch is not available';
  END IF;
  IF jsonb_typeof(p_order->'items') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_order->'items') < 1
     OR jsonb_array_length(p_order->'items') > 100 THEN
    RAISE EXCEPTION 'Order items are invalid';
  END IF;

  v_total := COALESCE(NULLIF(p_order->>'grandTotal', '')::numeric, 0);
  IF v_total < 0 OR v_total > 100000000 THEN RAISE EXCEPTION 'Order total is invalid'; END IF;
  v_status := CASE WHEN p_order->>'status' = 'pending_approval' THEN 'pending_approval' ELSE 'running' END;

  INSERT INTO public.order_counters (tenant_id, branch_id, last_number)
  VALUES (p_tenant, v_branch, 1)
  ON CONFLICT (tenant_id, branch_id)
  DO UPDATE SET last_number = public.order_counters.last_number + 1, updated_at = now()
  RETURNING last_number INTO v_number;

  v_data := p_order || jsonb_build_object(
    'id', v_id::text,
    'orderNumber', v_number,
    'branchId', v_branch::text,
    'status', v_status,
    'createdAt', COALESCE(NULLIF(p_order->>'createdAt', ''), now()::text),
    '_updatedAt', (extract(epoch from clock_timestamp()) * 1000)::bigint
  );

  INSERT INTO public.orders (
    id, tenant_id, branch_id, order_number, status, total, data, client_seq
  ) VALUES (
    v_id, p_tenant, v_branch, v_number, v_status, v_total, v_data,
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  );

  RETURN jsonb_build_object('id', v_id, 'order_number', v_number, 'order', v_data);
END;
$$;

REVOKE ALL ON FUNCTION public.public_place_order(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_place_order(uuid, uuid, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_track_order(
  p_tenant uuid,
  p_order_id uuid DEFAULT NULL,
  p_order_number integer DEFAULT NULL,
  p_phone_last4 text DEFAULT NULL,
  p_table_label text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_phone text;
  v_table text;
BEGIN
  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders
    WHERE id = p_order_id AND tenant_id = p_tenant AND deleted_at IS NULL;
  ELSE
    SELECT * INTO v_order FROM public.orders
    WHERE tenant_id = p_tenant AND order_number = p_order_number AND deleted_at IS NULL
    ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF v_order.id IS NULL THEN RETURN NULL; END IF;

  IF p_order_id IS NULL THEN
    v_phone := right(regexp_replace(COALESCE(v_order.data->'customer'->>'phone', ''), '\D', '', 'g'), 4);
    v_table := lower(COALESCE(v_order.data->>'tableLabel', v_order.data->>'tableName', ''));
    IF length(COALESCE(p_phone_last4, '')) < 4 AND length(trim(COALESCE(p_table_label, ''))) < 1 THEN
      RETURN NULL;
    END IF;
    IF right(regexp_replace(COALESCE(p_phone_last4, ''), '\D', '', 'g'), 4) IS DISTINCT FROM v_phone
       AND position(lower(trim(COALESCE(p_table_label, ''))) in v_table) = 0 THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN v_order.data || jsonb_build_object(
    'id', v_order.id::text,
    'orderNumber', v_order.order_number,
    'status', v_order.status,
    'grandTotal', v_order.total,
    '_updatedAt', (extract(epoch from v_order.updated_at) * 1000)::bigint
  );
END;
$$;

REVOKE ALL ON FUNCTION public.public_track_order(uuid, uuid, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_track_order(uuid, uuid, integer, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_call_waiter(
  p_tenant uuid,
  p_branch uuid,
  p_table_label text,
  p_floor_name text DEFAULT NULL,
  p_message text DEFAULT 'Call Waiter'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_call public.service_calls;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant AND is_active) THEN
    RAISE EXCEPTION 'Restaurant is not available';
  END IF;
  IF p_branch IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches WHERE id = p_branch AND tenant_id = p_tenant AND is_active
  ) THEN RAISE EXCEPTION 'Branch is not available'; END IF;
  IF length(trim(COALESCE(p_table_label, ''))) < 1 OR length(p_table_label) > 100 THEN
    RAISE EXCEPTION 'Table is required';
  END IF;

  INSERT INTO public.service_calls (tenant_id, branch_id, table_label, floor_name, message)
  VALUES (p_tenant, p_branch, trim(p_table_label), nullif(trim(p_floor_name), ''), left(COALESCE(NULLIF(trim(p_message), ''), 'Call Waiter'), 300))
  RETURNING * INTO v_call;

  RETURN jsonb_build_object(
    'id', v_call.id, 'tableLabel', v_call.table_label, 'floorName', v_call.floor_name,
    'message', v_call.message, 'at', v_call.created_at, 'acked', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.public_call_waiter(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_call_waiter(uuid, uuid, text, text, text) TO anon, authenticated;