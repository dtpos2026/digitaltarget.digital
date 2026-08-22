DO $$
DECLARE t text;
DECLARE tbls text[] := ARRAY[
  'categories','menu_items','dining_tables','floors','kitchens','inventory_items',
  'inventory_categories','customers','branches','deals','promo_codes',
  'payment_accounts','shifts','tenant_settings','order_items','order_payments'
];
BEGIN
FOREACH t IN ARRAY tbls LOOP
  EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL;', t);
  BEGIN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', t);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END LOOP;
END $$;