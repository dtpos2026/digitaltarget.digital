// ============================================================================
// "Local Sync / Locally Saved Data / Sync Error aata hai. Iska proper solution
//  karein taake DATA LOSS na ho."
//
// The loss was never the error message — it was the WRITE THAT REPORTED
// SUCCESS. On a portal session (rider / order taker) there is no Supabase
// session, and an UPDATE that RLS filters matches zero rows and returns no
// error. Proven on the live database:
//
//     set role anon; update orders    ... -> no error, rows affected = 0
//     set role anon; update customers ... -> no error, rows affected = 0
//
// So every path a portal app can reach must either go through a portal RPC or
// fail loudly. Silence is the bug.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const store = readFileSync('src/lib/supabaseStore.ts', 'utf8');
const code  = store.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

describe('no portal write can vanish quietly', () => {
  it('an order goes through the portal RPC', () => {
    const fn = code.slice(code.indexOf('export async function sbSaveItem'));
    expect(fn).toContain('portalSaveOrder');
    expect(fn.indexOf('portalSaveOrder')).toBeLessThan(fn.indexOf('upsert(row'));
  });

  it('anything else on a portal session RAISES instead of pretending', () => {
    const fn = code.slice(code.indexOf('export async function sbSaveItem'));
    expect(fn).toContain('hasPortalSessionSafe()');
    expect(fn).toContain('throw new Error(');
    // and it must be decided before the table write, not after
    expect(fn.indexOf('hasPortalSessionSafe()')).toBeLessThan(fn.indexOf('upsert(row'));
  });

  it('the batch path never runs for a portal session', () => {
    // A batch update matches zero rows with no error, so it would report a
    // hundred saves that never happened — the worst shape of this bug.
    const fn = code.slice(code.indexOf('export async function sbSaveMany'));
    expect(fn).toContain('portalSession');
    expect(fn).toContain('(isDocStoreCollection(col) || portalSession) ? null : tableFor(col)');
    expect(fn.indexOf('portalSession =')).toBeLessThan(fn.indexOf('upsert(rows'));
  });

  it('a POS till keeps the fast batch path', () => {
    // hasPortalSession() is false there, so nothing about a till changes.
    const fn = code.slice(code.indexOf('export async function sbSaveMany'));
    expect(fn).toContain('upsert(rows');
  });

  it('a refused portal write names itself', () => {
    const fn = code.slice(code.indexOf('async function portalSaveOrder'));
    expect(fn).toContain('portal_upsert_order refused');
    expect(fn).toContain("r.ok !== true");
  });
});
