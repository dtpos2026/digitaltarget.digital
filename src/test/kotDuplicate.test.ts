// ============================================================
// Regression tests — Duplicate KOT fix (v1.2.4)
// User-reported: "order change ho ya cancel ho, KOT update par
// poori new KOT nikalti hai jis se orders duplicate lag jate hain."
// These tests walk the REAL flow: enqueue KOT -> edit order ->
// enqueue update -> verify only the DELTA goes to the kitchen and
// the diff baseline (printedQty / kotRevisions) stays correct.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import type { Order } from '@/lib/types';

// store falls back to localStorage when Firebase is not configured (tests)
import { saveOrder, getOrders } from '@/lib/store';
import {
  enqueueKot,
  enqueueKotUpdate,
  enqueueKotCancel,
  computeKotDiff,
  getPrintQueue,
} from '@/lib/printQueue';

function makeOrder(): Order {
  return {
    id: 'ord-1',
    orderNumber: 101,
    orderType: 'dining',
    status: 'running',
    items: [
      { id: 'line-burger', menuItemId: 'm1', name: 'Zinger Burger', price: 450, quantity: 1, lineTotal: 450 },
      { id: 'line-fries', menuItemId: 'm2', name: 'Fries Large', price: 350, quantity: 1, lineTotal: 350 },
    ],
    subtotal: 800,
    discount: 0,
    tax: 0,
    grandTotal: 800,
    createdAt: new Date().toISOString(),
  } as unknown as Order;
}

beforeEach(() => {
  localStorage.clear();
  // minimal store blob — no tenant => pure local mode
  localStorage.setItem('desi-pos-data', JSON.stringify({
    orders: [], settings: { kotEnabled: true }, categories: [], menuItems: [], tables: [],
  }));
});

describe('Duplicate-KOT fix — full lifecycle', () => {
  it('first KOT stamps printedQty + revision at ENQUEUE time', () => {
    const order = makeOrder();
    saveOrder(order);

    const job = enqueueKot(order);
    expect(job).toBeTruthy();
    expect(job!.stamped).toBe(true);

    const stored = getOrders().find(o => o.id === 'ord-1')!;
    expect(stored.kotPrinted).toBe(true);
    expect(stored.items.find(i => i.id === 'line-burger')!.printedQty).toBe(1);
    expect(stored.items.find(i => i.id === 'line-fries')!.printedQty).toBe(1);
    expect(stored.kotRevisions?.length).toBe(1);
    expect(stored.kotRevisions![0].type).toBe('NEW');
  });

  it('order EDIT sends only the delta — and the next diff is clean (no duplicates)', () => {
    const order = makeOrder();
    saveOrder(order);
    enqueueKot(order);

    // Cashier edits: burger 1 -> 3, plus a new item added
    const afterFirst = getOrders().find(o => o.id === 'ord-1')!;
    const edited: Order = {
      ...afterFirst,
      items: [
        ...afterFirst.items.map(it => it.id === 'line-burger' ? { ...it, quantity: 3, lineTotal: 1350 } : it),
        { id: 'line-pepsi', menuItemId: 'm3', name: 'Pepsi 500ml', price: 120, quantity: 2, lineTotal: 240 } as any,
      ],
    };
    saveOrder(edited);

    const diff = computeKotDiff(getOrders().find(o => o.id === 'ord-1')!);
    expect(diff.hasDiff).toBe(true);
    expect(diff.diffDeltas['line-burger']).toBe(2);  // only the EXTRA 2, not 3
    expect(diff.diffDeltas['line-pepsi']).toBe(2);
    expect(diff.diffDeltas['line-fries']).toBeUndefined(); // already sent — must NOT reprint

    const job = enqueueKotUpdate(getOrders().find(o => o.id === 'ord-1')!);
    expect(job).toBeTruthy();
    expect(job!.updateMode).toBe(true);
    expect(job!.diffDeltas).toEqual({ 'line-burger': 2, 'line-pepsi': 2 });

    // THE core assertion: after the update slip, nothing is outstanding —
    // a second "update" produces NO ticket instead of a full duplicate.
    const after = getOrders().find(o => o.id === 'ord-1')!;
    expect(after.items.find(i => i.id === 'line-burger')!.printedQty).toBe(3);
    expect(after.items.find(i => i.id === 'line-pepsi')!.printedQty).toBe(2);
    const diff2 = computeKotDiff(after);
    expect(diff2.hasDiff).toBe(false);
    expect(enqueueKotUpdate(after)).toBeNull();
    expect(after.kotRevisions?.length).toBe(2);
  });

  it('item CANCEL sends a cancel slip for exactly the removed qty', () => {
    const order = makeOrder();
    saveOrder(order);
    enqueueKot(order);

    // Fries removed entirely
    const afterFirst = getOrders().find(o => o.id === 'ord-1')!;
    const edited: Order = { ...afterFirst, items: afterFirst.items.filter(it => it.id !== 'line-fries') };
    saveOrder(edited);

    const diff = computeKotDiff(getOrders().find(o => o.id === 'ord-1')!);
    expect(diff.hasDiff).toBe(true);
    expect(diff.cancelDeltas['line-fries']).toBe(1);
    expect(diff.cancelNames['line-fries']).toBe('Fries Large');
    expect(Object.keys(diff.diffDeltas)).toHaveLength(0); // nothing new to cook

    const job = enqueueKotUpdate(getOrders().find(o => o.id === 'ord-1')!);
    expect(job!.cancelDeltas).toEqual({ 'line-fries': 1 });

    // Cancel accounted for — no repeat cancel slip on next diff
    const diff2 = computeKotDiff(getOrders().find(o => o.id === 'ord-1')!);
    expect(diff2.hasDiff).toBe(false);
  });

  it('full ORDER CANCEL sends a cancel slip covering every sent item', () => {
    const order = makeOrder();
    saveOrder(order);
    enqueueKot(order);

    const cancelled: Order = { ...getOrders().find(o => o.id === 'ord-1')!, status: 'cancelled' as any };
    saveOrder(cancelled);
    const job = enqueueKotCancel(getOrders().find(o => o.id === 'ord-1')!);
    expect(job).toBeTruthy();
    expect(job!.cancelDeltas).toEqual({ 'line-burger': 1, 'line-fries': 1 });
    expect(Object.keys(job!.diffDeltas || {})).toHaveLength(0);
  });

  it('duplicate-guard: a second plain KOT for the same order is skipped', () => {
    const order = makeOrder();
    saveOrder(order);
    expect(enqueueKot(order)).toBeTruthy();
    const again = enqueueKot(getOrders().find(o => o.id === 'ord-1')!);
    expect(again).toBeNull(); // kotPrinted stamped at enqueue => guard holds
    expect(getPrintQueue().filter(j => j.printType === 'kot')).toHaveLength(1);
  });
});
