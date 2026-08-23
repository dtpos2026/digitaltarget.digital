-- ============================================================================
-- v1.27.0 — customer accounts that actually exist on the server
--
-- ===== WHAT WAS THERE BEFORE =====
-- The customer "account" was a localStorage blob: `dt-online-accounts-v2`, a
-- phone-keyed registry of every customer, with a SHA-256 PIN checked in the
-- browser. It was mirrored to module_documents, but that table is
-- authenticated-only, so an anonymous customer could never read or write it.
--
-- In practice that meant: an account existed on ONE device, in ONE browser. A
-- customer who reinstalled, cleared data, or picked up a second phone had no
-- account and no order history — which is precisely what a packaged customer
-- app is expected to provide.
--
-- ===== WHY RPCs AND NOT TABLE POLICIES =====
-- customers is authenticated + tenant-scoped, and it must stay that way: it
-- holds every diner's name, phone, address and spend. A customer app is
-- anonymous — it cannot hold a Supabase session for a restaurant it does not
-- work for, and it certainly cannot hold a service-role key inside an APK.
--
-- So the app never touches the table. It calls these functions, each of which
-- is scoped to one tenant and one customer, and returns only that customer's
-- own data. One restaurant's app cannot read another restaurant's diners even
-- if it changes the tenant id it sends.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Sessions. The app gets an opaque token; only its hash is stored, so a leaked
-- database backup does not hand over live sessions.
-- ---------------------------------------------------------------------------
create table if not exists public.customer_sessions (
  token_hash   text        primary key,
  customer_id  uuid        not null references public.customers(id) on delete cascade,
  tenant_id    uuid        not null references public.tenants(id)   on delete cascade,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '90 days'
);

create index if not exists idx_customer_sessions_customer
  on public.customer_sessions (customer_id);

alter table public.customer_sessions enable row level security;
-- No policy at all: nothing reaches this table except the SECURITY DEFINER
-- functions below. A session token is not a row anybody should be able to list.

-- ---------------------------------------------------------------------------
-- PIN throttling.
--
-- A 4-digit PIN is 10,000 guesses, and these functions are callable by anon by
-- design. Without a lockout, one script reads every customer's address and
-- order history for a restaurant. Five wrong tries buys a fifteen-minute lock.
-- ---------------------------------------------------------------------------
alter table public.customers add column if not exists pin_attempts    integer not null default 0;
alter table public.customers add column if not exists pin_locked_until timestamptz;

-- ---------------------------------------------------------------------------
-- Internal helpers. Not granted to anon.
-- ---------------------------------------------------------------------------
create or replace function public.customer_phone_digits(p text)
returns text language sql immutable set search_path to 'public' as $$
  select regexp_replace(coalesce(p, ''), '\D', '', 'g');
$$;

/** The public shape of a customer. Never includes pin_hash or push_token. */
create or replace function public.customer_public_json(c public.customers)
returns jsonb language sql stable set search_path to 'public' as $$
  select jsonb_build_object(
    'id',            c.id,
    'name',          c.name,
    'phone',         c.phone,
    'email',         c.email,
    'address',       c.address,
    'city',          c.city,
    'area',          c.area,
    'fullAddress',   c.full_address,
    'addresses',     coalesce(c.addresses, '[]'::jsonb),
    'dateOfBirth',   c.date_of_birth,
    'lat',           c.lat,
    'lng',           c.lng,
    'loyaltyPoints', c.loyalty_points,
    'totalOrders',   c.total_orders,
    'lastOrderAt',   c.last_order_at);
$$;

/** Mint a session and hand back the raw token exactly once. */
create or replace function public.customer_new_session(p_customer uuid, p_tenant uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into customer_sessions (token_hash, customer_id, tenant_id)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_customer, p_tenant);
  return v_token;
end $$;

/** Resolve a token to its customer, or null. Also extends the session. */
create or replace function public.customer_from_token(p_token text)
returns public.customers
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare v_row public.customers;
begin
  if p_token is null or length(p_token) < 32 then return null; end if;

  update customer_sessions s
     set last_seen_at = now()
   where s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and s.expires_at > now();
  if not found then return null; end if;

  select c.* into v_row
    from customers c
    join customer_sessions s on s.customer_id = c.id
   where s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and c.deleted_at is null
     and not c.is_blocked;
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Sign up, or claim the profile the restaurant already has for this number.
-- ---------------------------------------------------------------------------
create or replace function public.public_customer_signup(
  p_tenant  uuid,
  p_phone   text,
  p_pin     text,
  p_name    text,
  p_email   text default null,
  p_address text default null,
  p_dob     date default null,
  p_lat     double precision default null,
  p_lng     double precision default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_digits text := customer_phone_digits(p_phone);
  v_row    public.customers;
  v_token  text;
begin
  if not exists (select 1 from customer_apps a join tenants t on t.id = a.tenant_id
                  where a.tenant_id = p_tenant and a.enabled and t.is_active) then
    return jsonb_build_object('ok', false, 'reason', 'app_disabled');
  end if;
  if length(v_digits) < 10 then
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
     and customer_phone_digits(c.phone) = v_digits
     and c.deleted_at is null
   order by c.created_at limit 1;

  -- An account with a PIN already belongs to someone. Signing up again is a
  -- login, not a takeover.
  if v_row.id is not null and v_row.pin_hash is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_registered');
  end if;
  if v_row.id is not null and v_row.is_blocked then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;

  if v_row.id is null then
    insert into customers (tenant_id, name, phone, email, address, date_of_birth,
                           lat, lng, location_captured_at, pin_hash, last_login_at)
    values (p_tenant, btrim(p_name), btrim(p_phone), nullif(btrim(coalesce(p_email,'')),''),
            nullif(btrim(coalesce(p_address,'')),''), p_dob, p_lat, p_lng,
            case when p_lat is not null then now() end,
            extensions.crypt(p_pin, extensions.gen_salt('bf')), now())
    returning * into v_row;
  else
    -- Claiming a profile the restaurant created from a past order. Their own
    -- details win over what the counter typed.
    update customers c
       set pin_hash      = extensions.crypt(p_pin, extensions.gen_salt('bf')),
           name          = coalesce(nullif(btrim(p_name), ''), c.name),
           email         = coalesce(nullif(btrim(coalesce(p_email,'')), ''), c.email),
           address       = coalesce(nullif(btrim(coalesce(p_address,'')), ''), c.address),
           date_of_birth = coalesce(p_dob, c.date_of_birth),
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
end $$;

-- ---------------------------------------------------------------------------
-- Log in.
-- ---------------------------------------------------------------------------
create or replace function public.public_customer_login(
  p_tenant uuid, p_phone text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_digits text := customer_phone_digits(p_phone);
  v_row    public.customers;
  v_token  text;
begin
  if not exists (select 1 from customer_apps a join tenants t on t.id = a.tenant_id
                  where a.tenant_id = p_tenant and a.enabled and t.is_active) then
    return jsonb_build_object('ok', false, 'reason', 'app_disabled');
  end if;

  select c.* into v_row from customers c
   where c.tenant_id = p_tenant
     and customer_phone_digits(c.phone) = v_digits
     and c.deleted_at is null
   order by c.created_at limit 1;

  -- Same answer whether the number is unknown or the PIN is wrong, so this
  -- cannot be used to find out who orders from a restaurant.
  if v_row.id is null or v_row.pin_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_credentials');
  end if;
  if v_row.is_blocked then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;
  if v_row.pin_locked_until is not null and v_row.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked',
                              'retryAt', v_row.pin_locked_until);
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
end $$;

-- ---------------------------------------------------------------------------
-- Who am I / update me / my orders / sign out / push token.
-- ---------------------------------------------------------------------------
create or replace function public.public_customer_me(p_token text)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_row public.customers := customer_from_token(p_token);
begin
  if v_row.id is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  return jsonb_build_object('ok', true, 'customer', customer_public_json(v_row));
end $$;

create or replace function public.public_customer_update(
  p_token     text,
  p_name      text default null,
  p_email     text default null,
  p_address   text default null,
  p_city      text default null,
  p_dob       date default null,
  p_addresses jsonb default null,
  p_lat       double precision default null,
  p_lng       double precision default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_row public.customers := customer_from_token(p_token);
begin
  if v_row.id is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;

  update customers c
     set name          = coalesce(nullif(btrim(coalesce(p_name, '')), ''), c.name),
         email         = coalesce(nullif(btrim(coalesce(p_email, '')), ''), c.email),
         address       = coalesce(nullif(btrim(coalesce(p_address, '')), ''), c.address),
         city          = coalesce(nullif(btrim(coalesce(p_city, '')), ''), c.city),
         date_of_birth = coalesce(p_dob, c.date_of_birth),
         -- A saved-address list of more than 20 is not a customer, it is abuse.
         addresses     = case when p_addresses is null then c.addresses
                              when jsonb_typeof(p_addresses) = 'array'
                               and jsonb_array_length(p_addresses) <= 20 then p_addresses
                              else c.addresses end,
         lat           = coalesce(p_lat, c.lat),
         lng           = coalesce(p_lng, c.lng),
         location_captured_at = case when p_lat is not null then now() else c.location_captured_at end,
         updated_at    = now()
   where c.id = v_row.id
  returning * into v_row;

  return jsonb_build_object('ok', true, 'customer', customer_public_json(v_row));
end $$;

create or replace function public.public_customer_orders(p_token text, p_limit integer default 30)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_row public.customers := customer_from_token(p_token);
  v_out jsonb;
begin
  if v_row.id is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;

  select coalesce(jsonb_agg(x order by x->>'createdAt' desc), '[]'::jsonb) into v_out
  from (
    select jsonb_build_object(
             'id',          o.id,
             'orderNumber', o.order_number,
             'status',      o.status,
             'orderType',   o.order_type,
             'source',      o.source,
             'grandTotal',  o.grand_total,
             'createdAt',   o.created_at,
             'branchId',    o.branch_id,
             'riderName',   o.rider_name,
             'items',       coalesce(o.data->'items', '[]'::jsonb)) as x
      from orders o
     where o.customer_id = v_row.id
       and o.tenant_id  = v_row.tenant_id
       and o.deleted_at is null
     order by o.created_at desc
     limit greatest(1, least(coalesce(p_limit, 30), 100))
  ) s;

  return jsonb_build_object('ok', true, 'orders', v_out);
end $$;

create or replace function public.public_customer_logout(p_token text)
returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions'
as $$
begin
  delete from customer_sessions
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.public_customer_push_token(p_token text, p_push text)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_row public.customers := customer_from_token(p_token);
begin
  if v_row.id is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  update customers set push_token = nullif(btrim(coalesce(p_push, '')), ''), updated_at = now()
   where id = v_row.id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Grants. The helpers stay private; only the public_* surface is anon-callable.
-- ---------------------------------------------------------------------------
revoke execute on function public.customer_new_session(uuid, uuid)  from public, anon, authenticated;
revoke execute on function public.customer_from_token(text)          from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public_customer_signup(uuid,text,text,text,text,text,date,double precision,double precision)',
    'public_customer_login(uuid,text,text)',
    'public_customer_me(text)',
    'public_customer_update(text,text,text,text,text,date,jsonb,double precision,double precision)',
    'public_customer_orders(text,integer)',
    'public_customer_logout(text)',
    'public_customer_push_token(text,text)'
  ] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end $$;
