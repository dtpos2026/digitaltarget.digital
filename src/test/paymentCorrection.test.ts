// ============================================================
// Tests — Payment correction (v1.6.0, feedback #2 item 5)
// "Customer paid by card, cashier selected cash" — method changes,
// MONEY NEVER changes, audit trail is permanent.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

let store: typeof import('@/lib/store');

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('desi-pos-data', JSON.stringify({
    orders: [], settings: {}, categories: [], menuItems: [],
    tables: [], users: [], orderCounter: 0,
  }));
  vi.resetModules();
  store = await import('@/lib/store');
});

function paidOrder(id = 'o1') {
  return {
    id, orderNumber: 7, orderType: 'takeaway', status: 'paid',
    items: [], subtotal: 500, discount: 0, tax: 0,
    serviceCharge: 0, serviceChargePercent: 0, grandTotal: 500,
    paymentMethod: 'cash',
    payments: [{ id: 'p1', method: 'cash', amount: 500 }],
    createdAt: new Date().toISOString(),
  } as any;
}

describe('correctOrderPayment', () => {
  it('cash → card: method moves, amounts and status untouched', () => {
    store.saveOrder(paidOrder());
    const r = store.correctOrderPayment('o1', { method: 'card' }, 'Manager Ali');
    expect(r.ok).toBe(true);

    const o = store.getOrders()[0];
    expect(o.paymentMethod).toBe('card');
    expect(o.grandTotal).toBe(500);          // money unchanged
    expect(o.status).toBe('paid');            // status unchanged
    expect(o.payments![0].amount).toBe(500);  // entry amount unchanged
    expect(o.payments![0].method).toBe('card'); // entry re-labelled
  });

  it('writes a permanent audit entry (who, when, from → to)', () => {
    store.saveOrder(paidOrder());
    store.correctOrderPayment('o1', { method: 'online', accountId: 'a1', accountName: 'JazzCash' }, 'Manager Ali');

    const o = store.getOrders()[0];
    expect(o.paymentCorrections).toHaveLength(1);
    const c = o.paymentCorrections![0];
    expect(c.by).toBe('Manager Ali');
    expect(c.fromMethod).toBe('cash');
    expect(c.toAccountName).toBe('JazzCash');
    expect(new Date(c.at).getTime()).toBeGreaterThan(0);
  });

  it('a second correction APPENDS — history is never overwritten', () => {
    store.saveOrder(paidOrder());
    store.correctOrderPayment('o1', { method: 'card' }, 'Ali');
    store.correctOrderPayment('o1', { method: 'cash' }, 'Sana');

    const o = store.getOrders()[0];
    expect(o.paymentCorrections).toHaveLength(2);
    expect(o.paymentCorrections![1].fromMethod).toBe('card');
    expect(o.paymentMethod).toBe('cash');
  });

  it('running / void bills refuse correction', () => {
    store.saveOrder({ ...paidOrder('run1'), status: 'running' });
    store.saveOrder({ ...paidOrder('void1'), status: 'void' });
    expect(store.correctOrderPayment('run1', { method: 'card' }, 'x').ok).toBe(false);
    expect(store.correctOrderPayment('void1', { method: 'card' }, 'x').ok).toBe(false);
  });

  it('unknown order id fails cleanly', () => {
    const r = store.correctOrderPayment('ghost', { method: 'card' }, 'x');
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('settlement report reflects the corrected method (end-to-end)', async () => {
    store.saveOrder(paidOrder());
    store.correctOrderPayment('o1', { method: 'card' }, 'Ali');
    const { buildItemSalesReport } = await import('@/lib/salesReport');
    const r = buildItemSalesReport(store.getOrders(), [], []);
    expect(r.settlement).toEqual([{ method: 'CARD', count: 1, amount: 500 }]);
  });
});
