-- Rollback for 20261117110000_v1_115_0_rider_cash_history.sql: portal_my_history exactly as it was before v1.115.0 (verbatim).
CREATE OR REPLACE FUNCTION public.portal_my_history(p_token text, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
               'address', o.data->'customer'->>'address')
             order by (o.data->>'deliveredAt') desc)
        from public.orders o
       where o.tenant_id = s.tenant_id and o.deleted_at is null
         and o.data->>'riderId' = s.user_id::text
         and o.data->>'deliveredAt' is not null
       limit greatest(1, least(coalesce(p_limit, 100), 500))), '[]'::jsonb),
    'totals', (
      select jsonb_build_object('delivered', count(*),
               'today', count(*) filter (where (o.data->>'deliveredAt')::timestamptz >= date_trunc('day', now())),
               'earnings', coalesce(sum((o.data->>'grandTotal')::numeric), 0))
        from public.orders o
       where o.tenant_id = s.tenant_id and o.deleted_at is null
         and o.data->>'riderId' = s.user_id::text
         and o.data->>'deliveredAt' is not null));
end $function$;
