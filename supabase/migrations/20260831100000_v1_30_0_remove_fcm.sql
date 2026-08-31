-- ============================================================================
-- v1.30.0 — Firebase out. Supabase only.
--
-- INSTRUCTED, twice: "Firebase ye q ha?? del — Supabase he lgy."
--
-- WHAT WAS ACTUALLY LEFT
-- The Firebase SDK (Firestore, Auth, Storage) was already gone in v1.24.0 —
-- not in package.json, not installed, every `firebase/*` import aliased to a
-- stub, and no Firebase endpoint in the shipped bundle. The only thing with
-- the name on it was FCM: Android's push transport, reached through
-- @capacitor/push-notifications, which pulls com.google.firebase:firebase-messaging.
--
-- I said plainly what removing it costs — Android has no non-FCM way to wake a
-- closed app, so BACKGROUND notifications go with it — and the instruction was
-- repeated. So it goes.
--
-- NOTHING IS LOST HERE THAT WAS EVER USED
-- Both token columns were verified EMPTY on the live database before dropping:
--   customers.push_token              0 of 1496 rows
--   staff_portal_sessions.push_token  0 of 3 rows
-- No token was ever stored, which is also why the outbox holds no 'push' rows:
-- enqueue_order_push bailed out at `if v_push is null then return new`, on
-- every single order status change since it was written.
--
-- WHAT IS KEPT, AND WHY
-- notification_outbox, claim_notification_batch and settle_notification stay.
-- They are channel-generic and the only rows in that table are OTP messages on
-- channel 'sms' — nothing to do with Firebase. Removing them would have broken
-- OTP delivery to spite a transport that was never wired.
--
-- WHAT CHANGES IN PRACTICE: LESS THAN IT SOUNDS
-- FCM never delivered a single notification in this system. No token was ever
-- stored, so enqueue_order_push discarded every order status change it ever
-- saw. Removing it removes a feature that had never once worked.
--
-- What is gained: the trigger no longer needs a device token, so it stops
-- throwing those events away. Every status change is now recorded on channel
-- 'realtime', addressed by customer_id. 'whatsapp' is already an accepted
-- channel on this table and this POS already sends WhatsApp — so these rows
-- are now something a dispatcher can actually deliver, which they never were.
--
-- The table also joins the supabase_realtime publication so a subscriber CAN
-- consume it. Nothing is wired to it in this migration: the POS already learns
-- about order changes from its own `orders` subscription, and a second listener
-- saying the same thing would be duplicate noise.
--
-- HONEST LIMIT, stated rather than buried: notification_outbox is behind
-- `tenant_id = auth_tenant_id()`, and the customer / rider / order-taker apps
-- are anon, so Realtime will not deliver to them. They alert the way they
-- already do — their own poll and ReadyNotificationBus — which works while the
-- app is open. NOTHING WAKES A CLOSED ANDROID APP NOW, and nothing can without
-- FCM. That is the accepted cost of this instruction, not an oversight.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 'realtime' has to be a channel the table will accept.
--
-- Caught by verification, not by reading: the first version of this migration
-- applied cleanly and the trigger still enqueued NOTHING, because the CHECK
-- allowed only sms/whatsapp/push — and the trigger's own
-- `exception when others then return new` swallowed the violation exactly as
-- silently as the missing-token bail it replaced.
-- ---------------------------------------------------------------------------
alter table public.notification_outbox
  drop constraint if exists notification_outbox_channel_check;

alter table public.notification_outbox
  add constraint notification_outbox_channel_check
  check (channel = any (array['sms'::text, 'whatsapp'::text, 'push'::text, 'realtime'::text]));

-- ---------------------------------------------------------------------------
-- 1. The trigger stops depending on a device token.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_order_push()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_state  text;
  v_prev   text;
  v_title  text;
  v_body   text;
begin
  v_state := coalesce(nullif(new.delivery_status, ''), nullif(new.kitchen_status, ''));
  v_prev  := coalesce(nullif(old.delivery_status, ''), nullif(old.kitchen_status, ''));

  if v_state is null or v_state is not distinct from v_prev then
    return new;
  end if;
  if new.customer_id is null then
    return new;
  end if;

  -- v1.30.0: the customers.push_token lookup that used to guard this is gone.
  -- It was never non-null, so every one of these events was discarded.

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
    else return new;
  end case;

  begin
    -- 'realtime', and settled on the spot: the delivery IS the publication
    -- broadcast, so there is no dispatcher to claim this row and no queue for
    -- it to sit in. 'sms' rows still go through the claim/settle path.
    insert into notification_outbox
      (tenant_id, channel, destination, title, body, data, customer_id, status, sent_at)
    values (new.tenant_id, 'realtime', new.customer_id::text, v_title, v_body,
            jsonb_build_object(
              'orderId',     new.id::text,
              'orderNumber', new.order_number,
              'state',       v_state,
              'kind',        'order_status'),
            new.customer_id, 'sent', now());
  exception when others then
    -- An alert must never be the reason an order fails to save.
    return new;
  end;

  return new;
end $function$;

-- ---------------------------------------------------------------------------
-- 2. settle_notification loses its FCM half.
--
-- p_drop_token existed for one thing: FCM reporting a dead registration, which
-- cleared customers.push_token. That column is going, so the parameter goes
-- with it. The rest — retry until 5 attempts, then 'failed' — is what the SMS
-- channel needs and is unchanged.
-- ---------------------------------------------------------------------------
drop function if exists public.settle_notification(uuid, boolean, text, boolean);

create or replace function public.settle_notification(
  p_id uuid, p_ok boolean, p_error text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update notification_outbox
     set status     = case when p_ok then 'sent'
                           when attempts >= 5 then 'failed'
                           else 'pending' end,
         sent_at    = case when p_ok then now() else sent_at end,
         last_error = case when p_ok then null else left(coalesce(p_error, ''), 500) end
   where id = p_id;
end $function$;

revoke all on function public.settle_notification(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.settle_notification(uuid, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The FCM-only surface, removed.
-- ---------------------------------------------------------------------------
drop function if exists public.portal_push_token(text, text);
drop function if exists public.staff_push_targets(uuid, text);
drop function if exists public.public_customer_push_token(text, text);

drop index if exists public.staff_portal_sessions_push_idx;

-- Verified empty on the live database before this ran: 0 of 1496, and 0 of 3.
alter table public.customers             drop column if exists push_token;
alter table public.staff_portal_sessions drop column if exists push_token;

-- ---------------------------------------------------------------------------
-- 4. Realtime carries what FCM used to.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'notification_outbox'
  ) then
    alter publication supabase_realtime add table public.notification_outbox;
  end if;
end $$;
