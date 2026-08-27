-- ===========================================================================
-- v1.28.1 — index the payment that was already recorded
--
-- FOUND BY the Gold-release QC sweep. Every paid bill in the database read
-- payment_method NULL and amount_paid 0.00 — all 33 of them, PKR 38,758 of
-- trade. The money was never lost: orders.data (the POS document) carried
-- paymentMethod, amountPaid, paidAt, cashReceived and the payments array all
-- along, and the till reads the document, so the cashier's screen was right.
-- What was wrong is the typed columns, which exist to be a queryable index OF
-- that document. rowToDb() simply never wrote them.
--
-- This is the same defect v1.26.3 fixed for subtotal/discount/tax/grand_total,
-- one field family later. The client-side half is in src/lib/supabaseStore.ts.
-- This is the half that repairs the rows already written.
--
-- SAFETY
-- Every column is filled ONLY where it is currently empty, and only from that
-- same row's own document. No row is deleted, no document is touched, and a
-- second run changes nothing.
-- ===========================================================================

update orders o
   set payment_method = coalesce(
         o.payment_method,
         nullif(btrim(coalesce(o.data->>'paymentMethod', '')), '')),
       payment_account_name = coalesce(
         o.payment_account_name,
         nullif(btrim(coalesce(o.data->>'paymentAccountName', '')), '')),
       amount_paid = case
         when coalesce(o.amount_paid, 0) = 0
          and (o.data->>'amountPaid') ~ '^-?[0-9]+(\.[0-9]+)?$'
         then (o.data->>'amountPaid')::numeric
         else o.amount_paid end,
       cash_received = case
         when o.cash_received is null
          and (o.data->>'cashReceived') ~ '^-?[0-9]+(\.[0-9]+)?$'
         then (o.data->>'cashReceived')::numeric
         else o.cash_received end,
       change_returned = case
         when o.change_returned is null
          and (o.data->>'changeReturned') ~ '^-?[0-9]+(\.[0-9]+)?$'
         then (o.data->>'changeReturned')::numeric
         else o.change_returned end,
       paid_at = case
         when o.paid_at is null and nullif(btrim(coalesce(o.data->>'paidAt','')),'') is not null
         then (o.data->>'paidAt')::timestamptz
         else o.paid_at end
 where o.deleted_at is null
   and (
     (o.payment_method is null and nullif(btrim(coalesce(o.data->>'paymentMethod','')),'') is not null)
     or (coalesce(o.amount_paid, 0) = 0 and (o.data->>'amountPaid') ~ '^-?[0-9]+(\.[0-9]+)?$')
     or (o.paid_at is null and nullif(btrim(coalesce(o.data->>'paidAt','')),'') is not null)
     or (o.cash_received is null and (o.data->>'cashReceived') ~ '^-?[0-9]+(\.[0-9]+)?$')
     or (o.change_returned is null and (o.data->>'changeReturned') ~ '^-?[0-9]+(\.[0-9]+)?$')
     or (o.payment_account_name is null and nullif(btrim(coalesce(o.data->>'paymentAccountName','')),'') is not null)
   );
