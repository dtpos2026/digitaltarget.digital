// ============================================================================
// v1.26.0 — the module mirror, exercised
//
// promotions, item variations, customer wallet, campaigns, delivery zones,
// daily wages and the blocked-customer list are mirrored into
// public.module_documents. The mirror had three independent ways to lose a
// record, and all three were silent. These drive the real functions.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TENANT = '22222222-2222-2222-2222-222222222222';
let serverRows: any[] = [];
const upserted: any[][] = [];
let upsertFails = false;

vi.mock('@/lib/supabase', async () => ({
  isSupabaseConfigured: () => true,
  currentTenantId: () => TENANT,
  currentBranchId: () => null,
  sb: () => ({
    from: () => ({
      select: () => ({ eq: async () => ({ data: serverRows, error: null }) }),
      upsert: async (rows: any[]) => {
        if (upsertFails) return { error: { message: 'offline' } };
        upserted.push(rows);
        return { error: null };
      },
    }),
  }),
}));

const docs = await import('@/lib/cloudDocs');

const KEY = 'dt-promotions';
const SNAP = `dt-cloud-docs-snap:${KEY}`;
const LOCALAT = `dt-cloud-docs-localat:${KEY}`;
const RETRY = 'dt-cloud-docs-retry';

const local = () => JSON.parse(localStorage.getItem(KEY) || '[]');
const snap = () => JSON.parse(localStorage.getItem(SNAP) || '{}');

beforeEach(() => {
  localStorage.clear();
  serverRows = []; upserted.length = 0; upsertFails = false;
});

describe('a record whose upload failed is not marked as synced', () => {
  it('re-offers it instead of banking its signature', async () => {
    // THE BUG: hydrate rebuilt the signature snapshot from the MERGED list, so
    // a record the server had never accepted was recorded as in sync.
    // mirrorList() then saw it as unchanged and never offered it again — the
    // record was stranded on one device, permanently and invisibly.
    upsertFails = true;
    localStorage.setItem(KEY, JSON.stringify([{ id: 'p1', label: 'Never Uploaded' }]));
    docs.mirrorList(KEY, local());
    await Promise.resolve();

    serverRows = [];                       // server genuinely does not have it
    upsertFails = false;
    await docs.hydrateCloudDocs();

    expect(local()).toHaveLength(1);       // still here
    expect(snap()['p1']).toBeUndefined();  // NOT claimed as synced
    // and it was actually uploaded this time
    expect(upserted.flat().some(r => r.doc_id === 'p1')).toBe(true);
  });

  it('does bank the signature for a record the server confirmed', async () => {
    serverRows = [{ kind: KEY, doc_id: 'p2', data: { id: 'p2', label: 'Confirmed' },
                    deleted_at: null, updated_at: new Date(5000).toISOString() }];
    await docs.hydrateCloudDocs();
    expect(snap()['p2']).toBeDefined();
  });
});

describe('conflicts are resolved by time, not by "the cloud is always right"', () => {
  it('keeps a local edit that is newer than the server copy', async () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: 'p3', label: 'Edited Offline' }]));
    docs.mirrorList(KEY, local());                       // records the local change time
    serverRows = [{ kind: KEY, doc_id: 'p3', data: { id: 'p3', label: 'Old Server Copy' },
                    deleted_at: null, updated_at: new Date(1000).toISOString() }];
    await docs.hydrateCloudDocs();
    expect(local()[0].label).toBe('Edited Offline');
  });

  it('takes the server copy when it is the newer one', async () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: 'p4', label: 'Stale Local' }]));
    localStorage.setItem(LOCALAT, JSON.stringify({ p4: 1000 }));
    serverRows = [{ kind: KEY, doc_id: 'p4', data: { id: 'p4', label: 'Newer From Device B' },
                    deleted_at: null, updated_at: new Date(9_000_000).toISOString() }];
    await docs.hydrateCloudDocs();
    expect(local()[0].label).toBe('Newer From Device B');
  });

  it('applies a tombstone from another device', async () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: 'p5', label: 'Deleted On Device B' }]));
    localStorage.setItem(LOCALAT, JSON.stringify({ p5: 1000 }));
    serverRows = [{ kind: KEY, doc_id: 'p5', data: {},
                    deleted_at: new Date(9_000_000).toISOString(),
                    updated_at: new Date(9_000_000).toISOString() }];
    await docs.hydrateCloudDocs();
    expect(local()).toHaveLength(0);
  });

  it('a newer local edit outranks an older tombstone', async () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: 'p6', label: 'Re-added Here' }]));
    localStorage.setItem(LOCALAT, JSON.stringify({ p6: 9_000_000 }));
    serverRows = [{ kind: KEY, doc_id: 'p6', data: {},
                    deleted_at: new Date(1000).toISOString(),
                    updated_at: new Date(1000).toISOString() }];
    await docs.hydrateCloudDocs();
    expect(local()).toHaveLength(1);
  });
});

describe('the retry buffer is not emptied before the push lands', () => {
  it('keeps the batch when the push fails', async () => {
    upsertFails = true;
    localStorage.setItem(KEY, JSON.stringify([{ id: 'p7' }]));
    docs.mirrorList(KEY, local());
    await Promise.resolve(); await Promise.resolve();
    expect(JSON.parse(localStorage.getItem(RETRY) || '[]')).toHaveLength(1);

    await docs.flushCloudDocs();           // still offline
    expect(JSON.parse(localStorage.getItem(RETRY) || '[]')).toHaveLength(1);

    upsertFails = false;
    await docs.flushCloudDocs();           // back online
    expect(JSON.parse(localStorage.getItem(RETRY) || '[]')).toHaveLength(0);
    expect(upserted.flat().some(r => r.doc_id === 'p7')).toBe(true);
  });
});
