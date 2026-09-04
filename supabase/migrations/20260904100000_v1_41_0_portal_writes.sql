-- ============================================================================
-- v1.41.0 — the rider and order-taker apps can finally WRITE
--
-- REPORTED, with screenshots: "1 change could not be uploaded (orders /
-- riders / customers)", "Cloud sync issue", and a rider Claim that does not
-- stick — the order stays in AVAILABLE ORDERS and MY ACTIVE ORDERS stays 0.
--
-- THE CAUSE, proven against the live database. A portal app signs in with a
-- username and PIN and holds an opaque portal token; it has NO Supabase auth
-- session, so auth.uid() is null. v1.29.0 gave those apps READS through the
-- portal_* SECURITY DEFINER functions, but every WRITE still went straight at
-- the table as `anon`. And an UPDATE that RLS filters out does not raise —
-- it matches zero rows and returns success:
--
--     set role anon; update user_profiles ... ;  -> no error, rows affected = 0
--     set role anon; update customers      ... ;  -> no error, rows affected = 0
--
-- So the claim was written locally, reported as saved, and silently never
-- reached the server. That is worse than a refusal, and it is why the data
-- "syncs" everywhere except where it matters.
--
-- These are the missing write halves, keyed on the same token the reads use.
-- Nothing is granted to a bare `anon` caller: every one of them resolves the
-- token first and fails closed.
-- ============================================================================

-- ------------------------------------------------------------------- the photo
--
-- REPORTED: "rider ka profile mein pic laga sake, apna naam waghera bhi, aur
-- aise hi order taker bhi." There was nowhere to put one — user_profiles has
-- display_name and phone and no photo column at all. Added rather than
-- invented elsewhere, so the staff photo lives beside the staff record.
alter table public.user_profiles add column if not exists photo_url text;

-- ---------------------------------------------------------------- claim/advance
--
-- A rider may only touch the delivery fields, and only on an order of their own
-- restaurant. Claiming is guarded so two riders cannot take the same order: the
-- update requires the order to be unclaimed OR already theirs.
create or replace function public.portal_order_delivery(
  p_token   text,
  p_order   uuid,
  p_stage   text,
  p_claim   boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid; v_tenant uuid; v_role text; v_name text; v_phone text; o record; n int;
begin
  select user_id, tenant_id, role into v_id, v_tenant, v_role
  from public.portal_identity(p_token);
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if v_role not in ('rider','order_taker') then
    return jsonb_build_object('ok', false, 'reason', 'wrong_role');
  end if;
  if p_stage is null or p_stage !~ '^[a-z_]{3,32}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_stage');
  end if;

  select display_name, phone into v_name, v_phone
  from public.user_profiles where user_id = v_id;

  select * into o from public.orders
   where id = p_order and tenant_id = v_tenant and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_order'); end if;

  -- One order, one rider. Someone else's claim is not overwritten.
  if p_claim and coalesce(o.data->>'riderId','') not in ('', v_id::text) then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end if;
  if not p_claim and coalesce(o.data->>'riderId','') <> v_id::text then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;

  update public.orders set data = data
      || jsonb_build_object('deliveryStatus', p_stage, 'updatedAt', now())
      || case when p_claim then jsonb_build_object(
              'riderId', v_id::text, 'riderName', v_name, 'riderPhone', v_phone,
              'dispatchedAt', now())
         else '{}'::jsonb end
      || case when p_stage = 'delivered' then jsonb_build_object(
              'deliveredAt', now(), 'status', 'paid', 'paidAt', now())
         else '{}'::jsonb end,
      status = case when p_stage = 'delivered' then 'paid' else status end
   where id = p_order and tenant_id = v_tenant;
  get diagnostics n = row_count;

  return jsonb_build_object('ok', n > 0, 'reason', case when n > 0 then null else 'no_rows' end,
                            'orderId', p_order, 'stage', p_stage);
end $function$;

-- ------------------------------------------------------------------ own profile
--
-- REPORTED: the rider cannot set their own name or photo, and the order taker
-- has the same gap. Own row only — the token decides which, so a rider cannot
-- edit a colleague. Role, permissions, branch and active flag are deliberately
-- NOT writable here: those belong to the restaurant's admin.
create or replace function public.portal_update_me(
  p_token  text,
  p_name   text default null,
  p_phone  text default null,
  p_photo  text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid; n int;
begin
  select user_id into v_id from public.portal_identity(p_token);
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;

  if p_photo is not null and p_photo <> '' and p_photo !~* '^https?://' then
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
end $function$;

-- The customer app already writes through public_customer_update; the staff
-- portals now have the same shape. Grant to anon because that is the role a
-- token-bearing app calls as — the token, not the role, is the authority.
revoke all on function public.portal_order_delivery(text, uuid, text, boolean) from public;
revoke all on function public.portal_update_me(text, text, text, text) from public;
grant execute on function public.portal_order_delivery(text, uuid, text, boolean) to anon, authenticated;
grant execute on function public.portal_update_me(text, text, text, text) to anon, authenticated;
