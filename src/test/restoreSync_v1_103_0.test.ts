// ============================================================
// v1.103.0 — a big backup restore must not fight the sync engine.
//
// Reported: "I upload a backup, sync trouble, the app sticks."
// Found by reading the code path (not guessed):
//   • the restore uploaded every record AND, meanwhile, each change the upload made woke the realtime reload, which found every row
//     the upload had not reached yet "missing from the cloud" and queued it again — thousands of rows in the queue and in the upload
//     loop at once, and the queue's flush uploaded them a second time while the restore ran;
//   • one network hiccup counted a whole chunk of 100 rows as failed and moved on;
//   • rows kept with their pictures made single requests of many megabytes;
//   • the page reloaded after a fixed six seconds, cutting a big restore off halfway.
// Pinned: chunks are bounded in rows and bytes and lose nothing; during a restore the reload is held and the queue's flush is held,
// then one reconcile runs; a failed chunk is retried, and rows that still fail are queued and reported; the local copies are stamped
// as the newest word; a local-only restore says so.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const sbSaveMany = vi.fn();
const sbLoadCollectionDelta = vi.fn(async () => ({ rows: [] as any[], full: true }));
vi.mock('@/lib/supabaseStore', async (orig) => ({
  ...(await orig<typeof import('@/lib/supabaseStore')>()),
  sbSaveMany: (...a: unknown[]) => (sbSaveMany as any)(...a),
  sbSaveSettings: async () => {},
  sbLoadCollectionDelta: (...a: unknown[]) => (sbLoadCollectionDelta as any)(...a),
}));

const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const mk = (n: number, f: (i: number) => any) => Array.from({ length: n }, (_, i) => f(i));
const backup = (items: number, orders: number) => JSON.stringify({
  settings: { name: 'Chai Corner' },
  users: [{ id: 'a1', name: 'Owner', username: 'owner', password: 'x', role: 'admin', isActive: true }],
  categories: [{ id: 'c1', name: 'Mains', icon: '', sortOrder: 1 }],
  menuItems: mk(items, i => ({ id: `m${i}`, name: `Item ${i}`, price: 100 + i, categoryId: 'c1', pricingType: 'fixed', isActive: true })),
  orders: mk(orders, i => ({ id: `o${i}`, orderNumber: i + 1, orderType: 'dining', status: 'paid', grandTotal: 500, subtotal: 500, createdAt: new Date().toISOString(), items: [], payments: [] })),
  tables: [], floors: [], kitchens: [], waiters: [], riders: [], orderCounter: 900,
});

describe('chunkForUpload', () => {
  it('bounds a request by rows and by bytes, keeps every row and the order', async () => {
    const { chunkForUpload } = await import('@/lib/store');
    const rows = mk(250, i => ({ id: `r${i}`, pad: 'x'.repeat(10) }));
    const byRows = chunkForUpload(rows, 100, 10_000_000);
    expect(byRows.map(c => c.length)).toEqual([100, 100, 50]);
    const fat = mk(6, i => ({ id: `f${i}`, pad: 'y'.repeat(400_000) }));   // ~0.4 MB each
    const byBytes = chunkForUpload(fat, 100, 1_000_000);
    expect(byBytes.every(c => c.length <= 2)).toBe(true);
    expect(byBytes.flat().map(r => r.id)).toEqual(fat.map(r => r.id));
    expect(chunkForUpload([{ id: 'huge', pad: 'z'.repeat(2_000_000) }], 100, 1_000_000)).toHaveLength(1);   // one oversize row stands alone
    expect(chunkForUpload([], 100, 1000)).toEqual([]);
  });
});

describe('importData in a signed-in restaurant', () => {
  beforeEach(async () => {
    localStorage.clear(); vi.resetModules(); sbSaveMany.mockReset(); sbLoadCollectionDelta.mockClear();
    localStorage.setItem('dtpos-auth-backend', 'supabase');
    localStorage.setItem('pos-tenant-id', 'tenant-1');
    localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin');
    reload();
  });
  afterEach(() => { vi.useRealTimers(); });
  const saved = (items: ReadonlyArray<{ id: string }>) => ({ saved: items.map(i => i.id), failed: [] as Array<{ id: string; error: string }> });

  it('uploads every record in bounded chunks and reports the outcome; progress ends at the total', async () => {
    sbSaveMany.mockImplementation(async (_c: string, items: any[]) => saved(items));
    const progress: Array<[number, number]> = [];
    const on = (e: Event) => { const d = (e as CustomEvent).detail; progress.push([d.processedCount, d.totalCount]); };
    window.addEventListener('dt-import-progress', on);
    const store = await import('@/lib/store');
    const out = await store.importData(backup(230, 40));
    window.removeEventListener('dt-import-progress', on);
    expect(out.cloud).toBe(true);
    expect(out.failed).toBe(0);
    expect(out.total).toBe(out.ok);
    expect(out.ok).toBeGreaterThanOrEqual(271);                       // 230 items + 40 orders + the category + the user
    for (const call of sbSaveMany.mock.calls) expect((call[1] as unknown[]).length).toBeLessThanOrEqual(100);
    expect(progress[0][0]).toBe(0);
    expect(progress[progress.length - 1]).toEqual([out.total, out.total]);
    expect(store.isBulkImporting()).toBe(false);
  });

  it('while it uploads: a realtime reload is HELD (not run, nothing re-queued), then reconciled once at the end', async () => {
    const store = await import('@/lib/store');
    const { getDeferredOps } = await import('@/lib/deferredSync');
    let heldDuring = false; let loadsDuring = -1; let queuedDuring = -1;
    sbSaveMany.mockImplementation(async (col: string, items: any[]) => {
      if (col === 'menuItems' && !heldDuring) {
        heldDuring = store.isBulkImporting();
        await store.sbReloadCollections(['menuItems', 'orders']);      // what a realtime announcement does
        loadsDuring = sbLoadCollectionDelta.mock.calls.length;
        queuedDuring = getDeferredOps().length;
      }
      return saved(items);
    });
    await store.importData(backup(30, 5));
    expect(heldDuring).toBe(true);
    expect(loadsDuring).toBe(0);                                      // the reload did not read the cloud mid-restore
    expect(queuedDuring).toBe(0);                                     // …and queued nothing a second time
    await new Promise(r => setTimeout(r, 20));
    expect(sbLoadCollectionDelta.mock.calls.length).toBe(2);          // one reconcile for the two held collections
  });

  it('the queue does not flush while a restore uploads, and does afterwards', async () => {
    const { holdDeferredFlush, flushDeferredOps, enqueueDeferredOp, registerDeferredFlusher } = await import('@/lib/deferredSync');
    const flusher = vi.fn(async () => {});
    registerDeferredFlusher(flusher as any);
    enqueueDeferredOp('menuItems', 'm-x', 'set');
    const release = holdDeferredFlush();
    const held = await flushDeferredOps();
    expect(held.skipped).toBe(true);
    expect(flusher).not.toHaveBeenCalled();
    release(); release();                                              // releasing twice must not go below zero
    const after = await flushDeferredOps();
    expect(after.skipped).toBe(false);
  });

  it('a chunk that fails once is retried and nothing is lost', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    let first = true;
    sbSaveMany.mockImplementation(async (col: string, items: any[]) => {
      if (col === 'menuItems' && first) { first = false; throw new Error('network hiccup'); }
      return saved(items);
    });
    const store = await import('@/lib/store');
    const p = store.importData(backup(20, 0));
    await vi.advanceTimersByTimeAsync(5000);
    const out = await p;
    expect(out.failed).toBe(0);
    expect(sbSaveMany.mock.calls.filter(c => c[0] === 'menuItems')).toHaveLength(2);   // tried twice
  });

  it('a chunk that never succeeds is reported, queued for the sync engine, and does not stop the rest', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    sbSaveMany.mockImplementation(async (col: string, items: any[]) => {
      if (col === 'menuItems') throw new Error('upstream down');
      return saved(items);
    });
    const store = await import('@/lib/store');
    const { getDeferredOps } = await import('@/lib/deferredSync');
    const p = store.importData(backup(12, 3));
    await vi.advanceTimersByTimeAsync(10_000);
    const out = await p;
    expect(out.failed).toBe(12);
    expect(out.failedRows.every(f => f.col === 'menuItems' && /upstream down/.test(f.error))).toBe(true);
    expect(out.ok).toBeGreaterThan(0);                                 // the orders after it still went
    const queued = getDeferredOps().filter(o => o.col === 'menuItems').map(o => o.entityId).sort();
    expect(queued).toHaveLength(12);
    expect(sbSaveMany.mock.calls.filter(c => c[0] === 'menuItems')).toHaveLength(3);   // three tries
  });

  it('the local copies are stamped as the newest word, so a later merge keeps the restore', async () => {
    sbSaveMany.mockImplementation(async (_c: string, items: any[]) => saved(items));
    const store = await import('@/lib/store');
    const before = Date.now();
    await store.importData(backup(3, 1));
    const items = store.getMenuItems() as any[];
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.every(i => Number(i._updatedAt) >= before)).toBe(true);
  });
});

describe('importData without a cloud session', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); reload(); });
  it('restores locally and says it did not touch the cloud', async () => {
    const store = await import('@/lib/store');
    const out = await store.importData(backup(5, 2));
    expect(out.cloud).toBe(false);
    expect(store.getMenuItems().length).toBeGreaterThanOrEqual(5);
  });
  it('an invalid file throws before anything is touched', async () => {
    const store = await import('@/lib/store');
    expect(() => store.importData('{ not json')).toThrow();
  });
});

describe('the queue does not rewrite itself once per op', () => {
  it('re-queueing many bills costs a handful of durable writes, not one per bill, and loses none', async () => {
    vi.resetModules();
    const writes: number[] = [];
    vi.doMock('@/lib/localDb', async () => {
      const orig = await vi.importActual<typeof import('@/lib/localDb')>('@/lib/localDb');
      return { ...orig, localDb: { ...orig.localDb, writeAll: async (_k: string, rows: unknown[]) => { writes.push(rows.length); }, readAll: async () => [] } };
    });
    const q = await import('@/lib/deferredSync');
    for (let i = 0; i < 600; i++) q.enqueueDeferredOp('orders', `o${i}`, 'set');       // 'orders' is a write-through collection
    await q.waitForQueuePersist();
    await new Promise(r => setTimeout(r, 50));
    expect(writes.length).toBeLessThanOrEqual(5);                                      // was 600 writes of up to 600 rows each
    expect(writes[writes.length - 1]).toBe(600);                                       // the last write holds every op
    expect(q.deferredPendingCount()).toBe(600);
    vi.doUnmock('@/lib/localDb');
  });
});
