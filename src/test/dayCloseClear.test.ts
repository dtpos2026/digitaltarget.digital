// ============================================================
// Tests — Day Close actually clears data (v1.5.1)
//
// Reported: "day close par software data zero nahi hota."
//
// Two independent root causes, both covered here:
//  A. deleteOrder() fired its CLOUD delete without awaiting it. Day Close
//     looped over hundreds of orders, reported success immediately, and any
//     delete that failed left the order on the server — where the realtime
//     listener promptly restored it locally. Orders "came back".
//  B. The "Reset order number" option removed localStorage keys that never
//     existed, so the counter never reset and order numbers kept climbing.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Order } from '@/lib/types';

let store: typeof import('@/lib/store');

function mkOrder(id: string, over: Partial<Order> = {}): Order {
  return {
    id,
    orderNumber: Number(id.replace(/\D/g, '')) || 1,
    orderType: 'takeaway',
    status: 'paid',
    items: [],
    subtotal: 100, discount: 0, tax: 0,
    serviceCharge: 0, serviceChargePercent: 0,
    grandTotal: 100,
    createdAt: new Date().toISOString(),
    ...over,
  } as Order;
}

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('desi-pos-data', JSON.stringify({
    orders: [], settings: {}, categories: [], menuItems: [],
    tables: [], users: [], orderCounter: 250,
  }));
  vi.resetModules();
  store = await import('@/lib/store');
});

describe('A. deleteOrdersBulk — the clearing path used by Day Close', () => {
  it('removes every requested order in local-only mode', async () => {
    store.saveOrder(mkOrder('o1'));
    store.saveOrder(mkOrder('o2'));
    store.saveOrder(mkOrder('o3'));
    expect(store.getOrders()).toHaveLength(3);

    const res = await store.deleteOrdersBulk(['o1', 'o2', 'o3']);

    expect(res.deleted).toBe(3);
    expect(res.failed).toBe(0);
    expect(store.getOrders()).toHaveLength(0); // <- data IS zero now
  });

  it('leaves orders that were not selected (credit/udhaar protection)', async () => {
    store.saveOrder(mkOrder('paid1'));
    store.saveOrder(mkOrder('credit1', { status: 'credit_pending' }));

    await store.deleteOrdersBulk(['paid1']);

    const left = store.getOrders();
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe('credit1');
  });

  it('is awaitable and reports a real result (the old code did neither)', async () => {
    store.saveOrder(mkOrder('o1'));
    const res = await store.deleteOrdersBulk(['o1']);
    expect(res).toEqual(expect.objectContaining({ deleted: 1, failed: 0, offline: false }));
  });

  it('handles an empty selection without touching anything', async () => {
    store.saveOrder(mkOrder('o1'));
    const res = await store.deleteOrdersBulk([]);
    expect(res.deleted).toBe(0);
    expect(store.getOrders()).toHaveLength(1);
  });

  it('de-duplicates ids so counts stay honest', async () => {
    store.saveOrder(mkOrder('o1'));
    const res = await store.deleteOrdersBulk(['o1', 'o1', 'o1']);
    expect(res.deleted).toBe(1);
    expect(store.getOrders()).toHaveLength(0);
  });

  it('ignores ids that do not exist instead of throwing', async () => {
    store.saveOrder(mkOrder('o1'));
    const res = await store.deleteOrdersBulk(['o1', 'ghost']);
    expect(res.failed).toBe(0);
    expect(store.getOrders()).toHaveLength(0);
  });

  it('clears a large day (batching path) completely', async () => {
    const ids: string[] = [];
    for (let i = 1; i <= 600; i++) {        // > the 500-per-batch limit
      const id = `o${i}`;
      ids.push(id);
      store.saveOrder(mkOrder(id));
    }
    expect(store.getOrders()).toHaveLength(600);

    const res = await store.deleteOrdersBulk(ids);

    expect(res.deleted).toBe(600);
    expect(store.getOrders()).toHaveLength(0);
  });
});

describe('B. resetOrderCounter — "Reset order number" now actually works', () => {
  it('resets the counter to zero so the next order starts at 1', async () => {
    expect(store.peekNextOrderNumber()).toBe(251); // seeded at 250

    const ok = await store.resetOrderCounter(0);

    expect(ok).toBe(true);
    expect(store.peekNextOrderNumber()).toBe(1);
    expect(store.getNextOrderNumber()).toBe(1);
  });

  it('can start the new day from a chosen number', async () => {
    await store.resetOrderCounter(1000);
    expect(store.getNextOrderNumber()).toBe(1001);
  });

  it('never accepts a negative or junk starting point', async () => {
    await store.resetOrderCounter(-50);
    expect(store.peekNextOrderNumber()).toBe(1);
  });

  it('the reset survives a reload (persisted, not just in memory)', async () => {
    await store.resetOrderCounter(0);
    vi.resetModules();
    const fresh = await import('@/lib/store');
    expect(fresh.peekNextOrderNumber()).toBe(1);
  });
});

describe('Day Close end-to-end: a closed day really is empty', () => {
  it('clears the selected orders AND restarts numbering', async () => {
    store.saveOrder(mkOrder('a', { status: 'paid' }));
    store.saveOrder(mkOrder('b', { status: 'running' }));
    store.saveOrder(mkOrder('c', { status: 'credit_pending' })); // udhaar kept

    // what Day Close does with default config (paid + running cleared)
    const toDelete = store.getOrders()
      .filter(o => o.status === 'paid' || o.status === 'running')
      .map(o => o.id);
    const res = await store.deleteOrdersBulk(toDelete);
    await store.resetOrderCounter(0);

    expect(res.deleted).toBe(2);
    expect(store.getOrders().map(o => o.id)).toEqual(['c']); // only udhaar left
    expect(store.peekNextOrderNumber()).toBe(1);
  });
});
