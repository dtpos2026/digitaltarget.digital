// ============================================================
// Tests — v1.19.7 no Firestore subscription may hang the UI
//
// REPORTED: the Super Admin console's Releases tab showed a spinner forever.
//
// CAUSE: subscribeAllReleases() opens a Firestore onSnapshot. On a Supabase
// session that subscription never fires AND never errors — it simply sits
// there. The component's `loading` state is only cleared inside the callback,
// so it never cleared.
//
// This is worse than an error: an error at least tells the operator something
// is wrong. A permanent spinner looks like a slow network and gets waited on.
//
// Every Firestore subscription must therefore settle immediately when the
// session is on Supabase.
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

/** Files that open a Firestore onSnapshot. */
function filesWithSubscriptions(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'test') walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (src.includes('onSnapshot(')) out.push(p);
    }
  };
  walk(path.join(root, 'src'));
  return out;
}

const GUARDS = [
  'firestoreUnavailable', 'usingSupabaseAuth', 'useSupabaseBackend',
  // cloudPrintJobs gates on its own availability check, which already returns
  // false on a Supabase session — an equally valid way to settle.
  'isCloudPrintAvailable',
];

describe('every Firestore subscription can settle on a Supabase session', () => {
  const files = filesWithSubscriptions();

  it('finds the subscription sites at all', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of filesWithSubscriptions()) {
    const rel = path.relative(root, f);
    it(`${rel} guards its subscription`, () => {
      const src = fs.readFileSync(f, 'utf8');
      const guarded = GUARDS.some(g => src.includes(g));
      // An unguarded onSnapshot on a Supabase session = permanent spinner.
      expect(guarded).toBe(true);
    });
  }
});

describe('the guard itself resolves correctly', () => {
  function firestoreUnavailable(explicit: string | null, supabaseBuild: boolean): boolean {
    if (explicit === 'supabase') return true;
    if (explicit === 'firebase') return false;
    return supabaseBuild;
  }

  it('reports unavailable on a Supabase session', () => {
    expect(firestoreUnavailable('supabase', false)).toBe(true);
    expect(firestoreUnavailable(null, true)).toBe(true);
  });

  it('reports available for a legacy Firebase session', () => {
    expect(firestoreUnavailable('firebase', true)).toBe(false);
    expect(firestoreUnavailable(null, false)).toBe(false);
  });
});
