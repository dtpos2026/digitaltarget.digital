-- v1.128.0 — a support message that was read must STAY read.
--
-- REPORTED: in the Super Admin Support inbox (and the same chat inside the software) a message that had been seen came
-- back as unread, and there was no way to clear it.
--
-- ROOT CAUSE (measured on the live database): the app stores a restaurant's message with direction = 'owner' and the
-- admin's reply with direction = 'support' (support.ts dirFromSide; the CHECK constraint allows owner/support/in/out/
-- inbound/outbound). support_mark_read() and support_unread_counts() looked for direction = 'restaurant', a value that
-- is not even allowed by the constraint. So marking a thread read updated ZERO rows, returned {ok:true, updated:0}, the
-- screen believed it, and the very next reload brought read_by_admin = false back.
--
-- This only changes the two functions (CREATE OR REPLACE keeps their grants). No row is touched here: opening a thread
-- marks its messages read through the fixed function. Rollback: docs/rollback/2026-11-21-v1_128_0-support-read-before.sql

create or replace function public.support_mark_read(p_tenant uuid, p_side text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare n int;
begin
  if p_side = 'admin' then
    if not is_super_admin() then
      raise exception 'super admin only' using errcode = '42501';
    end if;
    -- messages FROM the restaurant: every spelling the table allows (the app writes 'owner')
    update admin_support_messages
      set read_by_admin = true
      where tenant_id = p_tenant
        and (direction is null or direction in ('owner', 'restaurant', 'in', 'inbound'))
        and read_by_admin = false;
  else
    if p_tenant is distinct from auth_tenant_id() then
      raise exception 'tenant mismatch' using errcode = '42501';
    end if;
    -- messages FROM support (the app writes 'support')
    update admin_support_messages
      set read_by_owner = true
      where tenant_id = p_tenant
        and direction in ('support', 'out', 'outbound')
        and is_internal = false and read_by_owner = false;
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'updated', n);
end $function$;

create or replace function public.support_unread_counts()
 returns table(tenant_id uuid, unread integer)
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
begin
  if not is_super_admin() then
    raise exception 'super admin only' using errcode = '42501';
  end if;
  return query
    select m.tenant_id, count(*)::int
    from admin_support_messages m
    where (m.direction is null or m.direction in ('owner', 'restaurant', 'in', 'inbound'))
      and m.read_by_admin = false
      and m.is_internal = false
    group by m.tenant_id;
end $function$;
