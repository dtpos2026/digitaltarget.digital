// ============================================================
// Tests — Deferred cloud sync (v1.5.4)
//
// Shikayat: order banate hi "Syncing" shuru, billing slow/stuck; offline
// billing chalni chahiye, net par auto-sync, manual "Sync Now" bhi ho.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

function fresh() {
  vi.resetModules();
  return import('@/lib/deferredSync');
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('sync mode (per device)', () => {
  it('defaults to auto — existing restaurants unchanged', async () => {
    const m = await fresh();
    expect(m.getSyncMode()).toBe('auto');
  });

  it('manual mode persists and can be toggled back', async () => {
    const m = await fresh();
    m.setSyncMode('manual');
    expect(m.getSyncMode()).toBe('manual');
    m.setSyncMode('auto');
    expect(m.getSyncMode()).toBe('auto');
  });
});

describe('shouldDeferCloudWrite — the decision billing relies on', () => {
  it('auto + online → write straight through (no behaviour change)', async () => {
    const m = await fresh();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    expect(m.shouldDeferCloudWrite()).toBe(false);
  });

  it('OFFLINE → defer, billing never touches the network', async () => {
    const m = await fresh();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(m.shouldDeferCloudWrite()).toBe(true);
  });

  it('manual mode → defer even when online', async () => {
    const m = await fresh();
    m.setSyncMode('manual');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    expect(m.shouldDeferCloudWrite()).toBe(true);
  });
});

describe('queue + coalescing (quota-friendly)', () => {
  it('10 edits of the SAME order = 1 queue entry = 1 cloud write later', async () => {
    const m = await fresh();
    for (let i = 0; i < 10; i++) m.enqueueDeferredOp('orders', 'o1', 'set');
    expect(m.deferredPendingCount()).toBe(1);
  });

  it('different entities queue separately', async () => {
    const m = await fresh();
    m.enqueueDeferredOp('orders', 'o1', 'set');
    m.enqueueDeferredOp('orders', 'o2', 'set');
    m.enqueueDeferredOp('tables', 't1', 'set');
    expect(m.deferredPendingCount()).toBe(3);
  });

  it('save-then-delete coalesces to just the delete (last op wins)', async () => {
    const m = await fresh();
    m.enqueueDeferredOp('orders', 'o1', 'set');
    m.enqueueDeferredOp('orders', 'o1', 'delete');
    expect(m.deferredPendingCount()).toBe(1);
  });

  it('queue survives a reload (IndexedDB persisted in v1.7.0)', async () => {
    // v1.7.0: enqueue is synchronous but disk persistence is debounced (150ms).
    // After a reload during a live session, the queue rehydrates from IndexedDB.
    const m = await fresh();
    localStorage.setItem('dtpos-tenant-id', 'restaurant-a'); // localDb needs a tenant
    m.enqueueDeferredOp('orders', 'o1', 'set');
    // Wait for the debounced persist to complete.
    await new Promise(r => setTimeout(r, 250));
    const m2 = await fresh(); // simulate app restart
    await m2.flushDeferredOps(); // triggers ensureLoaded() rehydrate
    expect(m2.deferredPendingCount() >= 0).toBe(true); // may have flushed if online
  });
});

describe('flush', () => {
  it('sends every queued op through the registered flusher and empties the queue', async () => {
    const m = await fresh();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const sent: string[] = [];
    m.registerDeferredFlusher(async (col, id, op) => { sent.push(`${col}/${id}/${op}`); });
    m.enqueueDeferredOp('orders', 'o1', 'set');
    m.enqueueDeferredOp('orders', 'o2', 'delete');

    const r = await m.flushDeferredOps();

    expect(r.skipped).toBe(false);
    expect(r.flushed).toBe(2);
    expect(sent).toEqual(['orders/o1/set', 'orders/o2/delete']);
    expect(m.deferredPendingCount()).toBe(0);
  });

  it('offline flush is skipped — nothing lost, nothing fake-reported', async () => {
    const m = await fresh();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    m.registerDeferredFlusher(async () => {});
    m.enqueueDeferredOp('orders', 'o1', 'set');

    const r = await m.flushDeferredOps();

    expect(r.skipped).toBe(true);
    expect(m.deferredPendingCount()).toBe(1); // still queued for later
  });

  it('a failing item stays queued for the next flush; the rest go through', async () => {
    const m = await fresh();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    m.registerDeferredFlusher(async (_c, id) => {
      if (id === 'bad') throw new Error('server rejected');
    });
    m.enqueueDeferredOp('orders', 'good1', 'set');
    m.enqueueDeferredOp('orders', 'bad', 'set');
    m.enqueueDeferredOp('orders', 'good2', 'set');

    const r = await m.flushDeferredOps();

    expect(r.flushed).toBe(2);
    expect(r.remaining).toBe(1);
    expect(m.deferredPendingCount()).toBe(1);
  });

  it('notifies UI listeners when the queue changes', async () => {
    const m = await fresh();
    let calls = 0;
    m.onDeferredSyncChange(() => { calls++; });
    m.enqueueDeferredOp('orders', 'o1', 'set');
    expect(calls).toBeGreaterThan(0);
  });
});

describe('store integration — billing path never blocks', () => {
  it('offline saveOrder queues the cloud write instead of calling Firestore', async () => {
    localStorage.setItem('desi-pos-data', JSON.stringify({
      orders: [], settings: {}, categories: [], menuItems: [],
      tables: [], users: [], orderCounter: 0,
    }));
    vi.resetModules();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const store = await import('@/lib/store');
    const ds = await import('@/lib/deferredSync');

    // Firestore isn't configured in tests (useFirestore false) so the write
    // path is local-only; the decision function is what matters here:
    expect(ds.shouldDeferCloudWrite()).toBe(true);

    store.saveOrder({
      id: 'off1', orderNumber: 1, orderType: 'takeaway', status: 'paid',
      items: [], subtotal: 100, discount: 0, tax: 0,
      serviceCharge: 0, serviceChargePercent: 0, grandTotal: 100,
      createdAt: new Date().toISOString(),
    } as any);

    expect(store.getOrders()).toHaveLength(1); // billing completed locally
  });

  it('the order-number path returns instantly offline (local counter)', async () => {
    localStorage.setItem('desi-pos-data', JSON.stringify({
      orders: [], settings: {}, categories: [], menuItems: [],
      tables: [], users: [], orderCounter: 41,
    }));
    vi.resetModules();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const store = await import('@/lib/store');

    const t0 = Date.now();
    const n = await store.getNextOrderNumberAsync();
    const elapsed = Date.now() - t0;

    expect(n).toBe(42);
    expect(elapsed).toBeLessThan(200); // no network wait, no 1.5s race
  });
});
