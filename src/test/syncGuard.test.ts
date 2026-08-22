// ============================================================
// Regression tests — Closed-bill resurrection guards (v1.2.4)
// User-reported: "Close day karte hain to next day kuch orders
// waise hi pare hote hain" — closed/paid orders coming back.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import type { Order } from '@/lib/types';
import { saveOrder, getOrders } from '@/lib/store';

function makeOrder(status: Order['status'] = 'running'): Order {
  return {
    id: 'ord-day1',
    orderNumber: 55,
    orderType: 'takeaway',
    status,
    items: [{ id: 'l1', menuItemId: 'm1', name: 'Chai', price: 100, quantity: 1, lineTotal: 100 }],
    subtotal: 100, discount: 0, tax: 0, grandTotal: 100,
    createdAt: new Date().toISOString(),
  } as unknown as Order;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('desi-pos-data', JSON.stringify({
    orders: [], settings: {}, categories: [], menuItems: [], tables: [],
  }));
});

describe('closed-bill lifecycle guard', () => {
  it('a paid bill can NEVER be flipped back to running by a stale save', () => {
    saveOrder(makeOrder('running'));
    saveOrder({ ...getOrders()[0], status: 'paid' } as Order);
    expect(getOrders()[0].status).toBe('paid');

    // stale replay (old device / offline queue / double event) tries to resurrect
    saveOrder(makeOrder('running'));
    expect(getOrders()[0].status).toBe('paid'); // still closed
  });

  it('cancelled bill stays cancelled against a stale hold save', () => {
    saveOrder(makeOrder('running'));
    saveOrder({ ...getOrders()[0], status: 'cancelled' } as Order);
    saveOrder({ ...makeOrder('hold') });
    expect(getOrders()[0].status).toBe('cancelled');
  });

  it('every save stamps _updatedAt so conflict merge is deterministic', () => {
    saveOrder(makeOrder('running'));
    const stamped: any = getOrders()[0];
    expect(Number(stamped._updatedAt)).toBeGreaterThan(0);
  });
});
