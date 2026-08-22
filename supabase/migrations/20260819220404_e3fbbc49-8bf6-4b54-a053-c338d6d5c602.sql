CREATE TABLE public.pending_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_owners TO authenticated;
GRANT ALL ON public.pending_owners TO service_role;
ALTER TABLE public.pending_owners ENABLE ROW LEVEL SECURITY;
CREATE POLICY sa_all ON public.pending_owners FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER update_pending_owners_updated_at BEFORE UPDATE ON public.pending_owners
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
INSERT INTO public.pending_owners (tenant_id, email)
SELECT c.linked_tenant_id, lower(c.email)
FROM public.admin_marketing_contacts c
WHERE c.linked_tenant_id IS NOT NULL AND c.email IS NOT NULL
ON CONFLICT (tenant_id) DO NOTHING;