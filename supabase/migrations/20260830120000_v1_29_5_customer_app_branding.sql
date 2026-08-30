-- ============================================================================
-- v1.29.5 — the customer app knows which restaurant it belongs to
--
-- REPORTED: "customer APK par restaurant ka naam nahi aata (web order link par
-- aata hai). App ko pata hona chahiye ke wo kis restaurant ka hai aur sara data
-- wahin jaye. App ka icon wohi ho jo restaurant ne apne POS admin me set kiya."
--
-- WHY THE NAME WAS MISSING, AND WHY THE WEB LINK LOOKED FINE
-- OnlineOrderPage renders its title from settings.name and its logo from
-- settings.webPortalLogo/logo. Those come from tenant_settings, which is behind
-- RLS: verified as the anon role, a customer sees 0 rows. So the header falls
-- back to the literal word "Restaurant".
--
-- On the web nobody noticed, because the link is opened on a machine where the
-- OWNER is signed in — their own settings are already in localStorage, so the
-- name appears. A freshly installed APK has no such leftovers, and shows the
-- fallback. Same code, different starting state; the APK was simply the first
-- place the real anonymous experience was ever seen.
--
-- public_customer_app_config() already exists for exactly this and is callable
-- by anon. It carried appName (falling back to the tenant name) but its logo
-- and icon came ONLY from customer_apps, which Super Admin fills in by hand —
-- and for the live restaurant, never had been. So logoUrl and iconUrl were
-- null while four perfectly good logos sat in that restaurant's own POS
-- settings (appLogo 149 bytes, logo 146, webPortalLogo 155, orderTakerLogo 156).
--
-- THE RULE THIS SETTLES: the restaurant's own POS admin is the DEFAULT source
-- of customer-app branding; Super Admin is an OVERRIDE. Neither has to be kept
-- in step with the other by hand, and a restaurant that never opens Super Admin
-- still gets its own name and its own icon in its own app.
--
-- Only three scalars are read out of the settings document — name, and two logo
-- URLs. The rest of that document (printer configuration, tax registration,
-- bank details, message templates) stays exactly as unreadable to anon as it is
-- today; this returns fields, never the blob.
-- ============================================================================

create or replace function public.public_customer_app_config(p_tenant uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'tenantId',        c.tenant_id,
    'enabled',         c.enabled,
    -- Super Admin's app name, else what the restaurant calls itself in the POS,
    -- else the tenant record. One of the three is always present.
    'appName',         coalesce(
                         nullif(c.app_name, ''),
                         nullif(ts.settings->>'name', ''),
                         t.name),
    -- The header logo inside the app. webPortalLogo is the one the restaurant
    -- already chose for its public ordering page, so it is the closest match.
    'logoUrl',         coalesce(
                         nullif(c.logo_url, ''),
                         nullif(ts.settings->>'webPortalLogo', ''),
                         nullif(ts.settings->>'appLogo', ''),
                         nullif(ts.settings->>'logo', '')),
    -- The app icon. appLogo is the field the POS admin screen offers for it.
    'iconUrl',         coalesce(
                         nullif(c.icon_url, ''),
                         nullif(ts.settings->>'appLogo', ''),
                         nullif(ts.settings->>'logo', '')),
    'theme',           c.theme,
    'whatsappNumber',  c.whatsapp_number,
    'features',        c.features,
    'appVersion',      c.app_version,
    'minSupportedVersion', c.min_supported_version,
    'updateUrl',       c.update_url,
    'updateRequired',  c.update_required,
    'requireClaimOtp', c.require_claim_otp)
  from public.customer_apps c
  join public.tenants t on t.id = c.tenant_id
  -- LEFT: a restaurant that has not saved POS settings yet still gets a config,
  -- it just falls through to the tenant name.
  left join public.tenant_settings ts on ts.tenant_id = c.tenant_id
  where c.tenant_id = p_tenant
    and c.enabled
    and t.is_active;
$function$;

-- Unchanged from before: anon must be able to call this, because the caller is
-- a customer who has not signed in to anything.
grant execute on function public.public_customer_app_config(uuid) to anon, authenticated, service_role;
