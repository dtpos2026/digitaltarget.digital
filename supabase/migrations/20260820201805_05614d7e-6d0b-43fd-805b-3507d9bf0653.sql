-- ============================================================
-- 1. STAFF ACCOUNT SECURITY (no self privilege escalation)
-- ============================================================
DROP POLICY IF EXISTS "tenant_all" ON public.user_profiles;

CREATE POLICY "profiles_read_tenant" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR tenant_id = public.auth_tenant_id());

CREATE POLICY "profiles_admin_insert" ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR (tenant_id = public.auth_tenant_id() AND public.auth_is_tenant_admin()));

CREATE POLICY "profiles_admin_update" ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR (tenant_id = public.auth_tenant_id() AND public.auth_is_tenant_admin()))
  WITH CHECK (public.is_super_admin() OR (tenant_id = public.auth_tenant_id() AND public.auth_is_tenant_admin()));

CREATE POLICY "profiles_admin_delete" ON public.user_profiles
  FOR DELETE TO authenticated
  USING (public.is_super_admin() OR (tenant_id = public.auth_tenant_id() AND public.auth_is_tenant_admin()));

-- ============================================================
-- 2. REPAIR EXISTING DUPLICATE ORDER NUMBERS (per tenant+branch)
-- ============================================================
WITH ranked AS (
  SELECT id, tenant_id, branch_id, order_number,
         row_number() OVER (
           PARTITION BY tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), order_number
           ORDER BY created_at, id
         ) AS rn
  FROM public.orders
  WHERE deleted_at IS NULL AND order_number IS NOT NULL
),
maxes AS (
  SELECT tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) AS bkey,
         max(order_number) AS mx
  FROM public.orders WHERE deleted_at IS NULL GROUP BY 1, 2
),
dupes AS (
  SELECT r.id, m.mx + row_number() OVER (PARTITION BY r.tenant_id, r.branch_id ORDER BY r.id) AS new_number
  FROM ranked r
  JOIN maxes m ON m.tenant_id = r.tenant_id
              AND m.bkey = coalesce(r.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  WHERE r.rn > 1
)
UPDATE public.orders o
SET order_number = d.new_number,
    data = o.data || jsonb_build_object('orderNumber', d.new_number, 'renumberedAt', now()::text)
FROM dupes d
WHERE o.id = d.id;

-- ============================================================
-- 3. ONE NUMBER = ONE BILL (database-enforced)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS orders_unique_number_per_branch
  ON public.orders (
    tenant_id,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    order_number
  )
  WHERE deleted_at IS NULL AND order_number IS NOT NULL;

-- ============================================================
-- 4. COUNTERS CONTINUE FROM THE HIGHEST EXISTING NUMBER
-- ============================================================
INSERT INTO public.order_counters (tenant_id, branch_id, last_number)
SELECT o.tenant_id, o.branch_id, max(o.order_number)
FROM public.orders o
WHERE o.branch_id IS NOT NULL AND o.order_number IS NOT NULL
GROUP BY o.tenant_id, o.branch_id
ON CONFLICT (tenant_id, branch_id) DO UPDATE
SET last_number = GREATEST(public.order_counters.last_number, excluded.last_number),
    updated_at = now();

-- ============================================================
-- 5. SERVER-AUTHORITATIVE ORDER NUMBERING ON SYNC
--    The device's own number is never trusted for a NEW order.
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_sync_batch(p_device_id uuid, p_ops jsonb)
 RETURNS TABLE(op_id uuid, result text, order_number integer, entity_id uuid, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        -- Existing bill keeps the number it was already given.
        SELECT o.order_number INTO v_num FROM orders o WHERE o.id = v_entity_id;

        -- New bill: the SERVER mints the number. A device-supplied number is
        -- ignored, because two offline tills both mint the same one.
        IF v_num IS NULL THEN
          INSERT INTO order_counters (tenant_id, branch_id, last_number)
          VALUES (v_dev.tenant_id, v_dev.branch_id, 1)
          ON CONFLICT (tenant_id, branch_id)
          DO UPDATE SET last_number = order_counters.last_number + 1, updated_at = now()
          RETURNING last_number INTO v_num;
        END IF;

        -- Keep the stored document consistent with the authoritative number.
        v_data := v_data || jsonb_build_object('orderNumber', v_num);

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
END $function$;