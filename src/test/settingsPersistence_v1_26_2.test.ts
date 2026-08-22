// ============================================================================
// v1.26.2 — "my restaurant name and logo disappear after refresh"
//
// THE REPORT: Admin Panel settings save correctly and show correctly, then a
// browser refresh reverts them.
//
// THE CAUSE, in two parts, both in refreshCloudStoreInBackground():
//
//  1. cloudLoadAll() starts from emptyRuntimeData(), whose `settings` is the
//     DEFAULTS. sbLoadSettings() returns null both when the tenant genuinely
//     has no settings row AND when the read merely FAILED — offline, a
//     timeout, a cold start. The code could not tell those apart, so a failed
//     read installed default settings over a good saved copy and then wrote
//     that to localStorage. The real values sat safe in the database the whole
//     time, which is why it looked so arbitrary.
//
//  2. The merge loop ran over CRITICAL_COLLECTIONS only — twelve of the
//     thirty-three. Every other collection (orders, transactions, ledger, day
//     closes, attendance, refunds, ...) kept emptyRuntimeData()'s []. Online
//     that self-corrects a moment later; offline it does not, so a refresh
//     with no connection emptied every bill on the device.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Faithful to the real thing: sbLoadAll() catches per collection and OMITS the
// ones that failed, so with no connection it resolves to {} rather than
// throwing. That empty object is precisely the input that used to be read as
// "the restaurant has nothing".
const sbLoadAll = vi.fn(async () => ({}) as any);
const sbLoadSettings = vi.fn(async () => null as any);

vi.mock('@/lib/supabaseStore', () => ({
  sbLoadAll: (...a: any[]) => sbLoadAll(...(a as [])),
  sbLoadSettings: (...a: any[]) => sbLoadSettings(...(a as [])),
  sbLoadCollection: async () => { throw new Error('offline'); },
  sbSaveItem: async () => {}, sbDeleteItem: async () => {}, sbSaveSettings: async () => {},
  TABLE_FOR: { orders: 'orders', menuItems: 'menu_items', categories: 'categories' },
}));

const { setTenant } = await import('@/lib/tenant');
const store = await import('@/lib/store');

const TENANT = '44444444-4444-4444-4444-444444444444';
const SAVED_SETTINGS = {
  name: 'Karachi Biryani House',
  logo: 'https://example.com/logo.png',
  currencyCode: 'PKR',
  taxPercent: 16,
  _updatedAt: 1_700_000_000_000,
};

function seedDevice() {
  localStorage.clear();
  localStorage.setItem('dtpos-auth-backend', 'supabase');
  localStorage.setItem('pos-tenant-id', TENANT);
  const base: any = { _tenantId: TENANT, settings: SAVED_SETTINGS, orderCounter: 7 };
  for (const k of ['orders','categories','menuItems','tables','floors','kitchens','waiters','riders','users','inventory','stockLogs','employees','attendance','leaves','payslips','advances','accountCategories','transactions','parties','ledger','dailyCashCloses','receivingEntries','marketingContacts','recipes','wastages','customers','branches','creditPayments','promoCodes','paymentAccounts','deals','shifts','refunds']) base[k] = [];
  base.menuItems = [{ id: 'm1', name: 'Chicken Biryani', price: 450, _updatedAt: 1 }];
  base.orders = [
    { id: 'o1', orderNumber: 41, status: 'paid', grandTotal: 450, items: [], payments: [], createdAt: new Date().toISOString(), _updatedAt: 1 },
    { id: 'o2', orderNumber: 42, status: 'paid', grandTotal: 900, items: [], payments: [], createdAt: new Date().toISOString(), _updatedAt: 1 },
  ];
  base.transactions = [{ id: 't1', amount: 500, _updatedAt: 1 }];
  // The cache is tenant-scoped: `desi-pos-data:<tenantId>`.
  localStorage.setItem(`desi-pos-data:${TENANT}`, JSON.stringify(base));
  setTenant(TENANT, 'Karachi Biryani House');
}

/** initStore kicks the refresh off without awaiting it. */
const settle = () => new Promise(r => setTimeout(r, 400));

beforeEach(() => {
  seedDevice();
  sbLoadAll.mockReset(); sbLoadSettings.mockReset();
  sbLoadAll.mockResolvedValue({} as any);
  sbLoadSettings.mockResolvedValue(null as any);
});

describe('a refresh with no connection keeps what the device already had', () => {
  it('keeps the restaurant name and logo', async () => {
    await store.initStore();
    await settle();
    const s = store.getSettings();
    expect(s.name).toBe('Karachi Biryani House');
    expect((s as any).logo).toBe('https://example.com/logo.png');
    expect((s as any).taxPercent).toBe(16);
  });

  it('does not write defaults over the saved settings in localStorage', async () => {
    await store.initStore();
    await settle();
    const persisted = JSON.parse(localStorage.getItem(`desi-pos-data:${TENANT}`) || '{}');
    expect(persisted.settings?.name).toBe('Karachi Biryani House');
  });

  it('keeps the bills — the collections the merge never used to look at', async () => {
    await store.initStore();
    await settle();
    expect(store.getOrders()).toHaveLength(2);
    expect(store.getOrders().map(o => o.orderNumber).sort()).toEqual([41, 42]);
  });

  it('keeps the menu', async () => {
    await store.initStore();
    await settle();
    expect(store.getMenuItems()).toHaveLength(1);
  });

  it('keeps everything when the whole load throws, too', async () => {
    // A different failure mode: not "every collection failed" but "the call
    // itself blew up". The refresh must be skipped, not applied with nothing.
    sbLoadAll.mockRejectedValue(new Error('boom'));
    await store.initStore();
    await settle();
    expect(store.getSettings().name).toBe('Karachi Biryani House');
    expect(store.getOrders()).toHaveLength(2);
  });

  it('survives repeated refreshes rather than degrading', async () => {
    // The original bug compounded: each reload persisted the emptied snapshot,
    // so the next reload started from less than the one before.
    for (let i = 0; i < 3; i++) { await store.initStore(); await settle(); }
    expect(store.getSettings().name).toBe('Karachi Biryani House');
    expect(store.getOrders()).toHaveLength(2);
  });
});

describe('settings saved BEFORE this release, which carry no version', () => {
  // This is every device already in the field. v1.26.0 made saves stamp
  // `_updatedAt`, but a device that has not saved since upgrading has settings
  // with no stamp at all — so the newer-wins comparison reads 0 against the
  // defaults' 0, local does NOT win, and the defaults are installed.
  //
  // Timestamps cannot rescue this case; only knowing that the read never
  // happened can.
  function seedUnstamped() {
    seedDevice();
    const key = `desi-pos-data:${TENANT}`;
    const d = JSON.parse(localStorage.getItem(key)!);
    delete d.settings._updatedAt;
    localStorage.setItem(key, JSON.stringify(d));
  }

  it('keeps an unstamped restaurant name when the read fails', async () => {
    seedUnstamped();
    await store.initStore();
    await settle();
    expect(store.getSettings().name).toBe('Karachi Biryani House');
  });

  it('keeps an unstamped logo when the read fails', async () => {
    seedUnstamped();
    await store.initStore();
    await settle();
    expect((store.getSettings() as any).logo).toBe('https://example.com/logo.png');
  });

  it('still adopts a real server row over an unstamped local copy', async () => {
    seedUnstamped();
    sbLoadSettings.mockResolvedValue({
      name: 'From The Database', currencyCode: 'PKR', _updatedAt: 5,
    } as any);
    await store.initStore();
    await settle();
    expect(store.getSettings().name).toBe('From The Database');
  });
});

describe('a settings row that genuinely loads is still applied', () => {
  it('takes the server copy when it is newer', async () => {
    sbLoadSettings.mockResolvedValue({
      name: 'Renamed On Another Device', currencyCode: 'PKR', _updatedAt: 1_900_000_000_000,
    } as any);
    await store.initStore();
    await settle();
    expect(store.getSettings().name).toBe('Renamed On Another Device');
  });

  it('keeps a newer local edit that has not uploaded yet', async () => {
    sbLoadSettings.mockResolvedValue({
      name: 'Older Server Copy', currencyCode: 'PKR', _updatedAt: 1,
    } as any);
    await store.initStore();
    await settle();
    expect(store.getSettings().name).toBe('Karachi Biryani House');
  });
});
