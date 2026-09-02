// ============================================================================
// The Customer Android app lives in dtpos2026/dtpos.apk, and only there.
//
// This repository used to carry a SECOND copy of it — 53 tracked files under
// android/Customer, its own build-android.yml, its own capacitor.config.json.
// Two sources of truth for one app is how they drift, and they had: the copy
// here still registered @capacitor/push-notifications and still carried the
// google-services classpath long after v1.30.0 removed Firebase from the
// canonical apps, so a Firebase APK was one workflow_dispatch away. It was
// also internally broken — capacitor.settings.gradle included a Gradle
// subproject whose npm package was no longer in package.json at all.
//
// It is gone. This test is what stops it coming back, because a stray
// `npx cap add android` recreates the whole tree in one command.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const has = (p: string) => existsSync(resolve(ROOT, p));
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

describe('the Android project does not live in this repository', () => {
  for (const p of [
    'android',
    'android/Customer',
    'capacitor.config.json',
    '.github/workflows/build-android.yml',
    'scripts/android-doctor.mjs',
    'scripts/android-apk.mjs',
  ]) {
    it(`${p} is absent`, () => expect(has(p), `${p} is back`).toBe(false));
  }

  it('no Capacitor dependency remains to rebuild it from', () => {
    const pkg = JSON.parse(read('package.json'));
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(Object.keys(all).filter(d => d.startsWith('@capacitor/'))).toEqual([]);
  });

  it('no android:* script remains', () => {
    const scripts = JSON.parse(read('package.json')).scripts ?? {};
    expect(Object.keys(scripts).filter(s => s.startsWith('android:'))).toEqual([]);
  });

  // build:app is what dtpos.apk's refresh_bundle calls, so it MUST survive
  // the removal — deleting it would break the canonical APK build instead.
  it('build:app survives, because dtpos.apk builds the bundle with it', () => {
    expect(JSON.parse(read('package.json')).scripts).toHaveProperty('build:app');
  });
});

describe('the web app still keeps Firebase neutralised', () => {
  it('every firebase/* import resolves to the stub', () => {
    const vite = read('vite.config.ts');
    for (const m of ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage']) {
      expect(vite).toContain(`"${m}": path.resolve(process.cwd(), "./src/lib/firebaseStub.ts")`);
    }
  });

  it('the real SDK is not installed', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies ?? {}).not.toHaveProperty('firebase');
    expect(pkg.devDependencies ?? {}).not.toHaveProperty('firebase');
  });
});
