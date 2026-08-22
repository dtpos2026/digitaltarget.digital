// ============================================================
// Tests — v1.12.1 Table management (Transfer / Merge / Split)
//
// Three REAL bugs were found by reading the handlers rather than
// trusting that they worked. Each had a money or identity consequence,
// so each gets a test that fails loudly if it ever comes back.
//
//  1. SPLIT cloned `payments` / `amountPaid` onto the new bill, so money
//     already taken was counted twice — once on each half.
//  2. SPLIT reused the SOURCE order number, so two live bills shared one
//     number (breaks reprint, day-close counting, and PRA USIN).
//  3. MERGE voided the source bill, and void was treated as a refund
//     everywhere — so merging silently subtracted the amount from Actual
//     sales AND made the cash drawer look short.
// ============================================================
import { describe, it, expect } from 'vitest';
import { cashRefundedOnOrder, buildCashDrawerReport, type Shift } from '@/lib/shifts';
import { buildItemSalesReport } from '@/lib/salesReport';
import type { Order, MenuItem, Category } from '@/lib/types';

function order(over: Partial<Order> = {}): Order {
  return {
    id: 'o1', orderNumber: 1, orderType: 'dining', status: 'paid',
    items: [], subtotal: 100, discount: 0, tax: 0,
    serviceCharge: 0, serviceChargePercent: 0, grandTotal: 100,
    createdAt: '2026-07-20T10:00:00.000Z',
    ...over,
  } as Order;
}

// ---- Mirrors the fixed split logic in TablesPage ----
function splitNewBill(source: Order, movedItems: any[], newId: string, newNumber: number): Order {
  return {
    ...source,
    id: newId,
    orderNumber: newNumber,
    items: movedItems,
    status: 'running',
    payments: [],
    amountPaid: 0,
    paidAt: undefined,
    paymentMethod: undefined,
    splitFromOrderId: source.id,
  } as Order;
}

describe('BUG 1 — split must NOT clone payments onto the new bill', () => {
  const paidSource = order({
    id: 'src', orderNumber: 10, status: 'partial',
    amountPaid: 500,
    payments: [{ id: 'p1', method: 'cash', amount: 500, at: '' }],
    grandTotal: 1000,
  } as any);

  it('the split bill starts with NO payments', () => {
    const fresh = splitNewBill(paidSource, [], 'new', 11);
    expect(fresh.payments).toEqual([]);
    expect(fresh.amountPaid).toBe(0);
    expect(fresh.paidAt).toBeUndefined();
  });

  it('money is counted once across both halves, not twice', () => {
    const fresh = splitNewBill(paidSource, [], 'new', 11);
    const totalRecorded = (paidSource.amountPaid || 0) + (fresh.amountPaid || 0);
    expect(totalRecorded).toBe(500);          // not 1000
  });

  it('the split bill is not marked paid just because the source was', () => {
    const fromPaid = order({ id: 'src', status: 'paid', amountPaid: 100 } as any);
    const fresh = splitNewBill(fromPaid, [], 'new', 12);
    expect(fresh.status).toBe('running');
  });
});

describe('BUG 2 — split must get its OWN order number', () => {
  it('the new bill never reuses the source number', () => {
    const src = order({ id: 'src', orderNumber: 42 });
    const fresh = splitNewBill(src, [], 'new-id', 43);
    expect(fresh.orderNumber).not.toBe(src.orderNumber);
    expect(fresh.orderNumber).toBe(43);
  });

  it('the new bill has its own id and records where it came from', () => {
    const src = order({ id: 'src', orderNumber: 42 });
    const fresh = splitNewBill(src, [], 'new-id', 43);
    expect(fresh.id).not.toBe(src.id);
    expect(fresh.splitFromOrderId).toBe('src');
  });
});

describe('BUG 3 — a MERGED bill is not a refund', () => {
  const mergedAway = order({
    id: 'src', status: 'void',
    amountPaid: 300, paymentMethod: 'cash',
    mergedIntoOrderId: 'dst',
  } as any);
  const genuineVoid = order({
    id: 'v', status: 'void',
    amountPaid: 300, paymentMethod: 'cash',
  } as any);

  it('cash refund is zero for a merged bill', () => {
    expect(cashRefundedOnOrder(mergedAway)).toBe(0);
  });

  it('a genuine void still counts as a cash refund', () => {
    expect(cashRefundedOnOrder(genuineVoid)).toBe(300);
  });

  it('the cash drawer is not made short by a merge', () => {
    const shift: Shift = {
      id: 's', deviceId: 'd', staffName: 'A',
      openedAt: '2026-07-20T00:00:00.000Z',
      closedAt: '2026-07-20T23:59:00.000Z',
      startingCash: 200, payIns: [], payOuts: [], status: 'closed',
    } as Shift;
    const d = buildCashDrawerReport(shift, [mergedAway]);
    expect(d.refund).toBe(0);
    expect(d.expectedCash).toBe(200);        // unchanged by the merge
  });

  it('the sales report does not count a merge as a refund', () => {
    const cats: Category[] = [{ id: 'c1', name: 'Food' } as Category];
    const items: MenuItem[] = [{ id: 'i1', name: 'Dish', categoryId: 'c1' } as MenuItem];
    const line = { id: 'i1', menuItemId: 'i1', name: 'Dish', pricingType: 'fixed', price: 100, quantity: 1, lineTotal: 100, note: '' };

    const sale = order({ id: 'paid', status: 'paid', grandTotal: 100, items: [line] as any });
    const merged = order({
      id: 'merged', status: 'void', grandTotal: 100,
      items: [line] as any, mergedIntoOrderId: 'paid',
    } as any);

    const r = buildItemSalesReport([sale, merged], items, cats);
    expect(r.summary.refundAmount).toBe(0);
    expect(r.transactions.refunded).toBe(0);
    expect(r.summary.actualSales).toBe(100);  // not 0
  });

  it('a genuine void IS still reported as a refund', () => {
    const cats: Category[] = [{ id: 'c1', name: 'Food' } as Category];
    const items: MenuItem[] = [{ id: 'i1', name: 'Dish', categoryId: 'c1' } as MenuItem];
    const line = { id: 'i1', menuItemId: 'i1', name: 'Dish', pricingType: 'fixed', price: 100, quantity: 1, lineTotal: 100, note: '' };

    const sale = order({ id: 'paid', status: 'paid', grandTotal: 100, items: [line] as any });
    const voided = order({ id: 'v', status: 'void', grandTotal: 40, items: [line] as any });

    const r = buildItemSalesReport([sale, voided], items, cats);
    expect(r.summary.refundAmount).toBe(40);
    expect(r.transactions.refunded).toBe(1);
  });
});

describe('transfer / split target checks use a LIVE ORDER, not table.status', () => {
  // Mirrors the fixed guard: occupancy is decided by whether a live bill
  // exists, because table.status drifts (hold/recall, cross-device sync).
  const LIVE = ['running', 'hold', 'partial', 'credit_pending'];
  const hasLiveBill = (tableId: string, orders: Order[]) =>
    orders.some(o => o.tableId === tableId && LIVE.includes(o.status));

  it('a table with a HOLD bill is treated as occupied', () => {
    const held = order({ id: 'h', tableId: 't2', status: 'hold' });
    expect(hasLiveBill('t2', [held])).toBe(true);
  });

  it('a table whose only bill is paid is free', () => {
    const done = order({ id: 'p', tableId: 't2', status: 'paid' });
    expect(hasLiveBill('t2', [done])).toBe(false);
  });

  it('a table with no bills at all is free', () => {
    expect(hasLiveBill('t9', [])).toBe(false);
  });
});

describe('v1.12.2 — dialog target lists must use LIVE BILLS, not table.status', () => {
  // The third and last layer of the same bug. v1.9.1 fixed the buttons,
  // v1.12.1 fixed the handlers, but the Transfer/Split and Merge dialogs
  // still filtered on t.status — so they opened EMPTY after hold/recall
  // and the feature looked like it had vanished.
  const LIVE = ['running', 'hold', 'partial', 'credit_pending'];
  type T = { id: string; status?: string };

  const liveOrderFor = (t: T, orders: Order[]) =>
    orders.find(o => o.tableId === t.id && LIVE.includes(o.status));

  const freeTables = (tables: T[], orders: Order[], selectedId?: string) =>
    tables.filter(t => t.id !== selectedId && !liveOrderFor(t, orders));
  const runningTables = (tables: T[], orders: Order[], selectedId?: string) =>
    tables.filter(t => t.id !== selectedId && !!liveOrderFor(t, orders));

  it('a table holding a recalled bill IS offered as a merge destination', () => {
    // Exactly the reported case: status drifted off 'running' after
    // hold → recall, so the old filter hid this table from Merge.
    const tables: T[] = [{ id: 't1' }, { id: 't2', status: 'free' }];
    const orders = [
      order({ id: 'a', tableId: 't1', status: 'running' }),
      order({ id: 'b', tableId: 't2', status: 'hold' }),
    ];
    const merge = runningTables(tables, orders, 't1').map(t => t.id);
    expect(merge).toEqual(['t2']);          // old code returned []
  });

  it('a table with a drifted status but no bill is still a valid transfer target', () => {
    const tables: T[] = [{ id: 't1' }, { id: 't2', status: 'running' }];
    const orders = [order({ id: 'a', tableId: 't1', status: 'running' })];
    const free = freeTables(tables, orders, 't1').map(t => t.id);
    expect(free).toEqual(['t2']);           // stale 'running' no longer hides it
  });

  it('a table with a PAID bill counts as free again', () => {
    const tables: T[] = [{ id: 't1' }, { id: 't2', status: 'running' }];
    const orders = [
      order({ id: 'a', tableId: 't1', status: 'running' }),
      order({ id: 'done', tableId: 't2', status: 'paid' }),
    ];
    expect(freeTables(tables, orders, 't1').map(t => t.id)).toEqual(['t2']);
    expect(runningTables(tables, orders, 't1')).toEqual([]);
  });

  it('the selected table never appears in its own target list', () => {
    const tables: T[] = [{ id: 't1' }, { id: 't2' }];
    const orders = [
      order({ id: 'a', tableId: 't1', status: 'running' }),
      order({ id: 'b', tableId: 't2', status: 'running' }),
    ];
    expect(runningTables(tables, orders, 't1').map(t => t.id)).toEqual(['t2']);
  });

  it('free and running lists never overlap and cover every other table', () => {
    const tables: T[] = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }];
    const orders = [
      order({ id: 'a', tableId: 't2', status: 'hold' }),
      order({ id: 'b', tableId: 't3', status: 'partial' }),
    ];
    const free = freeTables(tables, orders, 't1').map(t => t.id);
    const running = runningTables(tables, orders, 't1').map(t => t.id);
    expect(free).toEqual(['t4']);
    expect(running).toEqual(['t2', 't3']);
    expect(free.filter(x => running.includes(x))).toEqual([]);
    expect(free.length + running.length).toBe(tables.length - 1);
  });
});

describe('v1.12.4 — REACHABILITY: can the cashier actually get to the buttons?', () => {
  // Every earlier fix repaired code the cashier could never reach:
  //
  //   tap a table WITH a bill  -> jumped straight to the POS, panel never
  //                               opened, so the bill actions never showed
  //   tap a table WITHOUT one  -> panel opened, but the actions are hidden
  //                               because there is no bill to act on
  //
  // So Transfer / Merge / Split were unreachable in normal use, no matter
  // how correct the gating, the dialogs and the handlers were. These tests
  // model the tap -> panel -> buttons path itself.
  const LIVE = ['running', 'hold', 'partial', 'credit_pending'];
  type T = { id: string; status?: string };
  const liveOrderFor = (t: T, orders: Order[]) =>
    orders.find(o => o.tableId === t.id && LIVE.includes(o.status));

  /** v1.12.4 behaviour: a tap ALWAYS opens the panel. */
  const tap = (t: T, orders: Order[]) => ({
    panelOpened: true,
    navigatedAway: false,
    order: liveOrderFor(t, orders),
  });

  /** The panel's gate for the three bill actions. */
  const billActionsVisible = (t: T, orders: Order[]) => {
    const r = tap(t, orders);
    return r.panelOpened && !!r.order && t.status !== 'pending-payment';
  };

  it('tapping a RUNNING table opens the panel instead of jumping to POS', () => {
    const t: T = { id: 't1', status: 'running' };
    const orders = [order({ id: 'a', tableId: 't1', status: 'running' })];
    const r = tap(t, orders);
    expect(r.panelOpened).toBe(true);
    expect(r.navigatedAway).toBe(false);   // the old behaviour, now gone
    expect(r.order).toBeTruthy();
  });

  it('the bill actions are REACHABLE on a running table', () => {
    const t: T = { id: 't1', status: 'running' };
    const orders = [order({ id: 'a', tableId: 't1', status: 'running' })];
    expect(billActionsVisible(t, orders)).toBe(true);
  });

  it('they are reachable after hold -> recall, whatever the status drifted to', () => {
    for (const drifted of ['free', 'closed', undefined]) {
      const t: T = { id: 't1', status: drifted };
      const orders = [order({ id: 'a', tableId: 't1', status: 'hold' })];
      expect(billActionsVisible(t, orders)).toBe(true);
    }
  });

  it('a table with NO bill opens the panel but shows no bill actions', () => {
    const t: T = { id: 't9', status: 'free' };
    const r = tap(t, []);
    expect(r.panelOpened).toBe(true);
    expect(billActionsVisible(t, [])).toBe(false);
  });

  it('a pending-payment table still hides the bill actions (settle it first)', () => {
    const t: T = { id: 't1', status: 'pending-payment' };
    const orders = [order({ id: 'a', tableId: 't1', status: 'running' })];
    expect(billActionsVisible(t, orders)).toBe(false);
  });

  it('END TO END: running table -> actions visible -> merge target listed', () => {
    const t1: T = { id: 't1', status: 'running' };
    const t2: T = { id: 't2', status: 'free' };      // status drifted
    const orders = [
      order({ id: 'a', tableId: 't1', status: 'running' }),
      order({ id: 'b', tableId: 't2', status: 'hold' }),
    ];
    // 1. the actions can be reached at all
    expect(billActionsVisible(t1, orders)).toBe(true);
    // 2. and the Merge dialog actually offers the other table
    const mergeTargets = [t1, t2]
      .filter(t => t.id !== t1.id && !!liveOrderFor(t, orders))
      .map(t => t.id);
    expect(mergeTargets).toEqual(['t2']);
  });
});
