// Developer test for scripts/wincodesign.mjs — not part of `npm test` in the delivered ZIP.
//   WCS_ARCHIVE=/path/winCodeSign-2.6.0.7z SEVENZIP=/path/7za node --test scripts/wincodesign.test.mjs
// POSIX only: the "no symlink privilege" cases use a small sh wrapper around the real 7za.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureWinCodeSign, WIN_CODE_SIGN } from './wincodesign.mjs';

const ARCHIVE = process.env.WCS_ARCHIVE, SEVENZIP = process.env.SEVENZIP;
const skip = !ARCHIVE || !SEVENZIP || process.platform === 'win32' ? 'needs WCS_ARCHIVE, SEVENZIP and a POSIX shell' : false;
const quiet = () => {};
const serve = (buf) => async () => ({ ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
const cache = () => mkdtempSync(join(tmpdir(), 'wcs-cache-'));
const wrapper = (body) => { const f = join(mkdtempSync(join(tmpdir(), 'wcs-7z-')), '7za'); writeFileSync(f, `#!/bin/sh\n${body}\n`); chmodSync(f, 0o755); return f; };
const underWcs = (c) => readdirSync(join(c, 'winCodeSign'));

test('installs from the archive, leaves no scratch files, and a second call changes nothing', { skip }, async () => {
  const c = cache(), buf = readFileSync(ARCHIVE);
  const r = await ensureWinCodeSign({ cacheRoot: c, sevenZip: SEVENZIP, log: quiet, fetchImpl: serve(buf) });
  assert.equal(r.status, 'installed');
  assert.ok(existsSync(join(c, 'winCodeSign', WIN_CODE_SIGN.dir, 'rcedit-x64.exe')));
  assert.deepEqual(underWcs(c), [WIN_CODE_SIGN.dir]);
  const again = await ensureWinCodeSign({ cacheRoot: c, sevenZip: SEVENZIP, log: quiet, fetchImpl: async () => { throw new Error('must not download'); } });
  assert.equal(again.status, 'present');
});

test('Windows without the symlink privilege: two symlink errors and exit 2 are accepted', { skip }, async () => {
  const c = cache(), buf = readFileSync(ARCHIVE);
  // behave like 7-Zip on an unprivileged Windows account: everything extracted except the two links, "ERROR:" lines, exit 2
  const w = wrapper(`"${SEVENZIP}" "$@" >/dev/null\nout=$(for a in "$@"; do case "$a" in -o*) echo "\${a#-o}";; esac; done)\nrm -f "$out/darwin/10.12/lib/libcrypto.dylib" "$out/darwin/10.12/lib/libssl.dylib"\necho "ERROR: Cannot create symbolic link : A required privilege is not held by the client. : $out/darwin/10.12/lib/libcrypto.dylib" >&2\necho "ERROR: Cannot create symbolic link : A required privilege is not held by the client. : $out/darwin/10.12/lib/libssl.dylib" >&2\nexit 2`);
  const r = await ensureWinCodeSign({ cacheRoot: c, sevenZip: w, log: quiet, fetchImpl: serve(buf) });
  assert.equal(r.status, 'installed', r.reason);
  assert.ok(existsSync(join(c, 'winCodeSign', WIN_CODE_SIGN.dir, 'rcedit-x64.exe')));
  assert.ok(!existsSync(join(c, 'winCodeSign', WIN_CODE_SIGN.dir, 'darwin/10.12/lib/libssl.dylib')), 'the symlink really was absent');
  assert.deepEqual(underWcs(c), [WIN_CODE_SIGN.dir]);
});

test('any other 7-Zip error is a failure, and nothing is left under the real name', { skip }, async () => {
  const c = cache(), buf = readFileSync(ARCHIVE);
  const w = wrapper(`echo "ERROR: Data Error : x" >&2\nexit 2`);
  const r = await ensureWinCodeSign({ cacheRoot: c, sevenZip: w, log: quiet, fetchImpl: serve(buf) });
  assert.equal(r.status, 'skipped');
  assert.match(r.reason, /Data Error/);
  assert.deepEqual(underWcs(c), []);
});

test('a symlink error alone is not enough: rcedit must actually be there', { skip }, async () => {
  const c = cache(), buf = readFileSync(ARCHIVE);
  const w = wrapper(`echo "ERROR: Cannot create symbolic link : x" >&2\nexit 2`);
  const r = await ensureWinCodeSign({ cacheRoot: c, sevenZip: w, log: quiet, fetchImpl: serve(buf) });
  assert.equal(r.status, 'skipped');
  assert.match(r.reason, /rcedit is missing/);
  assert.deepEqual(underWcs(c), []);
});

test('a download that is not the expected archive is rejected before anything is extracted', { skip }, async () => {
  const c = cache(), buf = Buffer.from(readFileSync(ARCHIVE));
  buf[buf.length - 1] ^= 0xff;                                  // same size, one byte different
  const r = await ensureWinCodeSign({ cacheRoot: c, sevenZip: SEVENZIP, log: quiet, fetchImpl: serve(buf) });
  assert.equal(r.status, 'skipped');
  assert.match(r.reason, /SHA-512/);
  assert.deepEqual(underWcs(c), []);
  const short = await ensureWinCodeSign({ cacheRoot: c, sevenZip: SEVENZIP, log: quiet, fetchImpl: serve(buf.subarray(0, 100)) });
  assert.match(short.reason, /expected 5635384/);
});

test('an unreachable network is a skip with a reason, never a throw', { skip }, async () => {
  const c = cache();
  const r = await ensureWinCodeSign({ cacheRoot: c, sevenZip: SEVENZIP, log: quiet, fetchImpl: async () => { throw new Error('ENOTFOUND'); }, curl: '/nonexistent/curl' });
  assert.equal(r.status, 'skipped');
  assert.match(r.reason, /ENOTFOUND/);
});

test('a half-extracted folder under the real name (an earlier failed run) is replaced, not trusted', { skip }, async () => {
  const c = cache(), buf = readFileSync(ARCHIVE);
  mkdirSync(join(c, 'winCodeSign', WIN_CODE_SIGN.dir, 'darwin'), { recursive: true });
  const r = await ensureWinCodeSign({ cacheRoot: c, sevenZip: SEVENZIP, log: quiet, fetchImpl: serve(buf) });
  assert.equal(r.status, 'installed');
  assert.ok(existsSync(join(c, 'winCodeSign', WIN_CODE_SIGN.dir, 'rcedit-x64.exe')));
});
