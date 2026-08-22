// ============================================================
// v1.15.1 — "the table shows AVAILABLE but is still Sitting 94h"
//
// The client sent a screenshot of the Dining Tables grid where five tables
// were badged AVAILABLE (header: "10 Available · 0 Running") while each one
// also displayed a live dine timer — "Sitting 94h 31m", "Sitting 96h 1m".
// Four days of phantom occupancy on a free table.
//
// Root cause: freeing a table is done in SEVEN different places, and only
// the ones inside TablesPage cleared `seatedAt`. The settle/pay paths —
//
//     saveTable({ ...t, status: 'free', currentOrderId: undefined })
//
// — in POSScreen, RunningBillsPage, ReceivePaymentButton and the Day Close
// sweep left `seatedAt` behind. The grid renders the dine timer from
// `seatedAt` alone, so it kept counting from the original seating, forever,
// on a table the badge called free. No session row was written either, so
// those tables never showed "Last: 25m · freed 4:22 pm" like the correctly
// freed ones did.
//
// Every release path now goes through this one helper. Adding an eighth
// call site cannot reintroduce the bug.
import type { DiningTable, Order, TableSession } from './types';

/**
 * Build the dine-session row for a table being released.
 * Returns null when the table was never seated (nothing to record).
 */
export function buildTableSession(
  t: DiningTable,
  order?: Order,
  now = Date.now(),
): TableSession | null {
  if (!t.seatedAt) return null;
  const seated = new Date(t.seatedAt).getTime();
  if (!Number.isFinite(seated)) return null;
  const durationMinutes = Math.max(1, Math.round((now - seated) / 60000));
  return {
    seatedAt: t.seatedAt,
    freedAt: new Date(now).toISOString(),
    durationMinutes,
    orderId: order?.id,
    orderNumber: order?.orderNumber,
    guests: t.seatedGuests || t.seats,
    total: order?.grandTotal,
  };
}

/**
 * The released table record: status reset, order pointer dropped, dine timer
 * cleared, and the finished session appended to history.
 *
 * Pure — returns the object to save. The caller does the saving so this stays
 * usable from tests and from components that batch their writes.
 */
export function releasedTable(
  t: DiningTable,
  order?: Order,
  status: 'free' | 'closed' = 'free',
  now = Date.now(),
): DiningTable {
  const session = buildTableSession(t, order, now);
  return {
    ...t,
    status,
    currentOrderId: undefined,
    seatedAt: undefined,
    seatedGuests: undefined,
    sessions: session ? [...(t.sessions || []), session] : (t.sessions || []),
  } as DiningTable;
}

/**
 * A table is "occupied" if it holds a live bill OR has been seated.
 * Used to decide whether a table needs releasing at all — a table seated by
 * a waiter but never billed is still occupied and must not be skipped.
 */
export function isTableOccupied(t: DiningTable): boolean {
  return !!t.currentOrderId || !!t.seatedAt
    || (t.status !== 'free' && t.status !== 'closed');
}
