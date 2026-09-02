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
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
const auth = readFileSync(join(process.cwd(), 'src/lib/authProvider.ts'), 'utf8');
// v1.40.0 — the Android build left this repository along with the duplicate
// Capacitor project; it lives in dtpos2026/dtpos.apk now, and that repository
// carries this same guard in its own workflow and its own tools/check.mjs.
// What is still asserted here is the half that ships from THIS repository.
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

  it('no workflow here passes an unset secret over it', () => {
    // The exact shape of the bug: a secret that does not exist arrives as ""
    // and blanks the committed value. Asserted across every workflow this
    // repository still has, so a new one cannot reintroduce it.
    const dir = join(process.cwd(), '.github/workflows');
    const files = existsSync(dir) ? readdirSync(dir).filter(f => /\.ya?ml$/.test(f)) : [];
    for (const f of files) {
      const wf = readFileSync(join(dir, f), 'utf8');
      for (const v of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']) {
        expect(wf, `${f} passes an unset ${v} straight into the build`)
          .not.toContain(`${v}: \${{ secrets.${v} }}`);
      }
    }
  });

  it('build:app survives, because dtpos.apk builds the Customer bundle with it', () => {
    // The Android build moved out; this script is the contract it calls.
    expect(JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).scripts)
      .toHaveProperty('build:app');
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
