-- public_customer_login and public_customer_request_otp BEFORE v1.108.0 (pg_get_functiondef on the live database,
-- 2026-11-06). Run this file to restore them exactly. Grants ({postgres, anon, authenticated, service_role}) are unchanged.

CREATE OR REPLACE FUNCTION public.public_customer_login(p_tenant uuid, p_phone text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

CREATE OR REPLACE FUNCTION public.public_customer_request_otp(p_tenant uuid, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
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

  select count(*) into v_recent from customer_otps
   where tenant_id = p_tenant and phone_digits = v_key
     and created_at > now() - interval '15 minutes';
  if v_recent >= 3 then
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
