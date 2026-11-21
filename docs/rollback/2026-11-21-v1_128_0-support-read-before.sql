-- Rollback for v1.128.0 (support read/unread). These are the two functions exactly as they were before the change.
create or replace function public.support_mark_read(p_tenant uuid, p_side text)
 returns jsonb language plpgsql security definer set search_path to 'pg_catalog', 'public'
as $function$
declare n int;
begin
  if p_side = 'admin' then
    if not is_super_admin() then
      raise exception 'super admin only' using errcode = '42501';
    end if;
    update admin_support_messages
      set read_by_admin = true
      where tenant_id = p_tenant and direction = 'restaurant' and read_by_admin = false;
  else
    if p_tenant is distinct from auth_tenant_id() then
      raise exception 'tenant mismatch' using errcode = '42501';
    end if;
    update admin_support_messages
      set read_by_owner = true
      where tenant_id = p_tenant and direction = 'support'
        and is_internal = false and read_by_owner = false;
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'updated', n);
end $function$;

create or replace function public.support_unread_counts()
 returns table(tenant_id uuid, unread integer) language plpgsql security definer set search_path to 'pg_catalog', 'public'
as $function$
begin
  if not is_super_admin() then
    raise exception 'super admin only' using errcode = '42501';
  end if;
  return query
    select m.tenant_id, count(*)::int
    from admin_support_messages m
    where m.direction = 'restaurant'
      and m.read_by_admin = false
      and m.is_internal = false
    group by m.tenant_id;
end $function$;
