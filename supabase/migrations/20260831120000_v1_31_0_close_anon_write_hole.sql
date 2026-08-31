-- ============================================================================
-- v1.31.0 — CRITICAL: anonymous writes into any restaurant's orders
--
-- FOUND BY EXPLOITING IT, not by reading. As the `anon` role — a stranger
-- holding nothing but the public API key that ships in every browser bundle —
-- inside a transaction that was rolled back:
--
--   anon INSERT into order_items  ->  SUCCEEDED: a line item was written into
--                                     a LIVE order belonging to a restaurant
--                                     the attacker has no relationship with
--   anon INSERT into orders       ->  SUCCEEDED: a whole order was created for
--                                     that restaurant
--   anon SELECT/UPDATE/DELETE     ->  correctly refused (0 rows)
--
-- So it is write-only, which makes it an INTEGRITY and FLOODING attack rather
-- than a data breach. That is not much comfort:
--   * fake line items land on a real customer's bill and change the total;
--   * garbage orders reach the kitchen and burn order numbers;
--   * sales reports and inventory deduction are corrupted by rows nobody made;
--   * nothing rate-limits it, so the table can be filled indefinitely.
--
-- THE POLICIES RESPONSIBLE
--   orders_public_insert       TO anon  WITH CHECK (source IN ('website','qr')
--                                                   AND status = 'running')
--   order_items_public_insert  TO anon  WITH CHECK (true)      <-- no check at all
--
-- Neither is scoped by tenant. order_items has no condition whatsoever.
--
-- WHY REMOVING THEM IS SAFE
-- Nothing uses them. Verified: there is no `from('orders')` or
-- `from('order_items')` write anywhere in the client. Public ordering goes
-- through submitPublicOrder -> public_place_order, which is granted to
-- SERVICE_ROLE only and runs behind a server function that validates the
-- payload (uuid parsing, 1..100 items) before Postgres sees it. service_role
-- bypasses RLS entirely, so dropping an anon policy cannot affect it.
--
-- The POS itself writes as `authenticated` under the separate tenant policies
-- on both tables, which are untouched here.
--
-- These two are the legacy direct-insert path from before public_place_order
-- existed. They were left behind, and they are pure attack surface.
-- ============================================================================

drop policy if exists order_items_public_insert on public.order_items;
drop policy if exists orders_public_insert      on public.orders;

-- Belt and braces: anon has no business writing to either table by any route.
-- The grant is what made the policy reachable in the first place.
revoke insert, update, delete on public.orders      from anon;
revoke insert, update, delete on public.order_items from anon;
