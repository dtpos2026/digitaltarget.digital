DO $$
DECLARE b text;
DECLARE buckets text[] := ARRAY['menu-images','branding','employee-docs','support-attachments'];
BEGIN
FOREACH b IN ARRAY buckets LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname = b || '_tenant_all') THEN
    EXECUTE format($p$
      CREATE POLICY %I ON storage.objects FOR ALL TO authenticated
      USING (bucket_id = %L AND (storage.foldername(name))[1] = public.auth_tenant_id()::text)
      WITH CHECK (bucket_id = %L AND (storage.foldername(name))[1] = public.auth_tenant_id()::text);
    $p$, b || '_tenant_all', b, b);
  END IF;
END LOOP;
END $$;