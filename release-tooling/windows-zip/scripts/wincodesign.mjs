// ============================================================================
// Put electron-builder's `winCodeSign` download in place BEFORE packaging, without
// needing the Windows symbolic-link privilege.
//
// WHY
//   Packaging stamps the icon and version into DT POS.exe with rcedit, and rcedit
//   ships inside the `winCodeSign` archive — even for an unsigned build. That
//   archive also holds two macOS symlinks (darwin/10.12/lib/libcrypto.dylib and
//   libssl.dylib). electron-builder extracts it with `7za x -snld`; on Windows an
//   ordinary user cannot create a symlink, 7-Zip reports 2 errors, exits 2, and
//   electron-builder gives up — after downloading the same 5.6 MB four times.
//   The two symlinks are macOS tools. Nothing on Windows uses them.
//
// WHAT THIS DOES
//   Downloads the same archive from the same URL, checks its size and SHA-512,
//   extracts it into a scratch folder, accepts ONLY the symlink errors (any other
//   error is a real failure), checks that rcedit is there, and only then renames
//   the folder to the name electron-builder looks for:
//       <cache>\winCodeSign\winCodeSign-2.6.0
//   A half-extracted folder is therefore never left under that name. electron-builder
//   finds the folder and does not download or extract anything.
//
// IT NEVER THROWS. If anything goes wrong it says why and returns, and packaging
// carries on exactly as it did before this file existed.
// ============================================================================
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const WIN_CODE_SIGN = Object.freeze({
  dir: 'winCodeSign-2.6.0',
  url: 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z',
  size: 5635384,
  sha512: 'e8b408d9df413c2dd7b346684d07b5a37b4f880dbc73bf8f63af50f62fe90fc958e39a6c32d1ee2f0bf7bd1724895af7671d5c6cdc8b94147c493c0275c1f0b4',
});

// On Windows, the exact command electron-builder runs is `7za x -snld -bd`; the log of the failed first build shows it ending in
// exactly two "Cannot create symbolic link" errors and exit 2, so the same switch is used here. The Linux 7za that the tests use is
// version 16.02 and does not know -snld.
const LINK_SWITCH = process.platform === 'win32' ? ['-snld'] : [];
const NEEDED = ['rcedit-x64.exe', 'rcedit-ia32.exe'];
const complete = (dir) => NEEDED.every((f) => existsSync(join(dir, f)));

async function download(url, file, fetchImpl, curl) {
  try {
    const res = await fetchImpl(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return null;
  } catch (e) {
    // Node's fetch ignores HTTPS_PROXY; curl (built into Windows 10+) honours it.
    const r = spawnSync(curl, ['-fsSL', '-o', file, url], { stdio: 'ignore' });
    return r.status === 0 ? null : `download failed (${e.message}; curl ${r.error ? 'not available' : `exit ${r.status}`})`;
  }
}

/**
 * @returns {Promise<{status:'present'|'installed'|'skipped', reason?:string, dir:string}>}
 */
export async function ensureWinCodeSign({ cacheRoot, sevenZip, log = console.log, fetchImpl = globalThis.fetch, curl = 'curl' }) {
  const parent = join(cacheRoot, 'winCodeSign');
  const final = join(parent, WIN_CODE_SIGN.dir);
  const partial = join(parent, `${WIN_CODE_SIGN.dir}.partial`);
  const archive = join(parent, `${WIN_CODE_SIGN.dir}.download.7z`);
  const skip = (reason) => { rmSync(partial, { recursive: true, force: true }); rmSync(archive, { force: true }); return { status: 'skipped', reason, dir: final }; };

  if (complete(final)) return { status: 'present', dir: final };
  try {
    // a folder under the real name that lacks rcedit is a failed earlier attempt: it would be trusted and break the build
    rmSync(final, { recursive: true, force: true });
    mkdirSync(parent, { recursive: true });

    log(`[dt-pos] preparing the Windows icon/version tool (winCodeSign, ${(WIN_CODE_SIGN.size / 1048576).toFixed(1)} MB, once)`);
    const failed = await download(WIN_CODE_SIGN.url, archive, fetchImpl, curl);
    if (failed) return skip(failed);

    const bytes = readFileSync(archive);
    if (bytes.length !== WIN_CODE_SIGN.size) return skip(`download is ${bytes.length} bytes, expected ${WIN_CODE_SIGN.size}`);
    if (createHash('sha512').update(bytes).digest('hex') !== WIN_CODE_SIGN.sha512) return skip('download does not match the expected SHA-512');

    rmSync(partial, { recursive: true, force: true });
    const x = spawnSync(sevenZip, ['x', ...LINK_SWITCH, '-bd', '-y', archive, `-o${partial}`], { encoding: 'utf8' });
    if (x.error) return skip(`could not run 7-Zip (${x.error.message})`);
    // Exit 2 is what 7-Zip returns for the two symlink errors, so the exit code alone cannot tell them from a real failure:
    // read the error lines instead. Every one must be "Cannot create symbolic link".
    const errors = `${x.stdout}\n${x.stderr}`.split(/\r?\n/).filter((l) => /^\s*ERROR:/.test(l));
    const other = errors.filter((l) => !/Cannot create symbolic link/.test(l));
    if (other.length) return skip(`7-Zip reported: ${other[0].trim()}`);
    if (x.status !== 0 && x.status !== 1 && x.status !== 2) return skip(`7-Zip exit code ${x.status}`);
    if (!complete(partial)) return skip('rcedit is missing from the extracted folder');

    renameSync(partial, final);
    rmSync(archive, { force: true });
    return { status: 'installed', dir: final };
  } catch (e) {
    return skip(e.message);
  }
}
