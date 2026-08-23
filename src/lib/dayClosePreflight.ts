// ============================================================================
// What Day Close is about to do, checked before it does it.
//
// Closing a day is the one routine action that touches every bill at once, so
// it is the worst possible moment to be wrong about the state of the data. This
// answers three questions the admin should see BEFORE confirming:
//
//   1. How many bills move to history, and what are they worth?
//   2. Is any of today's money still only on this device?
//   3. Is any bill marked paid with no record of how it was paid?
//
// It changes nothing. It only reports.
// ============================================================================
import type { Order } from './types';

export interface DayClosePreflight {
  /** Bills that will move to history. */
  total: number;
  /** Their combined value — what the day is worth. */
  value: number;
  byStatus: { paid: number; running: number; credit: number; voided: number };

  /**
   * Order writes still sitting in the offline queue.
   *
   * A bill that was taken and paid on this till but has not reached the server
   * exists nowhere else. Archiving clears it from the till, and if the queue
   * never drains that sale is gone. This is the one condition that should stop
   * a Day Close rather than warn about it.
   */
  unsyncedOrders: number;

  /**
   * Bills marked paid that carry no payment line and no payment method.
   *
   * The money is counted in the sales total but nothing says how it arrived, so
   * the cash-vs-card reconciliation cannot balance. Worth showing before the
   * day is closed on it, while someone still remembers.
   */
  paidWithoutPaymentRecord: number;

  /** True when nothing should stop the close. */
  safe: boolean;
}

function isCreditOrder(o: Order): boolean {
  const s = o.status as string;
  return s === 'credit_pending' || s === 'credit_received'
    || ((o as any).paymentMethod === 'credit' && s !== 'void' && s !== 'cancelled');
}

/** A paid bill with nothing recording how it was paid. */
export function isPaidWithoutPaymentRecord(o: Order): boolean {
  const s = o.status as string;
  if (s !== 'paid') return false;
  const lines = Array.isArray(o.payments) ? o.payments : [];
  if (lines.length > 0) return false;
  const method = (o as any).paymentMethod;
  return !method;
}

export function buildDayClosePreflight(
  orders: readonly Order[],
  unsyncedOrders: number,
): DayClosePreflight {
  const byStatus = { paid: 0, running: 0, credit: 0, voided: 0 };
  let value = 0;
  let paidWithoutPaymentRecord = 0;

  for (const o of orders) {
    const s = o.status as string;
    if (isCreditOrder(o)) byStatus.credit++;
    else if (s === 'paid') byStatus.paid++;
    else if (s === 'void' || s === 'cancelled' || s === 'complimentary') byStatus.voided++;
    else byStatus.running++;

    // Void and cancelled bills carry no money and must not inflate the day.
    if (s !== 'void' && s !== 'cancelled') value += Number(o.grandTotal) || 0;
    if (isPaidWithoutPaymentRecord(o)) paidWithoutPaymentRecord++;
  }

  return {
    total: orders.length,
    value,
    byStatus,
    unsyncedOrders,
    paidWithoutPaymentRecord,
    safe: unsyncedOrders === 0,
  };
}

/** How many order writes are still waiting to reach the server. */
export async function countUnsyncedOrders(): Promise<number> {
  try {
    const { whenDeferredQueueReady, getDeferredOps } = await import('./deferredSync');
    // An unknown queue state must not read as "nothing pending" — that is
    // exactly the case where closing the day would lose a sale.
    if (!(await whenDeferredQueueReady())) return -1;
    return getDeferredOps().filter(o => o.col === 'orders').length;
  } catch {
    return -1;
  }
}
