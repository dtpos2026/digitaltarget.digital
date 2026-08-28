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
// It also checks the two things that are missing far more often than any file
// in the project — a JDK and the Android SDK — because Gradle reports those as
// walls of text that name neither. The SDK location it can repair itself.
//
//   node scripts/android-doctor.mjs            check, sync, verify
//   node scripts/android-doctor.mjs --clean     also delete the stale native
//                                               caches before syncing
//
// Exit code 0 means Gradle has everything it needs.
// ============================================================================
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const root = process.cwd();
const ANDROID = join('android', 'Customer');
const clean = process.argv.includes('--clean');
const isWin = process.platform === 'win32';

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const warn = (m) => console.log(`  warn  ${m}`);
const bad = (m) => { failed = true; console.log(`  FAIL  ${m}`); };

console.log('[android-doctor] checking the native project\n');

// ------------------------------------------------------------- 0. a JDK
//
// Android Gradle Plugin 8.x will not start on anything below Java 17, and the
// message it gives when it finds Java 11 or nothing at all names an internal
// class rather than the JDK. This is the first thing to establish.
{
  const probe = spawnSync('java', ['-version'], { encoding: 'utf8', shell: isWin });
  if (probe.error || probe.status !== 0) {
    bad('no Java runtime on PATH.\n' +
        '        Android needs a JDK (17 or newer; 21 is what CI uses).\n' +
        '        Windows:  winget install EclipseAdoptium.Temurin.21.JDK\n' +
        '        macOS:    brew install --cask temurin@21\n' +
        '        Linux:    sudo apt install openjdk-21-jdk\n' +
        '        Then open a NEW terminal so PATH is picked up.');
  } else {
    // Both stdout and stderr are used across JDK vendors and versions.
    const text = `${probe.stdout || ''}${probe.stderr || ''}`;
    const m = text.match(/version "(\d+)(?:\.(\d+))?/);
    const major = m ? (m[1] === '1' ? Number(m[2]) : Number(m[1])) : NaN;
    if (!Number.isFinite(major)) warn(`could not read the Java version from: ${text.split('\n')[0]}`);
    else if (major < 17) {
      bad(`Java ${major} is too old for the Android Gradle Plugin — 17 or newer is required.\n` +
          '        Install Temurin 21 and make sure it is first on PATH.');
    } else ok(`Java ${major} (JDK 17+ required)`);
  }
}

// ------------------------------------------------- 0b. the Android SDK
//
// Gradle finds the SDK through ANDROID_HOME / ANDROID_SDK_ROOT, or through
// sdk.dir in android/Customer/local.properties. local.properties is
// git-ignored (it is machine-specific), so a fresh clone has neither and the
// build stops with:
//
//     SDK location not found. Define a valid SDK location with an
//     ANDROID_HOME environment variable or by setting the sdk.dir path in
//     your project's local.properties file.
//
// On a machine that HAS Android Studio the SDK is sitting in a well-known
// place, so this writes the file rather than reporting the obvious.
function looksLikeSdk(dir) {
  if (!dir || !existsSync(dir)) return false;
  return existsSync(join(dir, 'platforms')) ||
         existsSync(join(dir, 'platform-tools')) ||
         existsSync(join(dir, 'cmdline-tools'));
}

function findSdk() {
  for (const env of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (looksLikeSdk(env)) return { dir: env, from: 'ANDROID_HOME / ANDROID_SDK_ROOT' };
  }
  const home = homedir();
  const candidates = isWin
    ? [join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Android', 'Sdk'),
       join(home, 'AppData', 'Local', 'Android', 'Sdk'),
       'C:\\Android\\Sdk']
    : process.platform === 'darwin'
      ? [join(home, 'Library', 'Android', 'sdk')]
      : [join(home, 'Android', 'Sdk'), join(home, 'android-sdk'), '/usr/lib/android-sdk'];
  for (const dir of candidates) if (looksLikeSdk(dir)) return { dir, from: 'the default install location' };
  return null;
}

const sdk = findSdk();
if (!sdk) {
  bad('the Android SDK was not found.\n' +
      '        Install Android Studio (it ships the SDK), open it once so it\n' +
      '        finishes downloading, then run this again. No environment\n' +
      '        variable is needed afterwards — this script writes the path in.\n' +
      '        Already installed somewhere unusual? Set ANDROID_HOME to it.');
} else {
  ok(`Android SDK at ${sdk.dir}  (found via ${sdk.from})`);

  // Write sdk.dir so Gradle does not depend on the environment of whichever
  // terminal happens to launch it. Backslashes are escapes in a .properties
  // file, so a Windows path has to be written the way Gradle reads it back.
  const propsPath = join(root, ANDROID, 'local.properties');
  const line = `sdk.dir=${sdk.dir.replace(/\\/g, '\\\\')}`;
  const current = existsSync(propsPath) ? readFileSync(propsPath, 'utf8') : '';
  if (!current.split(/\r?\n/).some(l => l.trim() === line)) {
    const kept = current.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('sdk.dir='));
    writeFileSync(propsPath, [...kept, line, ''].join('\n'));
    console.log(`  wrote ${join(ANDROID, 'local.properties')} -> ${line}`);
  } else {
    ok(`${join(ANDROID, 'local.properties')} already points at it`);
  }

  // compileSdkVersion comes from variables.gradle; Gradle downloads a missing
  // platform itself, so a missing one is a slow first build, not a failure.
  try {
    const vars = readFileSync(join(root, ANDROID, 'variables.gradle'), 'utf8');
    const want = (vars.match(/compileSdkVersion\s*=\s*(\d+)/) || [])[1];
    const have = existsSync(join(sdk.dir, 'platforms'))
      ? readdirSync(join(sdk.dir, 'platforms')) : [];
    if (want && !have.includes(`android-${want}`)) {
      warn(`SDK platform android-${want} is not installed (found: ${have.join(', ') || 'none'}).\n` +
           '        Gradle will fetch it on the first build — expect that build to be slow.\n' +
           `        To pre-install: sdkmanager "platforms;android-${want}"`);
    } else if (want) {
      ok(`SDK platform android-${want} installed`);
    }
  } catch { /* variables.gradle is checked properly below */ }
}

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

// ------------------------------------------- 8. the wrapper can be executed
//
// git preserves the executable bit, but a project delivered as a zip — which
// is how this one usually travels — does not. `./gradlew` then answers
// "Permission denied", which reads as a broken project rather than a file mode.
if (!isWin) {
  const wrapper = join(root, ANDROID, 'gradlew');
  if (existsSync(wrapper)) {
    try {
      const { chmodSync, statSync } = await import('node:fs');
      if (!(statSync(wrapper).mode & 0o111)) {
        chmodSync(wrapper, 0o755);
        console.log('  fixed  gradlew was not executable — chmod +x applied');
      } else ok('gradlew is executable');
    } catch (e) { warn(`could not check gradlew's mode: ${e.message}`); }
  }
}

console.log('');
if (failed) {
  console.error('[android-doctor] NOT ready — fix the FAIL lines above, then run again.');
  process.exit(1);
}
console.log('[android-doctor] ready. Build the APK with:');
console.log('    npm run android:apk');
console.log(`  or by hand: cd ${ANDROID} && ${isWin ? 'gradlew.bat' : './gradlew'} assembleDebug`);
