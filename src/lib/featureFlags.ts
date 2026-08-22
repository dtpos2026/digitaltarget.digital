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
