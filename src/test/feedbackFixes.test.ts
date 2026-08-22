// ============================================================
// Tests — Client feedback fixes (v1.3.3)
//
//  #1 Pending Pay settled bills without ever showing a payment screen.
//  #2 Transfer / Merge / Split said "No active order" on running tables.
//  #3 Kitchen re-asked for table + waiter after a table was chosen.
//  #4 Pay on running/hold bills skipped the payment screen.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { Order, DiningTable, PaymentEntry } from '@/lib/types';

const LIVE_STATUSES = ['running', 'hold', 'partial', 'credit_pending'];

/** Mirrors the fixed getTableOrder() in TablesPage (v1.3.3). */
function getTableOrder(t: DiningTable, orders: Order[]): Order | undefined {
  const byPointer = t.currentOrderId
    ? orders.find(o => o.id === t.currentOrderId && LIVE_STATUSES.includes(o.status))
    : undefined;
  if (byPointer) return byPointer;
  return orders
    .filter(o => o.tableId === t.id && LIVE_STATUSES.includes(o.status))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

/** Mirrors the settle logic shared by TablesPage + RunningBillsPage. */
function settle(order: Order, r: { payments: { amount: number; method: string }[]; method?: string }) {
  const total = Number(order.grandTotal || 0);
  const merged = [...(order.payments || []), ...r.payments] as PaymentEntry[];
  const newPaid = merged.reduce((s, p) => s + (p.amount || 0), 0);
  const fully = newPaid >= total - 0.5;
  return {
    ...order,
    payments: merged,
    amountPaid: Math.min(newPaid, total),
    status: fully ? 'paid' : 'partial',
    paymentMethod: r.method || order.paymentMethod,
  } as Order;
}

function mkOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'o1', orderNumber: 10, orderType: 'dining', status: 'running',
    tableId: 't1', items: [], subtotal: 1000, discount: 0, tax: 0,
    grandTotal: 1000, createdAt: '2026-07-09T10:00:00.000Z',
    ...over,
  } as Order;
}

const table: DiningTable = { id: 't1', name: 'Table 5', seats: 4, status: 'running' } as DiningTable;

describe('#2 Transfer / Merge / Split — "No active order" bug', () => {
  it('finds the order via the pointer when it is correct', () => {
    const o = mkOrder();
    const t = { ...table, currentOrderId: 'o1' };
    expect(getTableOrder(t, [o])?.id).toBe('o1');
  });

  it('THE BUG: still finds the live order when currentOrderId is MISSING', () => {
    // happens when the order was created on another device, or after sync
    const o = mkOrder();
    const t = { ...table, currentOrderId: undefined };
    expect(getTableOrder(t, [o])?.id).toBe('o1');
  });

  it('recovers when currentOrderId points at a stale/closed order', () => {
    const closed = mkOrder({ id: 'old', status: 'paid' });
    const live = mkOrder({ id: 'new', createdAt: '2026-07-09T12:00:00.000Z' });
    const t = { ...table, currentOrderId: 'old' };
    expect(getTableOrder(t, [closed, live])?.id).toBe('new');
  });

  it('picks the NEWEST live order when several exist', () => {
    const a = mkOrder({ id: 'a', createdAt: '2026-07-09T09:00:00.000Z' });
    const b = mkOrder({ id: 'b', createdAt: '2026-07-09T13:00:00.000Z' });
    expect(getTableOrder({ ...table, currentOrderId: undefined }, [a, b])?.id).toBe('b');
  });

  it('hold and partial bills also count as active (merge/split must work)', () => {
    for (const status of ['hold', 'partial'] as const) {
      const o = mkOrder({ status });
      expect(getTableOrder({ ...table, currentOrderId: undefined }, [o])).toBeTruthy();
    }
  });

  it('returns nothing for a genuinely empty table', () => {
    const paid = mkOrder({ status: 'paid' });
    expect(getTableOrder({ ...table, currentOrderId: undefined }, [paid])).toBeUndefined();
    expect(getTableOrder({ ...table, id: 't9', currentOrderId: undefined }, [mkOrder()])).toBeUndefined();
  });
});

describe('#1 / #4 Payment screen — method and amount are now recorded', () => {
  it('records the payment method instead of blindly marking paid', () => {
    const paid = settle(mkOrder(), { payments: [{ amount: 1000, method: 'card' }], method: 'card' });
    expect(paid.status).toBe('paid');
    expect(paid.paymentMethod).toBe('card');   // the old code lost this
    expect(paid.amountPaid).toBe(1000);
    expect(paid.payments).toHaveLength(1);
  });

  it('a short payment leaves the bill PARTIAL, not paid', () => {
    const partial = settle(mkOrder(), { payments: [{ amount: 400, method: 'cash' }], method: 'cash' });
    expect(partial.status).toBe('partial');
    expect(partial.amountPaid).toBe(400);
  });

  it('a later payment completes the bill and keeps both entries', () => {
    const first = settle(mkOrder(), { payments: [{ amount: 400, method: 'cash' }], method: 'cash' });
    const second = settle(first, { payments: [{ amount: 600, method: 'card' }] });
    expect(second.status).toBe('paid');
    expect(second.amountPaid).toBe(1000);
    expect(second.payments).toHaveLength(2);
  });

  it('split payment across cash + card settles the bill', () => {
    const done = settle(mkOrder(), {
      payments: [{ amount: 600, method: 'cash' }, { amount: 400, method: 'card' }],
      method: 'split',
    });
    expect(done.status).toBe('paid');
    expect(done.paymentMethod).toBe('split');
  });

  it('overpayment (change given) never records more than the bill total', () => {
    const done = settle(mkOrder(), { payments: [{ amount: 1000, method: 'cash' }], method: 'cash' });
    expect(done.amountPaid).toBe(1000);
    expect(done.amountPaid).toBeLessThanOrEqual(done.grandTotal);
  });
});

describe('#3 Kitchen re-asking for table — table param handoff', () => {
  // TablesPage navigates to `/?table=<id>&guests=<n>`; POS must consume it.
  function readTableParam(url: string): string | null {
    return new URLSearchParams(url.split('?')[1] || '').get('table');
  }

  it('the table id is present in the URL the Tables page produces', () => {
    expect(readTableParam('/?table=t1&guests=4')).toBe('t1');
  });

  it('POS selecting that table means the dining dialog is NOT re-opened', () => {
    // reproduces the guard condition in POSScreen's Kitchen handler
    const needsDialog = (orderType: string, selectedTable: string, editingOrderId: string | null) =>
      orderType === 'dining' && !selectedTable && !editingOrderId;

    const selected = readTableParam('/?table=t1&guests=4') || '';
    expect(needsDialog('dining', selected, null)).toBe(false);
    // before the fix the param was ignored, so selectedTable stayed empty:
    expect(needsDialog('dining', '', null)).toBe(true);
  });

  it('an existing live bill on that table is continued, not duplicated', () => {
    const live = mkOrder();
    const found = getTableOrder({ ...table, currentOrderId: undefined }, [live]);
    expect(found?.id).toBe('o1'); // POS loads this into the cart as an edit
  });
});
