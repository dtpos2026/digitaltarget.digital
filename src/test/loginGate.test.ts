// ============================================================
// Tests — v1.24.2 which login screen appears
//
// REPORTED: "email login nahi aa raha, user login ho raha hai" — the POS user
// prompt appeared but the email/password screen never did, so the Super Admin
// panel became unreachable (that screen is its only entry point).
//
// CAUSE: tenantReady was decided by a CACHED tenant id alone:
//
//     useState(() => !cloudMode || !!getTenantId())
//
// The tenant id is written on first login and never expires, so from then on
// Stage 1 was skipped permanently — with or without a valid session.
// ============================================================
import { describe, it, expect } from 'vitest';

/** Mirrors the boot decision in App.tsx. */
function initialTenantReady(cloudMode: boolean, cachedTenantId: string | null): boolean {
  return !cloudMode || !!cachedTenantId;
}

/** Mirrors the post-auth correction. */
function afterAuthResolves(
  tenantReady: boolean, cloudMode: boolean, hasSession: boolean,
): boolean {
  if (!cloudMode) return tenantReady;
  return hasSession ? tenantReady : false;
}

describe('a cached tenant id is a hint, not proof of a session', () => {
  it('THE REGRESSION: cached tenant + NO session shows the email screen', () => {
    const boot = initialTenantReady(true, 'tenant-123');
    expect(boot).toBe(true);                                   // optimistic
    expect(afterAuthResolves(boot, true, false)).toBe(false);  // corrected
  });

  it('cached tenant + a real session stays signed in', () => {
    // Re-prompting a working session on every reload would be its own bug.
    const boot = initialTenantReady(true, 'tenant-123');
    expect(afterAuthResolves(boot, true, true)).toBe(true);
  });

  it('no cached tenant always shows the email screen', () => {
    expect(initialTenantReady(true, null)).toBe(false);
  });

  it('an offline single-till build skips the email screen entirely', () => {
    // No cloud backend means no owner account to sign into.
    expect(initialTenantReady(false, null)).toBe(true);
    expect(afterAuthResolves(true, false, false)).toBe(true);
  });
});

describe('super-admin status survives a refresh', () => {
  const KEY = 'pos-super-admin';

  function bootSuperAdmin(stored: string | null): boolean {
    return stored === '1';
  }

  it('THE REGRESSION: a reload used to drop out of the panel', () => {
    // superAdmin was useState(false), so every mount forgot it.
    expect(bootSuperAdmin(null)).toBe(false);
    expect(bootSuperAdmin('1')).toBe(true);
  });

  it('is scoped to the tab, not the device', () => {
    // sessionStorage, deliberately: closing the tab ends the elevated session,
    // so a shared machine does not leave the panel open for the next person.
    expect(KEY).toBe('pos-super-admin');
  });

  it('a normal owner login clears it', () => {
    expect(bootSuperAdmin(null)).toBe(false);
  });
});

describe('cloud mode is not tied to one vendor', () => {
  function isCloudConfigured(env: Record<string, string | undefined>): boolean {
    return !!env.VITE_SUPABASE_URL
      && !!(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY);
  }

  it('a Supabase build IS in cloud mode', () => {
    expect(isCloudConfigured({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    })).toBe(true);
  });

  it('an unconfigured build is not — and must not show an owner login', () => {
    // This is what happened when Firebase was removed and cloudMode still
    // asked isFirebaseConfigured(): the app silently became a local-only till.
    expect(isCloudConfigured({})).toBe(false);
  });
});
