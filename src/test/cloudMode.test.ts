// ============================================================
// Tests — v1.24.1 cloud mode must not be tied to one vendor
//
// REPORTED: "email login nahi aa raha, user login to ho raha" and
// "Cloud mode disabled — device management not available".
//
// CAUSE: cloudMode was isFirebaseConfigured(). Emptying the Firebase config in
// v1.24.0 made it false forever. That single boolean gates ~40 call sites —
// the owner login screen, tenant guard, device registration, plan checks, sync
// and session isolation.
//
// The app silently became a standalone offline till. Nothing errored: the POS
// user screen kept working, so it looked like only the email login had broken.
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** Mirrors isCloudConfigured(). */
function cloudConfigured(env: Record<string, string | undefined>): boolean {
  return !!env.VITE_SUPABASE_URL
    && !!(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY);
}

describe('a Supabase build IS in cloud mode', () => {
  it('THE REGRESSION: Supabase config alone enables cloud mode', () => {
    expect(cloudConfigured({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    })).toBe(true);
  });

  it('does NOT require any Firebase configuration', () => {
    // Requiring it is exactly what broke: Firebase is gone.
    expect(cloudConfigured({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'eyJhbGci...',
      VITE_FIREBASE_API_KEY: undefined,
    })).toBe(true);
  });

  it('accepts the legacy anon key name', () => {
    expect(cloudConfigured({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'eyJhbGci...',
    })).toBe(true);
  });
});

describe('a build with no backend is honestly offline', () => {
  it('reports false when nothing is configured', () => {
    expect(cloudConfigured({})).toBe(false);
  });

  it('reports false when only half the config is present', () => {
    // A URL with no key cannot authenticate; pretending otherwise would show
    // a login screen that can never succeed.
    expect(cloudConfigured({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toBe(false);
    expect(cloudConfigured({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' })).toBe(false);
  });
});

describe('cloud mode is decided in ONE place', () => {
  const root = process.cwd();

  it('the module exists and does not import firebase', () => {
    const f = path.join(root, 'src', 'lib', 'cloudMode.ts');
    expect(fs.existsSync(f)).toBe(true);
    const src = fs.readFileSync(f, 'utf8');
    // Reintroducing the dependency here is what tied cloud mode to one vendor.
    expect(src).not.toMatch(/from ['"]firebase\//);
  });

  it('App.tsx uses it rather than a Firebase check', () => {
    const app = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
    expect(app).toMatch(/const cloudMode = isCloudConfigured\(\)/);
  });

  it('this build would render the email login screen', () => {
    // The real .env is what ships; if it were wrong, the login screen would
    // vanish again exactly as it did.
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    const url = /VITE_SUPABASE_URL=(\S+)/.exec(env)?.[1];
    const key = /VITE_SUPABASE_PUBLISHABLE_KEY=(\S+)/.exec(env)?.[1];
    expect(cloudConfigured({
      VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key,
    })).toBe(true);
  });
});
