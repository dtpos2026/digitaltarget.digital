// ============================================================================
// v1.28.1 — the payment must reach its columns, not only the document
//
// FOUND BY the Gold-release QC sweep against the live database: every paid
// bill read `payment_method` NULL and `amount_paid` 0.00 — all 33 of them,
// PKR 38,758 of trade. Nothing was lost; orders.data carried paymentMethod,
// amountPaid, paidAt and the payments array the whole time, and the till reads
// the document, so the cashier's screen was correct. What was wrong is the
// typed columns, which exist to be a queryable index OF that document:
// rowToDb() simply never wrote them, so any report or reconciliation querying
// the table for a cash/card breakdown saw an empty column.
//
// This is the same class of defect v1.26.3 fixed for the totals, so the totals
// are asserted here too — the two must never drift apart again.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { rowToDb } from '@/lib/supabaseStore';

/** A bill exactly as the POS saves one after taking cash. */
const paidBill = {
  id: 'ord-1',
  orderNumber: 1024,
  orderType: 'dining',
  status: 'paid',
  source: 'pos',
  branchId: null,
  items: [{ id: 'l1', name: 'Karahi', quantity: 1, price: 5480, lineTotal: 5480 }],
  payments: [{ id: 'p1', method: 'cash', amount: 5480, at: '2026-08-23T01:12:19.826Z', by: 'cashier' }],
  subtotal: 5480,
  discount: 0,
  tax: 0,
  grandTotal: 5480,
  paymentMethod: 'cash',
  amountPaid: 5480,
  cashReceived: 5480,
  changeReturned: 0,
  paidAt: '2026-08-23T01:12:20.118Z',
  createdAt: '2026-08-23T01:10:00.000Z',
};

describe('a paid bill indexes its payment into the orders columns', () => {
  const row = rowToDb('orders', paidBill);

  it('records how the bill was paid', () => {
    expect(row.payment_method).toBe('cash');
  });

  it('records how much was taken', () => {
    expect(Number(row.amount_paid)).toBe(5480);
  });

  it('records when it was paid', () => {
    expect(row.paid_at).toBe(new Date('2026-08-23T01:12:20.118Z').toISOString());
  });

  it('records the cash handed over and the change given', () => {
    expect(Number(row.cash_received)).toBe(5480);
    expect(Number(row.change_returned)).toBe(0);
  });

  it('still indexes the totals (the v1.26.3 fix)', () => {
    expect(Number(row.grand_total)).toBe(5480);
    expect(Number(row.subtotal)).toBe(5480);
    expect(Number(row.total)).toBe(5480);
  });

  it('keeps the whole document, so nothing depends on the columns being complete', () => {
    expect(row.data.payments).toHaveLength(1);
    expect(row.data.paymentMethod).toBe('cash');
    expect(row.data.id).toBe('ord-1');
  });

  it('the indexed amount agrees with the document it was indexed from', () => {
    expect(Number(row.amount_paid)).toBe(Number(row.data.amountPaid));
    expect(row.payment_method).toBe(row.data.paymentMethod);
  });
});

describe('an unpaid bill claims no payment', () => {
  const running = rowToDb('orders', {
    id: 'ord-2', orderNumber: 1025, orderType: 'dining', status: 'running',
    items: [], subtotal: 0, discount: 0, tax: 0, grandTotal: 900,
    createdAt: '2026-08-23T02:00:00.000Z',
  });

  it('leaves the payment columns empty rather than inventing a method', () => {
    expect(running.payment_method).toBeNull();
    expect(Number(running.amount_paid)).toBe(0);
    expect(running.paid_at).toBeNull();
  });

  it('distinguishes "no cash drawer entry" from zero', () => {
    // null means the field was never captured; 0 would claim the customer
    // handed over nothing, which is a different statement.
    expect(running.cash_received).toBeNull();
    expect(running.change_returned).toBeNull();
  });
});

describe('a card payment is indexed the same way', () => {
  const card = rowToDb('orders', {
    id: 'ord-3', orderNumber: 1026, orderType: 'takeaway', status: 'paid',
    items: [], subtotal: 1200, discount: 0, tax: 0, grandTotal: 1200,
    paymentMethod: 'card', paymentAccountName: 'Meezan POS Terminal',
    amountPaid: 1200, paidAt: '2026-08-23T03:00:00.000Z',
    createdAt: '2026-08-23T02:55:00.000Z',
  });

  it('carries the method and the account it settled to', () => {
    expect(card.payment_method).toBe('card');
    expect(card.payment_account_name).toBe('Meezan POS Terminal');
    expect(Number(card.amount_paid)).toBe(1200);
  });
});
