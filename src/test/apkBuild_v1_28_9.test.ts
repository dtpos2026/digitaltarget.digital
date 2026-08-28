// ============================================================================
// v1.28.9 — building a restaurant's APK from Super Admin
//
// Everything inside the customer app is already branded from the database at
// runtime. Three things are not, because Android reads them from the installed
// package: the applicationId, the launcher icon and the launcher name. Those
// need a build, and asking an operator to open GitHub for it is a step they
// will get wrong or skip.
//
// The build runs on GitHub Actions, which means a token that can write to the
// repository. What is asserted here is that the token never reaches the
// browser, that only a super admin can spend it, and that the button refuses
// the two inputs that would produce a broken APK.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fn = readFileSync(join(process.cwd(), 'supabase/functions/apk-build/index.ts'), 'utf8');
const panel = readFileSync(join(process.cwd(), 'src/components/CustomerAppsManager.tsx'), 'utf8');

describe('the token stays on the server', () => {
  it('is read from the environment, never from a request', () => {
    expect(fn).toContain('Deno.env.get("GITHUB_APK_TOKEN")');
  });

  it('is never sent back to the caller', () => {
    // The failure responses name the problem, not the credential.
    const responses = fn.match(/return json\([\s\S]*?\);/g) ?? [];
    for (const r of responses) expect(r).not.toContain('GH_TOKEN');
  });

  it('the browser calls the function, not GitHub', () => {
    expect(panel).toContain("functions.invoke('apk-build'");
    expect(panel).not.toContain('api.github.com');
  });
});

describe('who may spend it', () => {
  it('verifies the caller has a real session', () => {
    expect(fn).toContain('/auth/v1/user');
    expect(fn).toContain('"not signed in"');
  });

  it('asks is_super_admin WITH THE CALLER\'S token, not the service role', () => {
    // Asking with the service-role key would answer for the service role and
    // let every restaurant owner through.
    const call = fn.slice(fn.indexOf('rpc/is_super_admin'), fn.indexOf('const isSuper'));
    expect(call).toContain('authorization: `Bearer ${jwt}`');
    expect(call).not.toContain('Bearer ${SERVICE_KEY}');
  });

  it('refuses anyone else with 403 rather than building', () => {
    expect(fn).toContain('return json({ error: "super admin only" }, 403)');
  });
});

describe('what it refuses to build', () => {
  it('validates the tenant id and the package id', () => {
    expect(fn).toContain('tenant_id is not a uuid');
    expect(fn).toContain('app_id is not a valid Android package id');
  });

  it('rejects an app name or icon the operator has not set', () => {
    // An APK with no icon ships the platform's logo to a restaurant's
    // customers, and one with no name shows the default under it.
    expect(panel).toContain('Give the app a name first');
    expect(panel).toContain('otherwise the APK ships the Digital Target logo');
  });

  it('derives a distinct package id per restaurant', () => {
    // Two restaurants sharing one id are the same app to every phone:
    // installing the second replaces the first, and takes its data.
    expect(panel).toContain('com.digitaltarget.${slug');
    expect(panel).toContain("replace(/[^a-z0-9]+/g, '')");
  });
});

describe('when it cannot work', () => {
  it('says so, instead of a generic failure', () => {
    // The missing token is the one failure an operator can actually fix.
    expect(fn).toContain('no_build_token');
    expect(fn).toContain('Add a GITHUB_APK_TOKEN secret');
  });

  it('reads a 404 as "the token cannot see the repository"', () => {
    // Which it almost always is, rather than a missing repository.
    expect(fn).toContain('The build token cannot reach');
  });
});
