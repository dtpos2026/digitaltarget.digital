// ============================================================================
// v1.29.3 — "close day kiya, data zero nahi hua"
//
// REPORTED as a major bug: after Close Day the selected modules should read
// zero. They did not — the figures came back.
//
// resetSelectedData() cleared the local cache and then deleted from FIREBASE:
// getDocs, writeBatch, fbDb. Firebase was removed in v1.24.0 and every one of
// those now resolves to a stub that THROWS by design. The throw landed in
//
//     catch (e) { console.error('[reset]', col, e); }
//
// and went no further. So Close Day did exactly half its job, quietly: the till
// went to zero, the server kept everything, and the next sync pulled it back.
// Nothing in the UI could tell, because the failure was swallowed.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const store = readFileSync(join(process.cwd(), 'src/lib/store.ts'), 'utf8');
const backup = readFileSync(join(process.cwd(), 'src/pages/BackupRestorePage.tsx'), 'utf8');
const menu = readFileSync(join(process.cwd(), 'src/pages/MenuManagerPage.tsx'), 'utf8');
const bin = readFileSync(join(process.cwd(), 'src/lib/recycleBin.ts'), 'utf8');

const reset = store.slice(store.indexOf('export async function resetSelectedData'),
                          store.indexOf('export const RESETTABLE_COLLECTIONS'));

describe('the wipe reaches the server', () => {
  it('no longer deletes through Firebase, which is a stub that throws', () => {
    expect(reset).not.toContain('writeBatch');
    expect(reset).not.toContain('getDocs');
    expect(reset).not.toContain('fbDb()');
  });

  it('deletes through the tombstone-aware path instead', () => {
    // sbDeleteMany sets deleted_at on SOFT_DELETE tables, so the removal
    // replicates to every other till — and can be undone.
    expect(reset).toContain("await import('./supabaseStore')");
    expect(reset).toContain('sbDeleteMany(col, ids)');
  });

  it('collects the ids before clearing the local copy', () => {
    // They are what tells the server which rows to remove; clearing first
    // would leave nothing to name.
    expect(reset.indexOf('idsByCollection.set')).toBeLessThan(reset.indexOf('d[k] = []'));
  });
});

describe('a failure is reported, not swallowed', () => {
  it('returns what failed rather than logging and moving on', () => {
    expect(reset).toContain('outcome.failed.push');
    expect(reset).not.toMatch(/catch \(e\) \{ console\.error\('\[reset\]'/);
  });

  it('keeps the local rows for a collection the server refused', () => {
    // Otherwise the till shows zero while the server still holds the data, and
    // the next sync brings it back — which is the reported bug exactly.
    expect(reset).toContain('const refused = new Set(outcome.failed.map(f => f.collection))');
    expect(reset).toContain('if (!refused.has(k)) d[k] = []');
  });

  it('the screens say what the server did, not what was asked for', () => {
    expect(backup).toContain('could not be cleared on the server');
    expect(backup).toContain('res.failed.length');
    expect(menu).toContain('The server refused');
    expect(menu).toContain('The menu is unchanged');
  });
});

describe('the recycle bin', () => {
  it('lists and restores, and cannot purge', () => {
    // Purge is the one irreversible operation, so it is service_role only and
    // is not exposed to a browser session at all.
    expect(bin).toContain("rpc('recycle_bin_list'");
    expect(bin).toContain("rpc('recycle_bin_restore'");
    // Assert the CALL is absent, not the name: the comment above explains why
    // purge is service_role only, and matching prose would fail the file that
    // says the right thing.
    expect(bin).not.toContain("rpc('recycle_bin_purge'");
  });

  it('never sends a tenant — the server takes it from the session', () => {
    // An id from another restaurant therefore restores nothing. Verified live:
    // a batch of another tenant's ids restored 0.
    expect(bin).not.toMatch(/p_tenant/);
  });

  it('tells an unknown table apart from a permission problem', () => {
    expect(bin).toContain("res?.reason === 'unknown_table'");
    expect(bin).toContain('does not keep deleted rows');
    expect(bin).toContain("'unknown_table' : 'no_tenant'");
  });
});
