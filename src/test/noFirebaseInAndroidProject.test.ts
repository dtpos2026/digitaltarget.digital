// ============================================================================
// The POS repository carries its own Customer Android project, separate from
// the one in dtpos.apk. v1.30.0 removed Firebase from dtpos.apk but this copy
// was missed: it still registered @capacitor/push-notifications, still carried
// the com.google.gms:google-services classpath, and the workflow still wrote a
// google-services.json into the build. Worse, it was internally inconsistent —
// capacitor.settings.gradle pointed at node_modules/@capacitor/push-
// notifications/android, a package no longer in package.json at all.
//
// This is the same guard dtpos.apk's tools/check.mjs applies, so the two
// repositories cannot drift apart again. Build files and the manifest only,
// never prose: MainActivity's comment says the word while explaining why the
// thing is gone.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

const BUILD_FILES = [
  'android/Customer/build.gradle',
  'android/Customer/app/build.gradle',
  'android/Customer/app/capacitor.build.gradle',
  'android/Customer/capacitor.settings.gradle',
  'android/Customer/app/src/main/AndroidManifest.xml',
  'capacitor.config.json',
];

// Written by `cap sync` from the files above and gitignored, so it is absent on
// a clean clone. Checked when present rather than asserted into existence.
const GENERATED = 'android/Customer/app/src/main/assets/capacitor.plugins.json';

const BANNED = [
  'google-services',
  'com.google.firebase',
  'firebase-messaging',
  'push-notifications',
  'PushNotifications',
  'POST_NOTIFICATIONS',
];

describe('Firebase stays out of the Android project', () => {
  for (const f of BUILD_FILES) {
    it(`${f} carries no Firebase wiring`, () => {
      expect(existsSync(resolve(ROOT, f)), `${f} is missing`).toBe(true);
      const body = read(f);
      for (const needle of BANNED) {
        expect(body, `${f} still mentions ${needle}`).not.toContain(needle);
      }
    });
  }

  it('registers no Capacitor plugins at all', () => {
    if (!existsSync(resolve(ROOT, GENERATED))) return; // not synced in this checkout
    expect(JSON.parse(read(GENERATED))).toEqual([]);
  });

  it('never had a google-services.json committed', () => {
    expect(existsSync(resolve(ROOT, 'android/Customer/app/google-services.json'))).toBe(false);
  });

  it('the workflow cannot put one back', () => {
    // The YAML only. The header comment names the file while explaining that
    // it is gone, exactly as MainActivity's does.
    const wf = read('.github/workflows/build-android.yml')
      .split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
    expect(wf).not.toContain('GOOGLE_SERVICES_JSON');
    expect(wf).not.toContain('google-services.json');
  });

  it('the push plugin is not a dependency', () => {
    const pkg = read('package.json');
    expect(pkg).not.toContain('@capacitor/push-notifications');
  });

  it('every firebase/* import is aliased to the stub, so no SDK can ship', () => {
    const vite = read('vite.config.ts');
    for (const m of ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage']) {
      expect(vite).toContain(`"${m}": path.resolve(process.cwd(), "./src/lib/firebaseStub.ts")`);
    }
    // and the real SDK is not installed
    expect(JSON.parse(read('package.json')).dependencies).not.toHaveProperty('firebase');
  });
});
