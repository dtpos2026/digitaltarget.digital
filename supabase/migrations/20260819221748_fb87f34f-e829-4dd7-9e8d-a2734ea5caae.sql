
CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  order_number integer,
  status text NOT NULL DEFAULT 'open',
  total numeric NOT NULL DEFAULT 0,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_seq bigint NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_branch_updated_idx ON public.orders(branch_id, updated_at);
CREATE INDEX orders_tenant_idx ON public.orders(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders tenant access" ON public.orders FOR ALL TO authenticated
  USING (tenant_id = public.auth_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.auth_tenant_id());

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_seq bigint NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_items_order_idx ON public.order_items(order_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_items tenant access" ON public.order_items FOR ALL TO authenticated
  USING (tenant_id = public.auth_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.auth_tenant_id());

CREATE TABLE public.order_payments (
  id uuid PRIMARY KEY,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  amount numeric NOT NULL DEFAULT 0,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_seq bigint NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_payments_order_idx ON public.order_payments(order_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_payments TO authenticated;
GRANT ALL ON public.order_payments TO service_role;
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_payments tenant access" ON public.order_payments FOR ALL TO authenticated
  USING (tenant_id = public.auth_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.auth_tenant_id());

CREATE TABLE public.order_counters (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, branch_id)
);
GRANT SELECT ON public.order_counters TO authenticated;
GRANT ALL ON public.order_counters TO service_role;
ALTER TABLE public.order_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_counters tenant read" ON public.order_counters FOR SELECT TO authenticated
  USING (tenant_id = public.auth_tenant_id() OR public.is_super_admin());

CREATE TABLE public.sync_ops (
  op_id uuid PRIMARY KEY,
  device_id uuid REFERENCES public.devices(id) ON DELETE CASCADE,
  tenant_id uuid,
  entity text NOT NULL,
  entity_id uuid,
  order_number integer,
  applied_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sync_ops TO authenticated;
GRANT ALL ON public.sync_ops TO service_role;
ALTER TABLE public.sync_ops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sync_ops tenant read" ON public.sync_ops FOR SELECT TO authenticated
  USING (tenant_id = public.auth_tenant_id() OR public.is_super_admin());

CREATE TRIGGER orders_updated_at BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER order_items_updated_at BEFORE UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER order_payments_updated_at BEFORE UPDATE ON public.order_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.next_order_number(p_tenant uuid, p_branch uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n integer;
BEGIN
  IF p_tenant IS DISTINCT FROM public.auth_tenant_id() THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  INSERT INTO order_counters (tenant_id, branch_id, last_number)
  VALUES (p_tenant, p_branch, 1)
  ON CONFLICT (tenant_id, branch_id)
  DO UPDATE SET last_number = order_counters.last_number + 1, updated_at = now()
  RETURNING last_number INTO v_n;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.device_heartbeat(p_device_id uuid, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL, p_app_version text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE devices SET
    last_seen_at = now(),
    lat = COALESCE(p_lat, lat),
    lng = COALESCE(p_lng, lng),
    app_version = COALESCE(p_app_version, app_version)
  WHERE id = p_device_id AND tenant_id = public.auth_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Device not found for this restaurant'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.apply_sync_batch(p_device_id uuid, p_ops jsonb)
RETURNS TABLE(op_id uuid, result text, order_number integer, entity_id uuid, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_dev devices;
  v_op jsonb;
  v_op_id uuid; v_entity text; v_entity_id uuid; v_operation text; v_data jsonb; v_seq bigint;
  v_prev sync_ops;
  v_num integer;
BEGIN
  SELECT * INTO v_dev FROM devices WHERE id = p_device_id;
  IF v_dev.id IS NULL OR v_dev.tenant_id IS DISTINCT FROM public.auth_tenant_id() THEN
    RAISE EXCEPTION 'Device not registered for this restaurant';
  END IF;
  IF NOT v_dev.approved THEN
    RAISE EXCEPTION 'Device not approved for this restaurant';
  END IF;

  UPDATE devices SET last_seen_at = now(), last_sync_at = now() WHERE id = p_device_id;

  FOR v_op IN SELECT * FROM jsonb_array_elements(p_ops) LOOP
    v_op_id := (v_op->>'op_id')::uuid;
    v_entity := v_op->>'entity';
    v_entity_id := (v_op->>'entity_id')::uuid;
    v_operation := coalesce(v_op->>'operation', 'insert');
    v_data := coalesce(v_op->'data', '{}'::jsonb);
    v_seq := coalesce((v_op->>'client_seq')::bigint, 0);
    v_num := NULL;

    SELECT * INTO v_prev FROM sync_ops s WHERE s.op_id = v_op_id;
    IF v_prev.op_id IS NOT NULL THEN
      op_id := v_op_id; result := 'duplicate'; order_number := v_prev.order_number;
      entity_id := v_entity_id; reason := NULL; RETURN NEXT; CONTINUE;
    END IF;

    IF v_entity = 'orders' THEN
      IF v_operation = 'delete' THEN
        UPDATE orders SET deleted_at = now() WHERE id = v_entity_id AND tenant_id = v_dev.tenant_id;
      ELSE
        SELECT o.order_number INTO v_num FROM orders o WHERE o.id = v_entity_id;
        IF v_num IS NULL THEN
          v_num := coalesce(nullif((v_data->>'orderNumber')::text,'')::integer, NULL);
        END IF;
        IF v_num IS NULL THEN
          INSERT INTO order_counters (tenant_id, branch_id, last_number)
          VALUES (v_dev.tenant_id, v_dev.branch_id, 1)
          ON CONFLICT (tenant_id, branch_id)
          DO UPDATE SET last_number = order_counters.last_number + 1, updated_at = now()
          RETURNING last_number INTO v_num;
        END IF;
        INSERT INTO orders (id, tenant_id, branch_id, device_id, order_number, status, total, data, client_seq)
        VALUES (v_entity_id, v_dev.tenant_id, v_dev.branch_id, v_dev.id, v_num,
                coalesce(v_data->>'status','open'),
                coalesce(nullif(v_data->>'total','')::numeric, 0), v_data, v_seq)
        ON CONFLICT (id) DO UPDATE SET
          status = excluded.status, total = excluded.total, data = excluded.data,
          client_seq = excluded.client_seq, order_number = coalesce(orders.order_number, excluded.order_number),
          updated_at = now()
        WHERE orders.client_seq <= excluded.client_seq;
      END IF;
    ELSIF v_entity = 'order_items' THEN
      IF v_operation = 'delete' THEN
        UPDATE order_items SET deleted_at = now() WHERE id = v_entity_id AND tenant_id = v_dev.tenant_id;
      ELSE
        INSERT INTO order_items (id, order_id, tenant_id, branch_id, data, client_seq)
        VALUES (v_entity_id, nullif(v_data->>'orderId','')::uuid, v_dev.tenant_id, v_dev.branch_id, v_data, v_seq)
        ON CONFLICT (id) DO UPDATE SET data = excluded.data, client_seq = excluded.client_seq, updated_at = now()
        WHERE order_items.client_seq <= excluded.client_seq;
      END IF;
    ELSIF v_entity = 'order_payments' THEN
      IF v_operation = 'delete' THEN
        UPDATE order_payments SET deleted_at = now() WHERE id = v_entity_id AND tenant_id = v_dev.tenant_id;
      ELSE
        INSERT INTO order_payments (id, order_id, tenant_id, branch_id, amount, data, client_seq)
        VALUES (v_entity_id, nullif(v_data->>'orderId','')::uuid, v_dev.tenant_id, v_dev.branch_id,
                coalesce(nullif(v_data->>'amount','')::numeric, 0), v_data, v_seq)
        ON CONFLICT (id) DO UPDATE SET amount = excluded.amount, data = excluded.data,
          client_seq = excluded.client_seq, updated_at = now()
        WHERE order_payments.client_seq <= excluded.client_seq;
      END IF;
    ELSE
      op_id := v_op_id; result := 'rejected'; order_number := NULL;
      entity_id := v_entity_id; reason := 'unknown entity'; RETURN NEXT; CONTINUE;
    END IF;

    INSERT INTO sync_ops (op_id, device_id, tenant_id, entity, entity_id, order_number)
    VALUES (v_op_id, v_dev.id, v_dev.tenant_id, v_entity, v_entity_id, v_num);

    op_id := v_op_id; result := 'applied'; order_number := v_num;
    entity_id := v_entity_id; reason := NULL; RETURN NEXT;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.pull_orders_delta(p_branch uuid, p_since timestamptz, p_limit integer DEFAULT 500)
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid;
BEGIN
  v_tenant := public.auth_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Not permitted'; END IF;
  RETURN QUERY
  SELECT to_jsonb(o) FROM orders o
  WHERE o.tenant_id = v_tenant AND (p_branch IS NULL OR o.branch_id = p_branch)
    AND o.updated_at > coalesce(p_since, '-infinity'::timestamptz)
  ORDER BY o.updated_at ASC
  LIMIT coalesce(p_limit, 500);
END $$;
