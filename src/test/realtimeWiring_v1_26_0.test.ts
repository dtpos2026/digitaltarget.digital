// ============================================================================
// v1.26.0 — realtime wiring, exercised rather than described
//
// The subscription list was the whole bug: the client asked for change events
// on the collections in TABLE_FOR and nothing else, so tenant_settings
// (branding, logo, restaurant name) and module_documents (waiters, riders,
// promotions, wallet, delivery zones, daily wages, the blocked-customer list)
// were never listened to at all. No amount of correct merging helps a device
// that is never told anything changed.
//
// These tests drive the real startSupabaseRealtime() against a fake client and
// assert on what it actually subscribes to and what each event triggers.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TENANT = '11111111-1111-1111-1111-111111111111';

interface Sub { table: string; filter: string; cb: (p: any) => void }
const subs: Sub[] = [];
let subscribed = false;

const channel = {
  on(_evt: string, cfg: any, cb: (p: any) => void) {
    subs.push({ table: cfg.table, filter: cfg.filter, cb });
    return channel;
  },
  subscribe() { subscribed = true; return channel; },
  unsubscribe() { subscribed = false; },
};

vi.mock('@/lib/supabase', async () => ({
  sb: () => ({ channel: () => channel, removeChannel: () => {} }),
  currentTenantId: () => TENANT,
  currentBranchId: () => null,
  isSupabaseConfigured: () => true,
}));

const loadSettings = vi.fn<any>(async () => ({ name: 'From Device A', _updatedAt: 9_000_000 }));
const loadCollection = vi.fn<any>(async () => []);

vi.mock('@/lib/supabaseStore', async () => ({
  TABLE_FOR: { menuItems: 'menu_items', categories: 'categories', orders: 'orders',
               waiters: 'user_profiles', riders: 'user_profiles' },
  sbLoadSettings: (...a: any[]) => loadSettings(...(a as [])),
  sbLoadCollection: (...a: any[]) => loadCollection(...(a as [])),
}));

const hydrateCloudDocs = vi.fn(async () => {});
vi.mock('@/lib/cloudDocs', async () => ({
  hydrateCloudDocs, installCloudDocs: () => {}, mirrorList: () => {}, mirrorValue: () => {},
  flushCloudDocs: async () => {}, MIRRORED_KEYS: [], MIRRORED_VALUE_KEYS: [],
}));

const store = await import('@/lib/store');

const tableOf = (t: string) => subs.filter(s => s.table === t);
const fire = (t: string) => tableOf(t).forEach(s => s.cb({ eventType: 'UPDATE' }));
/** The channel debounces reloads by 400ms. */
const settle = () => new Promise(r => setTimeout(r, 700));

beforeEach(() => {
  subs.length = 0;
  loadSettings.mockReset(); loadCollection.mockReset(); hydrateCloudDocs.mockClear();
  loadSettings.mockResolvedValue({ name: 'From Device A', _updatedAt: 9_000_000 } as any);
  loadCollection.mockResolvedValue([] as any);
  localStorage.clear();
  localStorage.setItem('desi-pos-data', JSON.stringify({
    orders: [], menuItems: [], categories: [], tables: [], settings: { name: 'Local' },
  }));
  store.startSupabaseRealtime();
});

describe('what the POS actually subscribes to', () => {
  it('subscribes at all', async () => {
    await settle();
    expect(subscribed).toBe(true);
  });

  it('listens to tenant_settings — branding, logo, restaurant name', async () => {
    await settle();
    expect(tableOf('tenant_settings')).toHaveLength(1);
  });

  it('listens to module_documents — waiters, riders and the mirrored modules', async () => {
    await settle();
    expect(tableOf('module_documents')).toHaveLength(1);
  });

  it('scopes every subscription to this tenant', async () => {
    await settle();
    expect(subs.length).toBeGreaterThan(0);
    for (const s of subs) expect(s.filter).toBe(`tenant_id=eq.${TENANT}`);
  });

  it('does not listen to user_profiles, which has its own staff path', async () => {
    await settle();
    expect(tableOf('user_profiles')).toHaveLength(0);
  });
});

describe('what an event does', () => {
  it('a settings change on another device is pulled and applied', async () => {
    await settle();
    fire('tenant_settings');
    await settle();
    expect(loadSettings).toHaveBeenCalled();
    // The remote copy is newer than the local one, so it wins.
    expect(store.getSettings().name).toBe('From Device A');
  });

  it('a NEWER local settings edit is not clobbered by an older server copy', async () => {
    // Device A edits the logo offline. The server still holds yesterday's copy.
    // Pulling it must not undo the edit that has not uploaded yet — which is
    // exactly what happened before settings carried a version at all.
    await settle();
    store.saveSettings({ ...store.getSettings(), name: 'Edited Offline' } as any);
    expect(Number((store.getSettings() as any)._updatedAt)).toBeGreaterThan(0);

    loadSettings.mockResolvedValue({ name: 'Stale Server Copy', _updatedAt: 1 } as any);
    fire('tenant_settings');
    await settle();
    expect(store.getSettings().name).toBe('Edited Offline');
  });

  it('a module_documents change re-hydrates the mirrored modules', async () => {
    await settle();
    fire('module_documents');
    await settle();
    expect(hydrateCloudDocs).toHaveBeenCalled();
  });

  it('a menu change asks for the collection WITH its tombstones', async () => {
    // Without includeDeleted the merge sees a deleted item as merely absent,
    // cannot tell that from "not pushed yet", and resurrects it.
    await settle();
    fire('menu_items');
    await settle();
    expect(loadCollection).toHaveBeenCalledWith('menuItems', { includeDeleted: true });
  });
});
