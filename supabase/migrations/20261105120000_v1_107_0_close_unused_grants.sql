-- v1.107.0 — security hygiene S-1 / S-6 / S-7 (docs/SECURITY-REVIEW-2026-11-02.md).
-- REMOVES EXECUTE grants only. No table, column, policy or function body is touched.
--
-- S-1  Eleven functions that have no anonymous use (every one checks auth_tenant_id() / is_super_admin() inside and
--      every call site in src/ runs after sign-in): anon and PUBLIC lose EXECUTE; signed-in users and the server keep it.
-- S-6  sync_order_money_mirror() is a trigger function: nobody calls it over the API. A trigger does not need the firing
--      user to hold EXECUTE, so nothing that fires it changes.
-- S-7  sync_super_admins_from_allowlist() has no caller check. Only sa_add_team_member (SECURITY DEFINER, runs as the
--      owner) needs it, so signed-in restaurant users lose it.
--
-- Rollback: docs/rollback/2026-11-05-v1_107_0-rollback.sql (the exact ACLs read from the live database before this change).

revoke all on function public.auth_branch_ids()                                                  from public, anon;
revoke all on function public.device_heartbeat(uuid, double precision, double precision, text)   from public, anon;
revoke all on function public.get_workspace_code(uuid)                                           from public, anon;
revoke all on function public.orders_waiting_by_branch()                                         from public, anon;
revoke all on function public.pos_change_own_password(uuid, text, text, text)                    from public, anon;
revoke all on function public.promotion_audience_size()                                          from public, anon;
revoke all on function public.recycle_bin_list(text, integer)                                    from public, anon;
revoke all on function public.recycle_bin_restore(text, uuid[])                                  from public, anon;
revoke all on function public.register_device(text, text, uuid, text, text, jsonb, text, text)   from public, anon;
revoke all on function public.register_device(text, text, uuid, text, text, jsonb, text)         from public, anon;
revoke all on function public.reset_order_counter(uuid, integer)                                 from public, anon;
revoke all on function public.update_own_tenant_name(text)                                       from public, anon;

grant execute on function public.auth_branch_ids()                                                  to authenticated, service_role;
grant execute on function public.device_heartbeat(uuid, double precision, double precision, text)   to authenticated, service_role;
grant execute on function public.get_workspace_code(uuid)                                           to authenticated, service_role;
grant execute on function public.orders_waiting_by_branch()                                         to authenticated, service_role;
grant execute on function public.pos_change_own_password(uuid, text, text, text)                    to authenticated, service_role;
grant execute on function public.promotion_audience_size()                                          to authenticated, service_role;
grant execute on function public.recycle_bin_list(text, integer)                                    to authenticated, service_role;
grant execute on function public.recycle_bin_restore(text, uuid[])                                  to authenticated, service_role;
grant execute on function public.register_device(text, text, uuid, text, text, jsonb, text, text)   to authenticated, service_role;
grant execute on function public.register_device(text, text, uuid, text, text, jsonb, text)         to authenticated, service_role;
grant execute on function public.reset_order_counter(uuid, integer)                                 to authenticated, service_role;
grant execute on function public.update_own_tenant_name(text)                                       to authenticated, service_role;

revoke all on function public.sync_order_money_mirror()               from public, anon, authenticated;
revoke all on function public.sync_super_admins_from_allowlist()      from public, anon, authenticated;
grant execute on function public.sync_order_money_mirror()            to service_role;
grant execute on function public.sync_super_admins_from_allowlist()   to service_role;
