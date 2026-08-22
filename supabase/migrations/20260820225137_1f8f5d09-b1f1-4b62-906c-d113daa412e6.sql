CREATE POLICY "support_attachments_super_admin_all"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'support-attachments' AND public.is_super_admin())
WITH CHECK (bucket_id = 'support-attachments' AND public.is_super_admin());