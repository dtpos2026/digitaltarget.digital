-- v1.108.0 — security review S-4 and S-5 (docs/SECURITY-REVIEW-2026-11-02.md). Two function bodies; nothing else.
-- Rollback: docs/rollback/2026-11-06-v1_108_0-customer-functions-before.sql.
--
-- S-4  public_customer_request_otp limited 3 codes per PHONE per 15 minutes but nothing per RESTAURANT, so cycling through
--      numbers could run up the restaurant's SMS bill. Now also at most 30 codes per restaurant per hour.
-- S-5  public_customer_login told an attacker which numbers have an account ("blocked" / "locked" replies against
--      "bad_credentials" for the rest), took visibly longer for a real account (a bcrypt check the others skipped), and
--      locked for a flat 15 minutes however many times it was tried. Now every refusal is the same "bad_credentials" with the
--      same work done, and the lock grows with the number of wrong PINs: 15 minutes from the 5th, 1 hour from the 10th,
--      4 hours from the 15th, 24 hours from the 20th (the counter resets on a correct PIN). A 4-digit PIN would need about
--      a month of continuous guessing; the website still accepts 4–6 digits so nobody is locked out of signing up.

create or replace function public.public_customer_login(p_tenant uuid, p_phone text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_key    text := customer_phone_key(p_phone);
  v_row    public.customers;
  v_token  text;
  v_fails  integer;
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
    -- Same work as a real account, so the time taken says nothing.
    perform extensions.crypt(coalesce(p_pin, ''), extensions.gen_salt('bf'));
    return jsonb_build_object('ok', false, 'reason', 'bad_credentials');
  end if;
  if v_row.is_blocked
     or (v_row.pin_locked_until is not null and v_row.pin_locked_until > now()) then
    perform extensions.crypt(coalesce(p_pin, ''), v_row.pin_hash);
    return jsonb_build_object('ok', false, 'reason', 'bad_credentials');
  end if;

  if v_row.pin_hash <> extensions.crypt(coalesce(p_pin, ''), v_row.pin_hash) then
    v_fails := v_row.pin_attempts + 1;
    update customers c
       set pin_attempts = v_fails,
           pin_locked_until = case
             when v_fails >= 20 then now() + interval '24 hours'
             when v_fails >= 15 then now() + interval '4 hours'
             when v_fails >= 10 then now() + interval '1 hour'
             when v_fails >= 5  then now() + interval '15 minutes' end,
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

create or replace function public.public_customer_request_otp(p_tenant uuid, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_key    text := customer_phone_key(p_phone);
  v_digits text := customer_phone_digits(p_phone);
  v_code   text;
  v_recent integer;
  v_tenant_recent integer;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  if not exists (select 1 from customer_apps a join tenants t on t.id = a.tenant_id
                  where a.tenant_id = p_tenant and a.enabled and t.is_active) then
    return jsonb_build_object('ok', false, 'reason', 'app_disabled');
  end if;
  if length(v_key) < 10 then
    return jsonb_build_object('ok', false, 'reason', 'bad_phone');
  end if;

  select count(*) into v_recent from customer_otps
   where tenant_id = p_tenant and phone_digits = v_key
     and created_at > now() - interval '15 minutes';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_requests');
  end if;

  -- S-4: a cap for the whole restaurant, so cycling through numbers cannot run up its SMS bill.
  select count(*) into v_tenant_recent from customer_otps
   where tenant_id = p_tenant and created_at > now() - interval '1 hour';
  if v_tenant_recent >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_requests');
  end if;

  v_code := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');

  update customer_otps set consumed_at = now()
   where tenant_id = p_tenant and phone_digits = v_key and consumed_at is null;

  insert into customer_otps (tenant_id, phone_digits, code_hash, expires_at)
  values (p_tenant, v_key, extensions.crypt(v_code, extensions.gen_salt('bf')), v_expires);

  insert into notification_outbox (tenant_id, channel, destination, title, body, data)
  values (p_tenant, 'sms', v_digits, null,
          'Your verification code is ' || v_code || '. It expires in 10 minutes.',
          jsonb_build_object('kind', 'otp'));

  return jsonb_build_object('ok', true, 'expiresAt', v_expires);
end $function$;
