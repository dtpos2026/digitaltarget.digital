-- ============================================================================
-- v1.27.1 — Close Day must clear the day, not destroy the sales record
--
-- ===== WHAT WAS HAPPENING =====
-- Day Close deletes orders by status group. For paid bills that meant a
-- tombstone in the cloud (deleted_at), which syncs to every device.
--
-- The only surviving copy was `dt-pos-order-archive::<tenant>` in localStorage:
-- one browser, one device, pruned to 400 days and 20,000 orders, and HALVED on
-- a quota error. A new till, a reinstall or a cleared browser has no history at
-- all, and the database — the one place that is backed up — has none either.
--
-- On this database that is 30 paid orders worth PKR 42,498, tombstoned across
-- three days. Their items, totals and paidAt are all intact; only the tombstone
-- hides them.
--
-- ===== THE FIX =====
-- A third state between "live" and "deleted": archived.
--
--   deleted_at   the row is gone. Tombstone, syncs as a delete.
--   archived_at  the day it belonged to was closed. The row stays, in full,
--                forever. Operational screens and counters ignore it; the
--                Admin Sales History and audit reports read it.
--
-- Closing a day is not a deletion and must stop behaving like one.
--
-- ===== RECOVERY =====
-- The 30 tombstoned PAID orders are restored as ARCHIVED, not as live. That
-- returns them to the audit trail without pushing them back into today's
-- takings — the operator closed those days deliberately and their reports
-- should not change under them.
--
-- Only paid and credit_received are restored. A void, cancelled or running
-- order that was deleted carries no payment record, and deleting it was a
-- legitimate act; those tombstones are left alone.
-- ============================================================================

alter table public.orders add column if not exists archived_at timestamptz;

comment on column public.orders.archived_at is
  'Set by Close Day. The order is history: excluded from operational screens and counters, always present in audit and sales history. NOT a deletion — deleted_at is a deletion.';

-- Operational reads are "this tenant, not archived, not deleted", which is the
-- hot path on every till.
create index if not exists idx_orders_live_operational
  on public.orders (tenant_id, branch_id, created_at desc)
  where archived_at is null and deleted_at is null;

-- Audit reads go the other way: one closed day at a time.
create index if not exists idx_orders_archived
  on public.orders (tenant_id, archived_at desc)
  where archived_at is not null;

-- ---- Recovery -------------------------------------------------------------
-- Idempotent: a row already restored has deleted_at null and is skipped.
update public.orders
   set archived_at = coalesce(archived_at, deleted_at),
       deleted_at  = null,
       updated_at  = now()
 where deleted_at is not null
   and status in ('paid', 'credit_received');
