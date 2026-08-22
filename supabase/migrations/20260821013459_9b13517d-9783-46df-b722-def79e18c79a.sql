ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS workspace_code text;

CREATE OR REPLACE FUNCTION public.gen_workspace_code()
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_code text; v_try int := 0;
BEGIN
  LOOP
    v_try := v_try + 1;
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    v_code := regexp_replace(v_code, '[^A-Z0-9]', '', 'g');
    IF length(v_code) = 6 AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.workspace_code = v_code) THEN
      RETURN v_code;
    END IF;
    IF v_try > 50 THEN RETURN upper(substr(md5(gen_random_uuid()::text), 1, 6)); END IF;
  END LOOP;
END $$;

UPDATE public.tenants SET workspace_code = public.gen_workspace_code() WHERE workspace_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_workspace_code_key ON public.tenants (workspace_code);

CREATE OR REPLACE FUNCTION public.tenants_set_workspace_code()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.workspace_code IS NULL OR trim(NEW.workspace_code) = '' THEN
    NEW.workspace_code := public.gen_workspace_code();
  ELSE
    NEW.workspace_code := upper(trim(NEW.workspace_code));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tenants_workspace_code ON public.tenants;
CREATE TRIGGER tenants_workspace_code BEFORE INSERT OR UPDATE OF workspace_code ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.tenants_set_workspace_code();

CREATE INDEX IF NOT EXISTS user_profiles_username_lower_idx ON public.user_profiles (lower(username));

-- Global staff sign-in: resolves tenant/branch/role on the SERVER from the
-- credentials alone. Optional workspace code disambiguates a username that
-- exists at more than one restaurant.
CREATE OR REPLACE FUNCTION public.staff_login_global(
  p_username text,
  p_pin text,
  p_workspace_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_code text := nullif(upper(trim(coalesce(p_workspace_code, ''))), '');
  v_user text := lower(trim(coalesce(p_username, '')));
  v_matches int;
  v_profile public.user_profiles;
  v_tenant public.tenants;
BEGIN
  IF v_user = '' OR coalesce(p_pin, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user');
  END IF;

  SELECT count(*) INTO v_matches
  FROM public.user_profiles p
  JOIN public.tenants t ON t.id = p.tenant_id AND t.is_active
  WHERE lower(p.username) = v_user
    AND (v_code IS NULL OR t.workspace_code = v_code);

  IF v_matches = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason',
      CASE WHEN v_code IS NULL THEN 'no_user' ELSE 'no_user_in_workspace' END);
  END IF;

  IF v_matches > 1 THEN
    -- Never guess between restaurants.
    SELECT count(*) INTO v_matches
    FROM public.user_profiles p
    JOIN public.tenants t ON t.id = p.tenant_id AND t.is_active
    WHERE lower(p.username) = v_user
      AND (v_code IS NULL OR t.workspace_code = v_code)
      AND p.pin_hash IS NOT NULL
      AND crypt(p_pin, p.pin_hash) = p.pin_hash;
    IF v_matches <> 1 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'need_workspace_code');
    END IF;
  END IF;

  SELECT p.* INTO v_profile
  FROM public.user_profiles p
  JOIN public.tenants t ON t.id = p.tenant_id AND t.is_active
  WHERE lower(p.username) = v_user
    AND (v_code IS NULL OR t.workspace_code = v_code)
    AND p.pin_hash IS NOT NULL
    AND crypt(p_pin, p.pin_hash) = p.pin_hash
  LIMIT 1;

  IF v_profile.user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_password');
  END IF;
  IF NOT v_profile.is_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = v_profile.tenant_id;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_profile.user_id,
    'name', v_profile.display_name,
    'role', v_profile.role,
    'tenant_id', v_profile.tenant_id,
    'tenant_name', v_tenant.name,
    'workspace_code', v_tenant.workspace_code,
    'branch_id', v_profile.branch_id,
    'all_branches', v_profile.all_branches,
    'permissions', v_profile.permissions,
    'feature_permissions', v_profile.feature_permissions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_login_global(text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_login_global(text, text, text) TO service_role;