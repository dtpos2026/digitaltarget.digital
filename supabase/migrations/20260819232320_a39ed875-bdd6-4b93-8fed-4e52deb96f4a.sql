CREATE TABLE public.tenant_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_settings TO authenticated;
GRANT ALL ON public.tenant_settings TO service_role;

ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Restaurant users manage own tenant settings"
ON public.tenant_settings
FOR ALL
TO authenticated
USING (tenant_id = public.auth_tenant_id() OR public.is_super_admin())
WITH CHECK (tenant_id = public.auth_tenant_id() OR public.is_super_admin());

CREATE TRIGGER tenant_settings_updated_at
BEFORE UPDATE ON public.tenant_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.devices
ADD COLUMN accuracy_m double precision;

NOTIFY pgrst, 'reload schema';