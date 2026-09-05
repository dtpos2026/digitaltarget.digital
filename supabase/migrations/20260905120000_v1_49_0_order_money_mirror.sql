-- ============================================================================
-- v1.49.0 — "Order Taker se 410 ka order aya, POS me bill 0 dikha raha hai"
--
-- THE ORDER WAS NEVER WRONG. THE COLUMNS WERE EMPTY.
--
-- An order is stored twice: as a document in orders.data, which is what the
-- screens render, and as flat columns, which is what every report, dashboard,
-- shift summary and analytics query reads. Nothing kept the two in step. Each
-- writer had to remember to fill the columns itself, and portal_upsert_order —
-- the Order Taker's write path, added in v1.42.0 — did not. It writes
--
--     id, tenant_id, branch_id, order_number, status, data
--
-- and nothing else, so subtotal, grand_total, order_type, amount_paid and
-- payment_method stayed at their defaults. The bill opened at Rs 0 while the
-- document underneath it said 410.
--
-- Measured on the live database before this migration:
--
--     orders (not deleted)                 268
--     grand_total 0 while the document > 0   2   -- Rs 540 invisible to reports
--     subtotal    0 while the document > 0   1
--     order_type  null while the document has one   1
--
-- Two rows is small. The rate is not: EVERY future Order Taker order would
-- have joined them, and the two here are from the last two days of testing.
--
-- THE FIX IS THE ONE ALREADY USED FOR LINE ITEMS
--
-- v1.34.0 hit exactly this shape with order_items — a mirror each writer had to
-- remember — and solved it with a trigger, so no writer can be forgotten. The
-- money columns now work the same way: they are DERIVED from the document
-- whenever the document is written, and only then. An update that does not
-- touch `data` leaves them alone.
--
-- A key the document does not carry is not touched either, so this cannot
-- blank a column that the document has nothing to say about.
--
-- Verified live in a rolled-back transaction before applying:
--
--     #1037 running    grand_total 0   -> 130   (document said 130)
--     #1034 hold       grand_total 0   -> 410   (document said 410)
--     #1033 cancelled  grand_total 0   -> 0     (document says 0 — untouched)
--     #1031 paid       grand_total 680 -> 680   (already right — untouched)
--
-- A deliberate zero is not resurrected. That distinction is the whole reason
-- this derives from the document rather than from the line items.
-- ============================================================================

create or replace function public.sync_order_money_mirror()
returns trigger
language plpgsql
as $function$
declare d jsonb := new.data;
begin
  if d is null or jsonb_typeof(d) <> 'object' then return new; end if;

  -- `d ? key` rather than a coalesce chain: a document that says nothing about
  -- a field must leave that column exactly as the writer set it.
  if d ? 'orderType'     then new.order_type     := nullif(d->>'orderType',''); end if;
  if d ? 'subtotal'      then new.subtotal       := coalesce((d->>'subtotal')::numeric,      new.subtotal); end if;
  if d ? 'discount'      then new.discount       := coalesce((d->>'discount')::numeric,      new.discount); end if;
  if d ? 'tax'           then new.tax            := coalesce((d->>'tax')::numeric,           new.tax); end if;
  if d ? 'serviceCharge' then new.service_charge := coalesce((d->>'serviceCharge')::numeric, new.service_charge); end if;
  if d ? 'grandTotal'    then new.grand_total    := coalesce((d->>'grandTotal')::numeric,    new.grand_total); end if;
  if d ? 'amountPaid'    then new.amount_paid    := coalesce((d->>'amountPaid')::numeric,    new.amount_paid); end if;
  if d ? 'paymentMethod' then new.payment_method := nullif(d->>'paymentMethod',''); end if;

  return new;
end
$function$;

drop trigger if exists trg_sync_order_money_mirror on public.orders;
create trigger trg_sync_order_money_mirror
  before insert or update of data on public.orders
  for each row execute function public.sync_order_money_mirror();

-- ---------------------------------------------------------------------------
-- Backfill: only the rows where a column is empty and the document is not.
--
-- `set data = data` re-saves the document through the trigger. Deliberately
-- narrow: no row whose columns already agree with its document is rewritten,
-- so updated_at does not move on 266 orders that were never broken, and no
-- cancelled order has its zero replaced.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  update public.orders set data = data
   where deleted_at is null
     and (   (coalesce(grand_total, 0) = 0 and coalesce((data->>'grandTotal')::numeric, 0) > 0)
          or (coalesce(subtotal,    0) = 0 and coalesce((data->>'subtotal')::numeric,   0) > 0)
          or (order_type is null and nullif(data->>'orderType', '') is not null)
          or (coalesce(amount_paid, 0) = 0 and coalesce((data->>'amountPaid')::numeric, 0) > 0));
  get diagnostics n = row_count;
  raise notice 'order money mirror: % row(s) repaired', n;
end $$;
