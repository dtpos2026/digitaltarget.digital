// ============================================================================
// BRAND — stamp one restaurant's identity onto the Android customer app
//
// The customer app is white-label: every restaurant gets its own launcher name
// and its own package id, from the same source tree. This rewrites the three
// places Android actually reads that from:
//
//   capacitor.config.json                 appId / appName
//   android/Customer/app/build.gradle     applicationId, versionCode/Name
//   .../res/values/strings.xml            app_name, title_activity_main
//
// `namespace` is deliberately NOT rewritten. It is the package the R class and
// MainActivity are compiled into; changing it without moving the Java sources
// breaks the build. `applicationId` is what identifies the app on a device and
// in the Play Console, and that is the one that has to differ per restaurant.
//
//   APP_ID=com.foo.bar APP_NAME="Foo Grill" node scripts/brand-app.mjs
// ============================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const appId = (process.env.APP_ID || '').trim();
const appName = (process.env.APP_NAME || '').trim();
const versionName = (process.env.APP_VERSION || '').trim();
const versionCode = (process.env.APP_VERSION_CODE || '').trim();

if (appId && !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(appId)) {
  console.error(`[brand-app] APP_ID is not a valid Android package id: ${appId}`);
  process.exit(1);
}
if (versionCode && !/^\d+$/.test(versionCode)) {
  console.error(`[brand-app] APP_VERSION_CODE must be a whole number: ${versionCode}`);
  process.exit(1);
}
if (!appId && !appName && !versionName && !versionCode) {
  console.log('[brand-app] nothing to change (no APP_ID / APP_NAME / APP_VERSION set)');
  process.exit(0);
}

const root = process.cwd();
const edit = (path, fn) => {
  const full = resolve(root, path);
  if (!existsSync(full)) {
    console.log(`[brand-app] skip (absent): ${path}`);
    return;
  }
  const before = readFileSync(full, 'utf8');
  const after = fn(before);
  if (after !== before) {
    writeFileSync(full, after, 'utf8');
    console.log(`[brand-app] updated ${path}`);
  }
};

// 1. Capacitor config — what `cap sync` copies into the app.
edit('capacitor.config.json', (raw) => {
  const cfg = JSON.parse(raw);
  if (appId) cfg.appId = appId;
  if (appName) cfg.appName = appName;
  return JSON.stringify(cfg, null, 2) + '\n';
});

// 2. Gradle — the id the device installs under.
edit('android/Customer/app/build.gradle', (raw) => {
  let out = raw;
  if (appId) out = out.replace(/applicationId\s+"[^"]*"/, `applicationId "${appId}"`);
  if (versionCode) out = out.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
  if (versionName) out = out.replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);
  return out;
});

// 3. Strings — the name under the launcher icon.
edit('android/Customer/app/src/main/res/values/strings.xml', (raw) => {
  let out = raw;
  if (appName) {
    const esc = appName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    out = out.replace(/(<string name="app_name">)[^<]*(<\/string>)/, `$1${esc}$2`);
    out = out.replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${esc}$2`);
  }
  if (appId) {
    out = out.replace(/(<string name="custom_url_scheme">)[^<]*(<\/string>)/, `$1${appId}$2`);
  }
  return out;
});

console.log('[brand-app] done');
