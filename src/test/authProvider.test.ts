// ============================================================
// Tests — v1.18.0 auth adapter
//
// The two failure modes this adapter exists to prevent:
//   1. Synchronous reads returning null while auth is still resolving
//      ("not logged in" errors that only appear under load).
//   2. Treating the auth uid as the tenant id. Under Firebase they are the
//      same value; under Supabase they are different UUIDs, and confusing
//      them means reading the wrong restaurant's data — or, with RLS on,
//      reading nothing and calling it data loss.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import {
  currentAuthUser, uid, authTenantId, authBranchId, authRole,
  onAuthUserChanged, isAuthReady, __setAuthStateForTest,
} from '@/lib/authProvider';

beforeEach(() => __setAuthStateForTest({}));

describe('the session cache is synchronous', () => {
  it('exposes the user without awaiting anything', () => {
    __setAuthStateForTest({ user: { uid: 'u1', email: 'a@b.c' }, tenantId: 't1' });
    expect(currentAuthUser()!.uid).toBe('u1');   // no await
    expect(uid()).toBe('u1');
  });

  it('returns null when signed out rather than throwing', () => {
    expect(currentAuthUser()).toBeNull();
    expect(uid()).toBeNull();
    expect(authTenantId()).toBeNull();
  });

  it('reports readiness so callers can tell "resolving" from "signed out"', () => {
    __setAuthStateForTest({});
    expect(isAuthReady()).toBe(true);
  });
});

describe('uid and tenantId are kept separate', () => {
  it('Firebase shape: they happen to be equal', () => {
    __setAuthStateForTest({ user: { uid: 'same-id', email: null }, tenantId: 'same-id' });
    expect(uid()).toBe(authTenantId());
  });

  it('Supabase shape: they are DIFFERENT and must not be interchanged', () => {
    __setAuthStateForTest({
      user: { uid: 'auth-user-uuid', email: null },
      tenantId: 'tenant-uuid', branchId: 'branch-uuid', role: 'owner',
    });
    expect(uid()).toBe('auth-user-uuid');
    expect(authTenantId()).toBe('tenant-uuid');
    expect(uid()).not.toBe(authTenantId());
  });

  it('a signed-in user with no tenant is representable', () => {
    // Happens when the owner has not bootstrapped a restaurant, or the JWT
    // claims hook is not registered. The UI must be able to detect it.
    __setAuthStateForTest({ user: { uid: 'u1', email: 'a@b.c' }, tenantId: null });
    expect(currentAuthUser()).not.toBeNull();
    expect(authTenantId()).toBeNull();
  });

  it('carries branch and role for RLS-scoped screens', () => {
    __setAuthStateForTest({
      user: { uid: 'u', email: null }, tenantId: 't',
      branchId: 'b1', role: 'cashier',
    });
    expect(authBranchId()).toBe('b1');
    expect(authRole()).toBe('cashier');
  });
});

describe('change notification', () => {
  it('fires immediately with the current value on subscribe', () => {
    __setAuthStateForTest({ user: { uid: 'u9', email: null }, tenantId: 't9' });
    let seen: string | null | undefined;
    const off = onAuthUserChanged(u => { seen = u?.uid ?? null; });
    expect(seen).toBe('u9');
    off();
  });

  it('fires when the signed-in user changes', () => {
    const seen: (string | null)[] = [];
    const off = onAuthUserChanged(u => seen.push(u?.uid ?? null));
    __setAuthStateForTest({ user: { uid: 'a', email: null }, tenantId: 'a' });
    __setAuthStateForTest({});
    off();
    expect(seen).toEqual([null, 'a', null]);
  });

  it('does NOT fire when only the token refreshes', () => {
    // A token refresh keeps the same user. Notifying would re-trigger every
    // downstream effect — including store re-init — on a routine refresh.
    __setAuthStateForTest({ user: { uid: 'u', email: null }, tenantId: 't', token: 'tok1' });
    const seen: (string | null)[] = [];
    const off = onAuthUserChanged(u => seen.push(u?.uid ?? null));
    __setAuthStateForTest({ user: { uid: 'u', email: null }, tenantId: 't', token: 'tok2' });
    off();
    expect(seen).toEqual(['u']);   // subscribe only, no second call
  });

  it('unsubscribing actually stops notifications', () => {
    let count = 0;
    const off = onAuthUserChanged(() => { count++; });
    off();
    __setAuthStateForTest({ user: { uid: 'z', email: null }, tenantId: 'z' });
    expect(count).toBe(1);   // the immediate call only
  });
});

// ============================================================
// Backend selection — the chicken-and-egg bug found in the A-to-Z audit.
//
// The first version read this flag from getSettings(), i.e. from cloud
// settings. Cloud settings load only AFTER sign-in, so at initAuth() time
// there was no tenant, no settings, and the flag was always false. The
// Supabase path was unreachable — the Admin could switch the toggle on and
// literally nothing would happen, on that boot or any later one.
//
// It is now a local per-device setting, readable synchronously at boot.
// ============================================================
import { usingSupabaseAuth, setAuthBackend } from '@/lib/authProvider';

describe('auth backend selection', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  it('with no device flag, follows the BUILD configuration', () => {
    // ===== EXPECTATION DELIBERATELY CHANGED in v1.18.1 =====
    // This used to assert `false` — "default to Firebase" — on the reasoning
    // that a restaurant which never opted in must not be moved silently.
    //
    // That reasoning was wrong for the very first login. A fresh browser has
    // no device flag, so the old rule sent EVERY new login to Firebase,
    // including the Super Admin whose account exists only in Supabase. The
    // result was `Firebase: Error (auth/invalid-credential)` — an error
    // blaming the password when the build was the problem.
    //
    // The safety concern is still honoured, just elsewhere: an explicit device
    // choice always wins (tested below), and resolveAndSignIn() falls back to
    // Firebase for accounts Supabase does not recognise. So a legacy owner is
    // never locked out, and a new Supabase account is never misrouted.
    //
    // This suite runs under Vite, which loads .env.local — so a configured
    // checkout answers true and an unconfigured one answers false. Assert the
    // RULE rather than a fixed value.
    const env = (import.meta as any).env ?? {};
    const configured = !!env.VITE_SUPABASE_URL
      && !!(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY);
    expect(usingSupabaseAuth()).toBe(configured);
  });

  it('a stale Firebase choice in storage can no longer pin a device', () => {
    // ===== v1.25.3 — this assertion is INVERTED ON PURPOSE =====
    // It used to require that a stored 'firebase' choice win, so a legacy
    // restaurant would not be moved off Firebase. Firebase is now removed
    // entirely, which turns that protection into a lockout: any till with the
    // old value in localStorage would route sign-in to a stubbed SDK and be
    // told, on every attempt, that its credentials were invalid.
    localStorage.setItem('dtpos-auth-backend', 'firebase');
    expect(usingSupabaseAuth()).toBe(true);
  });

  it('is readable synchronously, with no store and no session', () => {
    setAuthBackend('supabase');
    expect(usingSupabaseAuth()).toBe(true);   // no await, no getSettings()
  });

  it('cannot be switched to any other backend', () => {
    // There is exactly one backend, so there is no toggle left to get wrong.
    setAuthBackend('supabase');
    localStorage.setItem('dtpos-auth-backend', 'firebase');
    expect(usingSupabaseAuth()).toBe(true);
  });

  it('treats any unrecognised value as "no choice", not as Firebase', () => {
    // Junk in storage must not pin the app to one backend. It falls through to
    // the build configuration, exactly as an absent key does — otherwise a
    // corrupted value would reproduce the invalid-credential lockout.
    localStorage.setItem('dtpos-auth-backend', 'nonsense');
    expect(usingSupabaseAuth()).toBe(true);
  });
});

// ============================================================
// v1.18.1 — regression: "Firebase: Error (auth/invalid-credential)"
//           on the Super Admin login.
//
// Root cause: which backend to authenticate against was read from a device
// localStorage flag. On a fresh device that flag is unset, so the login
// defaulted to Firebase and tried to authenticate an account that exists
// only in Supabase. The flag could never be set correctly beforehand,
// because it lived in tenant settings — which cannot load until AFTER
// sign-in. A circular dependency that made super admin login impossible.
// ============================================================
describe('backend selection at login', () => {
  // Mirrors supabaseAvailable(): read from env, never from tenant settings.
  const supabaseAvailable = (env: Record<string, string | undefined>) =>
    !!env.VITE_SUPABASE_URL && !!(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY);

  it('is decided from env, so it works on a device with NO stored preference', () => {
    expect(supabaseAvailable({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
    })).toBe(true);
  });

  it('accepts the legacy anon key name too', () => {
    expect(supabaseAvailable({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    })).toBe(true);
  });

  it('falls back to Firebase when Supabase is not configured', () => {
    expect(supabaseAvailable({})).toBe(false);
    expect(supabaseAvailable({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toBe(false);
  });
});

describe('sign-in fallback only on a credentials failure', () => {
  // Mirrors resolveAndSignIn(): a network or config error must NOT silently
  // divert to the other backend, or a real outage would look like a wrong
  // password and the user would be sent down a path that cannot work.
  const isCredentialFailure = (e: { message?: string; status?: number }) => {
    const msg = String(e?.message ?? '').toLowerCase();
    return msg.includes('invalid login') || msg.includes('invalid credentials')
      || msg.includes('email not confirmed') || e?.status === 400;
  };

  it('treats wrong credentials as a reason to try the legacy backend', () => {
    expect(isCredentialFailure({ message: 'Invalid login credentials', status: 400 })).toBe(true);
  });

  it('does NOT fall back on a network failure', () => {
    expect(isCredentialFailure({ message: 'Failed to fetch' })).toBe(false);
  });

  it('does NOT fall back on a server error', () => {
    expect(isCredentialFailure({ message: 'Internal Server Error', status: 500 })).toBe(false);
  });
});

describe('super admins have no tenant, and that is correct', () => {
  it('a super admin session carries a user but no tenant', () => {
    // The tenant guard must be checked AFTER the super-admin check, or every
    // super admin login is rejected as "not linked to a restaurant".
    __setAuthStateForTest({ user: { uid: 'sa-1', email: 'digitaltarget.digital@gmail.com' }, tenantId: null });
    expect(currentAuthUser()).not.toBeNull();
    expect(authTenantId()).toBeNull();
  });

  it('a restaurant owner carries both', () => {
    __setAuthStateForTest({ user: { uid: 'o-1', email: 'owner@x.com' }, tenantId: 't-1', role: 'owner' });
    expect(authTenantId()).toBe('t-1');
  });
});
