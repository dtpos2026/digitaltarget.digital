-- ============================================================================
-- v1.26.3 — make the typed money columns agree with the order documents
--
-- The POS writer filled `total` and left grand_total / subtotal / discount /
-- tax at 0; public_place_order filled grand_total / subtotal and left `total`
-- at 0. Both writers are fixed from this release on, but the rows already in
-- the table still disagree — so anything querying the typed columns (the order
-- tracker before v1.26.2, and any branch/date sales reporting that groups in
-- SQL rather than in the client) reads 0 for whichever half it lands on.
--
-- The authoritative value is the order document: that is what the POS renders,
-- prints and reconciles against. This copies it into the columns where they
-- are empty. Nothing is overwritten that already holds a value, so it is
-- idempotent and cannot move a figure that someone has since corrected.
-- ============================================================================

update orders o
   set grand_total = coalesce(
         nullif(o.grand_total, 0),
         nullif(case when jsonb_typeof(o.data->'grandTotal') = 'number'
                     then (o.data->>'grandTotal')::numeric end, 0),
         nullif(o.total, 0), 0),
       total = coalesce(
         nullif(o.total, 0),
         nullif(case when jsonb_typeof(o.data->'grandTotal') = 'number'
                     then (o.data->>'grandTotal')::numeric end, 0),
         nullif(o.grand_total, 0), 0),
       subtotal = coalesce(
         nullif(o.subtotal, 0),
         nullif(case when jsonb_typeof(o.data->'subtotal') = 'number'
                     then (o.data->>'subtotal')::numeric end, 0),
         0),
       discount = coalesce(
         nullif(o.discount, 0),
         nullif(case when jsonb_typeof(o.data->'discount') = 'number'
                     then (o.data->>'discount')::numeric end, 0),
         0),
       tax = coalesce(
         nullif(o.tax, 0),
         nullif(case when jsonb_typeof(o.data->'tax') = 'number'
                     then (o.data->>'tax')::numeric end, 0),
         0),
       -- The document also knows the type and source; the columns are the
       -- index reports group by.
       order_type = coalesce(o.order_type, nullif(o.data->>'orderType', '')),
       source     = coalesce(o.source,     nullif(o.data->>'source', ''))
 where coalesce(o.grand_total, 0) = 0
    or coalesce(o.total, 0) = 0
    or coalesce(o.subtotal, 0) = 0
    or o.order_type is null
    or o.source is null;
