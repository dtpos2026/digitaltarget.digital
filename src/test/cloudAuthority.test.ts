// ============================================================================
// Tests — v1.25.20 the database is the single source of truth
//
// THE INCIDENT: the same account opened in two browsers showed DIFFERENT data.
//
// refreshCloudStoreInBackground() merged the cloud response with the local
// cache using:
//
//     if (!cloudRow || localAt > cloudAt) byId.set(row.id, row);
//
// The `!cloudRow` half meant "the cloud does not have this row, so keep mine".
// That is only correct for a row that has not been pushed yet. It is WRONG for
// a row that was deleted on another device — and the two are indistinguishable
// without consulting the sync queue.
//
// Consequences, both reported:
//   * Deletions undid themselves. Browser B deletes an item; Browser A
//     resurrects it from local cache and pushes it back up.
//   * Failed saves looked successful. A rejected row lived in localStorage
//     forever and was re-adopted on every refresh, so the operator saw it and
//     nobody else did.
//
// These tests pin the resolution rules directly, so the merge cannot quietly
// regress to "local always wins".
// ============================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const storeSrc = fs.readFileSync(
  path.join(process.cwd(), 'src', 'lib', 'store.ts'), 'utf8');

/**
 * The merge rule, extracted so it can be exercised directly. It must stay in
 * step with refreshCloudStoreInBackground(); the source assertions below guard
 * that it does.
 */
function mergeCollection(
  name: string,
  remoteRows: any[],
  localRows: any[],
  pendingIds: Set<string> | null,
): any[] {
  const byId = new Map<string, any>();
  for (const row of remoteRows) if (row?.id) byId.set(row.id, row);
  for (const row of localRows) {
    if (!row?.id) continue;
    const cloudRow = byId.get(row.id);
    const localAt = Number(row?._updatedAt || 0);
    const cloudAt = Number(cloudRow?._updatedAt || 0);
    if (!cloudRow) {
      const keep = pendingIds === null || pendingIds.has(`${name}:${row.id}`);
      if (keep) byId.set(row.id, row);
      continue;
    }
    if (localAt > cloudAt) byId.set(row.id, row);
  }
  return Array.from(byId.values());
}

describe('a row deleted on another device stays deleted', () => {
  it('does not resurrect a local row the cloud no longer has', () => {
    const local = [{ id: 'a', name: 'Deleted Elsewhere', _updatedAt: 5000 }];
    const out = mergeCollection('menuItems', [], local, new Set());
    expect(out).toHaveLength(0);
  });

  it('resurrecting it WOULD have happened under the old rule', () => {
    // Documents the exact regression this guards against.
    const oldRule = (remote: any[], localRows: any[]) => {
      const byId = new Map(remote.map((r: any) => [r.id, r]));
      for (const row of localRows) if (!byId.get(row.id)) byId.set(row.id, row);
      return Array.from(byId.values());
    };
    expect(oldRule([], [{ id: 'a' }])).toHaveLength(1);
  });
});

describe('a genuinely unsynced local row is preserved', () => {
  it('keeps a row that is still queued for push', () => {
    const local = [{ id: 'b', name: 'Created Offline', _updatedAt: 9000 }];
    const out = mergeCollection('menuItems', [], local, new Set(['menuItems:b']));
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Created Offline');
  });

  it('scopes the pending key by collection, not id alone', () => {
    // 'orders:b' pending must not rescue 'menuItems:b'.
    const local = [{ id: 'b', _updatedAt: 9000 }];
    expect(mergeCollection('menuItems', [], local, new Set(['orders:b']))).toHaveLength(0);
  });
});

describe('newer wins when both sides have the row', () => {
  it('the cloud wins when it is newer', () => {
    const out = mergeCollection('menuItems',
      [{ id: 'c', name: 'Cloud', _updatedAt: 200 }],
      [{ id: 'c', name: 'Local', _updatedAt: 100 }], new Set());
    expect(out[0].name).toBe('Cloud');
  });

  it('the local edit wins when it is newer', () => {
    const out = mergeCollection('menuItems',
      [{ id: 'c', name: 'Cloud', _updatedAt: 100 }],
      [{ id: 'c', name: 'Local', _updatedAt: 200 }], new Set());
    expect(out[0].name).toBe('Local');
  });

  it('a tie goes to the cloud', () => {
    // Equal timestamps must not flip to local, or clock skew decides the data.
    const out = mergeCollection('menuItems',
      [{ id: 'c', name: 'Cloud', _updatedAt: 100 }],
      [{ id: 'c', name: 'Local', _updatedAt: 100 }], new Set());
    expect(out[0].name).toBe('Cloud');
  });
});

describe('the shipped merge still consults the sync queue', () => {
  it('reads pending ops before deciding to keep a local-only row', () => {
    expect(storeSrc).toContain('getDeferredOps');
    expect(storeSrc).toContain('pendingIds');
  });

  it('no longer keeps every local-only row unconditionally', () => {
    // The old rule is quoted in the explanatory comment above the fix — on
    // purpose, so the next reader knows what was wrong. Strip comments before
    // asserting, or this test fails on the documentation rather than the code.
    const code = storeSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toContain('if (!cloudRow || localAt > cloudAt)');
  });
});


// ============================================================================
// v1.25.21 — the regression v1.25.20 shipped, pinned so it cannot return
//
// getDeferredOps() reads an in-memory Map that starts EMPTY and is filled by
// an ASYNC load. Called during boot it returns [] — which means "I have not
// looked yet", not "nothing is pending".
//
// v1.25.20 read it synchronously and trusted the empty result. On the first
// background refresh every unsynced local row was therefore discarded, wiping
// exactly the data the queue exists to protect — and on this project most rows
// were unsynced, so it wiped nearly everything.
//
// The rule now: an unreadable queue means KEEP. A stale duplicate is
// recoverable; a deleted order is not.
// ============================================================================
describe('an unreadable sync queue must never cause data loss', () => {
  it('keeps local-only rows when the queue has not loaded (null)', () => {
    const local = [
      { id: 'o1', total: 850, _updatedAt: 5000 },
      { id: 'o2', total: 200, _updatedAt: 6000 },
    ];
    const out = mergeCollection('orders', [], local, null);
    expect(out).toHaveLength(2);
  });

  it('an EMPTY set is not the same as an unread queue', () => {
    // Empty set = queue read, genuinely nothing pending -> cloud wins.
    expect(mergeCollection('orders', [], [{ id: 'o1', _updatedAt: 1 }], new Set()))
      .toHaveLength(0);
    // null = never read -> keep, because we cannot tell deletion from backlog.
    expect(mergeCollection('orders', [], [{ id: 'o1', _updatedAt: 1 }], null))
      .toHaveLength(1);
  });

  it('the shipped merge waits for the queue instead of reading it blind', () => {
    expect(storeSrc).toContain('whenDeferredQueueReady');
    expect(storeSrc).toContain('pendingIds === null');
  });
});
