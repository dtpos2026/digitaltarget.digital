// ============================================================================
// ANDROID DOCTOR — make the native project buildable, or say exactly why not
//
// THE FAILURE THIS EXISTS FOR
//
//   Could not read script '.../android/Customer/capacitor-cordova-android-
//   plugins/cordova.variables.gradle' as it does not exist.
//
// It is not a corrupt checkout. `android/Customer/settings.gradle` includes the
// `capacitor-cordova-android-plugins` project unconditionally:
//
//     include ':capacitor-cordova-android-plugins'
//
// while Capacitor's own `android/Customer/.gitignore` excludes that whole
// directory, because Capacitor regenerates it. So the directory is absent in
// every fresh clone, and Gradle fails before it compiles a line. The build
// sequence has to run `npx cap sync android` first — this script is that step,
// plus the checks that turn a cryptic Gradle error into a sentence.
//
//   node scripts/android-doctor.mjs            check, sync, verify
//   node scripts/android-doctor.mjs --clean     also delete the stale native
//                                               caches before syncing
//
// Exit code 0 means Gradle has everything it needs.
// ============================================================================
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = process.cwd();
const ANDROID = join('android', 'Customer');
const clean = process.argv.includes('--clean');

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const warn = (m) => console.log(`  warn  ${m}`);
const bad = (m) => { failed = true; console.log(`  FAIL  ${m}`); };

console.log('[android-doctor] checking the native project\n');

// ---------------------------------------------------------------- 1. the path
//
// Gradle, the Android SDK and the NDK have a long history of mishandling
// project paths containing spaces or shell-significant characters. A folder
// like "dt pos (3)" — the shape a browser gives a re-downloaded zip — produces
// errors that name a missing file rather than the real cause, so it is worth
// saying plainly before anything else runs.
const abs = resolve(root);
if (/[()]/.test(abs)) {
  bad(`the project path contains parentheses: ${abs}\n` +
      '        Android builds break on these in ways that report as missing files.\n' +
      '        Move the project somewhere like C:\\dtpos and run again.');
} else if (/\s/.test(abs)) {
  warn(`the project path contains spaces: ${abs}\n` +
       '        This usually works, but is the first thing to rule out if Gradle\n' +
       '        reports a file it can plainly see.');
} else if (/[^\x20-\x7e]/.test(abs)) {
  warn(`the project path contains non-ASCII characters: ${abs}`);
} else {
  ok('project path is safe for Gradle');
}

// ------------------------------------------------ 2. the platform is present
if (!existsSync(join(root, ANDROID, 'settings.gradle'))) {
  bad(`${ANDROID} is missing entirely.\n` +
      '        Run:  npx cap add android');
  process.exit(1);
}
ok(`${ANDROID} exists`);

// ----------------------------------------- 3. the web bundle Capacitor copies
const webDir = (() => {
  try { return JSON.parse(readFileSync(join(root, 'capacitor.config.json'), 'utf8')).webDir; }
  catch { return 'dist/client'; }
})();
if (!existsSync(join(root, webDir, 'index.html'))) {
  bad(`the web bundle is missing: ${webDir}/index.html\n` +
      '        Run:  npm run build:app');
} else {
  ok(`web bundle present (${webDir})`);
}

// ------------------------------------------------------- 4. clear stale state
if (clean) {
  for (const dir of [
    join(ANDROID, 'capacitor-cordova-android-plugins'),
    join(ANDROID, 'app', 'src', 'main', 'assets', 'public'),
    join(ANDROID, '.gradle'),
    join(ANDROID, 'build'),
    join(ANDROID, 'app', 'build'),
  ]) {
    const p = join(root, dir);
    if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); console.log(`  clean ${dir}`); }
  }
}

// ------------------------------------------------------------- 5. regenerate
//
// `cap sync` copies the web bundle in AND writes the generated Gradle files
// that settings.gradle expects. It is the step whose absence produces the
// error at the top of this file.
console.log('\n[android-doctor] npx cap sync android\n');
const sync = spawnSync('npx', ['cap', 'sync', 'android'], {
  cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
});
if (sync.status !== 0) {
  console.error('\n[android-doctor] cap sync failed — nothing below could pass.');
  process.exit(sync.status ?? 1);
}

// ------------------------------------- 6. every file Gradle is about to read
console.log('\n[android-doctor] verifying the generated Gradle inputs\n');
const required = [
  // Committed — part of the repository.
  [join(ANDROID, 'settings.gradle'), 'committed'],
  [join(ANDROID, 'variables.gradle'), 'committed'],
  [join(ANDROID, 'capacitor.settings.gradle'), 'committed'],
  [join(ANDROID, 'app', 'capacitor.build.gradle'), 'committed'],
  [join(ANDROID, 'app', 'build.gradle'), 'committed'],
  [join(ANDROID, 'app', 'src', 'main', 'AndroidManifest.xml'), 'committed'],
  // Generated by cap sync — absent in a fresh clone, which is the whole point.
  [join(ANDROID, 'capacitor-cordova-android-plugins', 'cordova.variables.gradle'), 'generated'],
  [join(ANDROID, 'capacitor-cordova-android-plugins', 'build.gradle'), 'generated'],
  [join(ANDROID, 'app', 'src', 'main', 'assets', 'capacitor.config.json'), 'generated'],
  [join(ANDROID, 'app', 'src', 'main', 'assets', 'public', 'index.html'), 'generated'],
];
for (const [rel, kind] of required) {
  if (existsSync(join(root, rel))) ok(`${rel}  (${kind})`);
  else bad(`${rel} is still missing after cap sync  (${kind})`);
}

// ------------------------------------- 7. every plugin is actually registered
//
// A plugin present in package.json but absent from capacitor.settings.gradle
// compiles to a runtime "plugin not implemented" rather than a build error, so
// it is worth catching here where it is cheap.
try {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const plugins = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter(d => d.startsWith('@capacitor/') &&
      !['@capacitor/core', '@capacitor/cli', '@capacitor/android', '@capacitor/ios'].includes(d));
  const settings = readFileSync(join(root, ANDROID, 'capacitor.settings.gradle'), 'utf8');
  const appGradle = readFileSync(join(root, ANDROID, 'app', 'capacitor.build.gradle'), 'utf8');
  if (plugins.length === 0) {
    ok('no Capacitor plugins to register');
  } else {
    for (const p of plugins) {
      const slug = p.replace('@capacitor/', 'capacitor-');
      const inSettings = settings.includes(slug);
      const inApp = appGradle.includes(slug);
      if (inSettings && inApp) ok(`${p} registered in settings.gradle and app/build`);
      else bad(`${p} is installed but ${!inSettings ? 'missing from capacitor.settings.gradle' : 'missing from app/capacitor.build.gradle'}`);
    }
  }
} catch (e) {
  warn(`could not verify plugin registration: ${e.message}`);
}

console.log('');
if (failed) {
  console.error('[android-doctor] NOT ready — fix the FAIL lines above, then run again.');
  process.exit(1);
}
console.log('[android-doctor] ready. Next:');
console.log(`    cd ${ANDROID} && ./gradlew assembleDebug        (or gradlew.bat on Windows)`);
