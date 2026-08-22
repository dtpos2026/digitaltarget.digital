CREATE TABLE public.staff_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  user_id uuid,
  user_name text,
  user_role text,
  action text NOT NULL,
  order_id text,
  order_number integer,
  table_label text,
  device_id text,
  device_name text,
  approved_by text,
  reason text,
  amount numeric,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.staff_audit_logs TO authenticated;
GRANT ALL ON public.staff_audit_logs TO service_role;

ALTER TABLE public.staff_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant staff can add audit entries"
ON public.staff_audit_logs FOR INSERT TO authenticated
WITH CHECK (tenant_id = public.auth_tenant_id());

CREATE POLICY "Tenant members can read audit entries"
ON public.staff_audit_logs FOR SELECT TO authenticated
USING (tenant_id = public.auth_tenant_id() AND public.auth_can_branch(branch_id));

CREATE INDEX staff_audit_logs_tenant_time_idx ON public.staff_audit_logs (tenant_id, created_at DESC);

CREATE TABLE public.staff_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  user_id uuid,
  staff_key text NOT NULL,
  user_name text,
  user_role text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_m double precision,
  speed_kmh double precision,
  device_name text,
  consent boolean NOT NULL DEFAULT true,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.staff_locations TO authenticated;
GRANT ALL ON public.staff_locations TO service_role;

ALTER TABLE public.staff_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant staff can add their location points"
ON public.staff_locations FOR INSERT TO authenticated
WITH CHECK (tenant_id = public.auth_tenant_id() AND consent = true);

CREATE POLICY "Tenant members can read location history"
ON public.staff_locations FOR SELECT TO authenticated
USING (tenant_id = public.auth_tenant_id() AND public.auth_can_branch(branch_id));

CREATE INDEX staff_locations_tenant_time_idx ON public.staff_locations (tenant_id, recorded_at DESC);
CREATE INDEX staff_locations_staff_idx ON public.staff_locations (tenant_id, staff_key, recorded_at DESC);