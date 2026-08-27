-- ===========================================================================
-- v1.28.3 — phone verification becomes a per-restaurant choice
--
-- v1.28.0 made an OTP mandatory before a customer could claim a profile the
-- restaurant already held for their number. That is the safer default, but it
-- assumes an SMS provider exists to deliver the code. None is connected, so
-- the codes sit in notification_outbox and the customer can never finish —
-- the app is unusable for exactly the diners the restaurant already knows.
--
-- The owner has chosen to let the account be created on the number alone.
-- This makes that a switch rather than a hardcoded behaviour, so it can be
-- turned back on the day an SMS provider is connected, without a code change.
--
-- WHAT IS BEING TRADED: with the switch off, anyone who knows a diner's phone
-- number can set a PIN on that diner's existing profile and read the name,
-- saved addresses and order history on it. Signing up on a number the
-- restaurant has never seen was never gated and is unaffected.
-- ===========================================================================

alter table public.customer_apps
  add column if not exists require_claim_otp boolean not null default false;

comment on column public.customer_apps.require_claim_otp is
  'When true, claiming a profile the restaurant already holds needs an SMS code. Needs a working SMS provider or customers cannot complete signup.';

create or replace function public.public_customer_app_config(p_tenant uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'tenantId',        c.tenant_id,
    'enabled',         c.enabled,
    'appName',         coalesce(nullif(c.app_name, ''), t.name),
    'logoUrl',         c.logo_url,
    'iconUrl',         c.icon_url,
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
  where c.tenant_id = p_tenant
    and c.enabled
    and t.is_active;
$$;

create or replace function public.public_customer_signup(
  p_tenant uuid, p_phone text, p_pin text, p_name text,
  p_email text default null, p_address text default null, p_dob date default null,
  p_lat double precision default null, p_lng double precision default null,
  p_gender text default null, p_claim_token text default null)
returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_key       text := customer_phone_key(p_phone);
  v_gender    text := case when lower(coalesce(p_gender,'')) in ('male','female')
                           then lower(p_gender) end;
  v_row       public.customers;
  v_token     text;
  v_needs_otp boolean;
begin
  select a.require_claim_otp into v_needs_otp
    from customer_apps a join tenants t on t.id = a.tenant_id
   where a.tenant_id = p_tenant and a.enabled and t.is_active;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'app_disabled');
  end if;
  if length(v_key) < 10 then
    return jsonb_build_object('ok', false, 'reason', 'bad_phone');
  end if;
  if p_pin is null or length(btrim(p_pin)) < 4 then
    return jsonb_build_object('ok', false, 'reason', 'weak_pin');
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;

  select c.* into v_row from customers c
   where c.tenant_id = p_tenant
     and customer_phone_key(c.phone) = v_key
     and c.deleted_at is null
   order by c.created_at limit 1;

  if v_row.id is not null and v_row.pin_hash is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_registered');
  end if;
  if v_row.id is not null and v_row.is_blocked then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;

  -- Claiming a profile the restaurant already holds. Gated only when this
  -- restaurant has switched verification on AND can actually deliver a code.
  if v_row.id is not null and coalesce(v_needs_otp, false) then
    if not customer_claim_token_valid(p_tenant, v_key, p_claim_token) then
      return jsonb_build_object('ok', false, 'reason', 'verification_required');
    end if;
  end if;

  if v_row.id is null then
    insert into customers (tenant_id, name, phone, email, address, date_of_birth,
                           gender, lat, lng, location_captured_at, pin_hash, last_login_at)
    values (p_tenant, btrim(p_name), btrim(p_phone), nullif(btrim(coalesce(p_email,'')),''),
            nullif(btrim(coalesce(p_address,'')),''), p_dob, v_gender, p_lat, p_lng,
            case when p_lat is not null then now() end,
            extensions.crypt(p_pin, extensions.gen_salt('bf')), now())
    returning * into v_row;
  else
    update customers c
       set pin_hash      = extensions.crypt(p_pin, extensions.gen_salt('bf')),
           name          = coalesce(nullif(btrim(p_name), ''), c.name),
           email         = coalesce(nullif(btrim(coalesce(p_email,'')), ''), c.email),
           address       = coalesce(nullif(btrim(coalesce(p_address,'')), ''), c.address),
           date_of_birth = coalesce(p_dob, c.date_of_birth),
           gender        = coalesce(v_gender, c.gender),
           lat           = coalesce(p_lat, c.lat),
           lng           = coalesce(p_lng, c.lng),
           location_captured_at = case when p_lat is not null then now() else c.location_captured_at end,
           pin_attempts  = 0,
           pin_locked_until = null,
           last_login_at = now(),
           updated_at    = now()
     where c.id = v_row.id
    returning * into v_row;
  end if;

  v_token := customer_new_session(v_row.id, p_tenant);
  return jsonb_build_object('ok', true, 'token', v_token, 'customer', customer_public_json(v_row));
end $function$;
