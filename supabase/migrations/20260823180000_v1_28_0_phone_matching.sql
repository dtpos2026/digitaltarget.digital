-- ===========================================================================
-- v1.28.0 — one customer, however they type their number
--
-- FOUND BY: the end-to-end customer journey probe. A customer who signed up as
-- 03211230001 and later typed +92 321 123 0001 got `bad_credentials`. Both are
-- the same phone. The lookup compared digit strings — "03211230001" against
-- "923211230001" — so the international form matched nothing, and the same
-- person could end up with a second, empty profile.
--
-- THE FIX: compare on the last ten digits. A national trunk '0' and a country
-- code are exactly the prefix that varies between the two forms, and ten
-- digits is the subscriber number in every format DT POS sees. Nothing about a
-- specific country is hardcoded, so this does not break if the product is used
-- outside Pakistan.
--
-- WHAT IS NOT CHANGED: `customers.phone` still stores what the customer typed,
-- and SMS still goes to the full dialable digits. Only the *matching* key
-- changes — a number is never rewritten on their behalf.
-- ===========================================================================

/**
 * The canonical key a phone number is matched on.
 *
 * Ten digits is deliberate: it is the subscriber number, the part that is the
 * same whether the customer writes 0321…, +92 321… or 0092321…. Anything
 * shorter than ten is returned as-is so a clearly invalid number cannot
 * collide with a real one.
 */
create or replace function public.customer_phone_key(p text)
returns text language sql immutable set search_path to 'public' as $$
  select case
           when length(customer_phone_digits(p)) >= 10
             then right(customer_phone_digits(p), 10)
           else customer_phone_digits(p)
         end;
$$;


create or replace function public.public_customer_login(p_tenant uuid, p_phone text, p_pin text)
returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_key    text := customer_phone_key(p_phone);
  v_row    public.customers;
  v_token  text;
begin
  if not exists (select 1 from customer_apps a join tenants t on t.id = a.tenant_id
                  where a.tenant_id = p_tenant and a.enabled and t.is_active) then
    return jsonb_build_object('ok', false, 'reason', 'app_disabled');
  end if;

  select c.* into v_row from customers c
   where c.tenant_id = p_tenant
     and customer_phone_key(c.phone) = v_key
     and c.deleted_at is null
   order by c.created_at limit 1;

  if v_row.id is null or v_row.pin_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_credentials');
  end if;
  if v_row.is_blocked then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;
  if v_row.pin_locked_until is not null and v_row.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'retryAt', v_row.pin_locked_until);
  end if;

  if v_row.pin_hash <> extensions.crypt(p_pin, v_row.pin_hash) then
    update customers c
       set pin_attempts = c.pin_attempts + 1,
           pin_locked_until = case when c.pin_attempts + 1 >= 5
                                   then now() + interval '15 minutes' end,
           updated_at = now()
     where c.id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', 'bad_credentials');
  end if;

  update customers c
     set pin_attempts = 0, pin_locked_until = null,
         last_login_at = now(), updated_at = now()
   where c.id = v_row.id
  returning * into v_row;

  v_token := customer_new_session(v_row.id, p_tenant);
  return jsonb_build_object('ok', true, 'token', v_token, 'customer', customer_public_json(v_row));
end $function$;


create or replace function public.public_customer_signup(
  p_tenant uuid, p_phone text, p_pin text, p_name text,
  p_email text default null, p_address text default null, p_dob date default null,
  p_lat double precision default null, p_lng double precision default null,
  p_gender text default null, p_claim_token text default null)
returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_key    text := customer_phone_key(p_phone);
  v_gender text := case when lower(coalesce(p_gender,'')) in ('male','female')
                        then lower(p_gender) end;
  v_row    public.customers;
  v_token  text;
begin
  if not exists (select 1 from customer_apps a join tenants t on t.id = a.tenant_id
                  where a.tenant_id = p_tenant and a.enabled and t.is_active) then
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

  -- ===== v1.28.0 — claiming an existing profile needs proof of the phone =====
  --
  -- A profile the restaurant created from a past order carries that diner's
  -- name, address and order history. Letting anyone who knows the number set a
  -- PIN on it hands all of that over. Creating a brand-new profile is not
  -- gated: there is nothing there to take.
  if v_row.id is not null then
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


create or replace function public.public_customer_request_otp(p_tenant uuid, p_phone text)
returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  -- Two forms, on purpose. The KEY is what a number is matched on; the DIGITS
  -- are what an SMS is actually sent to, and a ten-digit key is not dialable.
  v_key    text := customer_phone_key(p_phone);
  v_digits text := customer_phone_digits(p_phone);
  v_code   text;
  v_recent integer;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  if not exists (select 1 from customer_apps a join tenants t on t.id = a.tenant_id
                  where a.tenant_id = p_tenant and a.enabled and t.is_active) then
    return jsonb_build_object('ok', false, 'reason', 'app_disabled');
  end if;
  if length(v_key) < 10 then
    return jsonb_build_object('ok', false, 'reason', 'bad_phone');
  end if;

  -- Three codes per number per fifteen minutes. Without this the endpoint is a
  -- free SMS pump billed to the restaurant.
  select count(*) into v_recent from customer_otps
   where tenant_id = p_tenant and phone_digits = v_key
     and created_at > now() - interval '15 minutes';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_requests');
  end if;

  -- Six digits, uniformly random, from the CSPRNG rather than random().
  v_code := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');

  -- Any earlier code for this number is dead the moment a new one is issued.
  update customer_otps set consumed_at = now()
   where tenant_id = p_tenant and phone_digits = v_key and consumed_at is null;

  insert into customer_otps (tenant_id, phone_digits, code_hash, expires_at)
  values (p_tenant, v_key, extensions.crypt(v_code, extensions.gen_salt('bf')), v_expires);

  -- The plaintext exists only here, on its way to the delivery worker.
  insert into notification_outbox (tenant_id, channel, destination, title, body, data)
  values (p_tenant, 'sms', v_digits, null,
          'Your verification code is ' || v_code || '. It expires in 10 minutes.',
          jsonb_build_object('kind', 'otp'));

  return jsonb_build_object('ok', true, 'expiresAt', v_expires);
end $function$;


create or replace function public.public_customer_verify_otp(p_tenant uuid, p_phone text, p_code text)
returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_key    text := customer_phone_key(p_phone);
  v_row    customer_otps;
  v_token  text;
begin
  select * into v_row from customer_otps
   where tenant_id = p_tenant and phone_digits = v_key
     and consumed_at is null and expires_at > now()
   order by created_at desc limit 1;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  -- Five guesses at six digits, then the code dies. Otherwise a million tries
  -- is an afternoon.
  if v_row.attempts >= 5 then
    update customer_otps set consumed_at = now() where id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  if v_row.code_hash <> extensions.crypt(coalesce(p_code, ''), v_row.code_hash) then
    update customer_otps set attempts = attempts + 1 where id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', 'bad_code');
  end if;

  -- The proof IS the consumed row's id: it exists only after a correct code,
  -- it is single-use, and it is worthless once the claim happens.
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  update customer_otps
     set consumed_at = now(),
         code_hash   = extensions.crypt(v_token, extensions.gen_salt('bf')),
         purpose     = 'claim_token',
         expires_at  = now() + interval '15 minutes'
   where id = v_row.id;

  return jsonb_build_object('ok', true, 'claimToken', v_token);
end $function$;


-- The order → profile trigger has to agree with the login lookup, or an order
-- placed as +92 321… would create a second profile beside the one the same
-- diner signed in with.
create or replace function public.link_order_customer()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_snap   jsonb := coalesce(new.customer_snapshot, '{}'::jsonb);
  v_phone  text;
  v_digits text;
  v_key    text;
  v_name   text;
  v_addr   text;
  v_city   text;
  v_lat    double precision;
  v_lng    double precision;
  v_id     uuid;
  v_at     timestamptz := coalesce(new.created_at, now());
begin
  if new.customer_id is not null then return new; end if;

  v_phone := nullif(btrim(coalesce(v_snap->>'phone', '')), '');
  if v_phone is null then return new; end if;

  v_digits := regexp_replace(v_phone, '\D', '', 'g');
  if length(v_digits) < 7 then return new; end if;
  v_key := customer_phone_key(v_phone);

  v_name := nullif(btrim(coalesce(v_snap->>'name', '')), '');
  v_addr := nullif(btrim(coalesce(v_snap->>'address', '')), '');
  v_city := nullif(btrim(coalesce(v_snap->>'city', '')), '');
  begin v_lat := (v_snap->>'lat')::double precision; exception when others then v_lat := null; end;
  begin v_lng := (v_snap->>'lng')::double precision; exception when others then v_lng := null; end;

  select id into v_id
    from customers
   where tenant_id = new.tenant_id
     and customer_phone_key(phone) = v_key
     and deleted_at is null
   order by created_at
   limit 1;

  if v_id is null then
    insert into customers (tenant_id, name, phone, address, city, lat, lng,
                           location_captured_at, last_order_at)
    values (new.tenant_id, v_name, v_phone, v_addr, v_city, v_lat, v_lng,
            case when v_lat is not null then v_at end, v_at)
    on conflict (tenant_id, phone) do update set updated_at = now()
    returning id into v_id;
  else
    update customers c
       set name    = coalesce(nullif(btrim(coalesce(c.name, '')), ''), v_name),
           address = coalesce(nullif(btrim(coalesce(c.address, '')), ''), v_addr),
           city    = coalesce(nullif(btrim(coalesce(c.city, '')), ''), v_city),
           lat     = coalesce(v_lat, c.lat),
           lng     = coalesce(v_lng, c.lng),
           location_captured_at = case when v_lat is not null then v_at
                                       else c.location_captured_at end,
           last_order_at = greatest(coalesce(c.last_order_at, v_at), v_at),
           updated_at = now()
     where c.id = v_id;
  end if;

  new.customer_id := v_id;
  return new;
exception when others then
  -- Linking a profile is never worth failing an order over.
  return new;
end $function$;

-- A trigger function has no business being a REST endpoint. Calling it that way
-- fails anyway ("trigger functions can only be called as triggers"), but the
-- database linter is right that it should not be offered at all. Triggers do
-- not consult EXECUTE privilege, so the revoke does not stop the trigger:
-- verified against the live database — an anon website order still linked to
-- its profile with the grant removed.
revoke execute on function public.link_order_customer() from public, anon, authenticated;

-- The lookups above are per-tenant and index-assisted by this expression.
create index if not exists customers_phone_key_idx
  on public.customers (tenant_id, public.customer_phone_key(phone))
  where deleted_at is null;
