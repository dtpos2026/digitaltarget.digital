-- v1.83.0 — public, read-only verification of ONE Digital Target invoice by its id.
-- Applied to project drpzxzpvkpqfxcjbwypo as migration "add_verify_invoice_function" (2026-11-01).
--
-- The id is the invoice's own random uuid (122 bits: not guessable). The function returns the invoice header and its
-- payment state only — never line items, notes, e-mail or phone numbers — or NULL when the id is unknown.
-- Additive: no table, column or policy is touched.
create or replace function public.verify_invoice(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'number',     i.number,
    'issued_at',  i.issued_at,
    'due_at',     i.due_at,
    'total',      i.total,
    'paid_total', i.paid_total,
    'status',     i.status,
    'customer',   t.name,
    'issuer',     'Digital Target'
  )
  from public.admin_invoices i
  left join public.tenants t on t.id = i.tenant_id
  where i.id = p_id
$$;

revoke all on function public.verify_invoice(uuid) from public;
grant execute on function public.verify_invoice(uuid) to anon, authenticated;

comment on function public.verify_invoice(uuid) is
  'Public invoice verification (v1.83.0): header + payment state of one invoice by its random id; NULL when unknown.';
