-- ============================================================================
-- v1.55.0 — "customer order site ya APK se order POS me nahi aata"
--
-- THE ORDERS ARRIVE. NOBODY IS LOOKING AT THE BRANCH THEY LAND ON.
--
-- Measured on the live database:
--
--   source   branch        orders  numbers
--   website  burewala           7  13 – 23     <- today's order #23
--   website  hafiz              2  1 – 2
--   website  multan             2  2 – 3
--   website  Main Branch        9  1007 – 1020
--
-- The till works at Main Branch. A customer on the ordering site picks a branch
-- from the picker — every one of this restaurant's five branches is active, so
-- every one is offered — and the order goes there. The POS reads orders with
--
--     pull_orders_delta(p_branch, ...)
--
-- which is branch-scoped by design, and correctly so for a real chain. The
-- consequence is not correct: the order is in the database, the customer is
-- waiting, and the owner's screen shows nothing at all. Silently.
--
-- It also explains the order NUMBER. Each branch has its own counter, so an
-- order on burewala is #23 while Main Branch is at #1052 — which reads like a
-- different system rather than a missed order.
--
-- THE FIX IS NOT TO BREAK BRANCH SCOPING
--
-- Widening the pull would put another branch's bills on this till, which is
-- exactly what branch scoping exists to prevent. Instead the POS is TOLD: this
-- counts what is waiting elsewhere so the screen can say "2 online orders
-- waiting at burewala" and offer to switch. Nothing is hidden any more, and no
-- till starts showing another branch's orders.
--
-- Scoped by auth_branch_ids(), which already returns every branch for an owner
-- or admin and only their own for branch-bound staff — so a cashier cannot use
-- this to survey the chain.
-- ============================================================================

create or replace function public.orders_waiting_by_branch()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare v_tenant uuid := auth_tenant_id();
        v jsonb;
begin
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  select coalesce(jsonb_agg(x order by x->>'branchName'), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
             'branchId',   b.id,
             'branchName', b.name,
             'waiting',    count(o.id),
             'oldestAt',   min(o.created_at),
             'total',      coalesce(sum(o.grand_total), 0)
           ) as x
      from public.branches b
      join public.orders o
        on o.branch_id = b.id
       and o.deleted_at is null
       and o.archived_at is null
       -- Only what a customer placed and is still waiting on. A bill the till
       -- has already taken is not "waiting" for anyone.
       and coalesce(o.status, 'running') in ('running', 'hold')
       and coalesce(o.data->>'source', '') in ('website', 'qr', 'customer_app', 'app')
     where b.tenant_id = v_tenant
       and b.id in (select auth_branch_ids())
     group by b.id, b.name
  ) s;

  return jsonb_build_object('ok', true, 'branches', v);
end
$function$;

revoke all on function public.orders_waiting_by_branch() from public;
grant execute on function public.orders_waiting_by_branch() to authenticated, service_role;
