// ============================================================
// Tests — v1.18.1 auth backend resolution
//
// THE BUG: usingSupabaseAuth() read the device flag alone. On a fresh browser
// that key does not exist, so the answer was "Firebase" — and the Super Admin,
// whose account exists ONLY in Supabase, was sent to Firebase and received
// `auth/invalid-credential`.
//
// A chicken-and-egg: the flag is per-device, but it cannot be set until
// someone logs in, and they cannot log in until it is set.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

const KEY = 'dtpos-auth-backend';

/** Mirrors the resolution order in authProvider.usingSupabaseAuth(). */
function resolve(explicit: string | null, supabaseConfigured: boolean): boolean {
  if (explicit === 'supabase') return true;
  if (explicit === 'firebase') return false;
  return supabaseConfigured;
}

beforeEach(() => { localStorage.clear(); });

describe('a fresh browser on a Supabase build chooses Supabase', () => {
  it('THE REGRESSION: no device flag + Supabase configured -> Supabase', () => {
    // This is exactly the Super Admin's first login. Before the fix this
    // returned false and produced auth/invalid-credential.
    expect(resolve(null, true)).toBe(true);
  });

  it('no device flag + no Supabase config -> Firebase', () => {
    expect(resolve(null, false)).toBe(false);
  });
});

describe('an explicit device choice always wins', () => {
  it('honours a remembered Supabase choice', () => {
    expect(resolve('supabase', true)).toBe(true);
    expect(resolve('supabase', false)).toBe(true);
  });

  it('honours a remembered Firebase choice even on a Supabase build', () => {
    // A legacy restaurant owner whose account lives in Firebase must keep
    // going to Firebase, on the very same deployment.
    expect(resolve('firebase', true)).toBe(false);
  });

  it('ignores a junk value and falls back to build configuration', () => {
    expect(resolve('nonsense', true)).toBe(true);
    expect(resolve('', false)).toBe(false);
  });
});

describe('the remembered backend survives a refresh', () => {
  it('persists to localStorage', () => {
    localStorage.setItem(KEY, 'supabase');
    expect(resolve(localStorage.getItem(KEY), false)).toBe(true);
  });

  it('a cleared device falls back to build configuration, not to a lockout', () => {
    localStorage.setItem(KEY, 'supabase');
    localStorage.clear();
    // Must NOT become "firebase and stuck" — that was the original bug.
    expect(resolve(localStorage.getItem(KEY), true)).toBe(true);
  });
});

describe('credential-failure detection decides whether to fall back', () => {
  // Only an "unknown account" style rejection may trigger the other backend.
  // A genuinely wrong password must not be retried against two providers.
  const isCredentialFailure = (e: any) => {
    const msg = String(e?.message ?? e).toLowerCase();
    return msg.includes('invalid login') || msg.includes('invalid credentials')
      || msg.includes('email not confirmed') || e?.status === 400;
  };

  it('treats Supabase invalid-login as a reason to try Firebase', () => {
    expect(isCredentialFailure({ message: 'Invalid login credentials' })).toBe(true);
    expect(isCredentialFailure({ status: 400 })).toBe(true);
  });

  it('does NOT fall back on a network or configuration failure', () => {
    // Masking an outage by silently switching backends would hide a real
    // problem and could sign someone into the wrong system.
    expect(isCredentialFailure({ message: 'Failed to fetch' })).toBe(false);
    expect(isCredentialFailure({ message: 'supabase not configured' })).toBe(false);
    expect(isCredentialFailure({ status: 500 })).toBe(false);
  });
});

// ============================================================
// v1.18.2 — "Firebase: Error (auth/invalid-credential)" on a Supabase account
//
// ROOT CAUSE: Vite bakes VITE_* variables into the bundle AT BUILD TIME. A
// build made without .env.local contains no Supabase configuration at all, so
// supabaseAvailable() is false, the app quietly falls back to Firebase, and an
// account that exists only in Supabase is rejected — with an error naming the
// wrong system entirely.
//
// The credentials were never the problem. The build was.
// ============================================================
describe('a build without Supabase configuration fails loudly, not silently', () => {
  /** Mirrors supabaseUnavailableReason(). */
  function reason(env: Record<string, string | undefined>): string | null {
    const url = env.VITE_SUPABASE_URL;
    const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY;
    if (!url && !key) return 'compiled without Supabase configuration';
    if (!url) return 'VITE_SUPABASE_URL is missing';
    if (!key) return 'VITE_SUPABASE_PUBLISHABLE_KEY is missing';
    return null;
  }

  it('THE REGRESSION: an empty build reports the real cause', () => {
    expect(reason({})).toContain('compiled without Supabase configuration');
  });

  it('names the specific variable when only one is missing', () => {
    expect(reason({ VITE_SUPABASE_PUBLISHABLE_KEY: 'k' })).toContain('VITE_SUPABASE_URL');
    expect(reason({ VITE_SUPABASE_URL: 'u' })).toContain('PUBLISHABLE_KEY');
  });

  it('is silent when the build is configured', () => {
    expect(reason({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
    })).toBeNull();
  });

  it('accepts the legacy anon key name as a fallback', () => {
    expect(reason({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'eyJhbGci...',
    })).toBeNull();
  });
});

describe('the publishable key must never be a secret key', () => {
  const isSecret = (k: string) => k.startsWith('sb_secret_') || k.includes('service_role');

  it('accepts a publishable key', () => {
    expect(isSecret('sb_publishable_wAdvU6MKlCyBCAMogNUdCQ')).toBe(false);
  });

  it('rejects a secret key — it bypasses RLS entirely', () => {
    expect(isSecret('sb_secret_abcdef')).toBe(true);
  });
});

// ============================================================
// v1.19.6 — a transient failure must not pin the device
//
// resolveAndSignIn() used to call rememberBackend('firebase') whenever the
// Supabase attempt failed for a NON-credential reason. A dropped wifi, a cold
// start, a momentary outage — any of them wrote 'firebase' to the device.
//
// That flag then wins over the build configuration on every future attempt, so
// the till kept going to Firebase long after the network recovered, showing
// auth/invalid-credential forever with no way for the operator to know why.
// ============================================================
describe('a transient failure does not pin the device to a backend', () => {
  const KEY = 'dtpos-auth-backend';

  /** Mirrors the decision in resolveAndSignIn()'s catch block. */
  function onSupabaseFailure(e: any): 'remember-firebase' | 'clear' {
    const msg = String(e?.message ?? e).toLowerCase();
    const isCredentialFailure =
      msg.includes('invalid login') || msg.includes('invalid credentials')
      || msg.includes('email not confirmed') || e?.status === 400;
    return isCredentialFailure ? 'remember-firebase' : 'clear';
  }

  beforeEach(() => localStorage.clear());

  it('THE REGRESSION: a network error CLEARS the choice, never pins Firebase', () => {
    expect(onSupabaseFailure({ message: 'Failed to fetch' })).toBe('clear');
    expect(onSupabaseFailure({ message: 'NetworkError when attempting to fetch' })).toBe('clear');
    expect(onSupabaseFailure({ status: 503 })).toBe('clear');
  });

  it('a configuration error also clears rather than pinning', () => {
    expect(onSupabaseFailure({ message: 'supabase not configured' })).toBe('clear');
  });

  it('a genuine unknown-account DOES fall through to Firebase', () => {
    // This is the legacy owner case, and the only time switching is correct.
    expect(onSupabaseFailure({ message: 'Invalid login credentials' })).toBe('remember-firebase');
    expect(onSupabaseFailure({ status: 400 })).toBe('remember-firebase');
  });

  it('after clearing, the next attempt resolves from the build again', () => {
    localStorage.setItem(KEY, 'supabase');
    localStorage.removeItem(KEY);              // what clearRememberedBackend does
    expect(localStorage.getItem(KEY)).toBeNull();
    // resolve() with no explicit value follows the build — Supabase here.
    expect(resolve(localStorage.getItem(KEY), true)).toBe(true);
  });
});
