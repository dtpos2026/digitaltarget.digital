-- ============================================================
-- 1. BRANCH PROFILE FIELDS (additive, all nullable)
-- ============================================================
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS branch_code text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS registration_number text,
  ADD COLUMN IF NOT EXISTS tax_number text,
  ADD COLUMN IF NOT EXISTS invoice_prefix text,
  ADD COLUMN IF NOT EXISTS invoice_footer text;

CREATE UNIQUE INDEX IF NOT EXISTS branches_tenant_code_uniq
  ON public.branches (tenant_id, lower(branch_code)) WHERE branch_code IS NOT NULL;

-- ============================================================
-- 2. USER -> BRANCH ACCESS (multi-branch assignment)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_branch_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  role text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, branch_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_branch_access TO authenticated;
GRANT ALL ON public.user_branch_access TO service_role;

ALTER TABLE public.user_branch_access ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS uba_user_idx ON public.user_branch_access (user_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS uba_tenant_branch_idx ON public.user_branch_access (tenant_id, branch_id);

DROP TRIGGER IF EXISTS user_branch_access_updated_at ON public.user_branch_access;
CREATE TRIGGER user_branch_access_updated_at BEFORE UPDATE ON public.user_branch_access
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 3. AUTHORIZATION HELPERS (security definer, no recursion)
-- ============================================================
CREATE OR REPLACE FUNCTION public.auth_is_tenant_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.user_id = auth.uid() AND p.is_active
      AND (p.all_branches OR p.role IN ('owner','admin'))
  )
$$;

-- All branch ids the current user may touch.
CREATE OR REPLACE FUNCTION public.auth_branch_ids()
RETURNS TABLE(branch_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id FROM public.branches b
  WHERE b.tenant_id = public.auth_tenant_id()
    AND public.auth_is_tenant_admin()
  UNION
  SELECT p.branch_id FROM public.user_profiles p
  WHERE p.user_id = auth.uid() AND p.is_active AND p.branch_id IS NOT NULL
  UNION
  SELECT a.branch_id FROM public.user_branch_access a
  WHERE a.user_id = auth.uid() AND a.is_active
$$;

-- Branch gate used by RLS. NULL branch = legacy/global row -> allowed.
CREATE OR REPLACE FUNCTION public.auth_can_branch(p_branch uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_branch IS NULL
      OR public.auth_is_tenant_admin()
      OR EXISTS (SELECT 1 FROM public.auth_branch_ids() x WHERE x.branch_id = p_branch)
$$;

GRANT EXECUTE ON FUNCTION public.auth_is_tenant_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_branch_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_can_branch(uuid) TO authenticated;

-- RLS for the access table itself (after helpers exist)
DROP POLICY IF EXISTS uba_read_own ON public.user_branch_access;
CREATE POLICY uba_read_own ON public.user_branch_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR tenant_id = public.auth_tenant_id());

DROP POLICY IF EXISTS uba_admin_manage ON public.user_branch_access;
CREATE POLICY uba_admin_manage ON public.user_branch_access
  FOR ALL TO authenticated
  USING (public.auth_is_tenant_admin() AND (tenant_id = public.auth_tenant_id() OR public.is_super_admin()))
  WITH CHECK (public.auth_is_tenant_admin() AND (tenant_id = public.auth_tenant_id() OR public.is_super_admin()));

-- Backfill from existing single-branch profiles (idempotent)
INSERT INTO public.user_branch_access (user_id, tenant_id, branch_id, role, is_active)
SELECT p.user_id, p.tenant_id, p.branch_id, p.role, p.is_active
FROM public.user_profiles p
WHERE p.branch_id IS NOT NULL
ON CONFLICT (user_id, branch_id) DO NOTHING;

-- ============================================================
-- 4. BRANCH-LEVEL RLS (restrictive: ANDs with existing tenant rules)
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orders','order_items','order_payments','dining_tables','floors','table_sessions',
    'cash_movements','shifts','inventory_items','payment_accounts','kitchens','devices',
    'tenant_settings','transactions','ledger_entries','employees','attendance','advances',
    'leaves','payslips','day_closes','stock_logs','wastages','receiving_entries','recipes',
    'parties','credit_payments','account_categories','refunds','service_calls'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS branch_scope ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY branch_scope ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING (public.auth_can_branch(branch_id))
         WITH CHECK (public.auth_can_branch(branch_id))', t);
  END LOOP;
END $$;

-- ============================================================
-- 5. BRANCH-SPECIFIC MENU CONFIG (no product duplication)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.menu_item_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  price numeric,
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, menu_item_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_item_branches TO authenticated;
GRANT ALL ON public.menu_item_branches TO service_role;
ALTER TABLE public.menu_item_branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_all ON public.menu_item_branches;
CREATE POLICY tenant_all ON public.menu_item_branches FOR ALL TO authenticated
  USING (public.is_super_admin() OR tenant_id = public.auth_tenant_id())
  WITH CHECK (public.is_super_admin() OR tenant_id = public.auth_tenant_id());

DROP POLICY IF EXISTS branch_scope ON public.menu_item_branches;
CREATE POLICY branch_scope ON public.menu_item_branches AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.auth_can_branch(branch_id)) WITH CHECK (public.auth_can_branch(branch_id));

DROP TRIGGER IF EXISTS menu_item_branches_updated_at ON public.menu_item_branches;
CREATE TRIGGER menu_item_branches_updated_at BEFORE UPDATE ON public.menu_item_branches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS mib_tenant_branch_idx ON public.menu_item_branches (tenant_id, branch_id);

-- ============================================================
-- 6. PERFORMANCE INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS orders_tenant_branch_created_idx ON public.orders (tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_branch_status_idx ON public.orders (branch_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS order_items_order_idx ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS order_payments_order_idx ON public.order_payments (order_id);
CREATE INDEX IF NOT EXISTS dining_tables_branch_idx ON public.dining_tables (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS inventory_items_branch_idx ON public.inventory_items (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS shifts_branch_status_idx ON public.shifts (tenant_id, branch_id, status);
CREATE INDEX IF NOT EXISTS cash_movements_branch_idx ON public.cash_movements (tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_branch_idx ON public.transactions (tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS devices_branch_idx ON public.devices (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS user_profiles_tenant_idx ON public.user_profiles (tenant_id);