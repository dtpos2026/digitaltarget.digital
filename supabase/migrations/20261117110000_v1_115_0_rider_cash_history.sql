-- v1.115.0 — the Rider app can say how much cash the rider is holding for the restaurant.
-- portal_my_history already lists the rider's delivered orders; each order's payments (booked "by the rider" when it was delivered) hold what was
-- taken at the door. This adds, to the SAME answer, per order: cashCollected and handedOverAt (stamped when the cashier receives the cash in
-- Riders), and in totals: cashUnsettled, cashUnsettledCount, cashToday. Every field it returned before is returned unchanged.
-- Read-only, same signature, same guard (portal_identity). Rollback: docs/rollback/2026-11-17-v1_115_0-rider-cash-history-before.sql
create or replace function public.portal_my_history(p_token text, p_limit integer default 100)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare s public.staff_portal_sessions := portal_identity(p_token);
begin
  if s.user_id is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  return jsonb_build_object('ok', true,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'orderNumber', o.order_number,
               'grandTotal', (o.data->>'grandTotal')::numeric,
               'deliveredAt', o.data->>'deliveredAt',
               'deliveryStatus', o.data->>'deliveryStatus',
               'customerName', o.data->'customer'->>'name',
               'address', o.data->'customer'->>'address',
               'cashCollected', o.cash,
               'handedOverAt', o.data->>'cashHandedOverAt')
             order by (o.data->>'deliveredAt') desc)
        from (select x.*, (select coalesce(sum(case when jsonb_typeof(pm->'amount') = 'number' then (pm->>'amount')::numeric else 0 end), 0)
                             from jsonb_array_elements(case when jsonb_typeof(x.data->'payments') = 'array' then x.data->'payments' else '[]'::jsonb end) pm
                            where pm->>'riderId' = s.user_id::text and lower(coalesce(pm->>'method', '')) = 'cash') as cash
                from public.orders x
               where x.tenant_id = s.tenant_id and x.deleted_at is null
                 and x.data->>'riderId' = s.user_id::text
                 and x.data->>'deliveredAt' is not null) o), '[]'::jsonb),
    'totals', (
      select jsonb_build_object('delivered', count(*),
               'today', count(*) filter (where (o.data->>'deliveredAt')::timestamptz >= date_trunc('day', now())),
               'earnings', coalesce(sum((o.data->>'grandTotal')::numeric), 0),
               'cashUnsettled', coalesce(sum(o.cash) filter (where o.data->>'cashHandedOverAt' is null), 0),
               'cashUnsettledCount', count(*) filter (where o.cash > 0 and o.data->>'cashHandedOverAt' is null),
               'cashToday', coalesce(sum(o.cash) filter (where (o.data->>'deliveredAt')::timestamptz >= date_trunc('day', now())), 0))
        from (select x.*, (select coalesce(sum(case when jsonb_typeof(pm->'amount') = 'number' then (pm->>'amount')::numeric else 0 end), 0)
                             from jsonb_array_elements(case when jsonb_typeof(x.data->'payments') = 'array' then x.data->'payments' else '[]'::jsonb end) pm
                            where pm->>'riderId' = s.user_id::text and lower(coalesce(pm->>'method', '')) = 'cash') as cash
                from public.orders x
               where x.tenant_id = s.tenant_id and x.deleted_at is null
                 and x.data->>'riderId' = s.user_id::text
                 and x.data->>'deliveredAt' is not null) o));
end $function$;
