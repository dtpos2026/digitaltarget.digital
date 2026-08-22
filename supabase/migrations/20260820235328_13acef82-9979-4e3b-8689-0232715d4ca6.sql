ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ip text,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_approved boolean NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS public.register_device(text, text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.register_device(
  p_hardware_id text,
  p_label text,
  p_branch_id uuid,
  p_platform text DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb,
  p_ip text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_row public.devices;
  v_limit integer;
  v_custom integer;
  v_plan text;
  v_active integer;
BEGIN
  v_tenant := public.auth_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No restaurant for this account'; END IF;

  INSERT INTO public.devices (
    tenant_id, branch_id, device_label, hardware_id, platform, app_version,
    meta, ip, last_seen_at, last_login_at, login_count
  ) VALUES (
    v_tenant, p_branch_id, p_label, p_hardware_id, p_platform, p_app_version,
    COALESCE(p_meta, '{}'::jsonb), p_ip, now(), now(), 1
  )
  ON CONFLICT (tenant_id, hardware_id) DO UPDATE SET
    device_label = EXCLUDED.device_label,
    branch_id    = COALESCE(EXCLUDED.branch_id, public.devices.branch_id),
    platform     = EXCLUDED.platform,
    app_version  = EXCLUDED.app_version,
    meta         = public.devices.meta || COALESCE(EXCLUDED.meta, '{}'::jsonb),
    ip           = COALESCE(EXCLUDED.ip, public.devices.ip),
    last_seen_at = now(),
    last_login_at = now(),
    login_count  = public.devices.login_count + 1
  RETURNING * INTO v_row;

  IF v_row.blocked THEN
    RETURN jsonb_build_object(
      'device_id', v_row.id, 'approved', false, 'blocked', true,
      'reason', COALESCE(v_row.blocked_reason, 'Device blocked by Super Admin'),
      'device_limit', NULL, 'active_devices', NULL
    );
  END IF;

  IF NOT v_row.approved THEN
    SELECT t.plan, t.custom_device_limit INTO v_plan, v_custom
    FROM public.tenants t WHERE t.id = v_tenant;

    IF v_custom IS NOT NULL AND v_custom > 0 THEN
      v_limit := v_custom;
    ELSE
      SELECT p.device_limit INTO v_limit
      FROM public.admin_plans p WHERE p.code = COALESCE(v_plan, 'trial');
      v_limit := COALESCE(v_limit, 1);
    END IF;

    SELECT count(*) INTO v_active FROM public.devices d
    WHERE d.tenant_id = v_tenant AND d.approved AND NOT d.blocked AND d.id <> v_row.id;

    IF v_limit = 0 OR v_active < v_limit THEN
      UPDATE public.devices
        SET approved = true, approved_at = now(), auto_approved = true
      WHERE id = v_row.id
      RETURNING * INTO v_row;
    END IF;
  END IF;

  SELECT count(*) INTO v_active FROM public.devices d
  WHERE d.tenant_id = v_tenant AND d.approved AND NOT d.blocked;

  RETURN jsonb_build_object(
    'device_id', v_row.id,
    'approved', v_row.approved,
    'blocked', v_row.blocked,
    'auto_approved', v_row.auto_approved,
    'device_limit', v_limit,
    'active_devices', v_active
  );
END $function$;