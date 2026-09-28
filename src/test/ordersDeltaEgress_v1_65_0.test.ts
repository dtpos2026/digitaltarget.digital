// ============================================================================
// v1.65.0 — the orders poll read the whole table, every time
//
// MEASURED, not assumed: First Chef has 352 live order rows; `select('*')` on
// them is 1,765 kB, and thirteen screens call refreshOrdersFromCloud() — four
// on an 8-15 second timer. One till on Running Bills pulled ~10.6 MB a minute
// to learn that two rows had changed.
//
// The fix reads only rows whose `updated_at` moved. The money guarantee is
// that this changes NOTHING about what the till shows or totals: the merge in
// refreshOrdersFromCloud() was already additive-only (it starts from the local
// rows and only adds or overwrites), so a delta and a full read must leave the
// SAME local orders. The tests below prove that by running one deterministic
// mutation script twice — once on deltas, once with the cursor wiped before
// every refresh so every read is a full one — and comparing every step.
//
// The server is a faithful in-memory model of PostgREST + the `orders` table:
// it APPLIES the eq / is / gte filters it is sent, so a query that forgot the
// tenant or archived filter would return the wrong rows here instead of
// passing quietly.
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const TENANT = '64434fd6-3ea7-4ae2-9c05-6da25a41ad41';
const OTHER_TENANT = 'fd3ead3d-af9a-4ff2-b78d-5f93d1e6e3fb';
const T0 = Date.parse('2026-09-28T09:00:00.000Z');

interface Row {
  id: string; tenant_id: string; branch_id: string | null; order_number: number;
  status: string; total: number; grand_total: number; data: Record<string, any>;
  created_at: string; updated_at: string; deleted_at: string | null; archived_at: string | null;
}

let table: Row[] = [];
let requests: { filters: string[]; rows: number }[] = [];
let failNext = false;
let latencyMs = 0;

function makeBuilder() {
  const preds: Array<(r: Row) => boolean> = [];
  const filters: string[] = [];
  const b: any = {
    select() { return b; },
    eq(c: string, v: any) { filters.push(`eq:${c}`); preds.push(r => (r as any)[c] === v); return b; },
    is(c: string, v: any) { filters.push(`is:${c}`); preds.push(r => (r as any)[c] === v); return b; },
    gte(c: string, v: string) {
      filters.push(`gte:${c}`);
      preds.push(r => Date.parse((r as any)[c]) >= Date.parse(v));
      return b;
    },
    then(resolve: any, reject: any) {
      const run = () => {
        if (failNext) {
          failNext = false;
          requests.push({ filters, rows: 0 });
          return { data: null, error: { message: 'network down' } };
        }
        const out = table.filter(r => preds.every(p => p(r))).map(r => structuredClone(r));
        requests.push({ filters, rows: out.length });
        return { data: out, error: null };
      };
      const p = latencyMs
        ? new Promise(res => setTimeout(() => res(run()), latencyMs))
        : Promise.resolve(run());
      return p.then(resolve, reject);
    },
  };
  return b;
}

vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  sb: () => ({ from: (t: string) => { if (t !== 'orders') throw new Error('unexpected table ' + t); return makeBuilder(); } }),
  isSupabaseConfigured: () => true,
}));

let authTenant: string | null = TENANT;
vi.mock('@/lib/authProvider', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  authTenantId: () => authTenant,
}));

const { setTenant } = await import('@/lib/tenant');
const store = await import('@/lib/store');
const sbStore = await import('@/lib/supabaseStore');

let clock = T0;
let seq = 0;

/** A server row, `ageMs` old relative to the test clock. */
function serverRow(over: Partial<Row> & { ageMs?: number; total?: number } = {}): Row {
  const n = ++seq;
  const ts = new Date(clock - (over.ageMs ?? 0)).toISOString();
  const total = over.total ?? 500 + n;
  const id = over.id ?? `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    id, tenant_id: over.tenant_id ?? TENANT, branch_id: null, order_number: n,
    status: over.status ?? 'running', total: 0, grand_total: total,
    data: { id, items: [{ id: 'i' + n, name: 'Zinger', qty: 1, price: total }], payments: [],
            grandTotal: total, status: over.status ?? 'running', orderNumber: n },
    created_at: ts, updated_at: ts,
    deleted_at: over.deleted_at ?? null, archived_at: over.archived_at ?? null,
  };
}

/** Change a server row the way the database does: `updated_at` moves forward. */
function touch(id: string, patch: { status?: string; total?: number; archive?: boolean; remove?: boolean }) {
  const r = table.find(x => x.id === id)!;
  if (patch.status) { r.status = patch.status; r.data.status = patch.status; }
  if (patch.total !== undefined) { r.grand_total = patch.total; r.data.grandTotal = patch.total; }
  if (patch.archive) r.archived_at = new Date(clock).toISOString();
  if (patch.remove) r.deleted_at = new Date(clock).toISOString();
  r.updated_at = new Date(clock).toISOString();
}

function seedDevice(localOrders: any[] = []) {
  localStorage.clear();
  localStorage.setItem('dtpos-auth-backend', 'supabase');
  localStorage.setItem('pos-tenant-id', TENANT);
  const base: any = { _tenantId: TENANT, settings: { name: 'First Chef' }, orderCounter: 1 };
  for (const k of ['orders','categories','menuItems','tables','floors','kitchens','waiters','riders','users','inventory','stockLogs','employees','attendance','leaves','payslips','advances','accountCategories','transactions','parties','ledger','dailyCashCloses','receivingEntries','marketingContacts','recipes','wastages','customers','branches','creditPayments','promoCodes','paymentAccounts','deals','shifts','refunds']) base[k] = [];
  base.orders = localOrders;
  localStorage.setItem(`desi-pos-data:${TENANT}`, JSON.stringify(base));
  setTenant(TENANT, 'First Chef');
  // store.ts keeps the parsed blob in memory. localStorage.clear() does not
  // touch it, so without this one test's bills leak into the next. This is the
  // event the app itself fires on a tenant switch.
  window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: TENANT } }));
}

const total = () => store.getOrders().reduce((s, o: any) => s + Number(o.grandTotal || 0), 0);
const snapshot = () => JSON.stringify(
  store.getOrders().map((o: any) => [o.id, o.status, o.grandTotal, o._updatedAt]).sort());
const isFull = (r: { filters: string[] }) => !r.filters.some(f => f.startsWith('gte:'));

beforeEach(() => {
  table = []; requests = []; failNext = false; latencyMs = 0; seq = 0; clock = T0;
  authTenant = TENANT;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  seedDevice();
});
afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
describe('sbLoadOrdersDelta — what goes over the wire', () => {
  it('the first read has no cursor, so it is a FULL read of every live order', async () => {
    table = [serverRow({ ageMs: 5000 }), serverRow({ ageMs: 4000 }), serverRow({ ageMs: 3000 })];
    const r = await sbStore.sbLoadOrdersDelta();
    expect(r.full).toBe(true);
    expect(r.rows).toHaveLength(3);
    expect(isFull(requests[0])).toBe(true);
  });

  it('the second read asks only for what moved, and gets only that', async () => {
    // 352 orders, one a minute apart — the shape of a real trading day.
    table = Array.from({ length: 352 }, (_, i) => serverRow({ ageMs: (352 - i) * 60_000 }));
    await sbStore.sbLoadOrdersDelta();

    clock += 10_000;
    touch(table[7].id, { status: 'paid' });
    touch(table[9].id, { total: 990 });

    const r = await sbStore.sbLoadOrdersDelta();
    expect(r.full).toBe(false);
    // The two rows that changed, plus the newest row from last time, which the
    // 30s overlap deliberately re-reads. 3 rows over the wire, not 352.
    expect(r.rows.map(x => x.id).sort()).toEqual([table[7].id, table[9].id, table[351].id].sort());
    expect(requests.at(-1)!.rows).toBe(3);
    expect(requests[0].rows).toBe(352);
  });

  it('keeps every filter the full read had — tenant, deleted, archived', async () => {
    table = [serverRow({ ageMs: 5000 })];
    await sbStore.sbLoadOrdersDelta();
    clock += 5000;
    await sbStore.sbLoadOrdersDelta();
    const delta = requests.at(-1)!.filters;
    expect(delta).toContain('eq:tenant_id');
    expect(delta).toContain('is:deleted_at');
    expect(delta).toContain('is:archived_at');
    expect(delta.some(f => f.startsWith('gte:updated_at'))).toBe(true);
  });

  it('never loads a closed day or a deleted bill back into the till', async () => {
    table = [serverRow({ ageMs: 9000 }), serverRow({ ageMs: 8000 })];
    await sbStore.sbLoadOrdersDelta();
    clock += 5000;
    touch(table[0].id, { archive: true });      // Day Close
    touch(table[1].id, { remove: true });       // deleted
    table.push(serverRow({ archived_at: new Date(clock).toISOString() }));
    const r = await sbStore.sbLoadOrdersDelta();
    expect(r.rows).toHaveLength(0);
  });

  it('never returns another restaurant\'s orders', async () => {
    const mine = serverRow({ ageMs: 5000 });
    const theirs = serverRow({ ageMs: 5000, tenant_id: OTHER_TENANT });
    table = [mine, theirs];
    expect((await sbStore.sbLoadOrdersDelta()).rows.map(x => x.id)).toEqual([mine.id]);
    clock += 5000;
    const theirsLater = serverRow({ tenant_id: OTHER_TENANT });
    table.push(theirsLater);
    const ids = (await sbStore.sbLoadOrdersDelta()).rows.map(x => x.id);
    expect(ids).not.toContain(theirs.id);
    expect(ids).not.toContain(theirsLater.id);
  });

  it('re-reads a short overlap, so a row committed late is not stepped over', async () => {
    table = [serverRow({ ageMs: 1000 })];
    await sbStore.sbLoadOrdersDelta();          // cursor = that row
    clock += 5000;
    // A long transaction commits a row stamped 10s BEFORE the newest one we saw.
    const late = serverRow({ ageMs: 11_000 });
    table.push(late);
    const r = await sbStore.sbLoadOrdersDelta();
    expect(r.rows.map(x => x.id)).toContain(late.id);
  });

  it('a failed read THROWS and does not move the cursor', async () => {
    table = [serverRow({ ageMs: 5000 })];
    await sbStore.sbLoadOrdersDelta();
    clock += 5000;
    touch(table[0].id, { status: 'paid' });
    failNext = true;
    await expect(sbStore.sbLoadOrdersDelta()).rejects.toBeTruthy();
    // The change was not lost: the next good read still delivers it.
    const r = await sbStore.sbLoadOrdersDelta();
    expect(r.rows.map(x => x.status)).toContain('paid');
  });

  it('a full read is taken again once the reconcile interval has passed', async () => {
    table = [serverRow({ ageMs: 5000 })];
    await sbStore.sbLoadOrdersDelta();
    clock += 60_000;
    expect((await sbStore.sbLoadOrdersDelta()).full).toBe(false);
    clock += 16 * 60_000;
    expect((await sbStore.sbLoadOrdersDelta()).full).toBe(true);
  });

  it('keeps one cursor per restaurant', async () => {
    table = [serverRow({ ageMs: 5000 })];
    await sbStore.sbLoadOrdersDelta();
    authTenant = OTHER_TENANT;
    const r = await sbStore.sbLoadOrdersDelta();
    expect(r.full).toBe(true);                   // the other tenant has no cursor yet
  });

  it('an archived-history read is always full and leaves the cursor alone', async () => {
    table = [serverRow({ ageMs: 5000 }), serverRow({ ageMs: 4000, archived_at: new Date(T0).toISOString() })];
    const r = await sbStore.sbLoadOrdersDelta({ includeArchived: true });
    expect(r.full).toBe(true);
    expect(r.rows).toHaveLength(2);
    // The cursor was not set, so the next ordinary read is still a full one.
    expect((await sbStore.sbLoadOrdersDelta()).full).toBe(true);
  });

  it('resetOrdersDeltaCursor makes the next read full', async () => {
    table = [serverRow({ ageMs: 5000 })];
    await sbStore.sbLoadOrdersDelta();
    sbStore.resetOrdersDeltaCursor(TENANT);
    expect((await sbStore.sbLoadOrdersDelta()).full).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('refreshOrdersFromCloud — the till shows the same bills and the same totals', () => {
  it('a device with no cached orders always takes a FULL read', async () => {
    table = [serverRow({ ageMs: 9000 }), serverRow({ ageMs: 8000 })];
    await sbStore.sbLoadOrdersDelta();           // a cursor exists…
    requests = [];
    seedDevice([]);                              // …but this device holds no rows
    await store.refreshOrdersFromCloud();
    expect(isFull(requests[0])).toBe(true);
    expect(store.getOrders()).toHaveLength(2);
  });

  it('a local bill newer than the server copy survives the overlap re-read', async () => {
    const row = serverRow({ ageMs: 1000, total: 500, status: 'running' });
    table = [row];
    // The till paid the bill a moment later; the server has not been told yet.
    seedDevice([{
      id: row.id, orderNumber: 1, status: 'paid', grandTotal: 500,
      items: row.data.items, payments: [{ method: 'cash', amount: 500 }],
      createdAt: row.created_at, _updatedAt: T0 + 2000,
    }]);
    // seedDevice() clears storage, so the cursor is set AFTER it: it now sits
    // on this row, exactly as it would after the till's previous refresh.
    await sbStore.sbLoadOrdersDelta();

    clock += 3000;
    requests = [];
    await store.refreshOrdersFromCloud();
    expect(isFull(requests[0])).toBe(false);     // a delta…
    expect(requests[0].rows).toBe(1);            // …that re-read the OLDER server copy
    const o: any = store.getOrders().find((x: any) => x.id === row.id);
    expect(o.status).toBe('paid');               // and did not undo the payment
    expect(o.payments).toHaveLength(1);
  });

  it('two callers in the same moment share ONE request and both get the orders', async () => {
    table = [serverRow({ ageMs: 5000 }), serverRow({ ageMs: 4000 })];
    latencyMs = 25;
    const [a, b] = await Promise.all([store.refreshOrdersFromCloud(), store.refreshOrdersFromCloud()]);
    expect(requests).toHaveLength(1);
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    // …and the guard releases: a later call makes its own request.
    await store.refreshOrdersFromCloud();
    expect(requests).toHaveLength(2);
  });

  it('a failed refresh keeps the cached bills and the guard still releases', async () => {
    table = [serverRow({ ageMs: 5000 })];
    await store.refreshOrdersFromCloud();
    failNext = true;
    await store.refreshOrdersFromCloud();
    expect(store.getOrders()).toHaveLength(1);
    await store.refreshOrdersFromCloud();        // not stuck on the rejected promise
    expect(requests.length).toBeGreaterThanOrEqual(3);
  });

  it('DELTA and FULL leave identical bills and identical totals at every step', async () => {
    // Deterministic script — no randomness, so a failure is reproducible.
    const script = (step: number) => {
      clock += 8000;
      if (step % 3 === 0) table.push(serverRow());                       // a new bill
      const live = table.filter(r => !r.archived_at && !r.deleted_at);
      if (step % 2 === 0 && live.length) touch(live[(step * 7) % live.length].id, { status: 'paid' });
      if (step % 4 === 1 && live.length) touch(live[(step * 5) % live.length].id, { total: 700 + step });
      if (step % 9 === 8 && live.length) touch(live[(step * 3) % live.length].id, { archive: true });
      if (step % 11 === 10 && live.length) touch(live[(step * 2) % live.length].id, { remove: true });
    };
    const seedServer = () => { seq = 0; clock = T0; table = Array.from({ length: 60 }, (_, i) => serverRow({ ageMs: 900_000 - i * 10 })); };

    const run = async (mode: 'delta' | 'full') => {
      seedServer(); requests = [];
      seedDevice();
      sbStore.resetOrdersDeltaCursor(TENANT);
      const trace: string[] = [];
      await store.refreshOrdersFromCloud();
      trace.push(snapshot() + '|' + total());
      for (let step = 1; step <= 40; step++) {
        script(step);
        if (mode === 'full') sbStore.resetOrdersDeltaCursor(TENANT);
        await store.refreshOrdersFromCloud();
        trace.push(snapshot() + '|' + total());
      }
      return { trace, rowsMoved: requests.reduce((s, r) => s + r.rows, 0) };
    };

    const full = await run('full');
    const delta = await run('delta');

    expect(delta.trace).toHaveLength(41);
    for (let i = 0; i < full.trace.length; i++) expect(delta.trace[i]).toBe(full.trace[i]);
    // …while moving a small fraction of the rows.
    expect(delta.rowsMoved).toBeLessThan(full.rowsMoved * 0.25);
  });
});
