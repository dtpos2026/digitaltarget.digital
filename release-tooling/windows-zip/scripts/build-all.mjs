// ============================================================================
// One entry point for the whole Windows build.
//
//   npm install        installs the web app and the Electron shell
//   npm run build      web bundle -> shell renderer -> compiled shell
//   npm run dist       the above, then the Windows installer (NSIS + portable)
//   npm test           the web test suite and the shell's tests
//   npm run deploy     builds the website and publishes it to Cloudflare Pages
//                      (the same command the web app already used: `npm run deploy`)
//
// The two projects keep their own package.json and their own scripts; this file
// only runs them in the right order. It changes neither project.
//
// ONE THING IT DOES DO: it stamps the shell's version from the web app's.
// The POS compares its own version against the installed shell's
// (getAppVersion) to decide whether to offer an update. The two used to be
// numbered independently (shell 1.26.x, POS 1.6x), which made every installed
// copy look permanently out of date. Stamping here means the installer is named
// after the POS version it contains. The change is made in this copy only.
// ============================================================================
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'digitaltarget.digital');
const DESK = join(ROOT, 'dtpos-desktop');
const win = process.platform === 'win32';

const step = process.argv[2];
if (!['install', 'build', 'dist', 'test', 'deploy'].includes(step)) {
  console.error('usage: node scripts/build-all.mjs <install|build|dist|test|deploy>');
  process.exit(2);
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`[dt-pos] Node ${process.versions.node} is too old. Install Node 22 LTS or newer (https://nodejs.org).`);
  process.exit(1);
}

function run(label, cmd, args, cwd, env = {}) {
  console.log(`\n[dt-pos] ${label}\n[dt-pos]   (${cwd}) > ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: win, env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`\n[dt-pos] FAILED: ${label} (exit ${r.status ?? 'signal'})`);
    process.exit(r.status ?? 1);
  }
}

const install = (cwd, label) =>
  run(`install ${label}`, 'npm', [existsSync(join(cwd, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'], cwd);

function stampVersion() {
  const webVersion = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+$/.test(webVersion)) throw new Error(`web version "${webVersion}" is not x.y.z`);
  const file = join(DESK, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (pkg.version !== webVersion) {
    console.log(`[dt-pos] shell version ${pkg.version} -> ${webVersion} (same as the POS)`);
    pkg.version = webVersion;
    writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
    // keep the lockfile's own copy of the root version in step so `npm ci` does not object
    const lock = join(DESK, 'package-lock.json');
    if (existsSync(lock)) {
      const l = JSON.parse(readFileSync(lock, 'utf8'));
      l.version = webVersion; if (l.packages?.['']) l.packages[''].version = webVersion;
      writeFileSync(lock, JSON.stringify(l, null, 2) + '\n');
    }
  } else {
    console.log(`[dt-pos] shell version already ${webVersion}`);
  }
  return webVersion;
}

function build() {
  const version = stampVersion();
  run('build the POS client bundle (web, desktop target)', 'npm', ['run', 'build:desktop'], WEB);
  run('copy the bundle into the shell', 'npm', ['run', 'renderer'], DESK,
    { DTPOS_RENDERER: join(WEB, 'dist-desktop', 'client') });
  run('compile the shell', 'npm', ['run', 'build'], DESK);
  return version;
}

if (step === 'install') {
  install(WEB, 'the web app');
  install(DESK, 'the Electron shell');
  console.log('\n[dt-pos] installed. Next: npm run build   then   npm run dist');
}

if (step === 'build') {
  build();
  console.log('\n[dt-pos] build OK. Next: npm run dist');
}

if (step === 'dist') {
  if (!win) console.warn('[dt-pos] NOTE: the Windows installer is built on Windows (or by the CI workflow). On this OS it stops at the unpacked app.');
  const version = build();
  run('package the Windows installer', 'node', ['scripts/build-windows.mjs'], DESK);
  console.log(`\n[dt-pos] done. Installer: ${join(DESK, 'release', `DT-POS-Setup-${version}.exe`)}`);
  console.log(`[dt-pos]       Portable:  ${join(DESK, 'release', `DT-POS-Portable-${version}.exe`)}`);
}

if (step === 'test') {
  run('web tests', 'npx', ['vitest', 'run'], WEB);
  build();
  run('shell tests', 'npm', ['test'], DESK);
}

if (step === 'deploy') {
  // Publishes the WEBSITE (not the Windows app). Run it before building the Windows app:
  // the installed app sends its server calls (login, support, admin) to the website.
  const probe = spawnSync('wrangler', ['--version'], { shell: win, stdio: 'ignore' });
  if (probe.status !== 0) {
    console.error('[dt-pos] wrangler (the Cloudflare tool) is not installed on this PC.');
    console.error('[dt-pos]   npm install -g wrangler');
    console.error('[dt-pos]   wrangler login');
    console.error('[dt-pos] then run  npm run deploy  again. Nothing was built or published.');
    process.exit(1);
  }
  run('build and publish the website to Cloudflare Pages (project dt-pos)', 'npm', ['run', 'deploy'], WEB);
  console.log('\n[dt-pos] published. Open the site, press Ctrl+F5, and check the version reads ' +
    JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')).version + '.');
}
