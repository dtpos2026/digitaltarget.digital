-- ============================================================================
-- v1.46.0 — a face on the profile: customer, rider, order taker
--
-- REPORTED: "rider ka profile me pic lga sky apna name wgara b, or asy he order
-- taker b; customer me lgana ha pic but nzr nhi aya".
--
-- The columns and the write RPCs already existed (v1.32.0 for customers,
-- v1.41.0 for staff). Two things stopped a photo from ever appearing:
--
--   1. The upload went through a TanStack server function on the website's own
--      origin. From the packaged app that origin is not what the WebView is
--      running, so the call never arrived. It now goes to an Edge Function on
--      the Supabase origin, which both the website and the app can reach.
--      (supabase/functions/profile-photo)
--
--   2. portal_me() never returned photo_url, so even a saved staff photo could
--      not be displayed. Fixed below.
--
-- And one hole worth closing while the path is being built: portal_update_me
-- accepted ANY http(s) URL as a staff photo. That let a staff member point
-- their avatar at a URL they control, which then loads inside the owner's
-- admin screens. The customer equivalent has always required the URL to be in
-- our own public bucket; the staff one now matches it.
--
-- Safe on live data: staff photo_url is currently NULL for every row (verified
-- before writing this), so nothing existing is invalidated by the tighter rule.
-- No table is dropped, no data is deleted.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. portal_me returns the photo and phone, so a profile screen can show them
-- ---------------------------------------------------------------------------
create or replace function public.portal_me(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  s public.staff_portal_sessions := portal_identity(p_token);
  p public.user_profiles;
  t public.tenants;
begin
  if s.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  update public.staff_portal_sessions
     set last_seen_at = now()
   where token_hash = s.token_hash;

  select * into p from public.user_profiles
   where user_id = s.user_id and tenant_id = s.tenant_id;
  if p.user_id is null or not p.is_active then
    delete from public.staff_portal_sessions where token_hash = s.token_hash;
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;

  select * into t from public.tenants where id = s.tenant_id;

  return jsonb_build_object(
    'ok', true,
    'userId', s.user_id,
    'tenantId', s.tenant_id,
    'tenantName', t.name,
    'workspaceCode', t.workspace_code,
    'branchId', s.branch_id,
    'allBranches', s.all_branches,
    'role', s.role,
    'name', p.display_name,
    'username', p.username,
    'phone', p.phone,
    'photo', p.photo_url,
    'permissions', coalesce(p.permissions, array[]::text[])
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- 2. A staff photo may only be a file in our own public bucket
-- ---------------------------------------------------------------------------
create or replace function public.portal_update_me(
  p_token text,
  p_name  text default null,
  p_phone text default null,
  p_photo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare v_id uuid; n int;
begin
  select user_id into v_id from public.portal_identity(p_token);
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;

  -- Same rule as public_customer_set_photo: the URL has to be a file we put
  -- there ourselves. '' still means "remove my photo".
  if p_photo is not null and p_photo <> ''
     and p_photo !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/customer-photos/'
  then
    return jsonb_build_object('ok', false, 'reason', 'bad_photo_url');
  end if;

  update public.user_profiles
     set display_name = coalesce(nullif(btrim(p_name), ''), display_name),
         phone        = coalesce(nullif(btrim(p_phone), ''), phone),
         photo_url    = case when p_photo is null then photo_url
                             when p_photo = ''    then null
                             else p_photo end
   where user_id = v_id;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end
$function$;
