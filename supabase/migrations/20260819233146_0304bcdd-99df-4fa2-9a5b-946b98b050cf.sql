DO $$
DECLARE t text;
DECLARE tbls text[] := ARRAY[
  'stock_logs','employees','attendance','leaves','payslips','advances',
  'account_categories','transactions','parties','ledger_entries','day_closes',
  'receiving_entries','recipes','wastages','credit_payments','refunds'
];
BEGIN
FOREACH t IN ARRAY tbls LOOP
  EXECUTE format($f$
    CREATE TABLE IF NOT EXISTS public.%I (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
      branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  $f$, t);

  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated;', t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='tenant_all') THEN
    EXECUTE format($p$
      CREATE POLICY tenant_all ON public.%I FOR ALL TO authenticated
      USING (public.is_super_admin() OR tenant_id = public.auth_tenant_id())
      WITH CHECK (public.is_super_admin() OR tenant_id = public.auth_tenant_id());
    $p$, t);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_updated_at') THEN
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();', t || '_updated_at', t);
  END IF;

  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id, updated_at DESC);', t || '_tenant_updated_idx', t);
  EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL;', t);
  BEGIN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', t);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END LOOP;
END $$;