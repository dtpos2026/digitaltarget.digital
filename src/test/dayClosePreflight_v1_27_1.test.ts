// ============================================================================
// v1.27.1 — what Day Close is about to do, before it does it
//
// Day Close touches every bill at once, so being wrong about the data is
// most expensive here. These assert the two conditions that actually cost a
// restaurant money: a sale that exists only on this device, and a paid bill
// with no record of how it was paid.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { buildDayClosePreflight, isPaidWithoutPaymentRecord } from '@/lib/dayClosePreflight';
import type { Order } from '@/lib/types';

const order = (o: Partial<Order>): Order => ({
  id: o.id ?? 'o1',
  orderNumber: 1,
  status: 'paid',
  orderType: 'takeaway',
  items: [],
  payments: [],
  grandTotal: 100,
  createdAt: new Date().toISOString(),
  ...o,
} as Order);

describe('a paid bill with no record of how it was paid', () => {
  it('is flagged', () => {
    expect(isPaidWithoutPaymentRecord(order({ status: 'paid', payments: [] }))).toBe(true);
  });

  it('is not flagged when there is a payment line', () => {
    const o = order({ status: 'paid', payments: [{ id: 'p', method: 'cash', amount: 100 }] as any });
    expect(isPaidWithoutPaymentRecord(o)).toBe(false);
  });

  it('is not flagged when a payment method was recorded instead', () => {
    const o = order({ status: 'paid', payments: [], paymentMethod: 'card' } as any);
    expect(isPaidWithoutPaymentRecord(o)).toBe(false);
  });

  it('does not flag a bill that was never paid', () => {
    expect(isPaidWithoutPaymentRecord(order({ status: 'running', payments: [] }))).toBe(false);
  });
});

describe('the pre-flight summary', () => {
  const orders = [
    order({ id: 'a', status: 'paid', grandTotal: 500, payments: [{ id: 'p', method: 'cash', amount: 500 }] as any }),
    order({ id: 'b', status: 'paid', grandTotal: 300, payments: [] }),               // no payment record
    order({ id: 'c', status: 'running', grandTotal: 200 }),
    order({ id: 'd', status: 'void', grandTotal: 999 }),                              // must not count
    order({ id: 'e', status: 'credit_pending', grandTotal: 400 } as any),
  ];

  it('counts every bill and groups them by what they are', () => {
    const p = buildDayClosePreflight(orders, 0);
    expect(p.total).toBe(5);
    expect(p.byStatus).toEqual({ paid: 2, running: 1, credit: 1, voided: 1 });
  });

  it('leaves void bills out of the day value', () => {
    // 500 + 300 + 200 + 400 — the 999 void must not inflate the day.
    expect(buildDayClosePreflight(orders, 0).value).toBe(1400);
  });

  it('surfaces the paid bill with no payment record', () => {
    expect(buildDayClosePreflight(orders, 0).paidWithoutPaymentRecord).toBe(1);
  });

  it('is UNSAFE while a sale is still only on this device', () => {
    expect(buildDayClosePreflight(orders, 0).safe).toBe(true);
    expect(buildDayClosePreflight(orders, 2).safe).toBe(false);
  });

  it('treats an unknown queue state as unsafe, not as empty', () => {
    // countUnsyncedOrders() returns -1 when it cannot read the queue. Reading
    // that as "nothing pending" is precisely how a day close eats a sale.
    expect(buildDayClosePreflight(orders, -1).safe).toBe(false);
  });
});
