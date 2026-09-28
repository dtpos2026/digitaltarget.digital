// ============================================================
// DT POS — Phase 1 stabilization feature flags.
// Additive only. Flip these to restore prior behavior.
// ============================================================

/**
 * When TRUE, pages that already have a live Firestore onSnapshot listener
 * (via src/lib/store.ts) will ALSO run their legacy setInterval poll on top.
 * Default FALSE — the live listener is sufficient, and the extra poll was
 * causing 2x Firestore reads and quota exhaustion.
 * Set to true only when debugging a page that appears stale.
 */
export const ENABLE_REDUNDANT_ORDER_POLL = false;

/**
 * When TRUE, printer settings (selected printer, margins, silent-print) are
 * mirrored to Firestore (legacy behavior). This caused one cashier's device
 * choice to overwrite another's. Default FALSE — settings stay local per
 * device (keyed by localStorage 'pos-device-id').
 */
export const SYNC_PRINTER_SETTINGS_TO_CLOUD = false;

/**
 * When TRUE (default), Firestore uses `experimentalAutoDetectLongPolling` so
 * the SDK first attempts the normal WebChannel stream and only falls back to
 * HTTP long-polling on failure. This roughly halves bandwidth versus always
 * forcing long polling. When FALSE, the original `experimentalForceLongPolling:
 * true` code path is used (kept intact as fallback). A per-browser marker
 * `dtpos-firestore-force-long-polling` (set to '1') also forces the legacy
 * behavior even when this flag is true, so devices on restrictive networks
 * can pin themselves to long polling without a code change.
 */
export const AUTO_DETECT_LONG_POLLING = true;

/**
 * TTL (in milliseconds) for the client-side cache of billing reads
 * (invoices + payments) in `src/lib/billing.ts`. Default 24 hours.
 *
 * Billing data changes infrequently (only when Super Admin issues an
 * invoice or records a payment). Repeatedly re-fetching the full
 * invoices/payments collections on every dashboard mount was a large
 * Firestore read multiplier. With this cache, subsequent reads inside
 * the TTL are served from localStorage.
 *
 * Set to 0 to disable the cache entirely (original behavior — always
 * hit Firestore). The cache can also be bypassed per-call by passing
 * `{ force: true }` to fetchInvoices / fetchPayments.
 */
export const BILLING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ============================================================
// v1.65.0 — Supabase egress: the orders poll
// ============================================================

/**
 * When TRUE (default), `refreshOrdersFromCloud()` reads only the orders that
 * CHANGED since the last read instead of re-downloading the whole collection.
 *
 * WHY THIS EXISTS — measured, not assumed:
 *
 *   One restaurant (First Chef) has 352 live order rows. `select('*')` on
 *   `orders` returns 1,765 kB for them, because each row carries the full
 *   order document in its `data` jsonb. Thirteen screens call
 *   `refreshOrdersFromCloud()`, four of them on an 8–15 second timer. One
 *   till sitting on Running Bills therefore pulled ~10.6 MB per minute —
 *   about 7.6 GB across a twelve-hour shift, for a set of orders that
 *   changed by two or three rows in that whole time.
 *
 * The delta uses the SAME table, the SAME tenant filter and the SAME RLS
 * policy as the full read — it adds one `updated_at >=` condition, nothing
 * else. `public.orders` has a BEFORE UPDATE trigger (`orders_updated_at`)
 * that sets `updated_at = now()` on every write, whichever path performs it,
 * so no change can slip past the cursor.
 *
 * Set to FALSE to restore the full-collection read exactly as it was.
 */
export const ENABLE_ORDERS_DELTA_PULL = true;

/**
 * How far BACK of the stored cursor each delta read starts, in milliseconds.
 *
 * Postgres `now()` is transaction-start time, so a long transaction can
 * commit a row whose `updated_at` is older than a row committed before it. A
 * strict "greater than the newest timestamp I saw" cursor would step over
 * that row and lose a bill. Re-reading a few seconds of overlap costs a
 * handful of rows and cannot lose one; the merge is idempotent, so a row
 * arriving twice changes nothing.
 */
export const ORDERS_DELTA_OVERLAP_MS = 30 * 1000;

/**
 * How often the delta path takes a FULL read anyway, in milliseconds.
 *
 * A cursor is only as good as the write that follows it: if the cursor
 * advances and `saveLocal()` then fails (storage quota), the device would
 * never ask for those rows again. This is the self-healing floor — at worst
 * the till is one reconcile behind, never permanently wrong. At 15 minutes a
 * device takes 4 full reads an hour instead of 450.
 *
 * Set to 0 to never reconcile (pure delta after the first read).
 */
export const ORDERS_FULL_RECONCILE_MS = 15 * 60 * 1000;
