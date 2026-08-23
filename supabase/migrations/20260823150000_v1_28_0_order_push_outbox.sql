-- ===========================================================================
-- v1.28.0 — Enqueue customer push notifications on order progress
--
-- `notification_outbox` already exists (it carries the OTP messages). This adds
-- the second producer: an AFTER UPDATE trigger on orders that writes one row
-- whenever the customer's order visibly moves — accepted, cooking, ready, on
-- the way, delivered.
--
-- Rules this trigger lives by, because it sits on the POS's hot path:
--   * it NEVER raises. A notification that cannot be queued must not stop a
--     cashier from marking an order ready.
--   * it only fires on a real change of the visible state.
--   * it writes nothing when the customer has no device token, so the outbox
--     does not fill with rows nothing can deliver.
--
-- Actual delivery is the `push-dispatch` edge function's job. Nothing here
-- talks to FCM.
-- ===========================================================================

-- Delivery workers claim rows by (status, created_at); this keeps that cheap.
create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (status, created_at)
  where status = 'pending';

create or replace function public.enqueue_order_push()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_state  text;
  v_prev   text;
  v_title  text;
  v_body   text;
  v_push   text;
  v_name   text;
begin
  -- One visible state per order, delivery first: once a rider has it, the
  -- kitchen's state is no longer what the customer is waiting on.
  v_state := coalesce(nullif(new.delivery_status, ''), nullif(new.kitchen_status, ''));
  v_prev  := coalesce(nullif(old.delivery_status, ''), nullif(old.kitchen_status, ''));

  if v_state is null or v_state is not distinct from v_prev then
    return new;
  end if;
  if new.customer_id is null then
    return new;
  end if;

  select nullif(btrim(coalesce(c.push_token, '')), ''), c.name
    into v_push, v_name
    from customers c
   where c.id = new.customer_id
     and c.tenant_id = new.tenant_id;

  if v_push is null then
    return new;
  end if;

  case lower(v_state)
    when 'accepted'       then v_title := 'Order confirmed';
                               v_body  := 'Your order #' || new.order_number || ' has been accepted.';
    when 'preparing'      then v_title := 'In the kitchen';
                               v_body  := 'Order #' || new.order_number || ' is being prepared.';
    when 'cooking'        then v_title := 'In the kitchen';
                               v_body  := 'Order #' || new.order_number || ' is being prepared.';
    when 'ready'          then v_title := 'Ready';
                               v_body  := 'Order #' || new.order_number || ' is ready.';
    when 'rider_assigned' then v_title := 'Rider assigned';
                               v_body  := coalesce(new.rider_name, 'A rider') || ' is collecting order #' || new.order_number || '.';
    when 'rider_picked'   then v_title := 'On the way';
                               v_body  := 'Order #' || new.order_number || ' has left the restaurant.';
    when 'onway'          then v_title := 'On the way';
                               v_body  := 'Order #' || new.order_number || ' is on the way to you.';
    when 'rider_reached'  then v_title := 'Your rider has arrived';
                               v_body  := 'Order #' || new.order_number || ' is at your address.';
    when 'delivered'      then v_title := 'Delivered';
                               v_body  := 'Order #' || new.order_number || ' has been delivered. Enjoy!';
    when 'cancelled'      then v_title := 'Order cancelled';
                               v_body  := 'Order #' || new.order_number || ' was cancelled.';
    else return new;   -- an internal state the customer has no use for
  end case;

  begin
    insert into notification_outbox (tenant_id, channel, destination, title, body, data, customer_id)
    values (new.tenant_id, 'push', v_push, v_title, v_body,
            jsonb_build_object(
              'orderId',     new.id::text,
              'orderNumber', new.order_number,
              'state',       v_state,
              'kind',        'order_status'),
            new.customer_id);
  exception when others then
    -- Queueing a notification is never worth failing an order update over.
    return new;
  end;

  return new;
end $$;

drop trigger if exists trg_enqueue_order_push on public.orders;
create trigger trg_enqueue_order_push
  after update on public.orders
  for each row
  when (
    old.delivery_status is distinct from new.delivery_status
    or old.kitchen_status is distinct from new.kitchen_status
  )
  execute function public.enqueue_order_push();

revoke execute on function public.enqueue_order_push() from public, anon, authenticated;
