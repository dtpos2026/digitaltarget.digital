GRANT SELECT ON public.menu_items TO anon;
GRANT SELECT ON public.categories TO anon;
GRANT SELECT ON public.deals TO anon;
GRANT SELECT ON public.branches TO anon;

CREATE POLICY "public_menu_read" ON public.menu_items FOR SELECT TO anon
  USING (is_active IS DISTINCT FROM false AND deleted_at IS NULL);
CREATE POLICY "public_categories_read" ON public.categories FOR SELECT TO anon
  USING (is_active IS DISTINCT FROM false AND deleted_at IS NULL);
CREATE POLICY "public_deals_read" ON public.deals FOR SELECT TO anon USING (true);
CREATE POLICY "public_branches_read" ON public.branches FOR SELECT TO anon USING (true);