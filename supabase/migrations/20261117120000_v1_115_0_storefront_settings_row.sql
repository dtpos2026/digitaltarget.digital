-- v1.115.0 — public_place_order read "a" settings row of the restaurant; the website's own reader (publicStorefront.readStorefront)
-- reads the all-branches row (branch_id = 00000000-…). A restaurant with a branch-specific row could therefore have the page and
-- the server disagree about the delivery charge or the minimum. The order function now prefers the same all-branches row.
-- A one-statement patch of the function body (so the function is not retyped); rollback = run docs/rollback/2026-11-17-v1_115_0-server-side-promo-before.sql
-- and then the migration 20261117100000 again, or simply leave it: it only makes the two readers agree.
do $m$
declare d text;
begin
  select pg_get_functiondef('public.public_place_order(uuid,uuid,jsonb)'::regprocedure) into d;
  if position('select ts.settings into v_settings from tenant_settings ts where ts.tenant_id = p_tenant limit 1;' in d) = 0 then
    raise exception 'public_place_order does not have the expected settings read; nothing changed';
  end if;
  d := replace(d,
    'select ts.settings into v_settings from tenant_settings ts where ts.tenant_id = p_tenant limit 1;',
    'select ts.settings into v_settings from tenant_settings ts where ts.tenant_id = p_tenant order by (ts.branch_id = ''00000000-0000-0000-0000-000000000000''::uuid) desc nulls last limit 1;');
  execute d;
end $m$;
