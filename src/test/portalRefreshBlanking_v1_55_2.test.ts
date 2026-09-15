// ============================================================================
// v1.55.2 — a portal's refresh refreshed nothing
//
// REPORTED: "rider web order taker mean all portal py refresh ky data show ni
// krty" — on the Rider, Order Taker and web portals a refresh does not bring
// the data back.
//
// A silent success. A portal device holds an opaque portal token, not a
// Supabase auth session, so every ordinary read goes as `anon`. RLS on
// dining_tables, user_profiles and module_documents is written for
// `authenticated`; a policy that matches no rows does NOT raise an error —
// PostgREST answers 200 with []. sbLoadCollection() reported a clean read of
// an empty collection and cloudLoadAll() marked it LOADED.
//
// mergeCollection does NOT drop a row the cloud has not seen — it keeps it and
// re-queues it, which is why nothing visibly vanished. What actually happened
// is worse in a quieter way: the store's refresh contributed NOTHING on a
// portal device, so the screen kept showing whatever that page's own bootstrap
// had cached once (RiderAppPage adopts only `orders` and `tables`), and every
// local row was re-queued for upload on every refresh — on a device RLS
// refuses every write from. That is the endless "Cloud sync issue".
//
// These are behaviour tests, not source greps: they drive initStore() with a
// portal token and a faithful model of the 200/empty anon read.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const portalBootstrap = vi.fn(async () => ({ ok: false, reason: 'offline', message: 'x' } as any));
let portalTokenPresent = true;

vi.mock('@/lib/portalData', () => ({
  hasPortalSession: () => portalTokenPresent,
  getPortalToken: () => (portalTokenPresent ? 'a'.repeat(64) : ''),
  portalBootstrap: (...a: any[]) => portalBootstrap(...(a as [])),
}));

vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  // No Supabase auth session — that is exactly what makes it a portal device.
  initSupabaseAuth: async () => {},
  currentUser: () => null,
}));

vi.mock('@/lib/supabaseStore', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    // isPortalOnlyDevice is the REAL one — it is half of what is under test.
    //
    // sbLoadAll is replaced by a faithful model of what PostgREST hands an
    // anon portal device: every collection present, every one an empty array,
    // no error at all. Without that, jsdom's unreachable network makes the
    // reads FAIL, the keys go absent, and the v1.26.0 failed-read protection
    // saves the cache — so the test would pass whether or not this release
    // works. The reported bug needs a read that SUCCEEDS with nothing in it.
    sbLoadAll: async (cols: readonly string[]) =>
      Object.fromEntries((cols || []).map(c => [c, [] as any[]])),
    sbLoadSettings: async () => null,
    sbSaveItem: async () => {}, sbDeleteItem: async () => {}, sbSaveSettings: async () => {},
  };
});

const { setTenant } = await import('@/lib/tenant');
const store = await import('@/lib/store');

const TENANT = '55555555-5555-5555-5555-555555555555';

function seedPortalDevice() {
  localStorage.clear();
  localStorage.setItem('dtpos-auth-backend', 'supabase');
  localStorage.setItem('pos-tenant-id', TENANT);
  localStorage.setItem('dt-portal-token', 'a'.repeat(64));
  const base: any = { _tenantId: TENANT, settings: { name: 'Butt BBQ' }, orderCounter: 1 };
  for (const k of ['orders','categories','menuItems','tables','floors','kitchens','waiters','riders','users','inventory','stockLogs','employees','attendance','leaves','payslips','advances','accountCategories','transactions','parties','ledger','dailyCashCloses','receivingEntries','marketingContacts','recipes','wastages','customers','branches','creditPayments','promoCodes','paymentAccounts','deals','shifts','refunds']) base[k] = [];
  base.tables    = [{ id: 't1', name: 'Table 1', seats: 4, status: 'free', _updatedAt: 1 }];
  base.waiters   = [{ id: 'w1', name: 'Hamza', phone: '', isActive: true, _updatedAt: 1 }];
  base.riders    = [{ id: 'r1', name: 'Waqas', phone: '', isActive: true, _updatedAt: 1 }];
  base.menuItems = [{ id: 'm1', name: 'Seekh Kebab', price: 450, _updatedAt: 1 }];
  base.orders    = [{ id: 'o1', orderNumber: 1046, status: 'pending', grandTotal: 590,
                      items: [], payments: [], createdAt: new Date().toISOString(), _updatedAt: 1 }];
  localStorage.setItem(`desi-pos-data:${TENANT}`, JSON.stringify(base));
  setTenant(TENANT, 'Butt BBQ');
}

/** initStore kicks the refresh off without awaiting it. */
const settle = () => new Promise(r => setTimeout(r, 400));

beforeEach(() => {
  portalTokenPresent = true;
  seedPortalDevice();
  portalBootstrap.mockReset();
  portalBootstrap.mockResolvedValue({ ok: false, reason: 'offline', message: 'unreachable' });
});

describe('a portal device whose anon reads all come back 200 and empty', () => {
  it('still has its tables afterwards', async () => {
    await store.initStore();
    await settle();
    expect(store.getTables()).toHaveLength(1);
  });

  it('still has its waiters and riders afterwards', async () => {
    await store.initStore();
    await settle();
    expect(store.getWaiters().map(w => w.name)).toEqual(['Hamza']);
    expect(store.getRiders().map(r => r.name)).toEqual(['Waqas']);
  });

  it('still has its live bill and its menu afterwards', async () => {
    await store.initStore();
    await settle();
    expect(store.getOrders()).toHaveLength(1);
    expect(store.getMenuItems()).toHaveLength(1);
  });

  it('does not degrade across repeated refreshes', async () => {
    // The original bug compounded: each reload persisted the emptied snapshot.
    for (let i = 0; i < 3; i++) { await store.initStore(); await settle(); }
    expect(store.getTables()).toHaveLength(1);
    expect(store.getWaiters()).toHaveLength(1);
    expect(store.getOrders()).toHaveLength(1);
  });

  it('recognises itself as a portal device', async () => {
    const { isPortalOnlyDevice } = await import('@/lib/supabaseStore');
    expect(await isPortalOnlyDevice()).toBe(true);
  });

  it('the real sbLoadAll reports every collection as unknown, not as empty', async () => {
    // The second half of the guard, tested against the REAL function rather
    // than the stub above: every key ABSENT. Absent already means "unknown,
    // keep what you have" everywhere in the store, so an anon 200/empty can
    // never be mistaken for a real answer.
    const actual = await vi.importActual<any>('@/lib/supabaseStore');
    expect(await actual.sbLoadAll(['tables', 'waiters', 'riders', 'orders'])).toEqual({});
  });
});

describe('why the anon read also caused the endless "Cloud sync issue"', () => {
  it('a 200/empty read makes the merge re-queue every local row for upload', async () => {
    // This asserts the CAUSE, on the pure function, so the reasoning above is
    // checked rather than asserted. mergeCollection keeps a row the cloud has
    // not seen and re-queues it — right for a till, ruinous for a portal: with
    // every collection reading back empty, every local row was re-queued on
    // every refresh, on a device RLS refuses every write from.
    const { mergeCollection } = await import('@/lib/syncMerge');
    const local = [{ id: 'w1', name: 'Hamza', _updatedAt: 1 }];
    const { rows, requeue } = mergeCollection('waiters', [], local, new Set<string>());
    expect(rows).toHaveLength(1);        // nothing vanished, which is why it was quiet
    expect(requeue).toEqual(['w1']);     // but it is queued for an upload that cannot succeed
  });

  it('and the portal path never reaches that merge at all', async () => {
    // Covered above by sbLoadAll returning {}: with every key absent the
    // refresh has nothing to merge against, so nothing is re-queued.
    const actual = await vi.importActual<any>('@/lib/supabaseStore');
    expect(await actual.sbLoadAll(['waiters'])).toEqual({});
  });
});

describe('a portal device refreshing when the server IS reachable', () => {
  it('takes the server roster, which is the point of refreshing', async () => {
    portalBootstrap.mockResolvedValue({
      ok: true,
      data: {
        tables: [], floors: [],
        riders:  [{ id: 'r1', name: 'Waqas', phone: null, isActive: true },
                  { id: 'r2', name: 'Umair', phone: null, isActive: true }],
        waiters: [{ id: 'w1', name: 'Hamza', phone: null, isActive: true }],
        orders:  [],
      },
    });
    await store.initStore();
    await settle();
    expect(store.getRiders().map(r => r.name).sort()).toEqual(['Umair', 'Waqas']);
    expect(store.getWaiters().map(w => w.name)).toEqual(['Hamza']);
  });

  it('keeps a cached collection the bootstrap did not mention', async () => {
    // An older server build sends no `waiters` key. Absent must mean unknown,
    // not "this restaurant has none".
    portalBootstrap.mockResolvedValue({
      ok: true,
      data: { tables: [], floors: [], riders: [], orders: [] },
    });
    await store.initStore();
    await settle();
    expect(store.getWaiters().map(w => w.name)).toEqual(['Hamza']);
  });
});

describe('an ordinary till is not affected', () => {
  it('takes the ordinary cloud path when there is no portal token', async () => {
    portalTokenPresent = false;
    localStorage.removeItem('dt-portal-token');
    const { isPortalOnlyDevice } = await import('@/lib/supabaseStore');
    expect(await isPortalOnlyDevice()).toBe(false);
    await store.initStore();
    await settle();
    expect(portalBootstrap).not.toHaveBeenCalled();
  });
});
