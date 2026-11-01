// ============================================================
// PRINTER FALLBACK — v1.0.40 regression locks (requirement: a printer
// problem must never cost a bill or freeze the till).
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Order } from '@/lib/types';

const QUEUE_KEY = 'pos-print-queue';
const STORE_KEY = 'desi-pos-data';

function seedStore(order: Order) {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    orders: [order], menuItems: [], inventory: [], stockLogs: [], customers: [],
    recipes: [], tables: [], users: [], categories: [],
    settings: { name: 'Test', kotEnabled: true }, orderCounter: 1,
  }));
}

function bill(id = 'b1', n = 101): Order {
  return {
    id, orderNumber: n, orderType: 'takeaway', status: 'paid',
    items: [{ id: 'l1', menuItemId: 'm1', name: 'Karahi', price: 300, quantity: 1, lineTotal: 300 }],
    subtotal: 300, discount: 0, tax: 0, serviceCharge: 0, grandTotal: 300,
    createdAt: new Date().toISOString(), paidAt: new Date().toISOString(),
  } as unknown as Order;
}

describe('print queue duplicate protection', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });

  it('does not queue a second receipt for the same bill on a double submit', async () => {
    const order = bill();
    seedStore(order);
    const q = await import('@/lib/printQueue');

    const first = q.enqueueReceiptOnPay(order);
    const second = q.enqueueReceiptOnPay(order);   // e.g. the same pay path firing twice

    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect(q.getPrintQueue().filter(j => j.printType === 'receipt')).toHaveLength(1);
  });

  it('does not queue a second KOT while the first is still pending', async () => {
    const order = bill('b2', 102);
    seedStore(order);
    const q = await import('@/lib/printQueue');

    expect(q.enqueueKot(order)).toBeTruthy();
    expect(q.enqueueKot(order)).toBeNull();
    expect(q.getPrintQueue().filter(j => j.printType === 'kot')).toHaveLength(1);
  });
});

describe('a failing printer', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });

  it('keeps the job for retry instead of dropping it', async () => {
    const order = bill('b3', 103);
    seedStore(order);
    const q = await import('@/lib/printQueue');
    const job = q.enqueueReceiptOnPay(order)!;

    q.markFailed(job.id, 'printer offline');

    const held = q.getPrintQueue().find(j => j.id === job.id)!;
    expect(held.status).toBe('failed');
    expect(held.errorReason).toBe('offline');
    // still retryable — not lost
    expect(q.getProcessableJobs().some(j => j.id === job.id)).toBe(true);
  });

  it('never deletes the bill, and records that it did not print', async () => {
    const order = bill('b4', 104);
    seedStore(order);
    const q = await import('@/lib/printQueue');
    const store = await import('@/lib/store');
    const job = q.enqueueReceiptOnPay(order)!;

    // exhaust the retries
    q.markFailed(job.id, 'printer offline');
    q.markFailed(job.id, 'printer offline');
    q.markFailed(job.id, 'printer offline');

    const saved = store.getOrders().find(o => o.id === 'b4');
    expect(saved).toBeTruthy();                 // the sale survives
    expect(saved!.grandTotal).toBe(300);
    expect(saved!.printStatus).toBe('failed');  // and we know a slip is owed
  });

  it('a manual retry puts the job back in the queue', async () => {
    const order = bill('b5', 105);
    seedStore(order);
    const q = await import('@/lib/printQueue');
    const job = q.enqueueReceiptOnPay(order)!;
    q.markFailed(job.id, 'printer offline');

    q.retryJob(job.id);

    expect(q.getPrintQueue().find(j => j.id === job.id)!.status).toBe('pending');
  });
});
