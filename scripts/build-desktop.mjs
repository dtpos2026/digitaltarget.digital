// ============================================================================
// BUILD — desktop (Electron) target
//
// The Cloudflare build (scripts/build.mjs) produces an SSR worker: `_worker.js`
// plus assets, and NO index.html. A packaged desktop app has no server to run,
// so that output cannot be loaded from disk at all.
//
// This build turns on TanStack Start's SPA mode and Nitro's `static` preset, so
// the output is a plain client bundle with a prerendered shell index.html that
// the router hydrates. The desktop shell serves that directory over its own
// app:// protocol.
//
// It is the SAME application code — routes, components, store, sync, auth. Only
// the delivery differs. Nothing here duplicates POS logic.
//
// Output: dist-desktop/   (kept separate so a desktop build can never be
// mistaken for, or overwrite, the Cloudflare artifact in dist/)
// ============================================================================
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = 'dist-desktop';

process.env.DT_BUILD_TARGET = 'desktop';

console.log(`[build:desktop] DT_BUILD_TARGET=desktop -> ${OUT}/`);

const r = spawnSync('npx', ['vite', 'build'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});
if (r.status !== 0) process.exit(r.status ?? 1);

// A desktop build with no index.html is useless and must not ship silently.
const dir = resolve(process.cwd(), OUT);
const clientDir = resolve(dir, 'client');
const root = existsSync(resolve(clientDir, 'index.html'))
  ? clientDir
  : existsSync(resolve(dir, 'index.html'))
    ? dir
    : null;

if (!root) {
  console.error(`\n[build:desktop] BUILD INCOMPLETE — no index.html under ${OUT}/`);
  console.error('[build:desktop] The desktop shell has nothing to load. Do NOT package this.');
  if (existsSync(dir)) console.error(`[build:desktop] ${OUT}/ contains: ${readdirSync(dir).join(', ')}`);
  process.exit(1);
}

console.log(`\n[build:desktop] OK — client bundle at ${root}`);
console.log('[build:desktop] Point the desktop shell\'s renderer root at that directory.');
