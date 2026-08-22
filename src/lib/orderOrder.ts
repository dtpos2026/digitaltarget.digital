// ============================================================
// v1.15.2 — "retrieve me order shuffling hota hai jab pay ya print karein"
//
// `getOrders()` returns the raw cached array. That array is REBUILT by the
// realtime snapshot merge on every sync: remote rows first, in whatever order
// Firestore streamed them, then any local-only rows appended. So the Retrieve
// list had no stable order at all — it visibly reshuffled after a payment, a
// print, or simply when another till saved something.
//
// Worse, `.find()` on that array was used to pick "the" live bill for a table.
// With no ordering, which bill got picked could change between renders — the
// same cause behind "ek order create karte hain, retrieve me 2 pade hote hain":
// two live bills existed on one table and the screen kept swapping between
// them instead of showing one consistently.
//
// Everything that lists or picks orders now goes through here.
import type { Order } from './types';

function ts(o: Order): number {
  const t = new Date((o as any).createdAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Newest first, with a deterministic tie-break so two orders created in the
 * same millisecond never swap places between renders.
 */
export function sortOrdersNewestFirst(orders: Order[]): Order[] {
  return orders.slice().sort((a, b) => {
    const d = ts(b) - ts(a);
    if (d !== 0) return d;
    const n = Number(b.orderNumber || 0) - Number(a.orderNumber || 0);
    if (n !== 0) return n;
    return String(a.id).localeCompare(String(b.id));
  });
}

/** Statuses that mean a bill is still open. */
export const LIVE_ORDER_STATUSES = ['running', 'hold', 'partial', 'credit_pending'];

export function isLiveOrder(o: Order): boolean {
  return LIVE_ORDER_STATUSES.includes(o.status as string);
}

/**
 * The live bill for a table. Deterministic: the newest one wins, always.
 *
 * A table should only ever hold one live bill, but two can exist after a
 * stale `currentOrderId` pointer or two tills seating the same table at once.
 * Picking arbitrarily made the POS look like it had duplicated the order.
 */
export function liveOrderForTable(orders: Order[], tableId: string): Order | undefined {
  return sortOrdersNewestFirst(orders.filter(o => o.tableId === tableId && isLiveOrder(o)))[0];
}

/** Every live bill on a table — used to warn when there is more than one. */
export function liveOrdersForTable(orders: Order[], tableId: string): Order[] {
  return sortOrdersNewestFirst(orders.filter(o => o.tableId === tableId && isLiveOrder(o)));
}
