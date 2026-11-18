// ============================================================================
// TEST — does the page reload with no signal, and does the kill switch work?   (v1.125.0)
//
// Run after `npm run build` (and once `npm run smoke:worker`, which installs wrangler):   node scripts/test-offline-reload.mjs
// Starts the BUILT app in workerd (as smoke-worker.mjs does), opens it in headless Chromium with service workers allowed, registers
// public/sw.js the way the page does after the owner opts in, then switches the network OFF and reloads. It signs in nowhere: the
// page it reloads is the sign-in screen, which is the same HTML, scripts and styles every screen starts from.
// Set CHROMIUM_PATH (e.g. /opt/pw-browsers/chromium) when Playwright's own browser is not installed.
// ============================================================================
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const TOOLS = join(tmpdir(), 'dt-smoke-wrangler');
const BIN = join(TOOLS, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
if (!existsSync(join(DIST, '_worker.js', 'index.js')) || !existsSync(join(DIST, 'sw.js'))) { console.error('dist/ is missing or has no sw.js — run `npm run build` first.'); process.exit(2); }
if (!existsSync(BIN)) { console.error('Run `npm run smoke:worker` once first: it installs wrangler into', TOOLS); process.exit(2); }
const { chromium } = createRequire(import.meta.url)('playwright');

const PORT = 8800 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(BIN, ['pages', 'dev', DIST, '--port', String(PORT), '--ip', '127.0.0.1'], { cwd: TOOLS, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
const stop = () => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid); } catch { /* gone */ } };
process.on('exit', stop);
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 60 && !/Ready on/.test(log); i++) await sleep(1000);
if (!/Ready on/.test(log)) { console.error('the worker never became ready\n' + log.slice(-800)); stop(); process.exit(1); }

let failed = false;
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${msg}`); if (!ok) failed = true; };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, serviceWorkers: 'allow' });
const page = await ctx.newPage();
const signInShown = async (ms = 20000) => page.waitForSelector('input', { timeout: ms }).then(() => true, () => false);

// 0. the file itself is served, as a script, and never cached by the browser
const sw = await fetch(`${BASE}/sw.js?v=test`);
check(sw.status === 200 && /javascript/.test(sw.headers.get('content-type') || ''), `GET /sw.js → ${sw.status} (${sw.headers.get('content-type')})`);

// 1. online: the page opens; then the worker is registered the way the page does it after the owner opts in
await page.goto(`${BASE}/`, { waitUntil: 'commit' });
check(await signInShown(60000), 'online: the page opens (the sign-in form is there)');
await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
await page.evaluate(async () => {
  await navigator.serviceWorker.register('/sw.js?v=test', { scope: '/', updateViaCache: 'none' });
  await navigator.serviceWorker.ready;
});
// a reload while online: the page and its files now pass through the worker and are kept
await page.reload({ waitUntil: 'commit' });
await signInShown(60000);
await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
await sleep(1500);
const kept = await page.evaluate(async () => {
  const names = await caches.keys();
  const shell = names.includes('dt-shell-test') ? await (await caches.open('dt-shell-test')).match('/') : null;
  const assets = names.includes('dt-assets') ? (await (await caches.open('dt-assets')).keys()).map(r => new URL(r.url).pathname) : [];
  return { names, page: !!shell, assets, controlled: !!navigator.serviceWorker.controller };
});
check(kept.controlled, 'the page is controlled by the worker after one online reload');
check(kept.page, 'the page (GET /) is kept in dt-shell-test');
check(kept.assets.length >= 5 && kept.assets.every(p => p.startsWith('/assets/')), `${kept.assets.length} build files are kept in dt-assets, all under /assets/`);

// 2. no signal: reload, and open the page again with a query string
await ctx.setOffline(true);
let offlineOk = false;
try { await page.reload({ waitUntil: 'commit', timeout: 20000 }); offlineOk = await signInShown(30000); } catch { offlineOk = false; }
check(offlineOk, 'NO SIGNAL: a reload still opens the page (the sign-in form is there)');
let queryOk = false;
try { await page.goto(`${BASE}/?device=till-2`, { waitUntil: 'commit', timeout: 20000 }); queryOk = await signInShown(30000); } catch { queryOk = false; }
check(queryOk, 'NO SIGNAL: the page also opens with a query string in the address');

// 3. what must never be answered from the copy
const posts = await page.evaluate(async () => {
  const r = {};
  try { await fetch('/api/custom-site/order/00000000-0000-4000-8000-000000000000', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }); r.post = 'answered'; } catch { r.post = 'failed (no network)'; }
  try { await fetch('/api/custom-site/order/00000000-0000-4000-8000-000000000000'); r.get = 'answered'; } catch { r.get = 'failed (no network)'; }
  return r;
});
check(posts.post.startsWith('failed') && posts.get.startsWith('failed'), `NO SIGNAL: /api is never answered from the copy (POST ${posts.post}, GET ${posts.get})`);
await ctx.setOffline(false);

// 4. a file that does not exist must not be stored (a missing script answered with the page must never be kept as a script)
const missing = await page.evaluate(async () => {
  const r = await fetch('/assets/definitely-missing-0000.js');
  const keys = (await (await caches.open('dt-assets')).keys()).map(k => new URL(k.url).pathname);
  return { status: r.status, type: r.headers.get('content-type') || '', stored: keys.includes('/assets/definitely-missing-0000.js') };
});
check(!missing.stored, `a missing /assets file (→ ${missing.status} ${missing.type.split(';')[0]}) is not stored`);

// 5. kill switch 1 — "?nosw=1" in the address (the app's own code, built into the bundle, does it)
await page.goto(`${BASE}/?nosw=1`, { waitUntil: 'commit' });
await signInShown(60000);
let gone = false;
for (let i = 0; i < 20 && !gone; i++) {
  await sleep(500);
  gone = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length === 0 && !(await caches.keys()).some(n => n.startsWith('dt-')));
}
check(gone, 'kill switch ?nosw=1: the worker is unregistered and every dt- copy is deleted');
check(!page.url().includes('nosw'), 'kill switch ?nosw=1: the parameter is dropped from the address');

// 6. after the kill switch the old behaviour is back: no signal → the page is gone (nothing is serving it)
await ctx.setOffline(true);
let goneOffline = false;
try { await page.goto(`${BASE}/`, { waitUntil: 'commit', timeout: 15000 }); goneOffline = !(await signInShown(5000)); } catch { goneOffline = true; }
check(goneOffline, 'after the kill switch, no signal means no page again (as before opt-in)');
await ctx.setOffline(false);

await browser.close();
stop();
console.log(failed ? '\n[offline] FAILED' : '\n[offline] reload with no signal works, and the kill switch puts everything back.');
process.exit(failed ? 1 : 0);
