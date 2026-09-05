// ============================================================================
// v1.48.0 — Super Admin can build the staff apps, and cannot brand them.
//
// REPORTED: "rider app apk ka b BUTT BBQ ata, order taker app ka b BUTT BBQ
// name ata — koi super admin me nhi branding kr skty."
//
// Both halves are real and pull in opposite directions. The names WERE wrong,
// because a build was started with a restaurant selected and the branding step
// renamed all three apps. And there was no way to build these two from Super
// Admin at all, because the panel hard-coded apps:'Customer'.
//
// The answer is not per-restaurant branding: these two are ONE build serving
// every restaurant, and branding them per restaurant is what broke them.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { versionCodeFor } from '@/components/CustomerAppsManager';

const ROOT = process.cwd();
const code = (f: string) =>
  readFileSync(resolve(ROOT, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

const FN = code('supabase/functions/apk-build/index.ts');
const PANEL = code('src/components/StaffAppsBuilder.tsx');

describe('Android will accept the versionCode we send', () => {
  it('rises with the version name', () => {
    expect(versionCodeFor('1.0.0')).toBe('10000');
    expect(versionCodeFor('1.2.3')).toBe('10203');
    expect(versionCodeFor('2.0.0')).toBe('20000');
    expect(Number(versionCodeFor('1.2.4'))).toBeGreaterThan(Number(versionCodeFor('1.2.3')));
    expect(Number(versionCodeFor('1.3.0'))).toBeGreaterThan(Number(versionCodeFor('1.2.99')));
    expect(Number(versionCodeFor('2.0.0'))).toBeGreaterThan(Number(versionCodeFor('1.99.99')));
  });

  it('refuses what it cannot encode rather than emitting a number that goes backwards', () => {
    // 1.100.0 would collide with 2.0.0 under this encoding, and a versionCode
    // that does not rise is an APK the phone will not install.
    expect(versionCodeFor('1.100.0')).toBe('');
    expect(versionCodeFor('')).toBe('');
    expect(versionCodeFor('not-a-version')).toBe('');
  });

  it('is sent with the build, which it never used to be', () => {
    // Without it every build shipped versionCode 1, so the SECOND APK a
    // restaurant was given failed with INSTALL_FAILED_VERSION_DOWNGRADE.
    expect(code('src/components/CustomerAppsManager.tsx')).toContain('version_code: versionCodeFor(');
    expect(PANEL).toContain('version_code: code');
    expect(FN).toContain('version_code: versionCode');
    expect(FN).toContain('app_version: appVersion');
  });

  it('is validated on the server, not only in the form', () => {
    expect(FN).toContain('version_code must be a whole number');
    expect(FN).toContain('app_version must look like 1.2.3');
  });
});

describe('the staff apps are one build for every restaurant', () => {
  it('the panel sends no tenant', () => {
    const at = PANEL.indexOf("functions.invoke('apk-build'");
    const body = PANEL.slice(at, at + 500);
    expect(body).not.toContain('tenant_id');
  });

  it('the server refuses a tenant on them, so no other caller can either', () => {
    expect(FN).toContain('staff_apps_are_shared');
    expect(FN).toContain('(apps === "Rider" || apps === "OrderTaker") && tenantId');
  });

  it('both apps and an all-three build are reachable from Super Admin', () => {
    expect(PANEL).toContain("'Rider'");
    expect(PANEL).toContain("'OrderTaker'");
    expect(PANEL).toContain("build('all')");
    expect(code('src/pages/SuperAdminPage.tsx')).toContain('<StaffAppsBuilder />');
  });

  it('says why there is no restaurant to pick, rather than leaving it looking broken', () => {
    expect(PANEL).toContain('one build for every restaurant');
  });
});
