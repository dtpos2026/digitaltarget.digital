// ============================================================================
// v1.28.4 — "⚠ Stuck (8)" on every restaurant except the first
//
// REPORTED: create a restaurant, log in, and the till header shows
// Pending 9 / Syncing (9) / ⚠ Stuck (8). Nothing ever syncs.
//
// FOUND, in the production Postgres log, eight at a time on every 20-second
// flush from the moment the restaurant was created:
//
//     new row violates row-level security policy (USING expression)
//     for table "account_categories"
//
// emptyRuntimeData() — documented by three separate callers as the EMPTY shape
// a cloud tenant starts from, because "cloud tenants must never see default
// data" — returned seedData(), which carries eight account categories with the
// fixed ids 'ac1'..'ac8' and a default admin user 'u-default-admin'.
//
// A fixed local id derives a FIXED cloud uuid: cloudId('ac1') hashes the id and
// nothing else, so every restaurant on the platform derived the same eight
// primary keys. The first restaurant to sync owned them. PostgREST upserts as
// INSERT ... ON CONFLICT (id) DO UPDATE, so restaurant number two was asking to
// update restaurant number one's row, and RLS refused — correctly. Six attempts
// each, then the dead-letter queue, then the badge.
//
// Nine queued: the eight categories plus the phantom admin. Eight stuck: the
// admin is not generically syncable, so its op no-ops instead of failing.
//
// What is asserted here is the whole repair: the client stops shipping shared
// row identities, the server creates real per-tenant defaults, and a till that
// is already carrying the failures forgets them.
// ============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedData } from '@/lib/seed-data';
import { stableUuid, cloudId } from '@/lib/supabaseStore';

const store = readFileSync(join(process.cwd(), 'src/lib/store.ts'), 'utf8');
const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260828100000_v1_28_4_tenant_default_accounts.sql'),
  'utf8',
);

describe('the collision that produced the badge', () => {
  it('the seed still ships the eight fixed ids that caused it', () => {
    // If this ever changes, the cleanup list below has to change with it.
    const ids = (seedData() as any).accountCategories.map((c: any) => c.id);
    expect(ids).toEqual(['ac1', 'ac2', 'ac3', 'ac4', 'ac5', 'ac6', 'ac7', 'ac8']);
    // v1.31.1 — the seeded admin is gone entirely, so it can no longer collide
    // with anything OR ship a password. See the dedicated case below.
    expect((seedData() as any).users).toEqual([]);
  });

  it('a fixed local id derives ONE uuid for every restaurant — the collision itself', () => {
    // Not a bug in stableUuid: it is deterministic on purpose, so a record
    // keeps one cloud key across devices. It only becomes a collision when two
    // restaurants carry the same local id, which is what the seed did.
    expect(stableUuid('ac1')).toBe(stableUuid('ac1'));
    expect(cloudId('ac1')).toBe('704aaf04-49b2-5687-9459-d086d062f371');
    // That is the exact row the live database holds for the FIRST restaurant.
  });
});

describe('a cloud tenant is no longer handed rows it cannot own', () => {
  it('emptyRuntimeData() empties every collection, as its callers claim', () => {
    expect(store).toContain('function emptyRuntimeData(): AppData {');
    const body = store.slice(store.indexOf('function emptyRuntimeData(): AppData {'));
    expect(body.slice(0, 600)).toContain('for (const k of ARRAY_COLLECTIONS) (data as any)[k] = [];');
  });

  it('the local-only path keeps its category defaults', () => {
    // Categories are harmless defaults with no other tenant to collide with.
    expect((seedData() as any).accountCategories).toHaveLength(8);
  });

  it('ships NO user, because the credential was the vulnerability', () => {
    // ===== v1.31.1 — this assertion used to be toHaveLength(1) =====
    //
    // It protected a default admin user whose password was written in plain
    // text in seed-data.ts, on the stated grounds that "a non-cloud install
    // needs the default admin login to be usable at all".
    //
    // That premise is not true. App.tsx renders MisconfiguredBuildScreen and
    // offers NO login whatsoever when cloudMode is false — its own comment
    // says "No login can succeed here, so offering one is a lie". So the
    // non-cloud install this row existed for cannot sign anyone in either way.
    //
    // What the row did do was ship a working credential: verified against the
    // live database, both restaurants' admin accounts opened with that exact
    // string, which is also public on GitHub. The expectation is inverted
    // deliberately.
    expect((seedData() as any).users).toHaveLength(0);
  });
});

describe('the defaults are created per restaurant instead', () => {
  it('each category gets its own uuid, never a derived one', () => {
    expect(migration).toContain('select gen_random_uuid(), _tenant_id, d.name, d.kind');
  });

  it('never seeds over a restaurant that already has categories', () => {
    expect(migration).toContain(
      'if exists (select 1 from public.account_categories where tenant_id = _tenant_id) then',
    );
  });

  it('sa_create_restaurant seeds them and returns the workspace code', () => {
    expect(migration).toContain('perform seed_default_account_categories(v_tenant);');
    expect(migration).toContain("'workspace_code', v_code");
  });

  it('the seeding function is not callable from the browser', () => {
    expect(migration).toContain(
      'revoke all on function public.seed_default_account_categories(uuid) from public, anon, authenticated;',
    );
  });
});

// ---------------------------------------------------------------------------
// The tills that are already stuck.
// ---------------------------------------------------------------------------
const disk: Record<string, any[]> = {};
vi.mock('@/lib/localDb', () => ({
  localDb: {
    writeAll: async (col: string, rows: any[]) => { disk[col] = JSON.parse(JSON.stringify(rows)); },
    getRows: async (col: string) => disk[col] ?? [],
    putRow: async (col: string, row: any) => { (disk[col] ??= []).push(row); },
    deleteRow: async (col: string, id: string) => {
      disk[col] = (disk[col] ?? []).filter(r => r.id !== id);
    },
    readQueue: async () => [],
    clearQueue: async () => {},
  },
}));
vi.mock('@/lib/tenant', () => ({ getTenantId: () => 'tenant-1', getDeviceId: () => 'device-1' }));

const sync = await import('@/lib/deferredSync');
const { cleanupShippedSeedRows, isUntouchedSeedRow } = await import('@/lib/seedRowCleanup');

beforeEach(async () => {
  sync.registerDeferredBatchFlusher(null);
  sync.registerDeferredFlusher(async () => {});
  await sync.discardDeferredOpsFor('accountCategories', ['ac1','ac2','ac3','ac4','ac5','ac6','ac7','ac8']);
  await sync.discardDeferredOpsFor('users', ['u-default-admin']);
  for (const k of Object.keys(disk)) delete disk[k];
  localStorage.clear();
});

describe('a till that is already carrying the failures', () => {
  function seededCache() {
    const d = seedData() as any;
    // ...plus one category the restaurant actually created.
    d.accountCategories.push({ id: 'own-1', name: 'Delivery Fees', type: 'expense' });
    return d;
  }

  it('drops the shipped rows and forgets their queued and dead-lettered ops', async () => {
    const data = seededCache();
    for (const c of data.accountCategories) sync.enqueueDeferredOp('accountCategories', c.id, 'set');
    // Four of them had already exhausted their retries and been parked.
    disk.deferredOpsDeadLetter = ['ac1', 'ac2', 'ac3', 'ac4'].map(id => ({
      id: `accountCategories::${id}`, col: 'accountCategories', entityId: id, op: 'set',
      at: 1, firstEnqueuedAt: 1, deviceId: 'd', attempts: 6,
      lastError: 'new row violates row-level security policy (USING expression) for table "account_categories"',
    }));

    const res = await cleanupShippedSeedRows(data, 'tenant-1');

    expect(res).not.toBeNull();
    expect(res!.removed.accountCategories).toEqual(['ac1','ac2','ac3','ac4','ac5','ac6','ac7','ac8']);
    // 8 queued + 4 parked.
    expect(res!.opsDropped).toBe(12);
    expect(disk.deferredOpsDeadLetter).toHaveLength(0);
    // The restaurant's own category keeps its place in the queue.
    expect(sync.deferredPendingCount()).toBe(1);
    expect(sync.getDeferredOps()[0].entityId).toBe('own-1');
  });

  it("never touches a category the restaurant created", async () => {
    const data = seededCache();
    await cleanupShippedSeedRows(data, 'tenant-1');
    expect(data.accountCategories).toEqual([{ id: 'own-1', name: 'Delivery Fees', type: 'expense' }]);
  });

  it('leaves a renamed default alone — it is the restaurant’s data now', () => {
    expect(isUntouchedSeedRow('accountCategories', { id: 'ac3', name: 'Rent' })).toBe(true);
    expect(isUntouchedSeedRow('accountCategories', { id: 'ac3', name: 'Shop Rent' })).toBe(false);
  });

  it('runs once per restaurant, not on every boot', async () => {
    const first = await cleanupShippedSeedRows(seededCache(), 'tenant-1');
    expect(first).not.toBeNull();
    const second = await cleanupShippedSeedRows(seededCache(), 'tenant-1');
    expect(second).toBeNull();
    // A different restaurant on the same device still gets cleaned.
    expect(await cleanupShippedSeedRows(seededCache(), 'tenant-2')).not.toBeNull();
  });

  it('still clears the parked ops when the cache has already been lost', async () => {
    disk.deferredOpsDeadLetter = ['ac1', 'ac2'].map(id => ({
      id: `accountCategories::${id}`, col: 'accountCategories', entityId: id, op: 'set',
      at: 1, firstEnqueuedAt: 1, deviceId: 'd', attempts: 6,
    }));
    const res = await cleanupShippedSeedRows({ accountCategories: [], users: [] }, 'tenant-1');
    expect(res!.opsDropped).toBe(2);
  });

  it('the store runs it before the first cloud refresh', () => {
    expect(store).toContain("await import('./seedRowCleanup')");
    // Called with {} rather than skipped when there is no local cache: the
    // parked ops live in IndexedDB and outlive the cache.
    expect(store).toContain('cleanupShippedSeedRows(cachedData ?? {}, getTenantId())');
    // Before the branch that returns early into the background refresh.
    expect(store.indexOf('cleanupShippedSeedRows(cachedData ?? {}, getTenantId())'))
      .toBeLessThan(store.indexOf('refreshCloudStoreInBackground();\n      return;'));
  });
});
