create or replace function public.get_workspace_code(_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select workspace_code from public.tenants where id = _tenant_id
$$;

grant execute on function public.get_workspace_code(uuid) to anon, authenticated, service_role;