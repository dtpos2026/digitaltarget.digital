// Persistent archive of orders that survives Day Close.
// Admin-only history for daily / weekly / monthly reporting.
//
// ===== v1.15.1 — "After Day Close the Shift Report shows 0 orders" =====
//
// Root cause of the client's report: Day Close DELETES orders from the live
// store (that is its job), and this archive was the only thing that kept a
// copy — but every report page read `getOrders()` directly, so the moment a
// day was closed the reports went to zero and no previous date could be
// pulled up again. The archive existed and was correct; nothing except the
// Admin Sales History page ever read it.
//
// Two changes here:
//   1. `archiveOrders` is now also called on every settled sale (see
//      store.ts), not only at Day Close. A device that never runs Day Close
//      itself — or that has its orders removed by a Day Close on ANOTHER
//      device via sync — still keeps its own history.
//   2. Writes are quota-safe. This lives in localStorage (~5 MB per origin,
//      shared with the main cache). An unbounded archive would eventually
//      throw QuotaExceededError, and the old catch swallowed it silently —
//      the archive would simply stop growing with nobody any the wiser.
//      We now prune to a retention window and retry, and report failure.
import { Order } from './types';
import { getTenantId } from './tenant';

/** How much history to keep on the device. A year covers every report preset. */
export const ARCHIVE_RETENTION_DAYS = 400;

/** Hard ceiling so a very busy year cannot fill the quota on its own. */
const ARCHIVE_MAX_ORDERS = 20000;

function key(): string {
  const tid = getTenantId() || 'local';
  return `dt-pos-order-archive::${tid}`;
}

function orderTime(o: Order): number {
  const raw = (o as any).paidAt || o.createdAt || (o as any)._updatedAt;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function getArchivedOrders(): Order[] {
  try {
    const raw = localStorage.getItem(key());
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Newest-first, trimmed to the retention window and the hard ceiling.
 * Exported for tests — the pruning rule is the part that can silently eat
 * history, so it is verified directly rather than through localStorage.
 */
export function pruneArchive(orders: Order[], now = Date.now()): Order[] {
  const cutoff = now - ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return orders
    .filter(o => orderTime(o) >= cutoff)
    .sort((a, b) => orderTime(b) - orderTime(a))
    .slice(0, ARCHIVE_MAX_ORDERS);
}

/** Merge the given orders into the archive. Returns false if it could not be saved. */
export function archiveOrders(orders: Order[]): boolean {
  if (!orders.length) return true;
  try {
    const byId = new Map<string, Order>();
    for (const o of getArchivedOrders()) byId.set(o.id, o);
    // Newer copy of the same order wins (a bill edited after archiving).
    for (const o of orders) byId.set(o.id, o);
    let merged = pruneArchive(Array.from(byId.values()));

    try {
      localStorage.setItem(key(), JSON.stringify(merged));
      return true;
    } catch {
      // Quota hit. Halve the archive (oldest go first) and try again rather
      // than losing the whole thing or, worse, silently keeping the old copy.
      merged = merged.slice(0, Math.floor(merged.length / 2));
      localStorage.setItem(key(), JSON.stringify(merged));
      console.warn('[archive] quota reached — older history trimmed');
      return true;
    }
  } catch (e) {
    console.error('archiveOrders failed', e);
    return false;
  }
}

export function clearArchivedOrders() {
  try { localStorage.removeItem(key()); } catch { /* ignore */ }
}

/** Merge live + archived, dedup by id (live wins — it is the fresher copy). */
export function getAllHistoricalOrders(liveOrders: Order[]): Order[] {
  const byId = new Map<string, Order>();
  for (const o of getArchivedOrders()) byId.set(o.id, o);
  for (const o of liveOrders) byId.set(o.id, o);
  return Array.from(byId.values());
}
