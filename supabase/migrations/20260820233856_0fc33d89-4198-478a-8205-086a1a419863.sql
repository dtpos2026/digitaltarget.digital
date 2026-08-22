CREATE TABLE IF NOT EXISTS public.module_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  kind text NOT NULL,
  doc_id text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, doc_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.module_documents TO authenticated;
GRANT ALL ON public.module_documents TO service_role;

ALTER TABLE public.module_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read module documents"
  ON public.module_documents FOR SELECT TO authenticated
  USING (tenant_id = public.auth_tenant_id());

CREATE POLICY "tenant members write module documents"
  ON public.module_documents FOR ALL TO authenticated
  USING (tenant_id = public.auth_tenant_id())
  WITH CHECK (tenant_id = public.auth_tenant_id());

CREATE TRIGGER module_documents_updated_at
  BEFORE UPDATE ON public.module_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS module_documents_tenant_kind_idx
  ON public.module_documents (tenant_id, kind, updated_at DESC);