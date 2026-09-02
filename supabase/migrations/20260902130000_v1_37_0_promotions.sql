-- ============================================================================
-- v1.37.0 — a restaurant can send a promotion to its OWN customers
--
-- ASKED FOR: "Restaurant A sends promotion -> ONLY Restaurant A's customers
-- receive it. Restaurant B customers must NOT."
--
-- HOW IT IS DELIVERED, honestly. FCM was removed on instruction, and Android
-- has no other way to wake a CLOSED app — that has not changed and no code here
-- changes it. This is the half that IS possible: the promotion is stored, and
-- the customer app shows it the moment it is opened or next polls. Open app:
-- seconds. Closed app: when they open it. Nothing here pretends otherwise.
--
-- ISOLATION. The customer never names a tenant. Their session token is resolved
-- inside Postgres and promotions are selected from the tenant THAT answer
-- returns, so a customer of Restaurant B cannot be handed Restaurant A's
-- promotion even by asking for it. There is no anon policy on the table at all:
-- customers read through the RPC, never the table, so campaigns cannot be
-- enumerated.
--
-- VERIFIED LIVE (rolled back):
--   A creates a promotion ................ ok, audience 1497 customers
--   A creates one FOR B .................. REFUSED by RLS
--   A's customer sees A's promotion ...... ok, returned in full
--   anon SELECT on the table ............. refused
--   junk session token ................... no_session
-- ============================================================================

create table if not exists public.customer_promotions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  title        text not null,
  body         text not null,
  image_url    text,
  deep_link    text,
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz,
  is_active    boolean not null default true,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index if not exists idx_customer_promotions_live
  on public.customer_promotions (tenant_id, starts_at desc)
  where deleted_at is null and is_active;

alter table public.customer_promotions enable row level security;

drop policy if exists customer_promotions_tenant on public.customer_promotions;
create policy customer_promotions_tenant on public.customer_promotions
  for all to authenticated
  using      (tenant_id = auth_tenant_id() or is_super_admin())
  with check (tenant_id = auth_tenant_id() or is_super_admin());

revoke all on public.customer_promotions from anon;

create or replace function public.public_customer_promotions(p_token text, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_row public.customers := customer_from_token(p_token);
  v_out jsonb;
begin
  if v_row.id is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if customer_app_blocked(v_row.tenant_id) then
    return jsonb_build_object('ok', false, 'reason', 'app_disabled');
  end if;

  -- v_row.tenant_id, never a tenant the caller supplied. That is the isolation.
  select coalesce(jsonb_agg(x order by x->>'startsAt' desc), '[]'::jsonb) into v_out
  from (
    select jsonb_build_object(
             'id', p.id, 'title', p.title, 'body', p.body,
             'imageUrl', p.image_url, 'deepLink', p.deep_link,
             'startsAt', p.starts_at, 'endsAt', p.ends_at) as x
      from public.customer_promotions p
     where p.tenant_id = v_row.tenant_id
       and p.deleted_at is null and p.is_active
       and p.starts_at <= now()
       and (p.ends_at is null or p.ends_at > now())
     order by p.starts_at desc
     limit greatest(1, least(coalesce(p_limit, 20), 50))
  ) s;

  return jsonb_build_object('ok', true, 'promotions', v_out);
end $function$;

revoke all on function public.public_customer_promotions(text, integer) from public;
grant execute on function public.public_customer_promotions(text, integer) to anon, authenticated, service_role;

-- How many customers a campaign would actually reach, for the compose screen.
create or replace function public.promotion_audience_size()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select count(*)::int from public.customers c
   where c.tenant_id = auth_tenant_id() and c.deleted_at is null and not c.is_blocked;
$function$;

grant execute on function public.promotion_audience_size() to authenticated, service_role;
