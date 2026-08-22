// ============================================================
// v1.11.0 — SHIFTS + CASH DRAWER
//
// Implements the two blocks the client's Shift Report sample has that
// the POS previously could not produce, because the underlying data
// simply did not exist:
//
//   Shift Report header  — staff, start, end, shift duration
//   Cash drawer report   — Starting cash, Order income, Pay in, Refund,
//                          Pay out, Expected cash, Actual ending cash
//
// WHY A REAL MODULE AND NOT JUST REPORT FIELDS
// These numbers are only meaningful if somebody actually counted the
// drawer at open and at close, and recorded every mid-shift cash
// movement. Printing them from thin air would produce a report that
// looks right and reconciles to nothing — worse than omitting them.
// So this module captures the events, and the report derives from them.
//
// The maths below is pure and side-effect free so it can be tested
// against hand-computed numbers; persistence lives in store.ts.
// ============================================================

import { round2 } from './taxEngine';
import type { Order } from './types';

export interface CashMovement {
  id: string;
  at: string;            // ISO
  amount: number;        // always positive; direction implied by the list
  reason: string;
  by: string;
}

export interface Shift {
  id: string;
  deviceId: string;
  staffId?: string;
  staffName: string;
  /** Printed on the Shift Report header, as in the client's sample. */
  staffEmail?: string;
  openedAt: string;      // ISO
  closedAt?: string;     // ISO
  /** Counted cash placed in the drawer at open. */
  startingCash: number;
  /** Cash ADDED mid-shift (float top-up). */
  payIns: CashMovement[];
  /** Cash REMOVED mid-shift (bank drop, petty expense). */
  payOuts: CashMovement[];
  /** Physically counted cash at close. Undefined until closed. */
  actualEndingCash?: number;
  status: 'open' | 'closed';
  notes?: string;
}

export interface CashDrawerReport {
  startingCash: number;
  /** Cash actually taken from customers during the shift. */
  orderIncome: number;
  payIn: number;
  refund: number;
  payOut: number;
  /** What SHOULD be in the drawer. */
  expectedCash: number;
  /** What was counted. Undefined while the shift is still open. */
  actualEndingCash?: number;
  /**
   * actual − expected. Positive = drawer over, negative = short.
   * Undefined while open. This is the number a manager actually cares
   * about, so it is computed rather than left to mental arithmetic.
   */
  variance?: number;
}

/** Human shift length, formatted like the sample ("3 days 23 hours"). */
export function formatShiftDuration(openedAt: string, closedAt?: string): string {
  const start = new Date(openedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—';
  const mins = Math.floor((end - start) / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const minutes = mins % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (days === 0 && hours === 0) parts.push(`${minutes} min`);
  return parts.join(' ');
}

/** Statuses whose money counts as taken. Voids/cancels never do. */
const SALE_STATUSES = new Set(['paid', 'partial', 'credit_received']);

/**
 * Sum the CASH actually received on an order.
 *
 * Deliberately reads the payments[] entries rather than grandTotal: a
 * split bill may be part cash, part card, and only the cash part ever
 * reaches the drawer. Legacy orders with no payments[] fall back to
 * paymentMethod, which is the best available signal for older data.
 */
export function cashTakenOnOrder(order: Order): number {
  if (!SALE_STATUSES.has(String(order.status))) return 0;
  const pays = order.payments || [];
  if (pays.length > 0) {
    return round2(
      pays
        .filter(p => String(p.method || '').toLowerCase() === 'cash')
        .reduce((s, p) => s + (Number(p.amount) || 0), 0),
    );
  }
  const method = String(order.paymentMethod || 'cash').toLowerCase();
  return method === 'cash' ? round2(Number(order.amountPaid ?? order.grandTotal) || 0) : 0;
}

/** Refunded cash — a void/cancelled order that had been paid in cash. */
export function cashRefundedOnOrder(order: Order): number {
  const s = String(order.status);
  if (s !== 'void' && s !== 'cancelled') return 0;
  // v1.12.1 — a bill voided by a table MERGE never returned cash to the
  // customer; its items just moved to another bill. Treating it as a
  // refund wrongly subtracted that amount from the expected drawer, so a
  // merge made the drawer look short at close.
  if ((order as any).mergedIntoOrderId) return 0;
  const pays = order.payments || [];
  if (pays.length > 0) {
    return round2(
      pays
        .filter(p => String(p.method || '').toLowerCase() === 'cash')
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
    );
  }
  const method = String(order.paymentMethod || '').toLowerCase();
  return method === 'cash' ? round2(Number(order.amountPaid) || 0) : 0;
}

function inShift(order: Order, shift: Shift): boolean {
  const t = new Date(order.createdAt).getTime();
  if (Number.isNaN(t)) return false;
  const start = new Date(shift.openedAt).getTime();
  const end = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();
  return t >= start && t <= end;
}

/**
 * Build the Cash drawer report for a shift.
 *
 *   Expected = Starting + Order income + Pay in − Refund − Pay out
 *
 * Matches the client's sample exactly (200 + 40 + 0 − 0 − 0 = 240).
 */
/**
 * v1.15.0 — real refunds also take cash out of the drawer. Passing them
 * is optional so every existing caller keeps working unchanged.
 */
export function buildCashDrawerReport(
  shift: Shift,
  orders: Order[],
  refunds: { at: string; payments?: { method: string; amount: number }[] }[] = [],
): CashDrawerReport {
  const scoped = orders.filter(o => inShift(o, shift));

  const orderIncome = round2(scoped.reduce((s, o) => s + cashTakenOnOrder(o), 0));
  const start = new Date(shift.openedAt).getTime();
  const end = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();
  const cashRefunded = round2(
    (refunds || [])
      .filter(r => {
        const t = new Date(r.at).getTime();
        return !Number.isNaN(t) && t >= start && t <= end;
      })
      .reduce((s, r) => s + (r.payments || [])
        .filter(p => String(p.method || '').toLowerCase() === 'cash')
        .reduce((n, p) => n + (Number(p.amount) || 0), 0), 0),
  );
  const refund = round2(scoped.reduce((s, o) => s + cashRefundedOnOrder(o), 0) + cashRefunded);
  const payIn = round2((shift.payIns || []).reduce((s, m) => s + (Number(m.amount) || 0), 0));
  const payOut = round2((shift.payOuts || []).reduce((s, m) => s + (Number(m.amount) || 0), 0));
  const startingCash = round2(Number(shift.startingCash) || 0);

  const expectedCash = round2(startingCash + orderIncome + payIn - refund - payOut);
  const actualEndingCash = typeof shift.actualEndingCash === 'number'
    ? round2(shift.actualEndingCash)
    : undefined;

  return {
    startingCash,
    orderIncome,
    payIn,
    refund,
    payOut,
    expectedCash,
    actualEndingCash,
    variance: actualEndingCash === undefined ? undefined : round2(actualEndingCash - expectedCash),
  };
}

/** Orders belonging to a shift — used by the Shift Report. */
export function ordersInShift(shift: Shift, orders: Order[]): Order[] {
  return orders.filter(o => inShift(o, shift));
}
