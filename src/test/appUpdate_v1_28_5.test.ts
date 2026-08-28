// ============================================================================
// v1.28.5 — "there is no update"
//
// customer_apps has carried app_version, min_supported_version, update_url and
// update_required since v1.27.0, and Super Admin has been able to edit all four
// since the panel was built. Nothing read them. A restaurant could raise the
// version, publish a new APK and point update_url at it, and every phone still
// running last month's build carried on as if nothing had happened, because no
// code anywhere compared the two numbers.
//
// These assert the comparison that closes that: which of the three answers
// follows from what the server says and what the build is, and — just as
// important — every case where the answer must be "say nothing".
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions, evaluateUpdate } from '@/lib/appUpdate';
import type { CustomerAppConfig } from '@/lib/customerAppConfig';

/** A configured restaurant, with only the update fields that matter here. */
function cfg(over: Partial<CustomerAppConfig> = {}): CustomerAppConfig {
  return {
    tenantId: 't1', enabled: true, appName: 'Test', logoUrl: null, iconUrl: null,
    primaryColor: null, mode: null, whatsappNumber: null, features: {},
    appVersion: null, minSupportedVersion: null, updateUrl: null,
    updateRequired: false, requireClaimOtp: false,
    ...over,
  };
}

const decide = (installed: string | null, over: Partial<CustomerAppConfig> = {}) =>
  evaluateUpdate({ config: cfg(over), installed, native: true });

describe('comparing two versions a human typed into a form', () => {
  it('orders them numerically, not as text', () => {
    // The bug a string compare gives you: "1.10.0" < "1.9.0".
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('treats a missing segment as zero, so 1.2 and 1.2.0 are the same release', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.1')).toBeLessThan(0);
  });

  it('forgives the shapes people actually type', () => {
    expect(compareVersions(' v1.4.0 ', '1.4.0')).toBe(0);
    expect(compareVersions('1.4.0-beta', '1.4.0')).toBe(0);
  });

  it('never reads nonsense as newer than everything', () => {
    expect(compareVersions('latest', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('', '0.0.1')).toBeLessThan(0);
  });
});

describe('when the app must say nothing at all', () => {
  it('says nothing in a browser — a website is never behind itself', () => {
    const d = evaluateUpdate({
      config: cfg({ appVersion: '9.9.9', updateRequired: true }),
      installed: '1.0.0',
      native: false,
    });
    expect(d.state).toBe('none');
  });

  it('says nothing when this build carries no version', () => {
    expect(decide(null, { appVersion: '2.0.0' }).state).toBe('none');
    expect(decide('', { appVersion: '2.0.0' }).state).toBe('none');
  });

  it('says nothing when the restaurant has published no version', () => {
    expect(decide('1.0.0', { appVersion: null }).state).toBe('none');
    // A blank left in the Super Admin form is not a release.
    expect(decide('1.0.0', { appVersion: '   ' }).state).toBe('none');
  });

  it('says nothing when the build is current, or ahead of it', () => {
    expect(decide('2.0.0', { appVersion: '2.0.0' }).state).toBe('none');
    // A tester carrying a build newer than the published one is not out of date.
    expect(decide('2.1.0', { appVersion: '2.0.0' }).state).toBe('none');
  });

  it('says nothing with no config at all', () => {
    expect(evaluateUpdate({ config: null, installed: '1.0.0', native: true }).state).toBe('none');
  });
});

describe('when there is a newer version', () => {
  it('suggests it, and can be ignored', () => {
    const d = decide('1.0.0', { appVersion: '1.1.0', updateUrl: 'https://x/app.apk' });
    expect(d.state).toBe('optional');
    expect(d.latest).toBe('1.1.0');
    expect(d.url).toBe('https://x/app.apk');
  });

  it('insists when the restaurant marked the release required', () => {
    expect(decide('1.0.0', { appVersion: '1.1.0', updateRequired: true }).state).toBe('required');
  });

  it('does not insist on a release the build already has, even marked required', () => {
    // update_required is about a RELEASE, not a permanent state of the app.
    expect(decide('1.1.0', { appVersion: '1.1.0', updateRequired: true }).state).toBe('none');
  });
});

describe('a build the server no longer supports', () => {
  it('forces, whatever the restaurant asked for', () => {
    const d = decide('1.0.0', {
      appVersion: '2.0.0', minSupportedVersion: '1.5.0', updateRequired: false,
    });
    expect(d.state).toBe('required');
    expect(d.reason).toContain('minimum supported version');
  });

  it('is checked before the ordinary comparison, so a hard stop is never softened', () => {
    // Nothing published as "latest", but this build is below the floor: still a stop.
    expect(decide('1.0.0', { appVersion: null, minSupportedVersion: '1.5.0' }).state).toBe('required');
  });

  it('leaves a build at the floor alone', () => {
    expect(decide('1.5.0', { appVersion: '1.5.0', minSupportedVersion: '1.5.0' }).state).toBe('none');
  });
});

describe('the build knows its own version', () => {
  const buildApp = readFileSync(join(process.cwd(), 'scripts/build-app.mjs'), 'utf8');

  it('build:app writes the version into the bundle', () => {
    // Without this there is no number to compare and the whole check is inert —
    // which is exactly the state this release fixes.
    expect(buildApp).toContain('appVersion');
    expect(buildApp).toContain("join(dest, 'dt-app.json')");
  });

  it('writes it even when no restaurant is bound', () => {
    // The file used to be written only inside `if (tenant)`, so a picker build
    // carried no version at all.
    const at = buildApp.indexOf("join(dest, 'dt-app.json')");
    const boot = buildApp.indexOf('bound to tenant');
    expect(at).toBeGreaterThan(boot);
  });
});

describe('the gate that renders it', () => {
  const gate = readFileSync(join(process.cwd(), 'src/components/AppUpdateGate.tsx'), 'utf8');
  const page = readFileSync(join(process.cwd(), 'src/pages/OnlineOrderPage.tsx'), 'utf8');

  it('is mounted on the customer surface', () => {
    expect(page).toContain('<AppUpdateGate config={appConfig} />');
  });

  it('a required update offers no way past', () => {
    const required = gate.slice(gate.indexOf("state === 'required'"), gate.indexOf('optional\n'));
    expect(required).not.toContain('setDismissed');
  });

  it('says something true when update_required has no url to send them to', () => {
    // A button that does nothing is worse than a sentence.
    expect(gate).toContain('contact the restaurant');
  });
});
