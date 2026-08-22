// ============================================================================
// v1.26.0 — the whole point, end to end
//
// Go offline. Take a bill, edit the menu, change the restaurant name. Come
// back online. Everything must reach the backend, exactly once, and nothing
// may be lost on the way — including the settings change, which until this
// release had no retry path at all and was simply discarded.
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Order } from '@/lib/types';

const TENANT = '33333333-3333-3333-3333-333333333333';

/** Stands in for Supabase. Records every write it accepts. */
const server = {
  rows: new Map<string, any>(),
  settings: null as any,
  writes: [] as string[],
  settingsWrites: 0,
  down: false,
};

const sbSaveItem = vi.fn(async (col: string, id: string, data: any) => {
  if (server.down) throw new Error('network down');
  server.writes.push(`${col}:${id}`);
  server.rows.set(`${col}:${id}`, data);
});
const sbDeleteItem = vi.fn(async (col: string, id: string) => {
  if (server.down) throw new Error('network down');
  server.writes.push(`del ${col}:${id}`);
  server.rows.delete(`${col}:${id}`);
});
const sbSaveSettings = vi.fn(async (s: any) => {
  if (server.down) throw new Error('network down');
  server.settingsWrites++;
  server.settings = s;
});

vi.mock('@/lib/supabaseStore', async () => ({
  cloudId: (await vi.importActual<any>('@/lib/supabaseStore')).cloudId,
  sbSaveItem, sbDeleteItem, sbSaveSettings,
  sbLoadCollection: async () => [], sbLoadAll: async () => ({}),
  sbLoadSettings: async () => null,
  TABLE_FOR: { menuItems: 'menu_items', orders: 'orders', categories: 'categories' },
}));

const { setTenant } = await import('@/lib/tenant');
const store = await import('@/lib/store');
const deferred = await import('@/lib/deferredSync');

function setOnline(v: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
}

function makeOrder(id: string, n: number): Order {
  return {
    id, orderNumber: n, orderType: 'takeaway', status: 'paid',
    items: [{ id: 'l1', menuItemId: 'm1', name: 'Chai', price: 100, quantity: 1, lineTotal: 100 }],
    subtotal: 100, discount: 0, tax: 0, grandTotal: 100,
    createdAt: new Date().toISOString(),
  } as unknown as Order;
}

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('dtpos-auth-backend', 'supabase');
  localStorage.setItem('desi-pos-data', JSON.stringify({
    orders: [], menuItems: [], categories: [], tables: [], settings: { name: 'Before' },
  }));
  setTenant(TENANT, 'Test Restaurant');
  server.rows.clear(); server.writes.length = 0;
  server.settings = null; server.settingsWrites = 0; server.down = false;
  sbSaveItem.mockClear(); sbSaveSettings.mockClear();
  deferred.stopDeferredSyncTriggers();
  setOnline(true);
});

afterEach(() => { setOnline(true); });

describe('work done offline reaches the backend when the connection returns', () => {
  it('carries an order, a menu edit and a settings change across the outage', async () => {
    setOnline(false);

    store.saveOrder(makeOrder('ord-offline-1', 101));
    store.saveMenuItem({ id: 'mi-1', name: 'Karahi', price: 900, categoryId: 'c1' } as any);
    store.saveSettings({ ...store.getSettings(), name: 'Renamed While Offline' } as any);

    // Nothing was attempted — billing never waits for a network that is not there.
    expect(sbSaveItem).not.toHaveBeenCalled();
    expect(deferred.deferredPendingCount()).toBeGreaterThan(0);

    // Settings debounce is 600ms; let it land on the queue.
    await new Promise(r => setTimeout(r, 800));

    setOnline(true);
    const result = await deferred.flushDeferredOps();

    expect(result.skipped).toBe(false);
    expect(server.writes).toContain('orders:ord-offline-1');
    expect(server.writes).toContain('menuItems:mi-1');
    expect(server.settings?.name).toBe('Renamed While Offline');
    expect(deferred.deferredPendingCount()).toBe(0);
  }, 20000);

  it('a settings change is queued, not discarded, when the write fails online', async () => {
    // THE BUG: cloudSaveSettings reported the error and gave up. saveSettings
    // swallowed it. A logo or restaurant name changed during a blip was gone,
    // and the UI showed it saved.
    server.down = true;
    store.saveSettings({ ...store.getSettings(), name: 'Saved During A Blip' } as any);
    await new Promise(r => setTimeout(r, 800));

    server.down = false;
    await deferred.flushDeferredOps();
    expect(server.settings?.name).toBe('Saved During A Blip');
  }, 20000);
});

describe('a retried write does not become two records', () => {
  it('re-flushing an op that already succeeded writes it once', async () => {
    setOnline(false);
    store.saveOrder(makeOrder('ord-once', 202));
    setOnline(true);

    await deferred.flushDeferredOps();
    await deferred.flushDeferredOps();       // nothing left to do
    expect(server.writes.filter(w => w === 'orders:ord-once')).toHaveLength(1);
  }, 20000);

  it('repeated edits of one record collapse to a single upload', async () => {
    setOnline(false);
    store.saveMenuItem({ id: 'mi-2', name: 'v1', price: 1 } as any);
    store.saveMenuItem({ id: 'mi-2', name: 'v2', price: 2 } as any);
    store.saveMenuItem({ id: 'mi-2', name: 'v3', price: 3 } as any);
    setOnline(true);

    await deferred.flushDeferredOps();
    expect(server.writes.filter(w => w === 'menuItems:mi-2')).toHaveLength(1);
    expect(server.rows.get('menuItems:mi-2').name).toBe('v3');   // the latest, not the first
  }, 20000);
});

describe('a failed flush keeps the work', () => {
  it('leaves the op queued and retries it after the failure', async () => {
    setOnline(false);
    store.saveOrder(makeOrder('ord-retry', 303));
    setOnline(true);

    server.down = true;
    await deferred.flushDeferredOps();
    expect(deferred.deferredPendingCount()).toBe(1);   // preserved, not dropped

    server.down = false;
    // The op is inside its backoff window; wind its clock back so the retry
    // is due now rather than sleeping through it in a test.
    for (const op of deferred.getDeferredOps()) (op as any).at = 0;
    await deferred.flushDeferredOps();
    expect(server.writes).toContain('orders:ord-retry');
    expect(deferred.deferredPendingCount()).toBe(0);
  }, 20000);
});


describe('the durable queue reflects what actually happened', () => {
  it('a completed flush is a fact on disk before it reports success', async () => {
    // THE BUG: flushDeferredOps() awaited persistInFlight, but schedulePersist()
    // only ARMS a 150ms timer, so persistInFlight was null and the await did
    // nothing. The function returned with the durable queue still listing ops
    // that had already been uploaded — and a reload inside that window replayed
    // every one of them.
    const { localDb } = await import('@/lib/localDb');
    setOnline(false);
    store.saveOrder(makeOrder('ord-persist', 404));
    setOnline(true);

    await deferred.flushDeferredOps();
    expect(server.writes).toContain('orders:ord-persist');
    // No extra waiting: the queue on disk must ALREADY be empty.
    expect(await localDb.getRows('deferredOps')).toHaveLength(0);
  }, 20000);

  it('a write that runs out of retries is announced, not just parked', async () => {
    // After MAX_ATTEMPTS an op is moved to the dead-letter store. Nothing read
    // that store, so the one path the design leaves for a permanently failing
    // write ended in silence.
    const parked: string[] = [];
    const off = deferred.onDeadLetter((_n, ops) => parked.push(...ops.map(o => o.id)));

    setOnline(false);
    store.saveOrder(makeOrder('ord-doomed', 505));
    setOnline(true);
    server.down = true;

    // Six attempts, winding the backoff clock forward each round.
    for (let i = 0; i < 7 && deferred.deferredPendingCount() > 0; i++) {
      for (const op of deferred.getDeferredOps()) (op as any).at = 0;
      await deferred.flushDeferredOps();
    }
    off();

    expect(parked).toContain('orders::ord-doomed');
    expect(deferred.deferredDeadLetterCount()).toBeGreaterThan(0);
    // Parked is not lost: the record is still recoverable.
    const dead = await deferred.getDeadLetterOps();
    expect(dead.some(o => o.entityId === 'ord-doomed')).toBe(true);

    // And the operator can put it back.
    server.down = false;
    await deferred.requeueDeadLetter('orders::ord-doomed');
    await deferred.flushDeferredOps();
    expect(server.writes).toContain('orders:ord-doomed');
  }, 30000);
});
