-- ROLLBACK for v1.107.0 (database part). Run in the Supabase SQL editor, in this order.
-- The ACLs below are what the live database had on 2026-11-05 BEFORE the change (read from pg_proc.proacl).
-- Running this file restores them exactly. Nothing in it touches data.

-- 1) close_unused_grants  ->  restore the previous grants
grant execute on function public.auth_branch_ids()                                                  to public, anon, authenticated, service_role;
grant execute on function public.device_heartbeat(uuid, double precision, double precision, text)   to public, anon, authenticated, service_role;
grant execute on function public.get_workspace_code(uuid)                                           to public, anon, authenticated, service_role;
grant execute on function public.orders_waiting_by_branch()                                         to anon, authenticated, service_role;
grant execute on function public.pos_change_own_password(uuid, text, text, text)                    to anon, authenticated, service_role;
grant execute on function public.promotion_audience_size()                                          to public, anon, authenticated, service_role;
grant execute on function public.recycle_bin_list(text, integer)                                    to public, anon, authenticated, service_role;
grant execute on function public.recycle_bin_restore(text, uuid[])                                  to public, anon, authenticated, service_role;
grant execute on function public.register_device(text, text, uuid, text, text, jsonb, text, text)   to public, anon, authenticated, service_role;
grant execute on function public.register_device(text, text, uuid, text, text, jsonb, text)         to public, anon, authenticated, service_role;
grant execute on function public.reset_order_counter(uuid, integer)                                 to public, anon, authenticated, service_role;
grant execute on function public.update_own_tenant_name(text)                                       to public, anon, authenticated, service_role;
grant execute on function public.sync_order_money_mirror()                                          to public, anon, authenticated, service_role;
grant execute on function public.sync_super_admins_from_allowlist()                                 to authenticated, service_role;

-- 2) track_order_throttle  ->  put the previous public_track_order body back, then drop the counter table
drop table if exists public.public_track_attempts;
-- The previous body of public.public_track_order(uuid,uuid,integer,text,text) is in
-- docs/rollback/2026-11-05-v1_107_0-public_track_order-before.sql (an exact copy of pg_get_functiondef from the live database).

-- 3) custom_website  ->  additive only; to remove it:
-- drop table if exists public.custom_site_orders;
-- drop table if exists public.custom_site_intake;

-- 3b) custom_website — remove the function as well (run with the drops above)
-- drop function if exists public.custom_site_place_order(uuid, uuid, jsonb);

-- 3c) v1.108.0 custom_site_rpcs — remove the five functions
-- drop function if exists public.custom_site_status();
-- drop function if exists public.custom_site_save(text, text, text);
-- drop function if exists public.custom_site_rotate_key();
-- drop function if exists public.custom_site_revoke_key();
-- drop function if exists public.sa_custom_site_overview();
