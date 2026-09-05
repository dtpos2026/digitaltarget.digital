-- v1.52.0 — "Order not found" for an order that exists.
--
-- Order #1046 is in the table: paid, Rs 410, customer phone ending 3354. The
-- customer typed 1046 and 3354 and was told it does not exist. Called directly,
-- public_track_order returns it in full — so the RPC was never the problem.
--
-- It is granted to service_role ONLY, so the only way to reach it is the
-- TanStack server function, which lives on the website's own origin. That is
-- the same dead end the customer photo upload hit: inside the packaged app the
-- origin is not being served, and on any deployment without a service-role key
-- the call throws. The client's catch turned every one of those into
-- "Order not found", which sends the customer to check a number that was right.
--
-- The tracking page is PUBLIC by design — no login, anyone with the link. So
-- the RPC gets its own anon door, exactly like every public_customer_* function
-- already has. Nothing is widened: the guard inside is unchanged and already
-- demands the tenant, the order number, AND the last four digits of the phone
-- (or the table). A caller who has those is the customer holding the receipt.
grant execute on function
  public.public_track_order(uuid, uuid, integer, text, text)
  to anon, authenticated;
