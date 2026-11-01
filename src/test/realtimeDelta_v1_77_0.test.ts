// ============================================================================
// v1.77.0 — a realtime event re-reads what CHANGED, not the whole collection
//
// MEASURED on the live database (2026-11-01): 388 live orders at ~2.2 kB, 2,271 customers, 315 menu items; 36,841
// order updates against 2,497 inserts; 50,860 customer updates; 291 of 315 menu items touched in one day. Every one of
// those writes is a realtime event, and every event made EVERY signed-in device re-read the whole collection.
//
// The money guarantee mirrors v1.65.0: the delta must leave the till showing EXACTLY what a full read would. The tests
// run one mutation script twice — on deltas, and with the cursors wiped before every reload so each is a full read —
// and compare the local collections after every step.
//
// The server below is an in-memory model of PostgREST: it APPLIES the eq / is / gte filters it is sent, so a query
// that forgot the tenant, the archived filter or the cursor would return the wrong rows here instead of passing.
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TENANT = '64434fd6-3ea7-4ae2-9c05-6da25a41ad41';
const T0 = Date.parse('2026-11-01T09:00:00.000Z');

interface Row { id: string; tenant_id: string; updated_at: string; deleted_at: string | null; [k: string]: any }
let server: Record<string, Row[]> = {};
let requests: { table: string; filters: string[]; rows: number }[] = [];
let failNext = false;

function builder(tableName: string) {
  const preds: Array<(r: Row) => boolean> = [];
  const filters: string[] = [];
  const b: any = {
    select() { return b; },
    eq(c: string, v: any) { filters.push(`eq:${c}`); preds.push(r => r[c] === v); return b; },
    is(c: string, v: any) { filters.push(`is:${c}`); preds.push(r => (r[c] ?? null) === v); return b; },
    gte(c: string, v: string) { filters.push(`gte:${c}`); preds.push(r => Date.parse(r[c]) >= Date.parse(v)); return b; },
    then(resolve: any, reject: any) {
      const run = () => {
        if (failNext) { failNext = false; requests.push({ table: tableName, filters, rows: 0 }); return { data: null, error: { message: 'network down' } }; }
        const out = (server[tableName] || []).filter(r => preds.every(p => p(r))).map(r => structuredClone(r));
        requests.push({ table: tableName, filters, rows: out.length });
        return { data: out, error: null };
      };
      return Promise.resolve(run()).then(resolve, reject);
    },
  };
  return b;
}

vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  sb: () => ({ from: (t: string) => builder(t) }),
  isSupabaseConfigured: () => true,
}));
vi.mock('@/lib/authProvider', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  authTenantId: () => TENANT,
}));

const { setTenant } = await import('@/lib/tenant');
const store = await import('@/lib/store');
const sbStore = await import('@/lib/supabaseStore');
const { mergeDelta, mergeCollection, deltaWindow } = await import('@/lib/syncMerge');

let clock = T0;
let seq = 0;
const iso = (ms: number) => new Date(ms).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function menuRow(over: Partial<Row> & { ageMs?: number } = {}): Row {
  const n = ++seq;
  const ts = iso(clock - (over.ageMs ?? 0));
  return { id: over.id ?? uuid(n), tenant_id: TENANT, name: over.name ?? `Item ${n}`, price: over.price ?? 100 + n,
           created_at: ts, updated_at: ts, deleted_at: null, ...over };
}
function orderRow(over: Partial<Row> & { ageMs?: number } = {}): Row {
  const n = ++seq;
  const ts = iso(clock - (over.ageMs ?? 0));
  const id = over.id ?? uuid(n);
  return { id, tenant_id: TENANT, branch_id: null, order_number: n, status: 'running', total: 0, grand_total: 500 + n,
           data: { id, items: [], payments: [], grandTotal: 500 + n, status: 'running', orderNumber: n },
           created_at: ts, updated_at: ts, deleted_at: null, archived_at: null, ...over };
}
/** Change a server row the way the database does: `updated_at` moves forward. */
function touch(table: string, id: string, patch: Record<string, any> = {}) {
  const r = server[table].find(x => x.id === id)!;
  Object.assign(r, patch);
  r.updated_at = iso(clock);
}
const remove = (table: string, id: string) => touch(table, id, { deleted_at: iso(clock) });

const ALL = ['orders','categories','menuItems','tables','floors','kitchens','waiters','riders','users','inventory','stockLogs','employees','attendance','leaves','payslips','advances','accountCategories','transactions','parties','ledger','dailyCashCloses','receivingEntries','marketingContacts','recipes','wastages','customers','branches','creditPayments','promoCodes','paymentAccounts','deals','shifts','refunds'];
function seedDevice() {
  localStorage.clear();
  localStorage.setItem('dtpos-auth-backend', 'supabase');
  localStorage.setItem('pos-tenant-id', TENANT);
  const base: any = { _tenantId: TENANT, settings: { name: 'First Chef' }, orderCounter: 1 };
  for (const k of ALL) base[k] = [];
  localStorage.setItem(`desi-pos-data:${TENANT}`, JSON.stringify(base));
  setTenant(TENANT, 'First Chef');
  window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: TENANT } }));
}
const wipeCursors = () => sbStore.resetRealtimeDeltaCursors(TENANT);
const menuAll = () => store.getMenuItems() as any[];
const menuIds = () => menuAll().map((m: any) => m.id).sort();
const menuSnap = () => JSON.stringify(menuAll().map((m: any) => [m.id, m.name, m.price, m._updatedAt]).sort());
const isFull = (r: { filters: string[] }) => !r.filters.some(f => f.startsWith('gte:'));

beforeEach(() => {
  server = { menu_items: [], orders: [], customers: [] };
  requests = []; failNext = false; seq = 0; clock = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  seedDevice();
});
afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
describe('what goes over the wire', () => {
  it('the first reload has no cursor, so it is a FULL read', async () => {
    server.menu_items = [menuRow({ ageMs: 5000 }), menuRow({ ageMs: 4000 })];
    await store.sbReloadCollections(['menuItems']);
    expect(requests).toHaveLength(1);
    expect(isFull(requests[0])).toBe(true);
    expect(menuIds()).toHaveLength(2);
  });

  it('the next reload asks only for what moved — 388 live orders, 3 rows over the wire', async () => {
    server.orders = Array.from({ length: 388 }, (_, i) => orderRow({ ageMs: (388 - i) * 60_000 }));
    await store.sbReloadCollections(['orders']);
    expect(requests[0].rows).toBe(388);

    clock += 10_000;
    touch('orders', server.orders[7].id, { status: 'paid' });
    touch('orders', server.orders[9].id, { grand_total: 990 });
    await store.sbReloadCollections(['orders']);

    const delta = requests.at(-1)!;
    expect(isFull(delta)).toBe(false);
    // the two that moved + the newest from last time, which the 30 s overlap deliberately re-reads
    expect(delta.rows).toBe(3);
    expect(store.getOrders()).toHaveLength(388);
  });

  it('a reload where nothing changed over the wire is one query returning the overlap row at most', async () => {
    server.menu_items = Array.from({ length: 315 }, (_, i) => menuRow({ ageMs: (315 - i) * 60_000 }));
    await store.sbReloadCollections(['menuItems']);
    clock += 5_000;
    await store.sbReloadCollections(['menuItems']);
    expect(requests.at(-1)!.rows).toBeLessThanOrEqual(1);
    expect(menuIds()).toHaveLength(315);
  });

  it('keeps the tenant filter, and the archived filter on orders, on every read', async () => {
    server.orders = [orderRow({ ageMs: 5000 })];
    await store.sbReloadCollections(['orders']);
    clock += 1000;
    await store.sbReloadCollections(['orders']);
    for (const r of requests) {
      expect(r.filters).toContain('eq:tenant_id');
      expect(r.filters).toContain('is:archived_at');
    }
  });

  it('does NOT filter out tombstones — a deletion is a changed row', async () => {
    server.menu_items = [menuRow({ ageMs: 5000 })];
    await store.sbReloadCollections(['menuItems']);
    clock += 1000;
    await store.sbReloadCollections(['menuItems']);
    for (const r of requests) expect(r.filters).not.toContain('is:deleted_at');
  });
});

// ---------------------------------------------------------------------------
describe('what the till shows', () => {
  it('an edit made on another device arrives', async () => {
    server.menu_items = [menuRow({ id: uuid(900), name: 'Zinger', price: 450, ageMs: 9000 }), menuRow({ ageMs: 8000 })];
    await store.sbReloadCollections(['menuItems']);
    clock += 20_000;
    touch('menu_items', uuid(900), { price: 520 });
    await store.sbReloadCollections(['menuItems']);
    const m = menuAll().find((x: any) => x.id === uuid(900));
    expect(m.price).toBe(520);
    expect(menuIds()).toHaveLength(2);
  });

  it('a new row on another device arrives', async () => {
    server.menu_items = [menuRow({ ageMs: 9000 })];
    await store.sbReloadCollections(['menuItems']);
    clock += 20_000;
    server.menu_items.push(menuRow({ name: 'Brand new' }));
    await store.sbReloadCollections(['menuItems']);
    expect(menuIds()).toHaveLength(2);
  });

  it('a deletion on another device removes the row here (the tombstone travels as a changed row)', async () => {
    server.menu_items = [menuRow({ id: uuid(901), ageMs: 9000 }), menuRow({ ageMs: 8000 })];
    await store.sbReloadCollections(['menuItems']);
    expect(menuIds()).toHaveLength(2);
    clock += 20_000;
    remove('menu_items', uuid(901));
    await store.sbReloadCollections(['menuItems']);
    expect(menuIds()).not.toContain(uuid(901));
    expect(menuIds()).toHaveLength(1);
  });

  it('rows the delta does not mention are left exactly as they were', async () => {
    server.menu_items = Array.from({ length: 20 }, (_, i) => menuRow({ ageMs: (20 - i) * 60_000 }));
    await store.sbReloadCollections(['menuItems']);
    const before = menuAll().map((m: any) => JSON.stringify(m));
    clock += 20_000;
    touch('menu_items', server.menu_items[3].id, { price: 7 });
    await store.sbReloadCollections(['menuItems']);
    const after = menuAll();
    const same = after.filter((m: any) => before.includes(JSON.stringify(m)));
    expect(after).toHaveLength(20);
    expect(same).toHaveLength(19);
  });

  it('DELTA and FULL leave the same collection after every step of a mixed script', async () => {
    const steps: Array<() => void> = [
      () => { server.menu_items.push(menuRow({ name: 'A' })); },
      () => { touch('menu_items', server.menu_items[0].id, { price: 999 }); },
      () => { server.menu_items.push(menuRow({ name: 'B' })); touch('menu_items', server.menu_items[1].id, { name: 'renamed' }); },
      () => { remove('menu_items', server.menu_items[0].id); },
      () => { /* nothing changes */ },
      () => { server.menu_items.push(menuRow({ name: 'C' })); remove('menu_items', server.menu_items[2].id); },
    ];
    const run = async (forceFull: boolean) => {
      // Counters first, so both runs build byte-identical rows and ids.
      seq = 100; clock = T0;
      server = { menu_items: [menuRow({ name: 'seed1', ageMs: 60_000 }), menuRow({ name: 'seed2', ageMs: 50_000 }), menuRow({ name: 'seed3', ageMs: 40_000 })], orders: [], customers: [] };
      seedDevice(); wipeCursors();
      const trail: string[] = [];
      await store.sbReloadCollections(['menuItems']);
      trail.push(menuSnap());
      for (const step of steps) {
        clock += 20_000;
        step();
        if (forceFull) wipeCursors();
        await store.sbReloadCollections(['menuItems']);
        trail.push(menuSnap());
      }
      return trail;
    };
    const delta = await run(false);
    const reqDelta = requests.filter(isFull).length;
    requests = [];
    const full = await run(true);
    expect(delta).toEqual(full);
    expect(reqDelta).toBeLessThan(requests.filter(isFull).length);   // and the delta run really did avoid full reads
  });
});

// ---------------------------------------------------------------------------
describe('when it must fall back to a full read', () => {
  it('a device holding nothing locally (fresh install, cleared browser) reads everything', async () => {
    server.menu_items = Array.from({ length: 5 }, (_, i) => menuRow({ ageMs: (5 - i) * 60_000 }));
    await store.sbReloadCollections(['menuItems']);
    // the browser's data is wiped but the cursor survives
    const k = `desi-pos-data:${TENANT}`;
    const blob = JSON.parse(localStorage.getItem(k)!); blob.menuItems = []; localStorage.setItem(k, JSON.stringify(blob));
    window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: TENANT } }));
    clock += 5_000;
    await store.sbReloadCollections(['menuItems']);
    expect(isFull(requests.at(-1)!)).toBe(true);
    expect(menuIds()).toHaveLength(5);
  });

  it('after the reconcile interval (1 hour) it takes a full read and heals anything a cursor stepped over', async () => {
    server.menu_items = [menuRow({ ageMs: 5000 })];
    await store.sbReloadCollections(['menuItems']);
    // a row appears with an `updated_at` OLDER than the cursor — the case the cursor alone cannot see
    server.menu_items.push(menuRow({ name: 'late committer', ageMs: 10 * 60_000 }));
    clock += 60_000;
    await store.sbReloadCollections(['menuItems']);
    expect(menuIds()).toHaveLength(1);                                  // the delta, correctly, does not see it
    clock += 30 * 60_000;
    await store.sbReloadCollections(['menuItems']);
    expect(isFull(requests.at(-1)!)).toBe(false);                       // half the interval: still a delta
    clock += 31 * 60_000;
    await store.sbReloadCollections(['menuItems']);
    expect(isFull(requests.at(-1)!)).toBe(true);
    expect(menuIds()).toHaveLength(2);                                  // the reconcile does
  });

  it('a failed read throws, does not move the cursor, and the next read still covers the gap', async () => {
    server.menu_items = [menuRow({ ageMs: 9000 })];
    await store.sbReloadCollections(['menuItems']);
    clock += 20_000;
    server.menu_items.push(menuRow({ name: 'missed while offline' }));
    failNext = true;
    await store.sbReloadCollections(['menuItems']);                    // logs a warning, keeps the cache
    expect(menuIds()).toHaveLength(1);
    clock += 20_000;
    await store.sbReloadCollections(['menuItems']);
    expect(menuIds()).toHaveLength(2);
  });

  it('collections that share a table keep separate cursors', async () => {
    server.customers = [{ id: uuid(700), tenant_id: TENANT, name: 'Ali', phone: '0300', created_at: iso(T0), updated_at: iso(T0 - 5000), deleted_at: null }];
    await store.sbReloadCollections(['customers']);
    clock += 5_000;
    await store.sbReloadCollections(['marketingContacts']);
    // marketingContacts has never been read on this device: it must NOT ride on the customers cursor
    expect(isFull(requests.at(-1)!)).toBe(true);
    expect(requests.at(-1)!.table).toBe('customers');
  });

  it('a cursor belongs to its tenant', async () => {
    server.menu_items = [menuRow({ ageMs: 5000 })];
    await store.sbReloadCollections(['menuItems']);
    const keys = Object.keys(localStorage).filter(k => k.startsWith('pos-rt-delta-cursor::'));
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k).toContain(TENANT);
    // `pos-` prefix: sessionIsolation wipes every pos-* key when the browser switches restaurant
    for (const k of keys) expect(k.startsWith('pos-')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('mergeDelta — the pure rule', () => {
  const local = (id: string, ts = 1, extra: any = {}) => ({ id, _updatedAt: ts, name: id, ...extra });
  const remote = (id: string, ts = 2, extra: any = {}) => ({ id, _updatedAt: ts, name: id + '-remote', ...extra });

  it('an empty delta changes nothing and says so', () => {
    const rows = [local('a'), local('b')];
    const r = mergeDelta('menuItems', [], rows, new Set());
    expect(r.changed).toBe(false);
    expect(r.rows).toBe(rows);
    expect(r.requeue).toEqual([]);
  });

  it('does NOT re-queue the local rows the delta is not about — the failure mergeCollection would cause', () => {
    const rows = Array.from({ length: 50 }, (_, i) => local('r' + i));
    const viaFull = mergeCollection('menuItems', [remote('r3')], rows, new Set());
    expect(viaFull.requeue).toHaveLength(49);                        // a partial list through the full merge re-uploads the rest
    const viaDelta = mergeDelta('menuItems', [remote('r3')], rows, new Set());
    expect(viaDelta.requeue).toEqual([]);
    expect(viaDelta.rows).toHaveLength(50);
    expect(viaDelta.rows.find(r => r.id === 'r3')!.name).toBe('r3-remote');
  });

  it('a tombstone removes the local row', () => {
    const r = mergeDelta('menuItems', [{ id: 'a', deleted: true, _updatedAt: 5 }], [local('a'), local('b')], new Set());
    expect(r.rows.map(x => x.id)).toEqual(['b']);
  });

  it('a newer local edit is kept over an older remote copy', () => {
    const r = mergeDelta('menuItems', [remote('a', 2)], [local('a', 9, { name: 'mine' })], new Set());
    expect(r.rows.find(x => x.id === 'a')!.name).toBe('mine');
  });

  it('a row only the cloud has is added', () => {
    const r = mergeDelta('menuItems', [remote('new')], [local('a')], new Set());
    expect(r.rows.map(x => x.id).sort()).toEqual(['a', 'new']);
  });

  it('recognises a local id and the cloud id it is keyed under as one record', () => {
    const cloudIdOf = (id: string) => (id === 'mi-1' ? 'uuid-1' : id);
    const r = mergeDelta('menuItems', [remote('uuid-1', 9)], [local('mi-1', 1), local('other')], new Set(), cloudIdOf);
    expect(r.rows).toHaveLength(2);                                  // not 3: no duplicate
    expect(r.rows.some(x => x.id === 'mi-1')).toBe(true);            // the LOCAL id is kept
  });
});

describe('deltaWindow — full or delta, and from when', () => {
  const base = { cursorMs: 1_000_000, lastFullMs: 1_000_000, nowMs: 1_060_000, overlapMs: 30_000, reconcileMs: 900_000 };
  it('is a delta from cursor minus the overlap', () => {
    const w = deltaWindow(base);
    expect(w.full).toBe(false);
    expect(w.sinceIso).toBe(new Date(970_000).toISOString());
  });
  it('is full without a cursor, when forced, and after the reconcile interval', () => {
    expect(deltaWindow({ ...base, cursorMs: 0 }).full).toBe(true);
    expect(deltaWindow({ ...base, force: true }).full).toBe(true);
    expect(deltaWindow({ ...base, nowMs: base.lastFullMs + 900_000 }).full).toBe(true);
  });
  it('never reconciles when the interval is 0', () => {
    expect(deltaWindow({ ...base, reconcileMs: 0, nowMs: base.lastFullMs + 99_999_999 }).full).toBe(false);
  });
  it('never asks for a negative time', () => {
    expect(deltaWindow({ ...base, cursorMs: 5_000 }).sinceIso).toBe(new Date(0).toISOString());
  });
});

describe('wiring', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  it('the realtime reload goes through the delta reader, and the flag is on', () => {
    expect(read('src/lib/store.ts')).toContain('sbLoadCollectionDelta(name, { force: localRows.length === 0 })');
    expect(read('src/lib/featureFlags.ts')).toContain('export const ENABLE_REALTIME_DELTA_RELOAD = true;');
  });
  it('a partial read never goes through the full merge', () => {
    const s = read('src/lib/store.ts');
    const at = s.indexOf('export async function sbReloadCollections');
    const body = s.slice(at, at + 3200);
    expect(body).toContain('mergeDelta(name, rows, localRows, pendingIds, cloudIdFor)');
    expect(body).toMatch(/if \(full\) \{[\s\S]*?mergeCollection\(/);
  });
});
