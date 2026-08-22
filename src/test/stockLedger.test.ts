// ============================================================
// v1.26.0 — Inventory conflict / integrity tests
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  movementIdFor, signedDelta, planMovement, recomputeFromLedger,
  isDuplicateMovement, ledgerHealth, type StockMovement,
} from '@/lib/stockLedger';

describe('movement identity', () => {
  it('is deterministic for the same sale line', () => {
    expect(movementIdFor('sale', 'o1', 'i1', 'l1')).toBe(movementIdFor('sale', 'o1', 'i1', 'l1'));
  });
  it('differs per item and per reference', () => {
    expect(movementIdFor('sale', 'o1', 'i1')).not.toBe(movementIdFor('sale', 'o1', 'i2'));
    expect(movementIdFor('sale', 'o1', 'i1')).not.toBe(movementIdFor('refund', 'o1', 'i1'));
  });
  it('detects a replayed movement', () => {
    const logs = [{ movementId: 'sale:o1:i1:0' }] as StockMovement[];
    expect(isDuplicateMovement(logs, 'sale:o1:i1:0')).toBe(true);
    expect(isDuplicateMovement(logs, 'sale:o2:i1:0')).toBe(false);
    expect(isDuplicateMovement(logs, undefined)).toBe(false); // legacy call
  });
});

describe('signed deltas', () => {
  it('sale and out consume, in adds, adjustment keeps the sign', () => {
    expect(signedDelta('sale', 3)).toBe(-3);
    expect(signedDelta('out', 3)).toBe(-3);
    expect(signedDelta('in', 3)).toBe(3);
    expect(signedDelta('in', -3)).toBe(3);   // refund bug guard
    expect(signedDelta('adjustment', -2)).toBe(-2);
  });
});

describe('negative stock is never created silently', () => {
  it('clamps at zero and flags the shortfall for review', () => {
    const r = planMovement(2, 'sale', 5);
    expect(r.balanceAfter).toBe(0);
    expect(r.needsReview).toBe(true);
    expect(r.shortfall).toBe(3);
  });
  it('allows negative only when explicitly permitted', () => {
    expect(planMovement(2, 'sale', 5, true).balanceAfter).toBe(-3);
  });
});

describe('deterministic recomputation (order-independent)', () => {
  const logs: StockMovement[] = [
    { id: 'a', inventoryItemId: 'i1', type: 'in', quantity: 10, note: '', date: '', delta: 10 },
    { id: 'b', inventoryItemId: 'i1', type: 'sale', quantity: 3, note: '', date: '', delta: -3 },
    { id: 'c', inventoryItemId: 'i2', type: 'in', quantity: 99, note: '', date: '', delta: 99 },
    { id: 'd', inventoryItemId: 'i1', type: 'out', quantity: 2, note: '', date: '', delta: -2 },
  ];
  it('sums only the item it was asked about', () => {
    expect(recomputeFromLedger('i1', logs)).toBe(5);
  });
  it('is the same regardless of merge order (two devices syncing)', () => {
    const shuffled = [logs[3], logs[0], logs[2], logs[1]];
    expect(recomputeFromLedger('i1', shuffled)).toBe(recomputeFromLedger('i1', logs));
  });
  it('two tills selling the same product ADD their movements (no overwrite)', () => {
    const tillA: StockMovement = { id: 'x', inventoryItemId: 'i1', type: 'sale', quantity: 1, note: '', date: '', delta: -1 };
    const tillB: StockMovement = { id: 'y', inventoryItemId: 'i1', type: 'sale', quantity: 1, note: '', date: '', delta: -1 };
    expect(recomputeFromLedger('i1', [...logs, tillA, tillB])).toBe(3);
  });
});

describe('drift report', () => {
  it('flags a stored quantity that does not match the ledger', () => {
    const inv = [{ id: 'i1', name: 'Cheese', quantity: 7 }] as any;
    const logs: StockMovement[] = [
      { id: 'a', inventoryItemId: 'i1', type: 'in', quantity: 10, note: '', date: '', delta: 10 },
      { id: 'b', inventoryItemId: 'i1', type: 'sale', quantity: 3, note: '', date: '', delta: -3 },
    ];
    const [row] = ledgerHealth(inv, logs);
    expect(row.ledger).toBe(7);
    expect(row.drift).toBe(0);
  });
});

describe('store integration — sale deduction is idempotent', () => {
  beforeEach(() => {
    localStorage.clear();
    // The store caches its snapshot in module scope — reset it per case so
    // each test starts from the seeded inventory above.
    vi.resetModules();
    localStorage.setItem('desi-pos-data', JSON.stringify({
      orders: [], settings: {}, categories: [], tables: [], users: [], orderCounter: 0,
      menuItems: [{ id: 'm1', name: 'Coke', price: 100, inventoryItemId: 'i1', stockPerUnit: 1 }],
      inventory: [{ id: 'i1', name: 'Coke can', quantity: 10, lowStockThreshold: 2 }],
      stockLogs: [], recipes: [],
    }));
  });

  it('replaying the SAME order does not deduct twice', async () => {
    const store = await import('@/lib/store');
    const order: any = {
      id: 'ord-A', orderNumber: 1, orderType: 'takeaway', status: 'paid',
      items: [{ id: 'l1', menuItemId: 'm1', name: 'Coke', price: 100, quantity: 2, lineTotal: 200 }],
      subtotal: 200, discount: 0, tax: 0, grandTotal: 200, createdAt: new Date().toISOString(),
    };
    store.deductStockForOrder(order);
    expect(store.getInventory()[0].quantity).toBe(8);
    store.deductStockForOrder(order); // crash retry / duplicate sync
    expect(store.getInventory()[0].quantity).toBe(8);
  });

  it('a different order still deducts', async () => {
    const store = await import('@/lib/store');
    const mk = (id: string): any => ({
      id, orderNumber: 1, orderType: 'takeaway', status: 'paid',
      items: [{ id: 'l1', menuItemId: 'm1', name: 'Coke', price: 100, quantity: 1, lineTotal: 100 }],
      subtotal: 100, discount: 0, tax: 0, grandTotal: 100, createdAt: new Date().toISOString(),
    });
    store.deductStockForOrder(mk('ord-B'));
    store.deductStockForOrder(mk('ord-C'));
    expect(store.getInventory()[0].quantity).toBe(8);
  });

  it('stock never goes below zero silently — movement is flagged', async () => {
    const store = await import('@/lib/store');
    const r = store.adjustStock('i1', 25, 'out', 'big issue', { movementId: 'adjustment:t1:i1' });
    expect(r.balanceAfter).toBe(0);
    expect(r.needsReview).toBe(true);
    const log: any = store.getStockLogs().slice(-1)[0];
    expect(log.needsReview).toBe(true);
    expect(log.shortfall).toBe(15);
  });

  it('refund restock ADDS stock back (regression: it used to subtract)', async () => {
    const store = await import('@/lib/store');
    store.adjustStock('i1', 3, 'in', 'refund back', { movementId: 'refund:r1:i1' });
    expect(store.getInventory()[0].quantity).toBe(13);
    // replay guard
    store.adjustStock('i1', 3, 'in', 'refund back', { movementId: 'refund:r1:i1' });
    expect(store.getInventory()[0].quantity).toBe(13);
  });
});
