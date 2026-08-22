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
// The REAL rule, not a copy of it. This file used to re-implement the merge
// and then police the original with string matching on store.ts — which pins
// the spelling, not the behaviour.
import { mergeCollection as merge } from '../lib/syncMerge';

/** Rows only — most cases here do not care about the re-queue list. */
function mergeCollection(
  name: string, remote: any[], local: any[], pendingIds: Set<string> | null,
): any[] {
  return merge(name, remote, local, pendingIds).rows;
}

const storeSrc = fs.readFileSync(
  path.join(process.cwd(), 'src', 'lib', 'store.ts'), 'utf8');

// ============================================================================
// v1.26.0 — a deletion is a TOMBSTONE, not an absence
//
// Until this release eleven tables were hard-DELETEd, so "deleted on another
// device" reached this merge as "the cloud does not have this row" — the exact
// same input as "my copy has not been pushed yet". The merge had to guess:
//
//   guess "deleted"  -> unsynced bills destroyed        (shipped as v1.25.20)
//   guess "unsynced" -> deletions resurrect and re-push (shipped before that)
//
// Both were reported as data loss, because both were. The fix is not a better
// guess; it is to stop guessing. `deleted_at` makes the deletion a fact that
// travels with the row, and absence can then always be handled the safe way.
// ============================================================================
describe('a row deleted on another device stays deleted', () => {
  it('drops a local row the cloud has tombstoned', () => {
    const local = [{ id: 'a', name: 'Deleted Elsewhere', _updatedAt: 5000 }];
    const remote = [{ id: 'a', deleted: true, deletedAt: 6000 }];
    expect(mergeCollection('menuItems', remote, local, new Set())).toHaveLength(0);
  });

  it('applies the tombstone even when the local edit is newer', () => {
    // Deleting is an edit too. A stale local timestamp must not veto it, or
    // the device that deleted the row would see it come back.
    const local = [{ id: 'a', name: 'Edited Locally', _updatedAt: 999999 }];
    const remote = [{ id: 'a', deleted: true, deletedAt: 1 }];
    expect(mergeCollection('menuItems', remote, local, new Set())).toHaveLength(0);
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

describe('a local row the cloud has never seen is never thrown away', () => {
  it('keeps a row that is still queued for push', () => {
    const local = [{ id: 'b', name: 'Created Offline', _updatedAt: 9000 }];
    const out = merge('menuItems', [], local, new Set(['menuItems:b']));
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].name).toBe('Created Offline');
    expect(out.requeue).toEqual([]);          // already queued — leave it alone
  });

  it('keeps AND re-queues a row that is not in the queue either', () => {
    // Absent from the cloud and absent from the queue means the push never
    // happened. Dropping it loses the record; keeping it quietly is how a bill
    // lives on one till forever. Keep it and put it back on the queue.
    const local = [{ id: 'b', name: 'Never Pushed', _updatedAt: 9000 }];
    const out = merge('menuItems', [], local, new Set());
    expect(out.rows).toHaveLength(1);
    expect(out.requeue).toEqual(['b']);
  });

  it('scopes the pending key by collection, not id alone', () => {
    // 'orders:b' pending must not be read as covering 'menuItems:b'.
    const local = [{ id: 'b', _updatedAt: 9000 }];
    const out = merge('menuItems', [], local, new Set(['orders:b']));
    expect(out.rows).toHaveLength(1);
    expect(out.requeue).toEqual(['b']);
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
    // Both keep the row — nothing is dropped on absence any more. What differs
    // is the repair: an empty set is a TRUSTWORTHY "not queued", so the row is
    // re-queued. null means the queue is unreadable, and enqueueing into a
    // queue that cannot be read would achieve nothing.
    expect(merge('orders', [], [{ id: 'o1', _updatedAt: 1 }], new Set()).requeue)
      .toEqual(['o1']);
    expect(merge('orders', [], [{ id: 'o1', _updatedAt: 1 }], null).requeue)
      .toEqual([]);
  });

  it('the shipped merge waits for the queue instead of reading it blind', () => {
    expect(storeSrc).toContain('whenDeferredQueueReady');
    expect(storeSrc).toContain('pendingOpKeys');
  });
});
