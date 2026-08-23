-- ===========================================================================
-- v1.28.0 — Outbox claim/settle helpers for the push-dispatch worker
--
-- The worker must never hand the same notification to FCM twice, even if two
-- invocations overlap. `claim_notification_batch` does the claiming inside one
-- statement with FOR UPDATE SKIP LOCKED, so a second worker simply gets the
-- next rows instead of the same ones.
--
-- Both functions are service-role only. Nothing here is reachable from anon or
-- authenticated — a customer must not be able to read the outbox, which holds
-- other customers' device tokens and OTP codes.
-- ===========================================================================

-- The table shipped with statuses pending/sent/failed/expired. Claiming needs a
-- fifth: a row handed to a worker but not yet answered for. Without it a crashed
-- worker would leave rows looking deliverable and a second worker would send
-- them again.
alter table public.notification_outbox drop constraint if exists notification_outbox_status_check;
alter table public.notification_outbox add  constraint notification_outbox_status_check
  check (status = any (array['pending', 'sending', 'sent', 'failed', 'expired']));

create or replace function public.claim_notification_batch(
  p_channel text default 'push',
  p_limit   integer default 50
)
returns setof public.notification_outbox
language plpgsql security definer set search_path to 'public'
as $$
begin
  return query
  update notification_outbox o
     set status   = 'sending',
         attempts = o.attempts + 1
   where o.id in (
     select id from notification_outbox
      where status = 'pending'
        and channel = p_channel
      order by created_at
      limit greatest(1, least(coalesce(p_limit, 50), 200))
      for update skip locked
   )
  returning o.*;
end $$;

create or replace function public.settle_notification(
  p_id      uuid,
  p_ok      boolean,
  p_error   text default null,
  p_drop_token boolean default false
)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare v_row public.notification_outbox%rowtype;
begin
  update notification_outbox
     set status     = case when p_ok then 'sent'
                           -- A device FCM has disowned will never accept this
                           -- message; four more attempts would just be noise.
                           when p_drop_token then 'failed'
                           when attempts >= 5 then 'failed'
                           else 'pending' end,
         sent_at    = case when p_ok then now() else sent_at end,
         last_error = case when p_ok then null else left(coalesce(p_error, ''), 500) end
   where id = p_id
  returning * into v_row;

  -- FCM says the device is gone: stop mailing a dead address.
  if p_drop_token and v_row.customer_id is not null then
    update customers
       set push_token = null, updated_at = now()
     where id = v_row.customer_id
       and push_token = v_row.destination;
  end if;
end $$;

revoke execute on function public.claim_notification_batch(text, integer) from public, anon, authenticated;
revoke execute on function public.settle_notification(uuid, boolean, text, boolean)  from public, anon, authenticated;
grant  execute on function public.claim_notification_batch(text, integer) to service_role;
grant  execute on function public.settle_notification(uuid, boolean, text, boolean)  to service_role;
