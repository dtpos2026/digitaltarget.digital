// ============================================================================
// v1.58.0 — "super admin me client save nhi hota, na he resturan bill"
//
// Both symptoms are one line.
//
// v1.25.3 HARD PINNED usingSupabaseAuth() to true, with the note "Firebase is
// gone. There is exactly one backend, so there is nothing left to resolve and
// no state that can put a device on the wrong path."
//
// firestoreUnavailable() was NOT changed with it, and kept consulting the very
// per-device flag that change had removed:
//
//     if (explicit === 'firebase') return false;
//
// On any device still carrying that stale flag, every platform module took the
// FIRESTORE branch — marketing contacts (the client list), client billing,
// packages, plans, releases, support — and Firestore has no identity for a
// Supabase-authenticated Super Admin, so each write was refused.
//
// The database was never at fault. Acting as a real Super Admin on the live
// database, inserts into admin_marketing_contacts, admin_invoices and
// admin_payments all succeeded, and the probe rows were removed again. RLS on
// all three is is_super_admin() for ALL, and it works.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { firestoreUnavailable } from '@/lib/legacyFirebaseGuard';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const guard = stripTs(read('src/lib/legacyFirebaseGuard.ts'));
const panel = stripTs(read('src/components/MarketingContactsPanel.tsx'));

describe('there is one backend, and every module agrees on which', () => {
  it('a stale "firebase" flag can no longer divert writes', () => {
    // This is the bug, executed: the flag that used to send a Super Admin's
    // writes to a dead Firestore.
    localStorage.setItem('dtpos-auth-backend', 'firebase');
    expect(firestoreUnavailable()).toBe(true);
  });

  it('holds with no flag at all, and with the supabase flag', () => {
    localStorage.removeItem('dtpos-auth-backend');
    expect(firestoreUnavailable()).toBe(true);
    localStorage.setItem('dtpos-auth-backend', 'supabase');
    expect(firestoreUnavailable()).toBe(true);
  });

  it('the per-device flag is not read here any more', () => {
    expect(guard).not.toContain("localStorage.getItem('dtpos-auth-backend')");
    expect(guard).not.toContain("explicit === 'firebase'");
  });

  it('agrees with authProvider, which has been pinned since v1.25.3', () => {
    const auth = stripTs(read('src/lib/authProvider.ts'));
    const fn = auth.slice(auth.indexOf('export function usingSupabaseAuth'));
    expect(fn.slice(0, 200)).toContain('return true;');
  });
});

describe('a refused save says so', () => {
  it('never shows an empty toast when the error carries no message', () => {
    // toast.error(undefined) renders an empty box, which reads as "nothing
    // happened" — the exact phrasing of the report.
    expect(panel).not.toContain('toast.error(e?.message);');
    expect(panel).toContain("toast.error(e?.message || 'Could not save");
  });
});
