// ============================================================================
// v1.28.6 — the Windows installer that could sign nobody in
//
// REPORTED, from a fresh Windows install: the app opens, asks for a username
// and password, and answers every correct credential with
//
//     This device is not linked to a restaurant yet.
//     Sign in with the owner email first.
//
// while no owner-email screen exists anywhere to be found.
//
// THE CAUSE, reproduced locally: building with VITE_SUPABASE_URL set to an
// EMPTY string produces a bundle carrying no Supabase address at all. An empty
// environment variable overrides the committed .env — and the CI job passed
// `VITE_SUPABASE_URL: ${{ secrets.… }}` for secrets that were never set on the
// desktop repository, so every installer it built was blank.
//
// THE DEAD END that made it unrecoverable: isCloudConfigured() then returns
// false while usingSupabaseAuth() hard-returns true (Firebase is gone; there is
// one backend). App.tsx gates the Stage-1 owner email screen on cloudMode, so
// it never rendered; the staff screen below took the Supabase path regardless,
// needed a tenant it could never obtain, and pointed the operator at a screen
// the same defect had hidden.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
const auth = readFileSync(join(process.cwd(), 'src/lib/authProvider.ts'), 'utf8');
const android = readFileSync(join(process.cwd(), '.github/workflows/build-android.yml'), 'utf8');
const env = readFileSync(join(process.cwd(), '.env'), 'utf8');

describe('the two answers that could disagree', () => {
  it('usingSupabaseAuth is unconditional — every path below assumes a backend', () => {
    const body = auth.slice(auth.indexOf('export function usingSupabaseAuth'));
    expect(body.slice(0, body.indexOf('}'))).toContain('return true');
  });

  it('so a build with no configuration is a defect, not a "local mode"', () => {
    // cloudMode false used to fall through to the staff login. It now stops.
    expect(app).toContain('if (!cloudMode) {');
    expect(app).toContain('<MisconfiguredBuildScreen />');
  });

  it('and it stops BEFORE the screens that cannot work', () => {
    const stop = app.indexOf('if (!cloudMode) {');
    expect(stop).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(app.indexOf('if (cloudMode && !tenantReady) {'));
    expect(stop).toBeLessThan(app.indexOf('<LoginPage onLogin={handleLogin} />'));
  });
});

describe('the configuration a build must carry', () => {
  it('.env holds it, and is committed on purpose', () => {
    expect(env).toMatch(/^VITE_SUPABASE_URL=https:\/\/[a-z0-9]+\.supabase\.co$/m);
    expect(env).toMatch(/^VITE_SUPABASE_PUBLISHABLE_KEY=.+$/m);
  });

  it('CI no longer passes an unset secret over it', () => {
    // The exact shape of the bug: a secret that does not exist arrives as ""
    // and blanks the committed value.
    expect(android).not.toContain('VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}');
    expect(android).toContain('if [ -n "$S_URL" ]; then');
    expect(android).toContain('the committed .env will be used');
  });

  it('CI proves the built bundle actually carries a backend', () => {
    // Trusting the step above is what shipped the blank installer.
    expect(android).toContain('Verify the bundle carries a backend');
    expect(android).toContain('built with NO Supabase configuration');
  });
});

describe('what the operator is told', () => {
  const screen = readFileSync(join(process.cwd(), 'src/components/MisconfiguredBuildScreen.tsx'), 'utf8');

  it('does not blame their account or their password', () => {
    expect(screen).toContain('Nothing is wrong');
    expect(screen).not.toMatch(/invalid|incorrect password/i);
  });

  it('says reinstalling will not help, because it will not', () => {
    expect(screen).toContain('Reinstalling will not help');
  });

  it('names the two variables, for whoever builds it', () => {
    expect(screen).toContain('VITE_SUPABASE_URL');
    expect(screen).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
  });
});
