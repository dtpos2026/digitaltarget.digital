// ============================================================================
// BUILD THE APK — one command, and a real sentence when it cannot
//
// `cd android/Customer && ./gradlew assembleDebug` is the actual build, but on
// a fresh machine it fails three ways before it compiles anything (no JDK, no
// SDK location, no generated Cordova gradle files) and reports each of them as
// something else. android-doctor settles all three; this runs it first, then
// the build, then says where the APK is.
//
//   npm run android:apk              debug APK, installable immediately
//   npm run android:apk -- --release signed release (needs the keystore env)
//   npm run android:apk -- --clean   wipe the native caches first
//
// A release build reads DT_KEYSTORE_PATH / DT_KEYSTORE_PASSWORD /
// DT_KEY_ALIAS / DT_KEY_PASSWORD, the same names the CI workflow uses.
// ============================================================================
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const ANDROID = join('android', 'Customer');
const args = process.argv.slice(2);
const release = args.includes('--release');
const isWin = process.platform === 'win32';

// ------------------------------------------------------------ 1. the doctor
const doctorArgs = ['scripts/android-doctor.mjs'];
if (args.includes('--clean')) doctorArgs.push('--clean');
const doctor = spawnSync(process.execPath, doctorArgs, { cwd: root, stdio: 'inherit' });
if (doctor.status !== 0) {
  console.error('\n[android-apk] the project is not ready to build — see the FAIL lines above.');
  process.exit(doctor.status ?? 1);
}

// ------------------------------------------------------------- 2. the build
if (release) {
  const missing = ['DT_KEYSTORE_PATH', 'DT_KEYSTORE_PASSWORD', 'DT_KEY_ALIAS', 'DT_KEY_PASSWORD']
    .filter(k => !process.env[k]);
  if (missing.length) {
    console.error(
      `\n[android-apk] a release build needs ${missing.join(', ')}.\n` +
      '              An unsigned release APK cannot be installed on a phone, so this\n' +
      '              stops rather than producing one. For testing use the debug build:\n' +
      '                  npm run android:apk',
    );
    process.exit(1);
  }
}

const task = release ? 'assembleRelease' : 'assembleDebug';
const gradlew = isWin ? 'gradlew.bat' : './gradlew';
console.log(`\n[android-apk] ${ANDROID} > ${gradlew} --no-daemon ${task}\n`);

const build = spawnSync(gradlew, ['--no-daemon', task], {
  cwd: join(root, ANDROID), stdio: 'inherit', shell: isWin,
});

if (build.status !== 0) {
  console.error('\n[android-apk] Gradle failed. The three that account for almost every case:');
  console.error('  • "SDK location not found"      -> run npm run android:doctor; it writes local.properties');
  console.error('  • "Could not resolve com.android.tools.build:gradle"');
  console.error('                                  -> the machine cannot reach dl.google.com. That host serves');
  console.error('                                     the Android plugin and nothing else mirrors it. Behind a');
  console.error('                                     proxy or a filtered network, use the GitHub Actions');
  console.error('                                     workflow "Build Android customer APK" instead.');
  console.error('  • "cordova.variables.gradle does not exist"');
  console.error('                                  -> npm run android:clean, then try again.');
  process.exit(build.status ?? 1);
}

// ------------------------------------------------------------ 3. the result
const outDir = join(root, ANDROID, 'app', 'build', 'outputs', 'apk');
const found = [];
(function walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith('.apk')) found.push(p);
  }
})(outDir);

if (found.length === 0) {
  console.error('\n[android-apk] Gradle reported success but produced no APK. Nothing to install.');
  process.exit(1);
}

console.log('\n[android-apk] done:');
for (const apk of found) {
  console.log(`    ${apk}  (${(statSync(apk).size / 1024 / 1024).toFixed(2)} MB)`);
}
console.log('\nInstall on a phone plugged in over USB:');
console.log(`    adb install -r "${found[0]}"`);
