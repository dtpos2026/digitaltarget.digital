// v1.85.0 — the auto-ready kitchen timer only touches food that is really on its way.
//
// Found while screenshotting the new dashboard: on start-up the timer re-saved and announced "READY" (a beep and a
// toast each) for every old bill that had no "ready"/"served" kitchen status — paid bills settled outside the POS,
// online orders still awaiting approval, last week's bills — and a till with a long order history froze.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import AutoReadyTimer from '@/components/AutoReadyTimer';
import { AUTO_READY_MAX_AGE_MS, isStillActiveCooking } from '@/lib/autoReady';
import { getOrders } from '@/lib/store';
import { onReady } from '@/lib/readyNotify';
import type { Order } from '@/lib/types';

const NOW = new Date(2026, 10, 3, 15, 30).getTime();
const ago = (min: number) => new Date(NOW - min * 60000).toISOString();
const order = (o: Partial<Order>): Order => ({
  id: Math.random().toString(36).slice(2), orderNumber: 1, orderType: 'takeaway', status: 'running', paymentMethod: 'cash',
  items: [{ id: 'i', menuItemId: 'm', name: 'Karahi', quantity: 1, lineTotal: 1000 } as any],
  subtotal: 1000, discount: 0, tax: 0, serviceCharge: 0, grandTotal: 1000, createdAt: ago(30), notes: '', ...o,
} as Order);

describe('which orders are still cooking', () => {
  it('an open bill past its prep time is; one already ready, served or out with a rider is not', () => {
    expect(isStillActiveCooking(order({}), NOW)).toBe(true);
    expect(isStillActiveCooking(order({ status: 'hold' }), NOW)).toBe(true);
    expect(isStillActiveCooking(order({ status: 'partial' }), NOW)).toBe(true);
    expect(isStillActiveCooking(order({ kitchenStatus: 'ready' }), NOW)).toBe(false);
    expect(isStillActiveCooking(order({ kitchenStatus: 'served' }), NOW)).toBe(false);
    expect(isStillActiveCooking(order({ kitchenStatus: 'delivered' }), NOW)).toBe(false);
    expect(isStillActiveCooking(order({ orderType: 'delivery', deliveryStatus: 'onway' }), NOW)).toBe(false);
  });

  it('a bill that never reached the kitchen or has finished with it is not', () => {
    for (const status of ['void', 'cancelled', 'rejected', 'pending_approval', 'credit_received'] as const) {
      expect(isStillActiveCooking(order({ status }), NOW)).toBe(false);
    }
  });

  it('a settled bill is only when the kitchen is still working on it (pay-first takeaway)', () => {
    expect(isStillActiveCooking(order({ status: 'paid' }), NOW)).toBe(false);
    expect(isStillActiveCooking(order({ status: 'complimentary' }), NOW)).toBe(false);
    expect(isStillActiveCooking(order({ status: 'paid', kitchenStatus: 'preparing' }), NOW)).toBe(true);
    expect(isStillActiveCooking(order({ status: 'paid', kitchenStatus: 'pending' }), NOW)).toBe(true);
  });

  it('history is never swept: past the age limit, or with no usable time, it is not', () => {
    expect(isStillActiveCooking(order({ createdAt: new Date(NOW - AUTO_READY_MAX_AGE_MS - 60000).toISOString() }), NOW)).toBe(false);
    expect(isStillActiveCooking(order({ createdAt: 'not a date' }), NOW)).toBe(false);
    expect(isStillActiveCooking(order({ createdAt: ago(60 * 24 * 3), cookingStartedAt: ago(25) }), NOW)).toBe(true); // re-fired KOT
  });
});

describe('the timer, mounted, on a till with history', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('marks only the late open bill and the pay-first one ready, once each; history is untouched', async () => {
    const history = Array.from({ length: 300 }, (_, i) => order({ id: `h${i}`, orderNumber: 100 + i, status: 'paid', createdAt: ago(60 * 24 + i), paidAt: ago(60 * 24 + i) }));
    const orders = [
      ...history,
      order({ id: 'late', orderNumber: 1, createdAt: ago(30) }),
      order({ id: 'fresh', orderNumber: 2, createdAt: ago(5) }),
      order({ id: 'payfirst', orderNumber: 3, status: 'paid', kitchenStatus: 'preparing', createdAt: ago(40), paidAt: ago(40) }),
      order({ id: 'approval', orderNumber: 4, status: 'pending_approval', createdAt: ago(45) }),
      order({ id: 'stale', orderNumber: 5, createdAt: ago(60 * 24 * 3) }),
    ];
    localStorage.setItem('desi-pos-data', JSON.stringify({ settings: { name: 'Chai Corner' }, users: [], orders, orderCounter: 1000 }));
    window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));

    const announced: string[] = [];
    const off = onReady(ev => announced.push(ev.orderId));
    render(<AutoReadyTimer />);
    await act(async () => { vi.advanceTimersByTime(5000); });
    await act(async () => { vi.advanceTimersByTime(30_000); }); // the next tick changes nothing more
    off();

    expect(announced.sort()).toEqual(['late', 'payfirst']);
    const byId = new Map(getOrders().map(o => [o.id, o]));
    expect(byId.get('late')!.kitchenStatus).toBe('ready');
    expect(byId.get('payfirst')!.kitchenStatus).toBe('ready');
    for (const id of ['fresh', 'approval', 'stale', 'h0', 'h299']) expect(byId.get(id)!.kitchenStatus).toBeUndefined();
  });
});
