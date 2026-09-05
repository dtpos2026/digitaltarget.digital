-- ============================================================================
-- v1.52.0 — "Order Taker se order aata hai, amount POS mein 0 hota hai"
--
-- THE CLIENT DESTROYED THE FIGURE ON EVERY PULL. This migration does the two
-- server-side halves; lib/supabaseStore carries the fix that stops it.
--
-- WHAT HAPPENED
--
-- rowFromDb() rebuilt an order from its row with:
--
--     payload.grandTotal = Number(row.total ?? payload.grandTotal) || 0;
--
-- `total` is the LEGACY column. portal_upsert_order — the Order Taker's write
-- path — stores the document and never fills it, so it sits at 0. And in
-- JavaScript `0 ?? x` is 0: nullish coalescing falls through on null and
-- undefined, never on zero. So the column's 0 beat the document's 590, and the
-- next save on that device wrote the 0 back INTO the document. One pull was
-- enough to lose the number for good.
--
-- THE PROOF IS STILL IN THE DATA
--
-- netOfTax is grandTotal minus tax, and nothing overlays it, so it kept what
-- grandTotal lost. Nine orders carry the fingerprint, and on every one of them
-- three independently-stored figures agree:
--
--   #    status     subtotal  netOfTax  items sum
--   1029 cancelled  3848      3848      3848
--   1032 cancelled  410       410       410
--   1033 cancelled  410       410       410
--   1034 cancelled  410       410       410
--   1037 cancelled  130       130       130
--   1042 running    590       590       590
--   1043 running    130       130       130
--   1044 running    130       130       130
--   1045 running    280       280       280
--
-- With tax 0, "netOfTax 590 and grandTotal 0" is not a business decision — it
-- is arithmetically impossible. That invariant, not a guess, is what makes the
-- repair below safe, and it is why cancelled orders are repaired too: a
-- deliberate cancel recomputes both figures together, so it could never leave
-- them disagreeing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Stop `total` being a lie.
--
-- v1.49.0 mirrored grand_total from the document and left `total` alone, so
-- the legacy column stayed at 0 and any reader preferring it got a zero. Both
-- now follow the document.
-- ---------------------------------------------------------------------------
create or replace function public.sync_order_money_mirror()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare d jsonb := new.data;
begin
  if d is null or jsonb_typeof(d) <> 'object' then return new; end if;

  if d ? 'orderType'     then new.order_type     := nullif(d->>'orderType',''); end if;
  if d ? 'subtotal'      then new.subtotal       := coalesce((d->>'subtotal')::numeric,      new.subtotal); end if;
  if d ? 'discount'      then new.discount       := coalesce((d->>'discount')::numeric,      new.discount); end if;
  if d ? 'tax'           then new.tax            := coalesce((d->>'tax')::numeric,           new.tax); end if;
  if d ? 'serviceCharge' then new.service_charge := coalesce((d->>'serviceCharge')::numeric, new.service_charge); end if;
  if d ? 'amountPaid'    then new.amount_paid    := coalesce((d->>'amountPaid')::numeric,    new.amount_paid); end if;
  if d ? 'paymentMethod' then new.payment_method := nullif(d->>'paymentMethod',''); end if;

  -- grand_total AND the legacy `total` together. They are the same number and
  -- letting them disagree is what this whole fault was.
  if d ? 'grandTotal' then
    new.grand_total := coalesce((d->>'grandTotal')::numeric, new.grand_total);
    new.total       := coalesce((d->>'grandTotal')::numeric, new.total);
  end if;

  if d ? 'riderId' then
    if d->>'riderId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      new.rider_id := (d->>'riderId')::uuid;
    elsif coalesce(btrim(d->>'riderId'), '') = '' then
      new.rider_id := null;
    end if;
  end if;
  if d ? 'riderName' then new.rider_name := nullif(btrim(d->>'riderName'), ''); end if;

  return new;
end
$function$;

-- ---------------------------------------------------------------------------
-- 2. Repair the nine, from their own surviving evidence.
--
-- Only where the document contradicts itself: grandTotal 0 while netOfTax is
-- positive. The restored value is netOfTax + tax, which is the definition of
-- grandTotal, and it is cross-checked against the sum of the line items — a
-- row whose items do not agree is left alone rather than guessed at.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  update public.orders o
     set data = jsonb_set(o.data, '{grandTotal}',
                          to_jsonb((o.data->>'netOfTax')::numeric
                                   + coalesce((o.data->>'tax')::numeric, 0)))
   where o.deleted_at is null
     and coalesce((o.data->>'grandTotal')::numeric, 0) = 0
     and coalesce((o.data->>'netOfTax')::numeric, 0) > 0
     and (o.data->>'netOfTax')::numeric + coalesce((o.data->>'tax')::numeric, 0)
         = (select coalesce(sum((it->>'lineTotal')::numeric), 0)
              from jsonb_array_elements(o.data->'items') it);
  get diagnostics n = row_count;
  raise notice 'order totals restored from netOfTax: % row(s)', n;
end $$;

-- 3. Backfill `total` for every row whose document knows better.
do $$
declare n int;
begin
  update public.orders set data = data
   where deleted_at is null
     and coalesce(total, 0) = 0
     and coalesce((data->>'grandTotal')::numeric, 0) > 0;
  get diagnostics n = row_count;
  raise notice 'legacy total column backfilled: % row(s)', n;
end $$;
