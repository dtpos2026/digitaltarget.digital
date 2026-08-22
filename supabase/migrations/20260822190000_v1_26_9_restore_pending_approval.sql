-- ============================================================================
-- v1.26.9 — put the 9 recovered customer orders back in Online Order Approval
--
-- v1.26.3 rebuilt 9 stranded customer orders (PKR 5,030, 22 item rows) and
-- routed them to Online Order Approval as 'pending_approval'. They were later
-- rewritten to 'cancelled'/'paid' — all nine inside a four-second window, and
-- with NO approvedAt, rejectedAt or cancelledAt on any of them. The approval
-- screen always stamps one of those, so nobody accepted or rejected these:
-- a device flushed an older local copy over the repaired rows.
--
-- Two things are done about that here.
--
-- 1. The nine go back to 'pending_approval', so the decision is still the
--    cashier's to make. Nothing is auto-accepted.
-- 2. Their _updatedAt is stamped to now. The client merge is last-write-wins
--    on that value, so without this the same stale device would simply
--    overwrite the repair again on its next flush.
--
-- Narrow and idempotent: only rows carrying the v1.26.3 recovery signature,
-- and only those a human never actioned. A genuine approval or rejection —
-- which always records approvedAt or rejectedAt — is left exactly as it is.
-- No row is deleted, no item is touched, no money value is invented.
-- ============================================================================

update orders o
   set status = 'pending_approval',
       updated_at = now(),
       data = coalesce(o.data, '{}'::jsonb) || jsonb_build_object(
         'status',     'pending_approval',
         '_updatedAt', (extract(epoch from now()) * 1000)::bigint)
 where o.data ? 'approvalRequired'
   and coalesce(o.data->>'approvalRequired', 'false') = 'true'
   and (o.data->>'approvedAt')  is null
   and (o.data->>'rejectedAt')  is null
   and (o.data->>'cancelledAt') is null
   and o.status <> 'pending_approval';
