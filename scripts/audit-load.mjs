// ============================================================================
// AUDIT — how much does the first load cost, and what happens with no network?   (v1.119.0)
//
// Run after `npm run build`:   node scripts/audit-load.mjs
//
// Starts the BUILT app in workerd (the way smoke-worker.mjs does), opens it in headless Chromium and reports, for the first load:
//   • every script and style that was fetched, with its size on the wire, biggest first, and the total;
//   • the time to the first paint of the app (the sign-in screen) on this machine, plain and with the CPU slowed 4× (a cheap phone);
//   • what a reload does with the network switched off (no service worker is registered, so the honest answer is "the page is gone").
// It signs in nowhere, so it measures the sign-in route; the per-screen chunks are listed by size from dist/assets.
// ============================================================================
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const TOOLS = join(tmpdir(), 'dt-smoke-wrangler');
const BIN = join(TOOLS, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
if (!existsSync(join(DIST, '_worker.js', 'index.js'))) { console.error('dist/ is missing — run `npm run build` first.'); process.exit(2); }
if (!existsSync(BIN)) { console.error('Run `npm run smoke:worker` once first: it installs wrangler into', TOOLS); process.exit(2); }
const { chromium } = createRequire(import.meta.url)('playwright');

const PORT = 8900 + Math.floor(Math.random() * 90);
const child = spawn(BIN, ['pages', 'dev', DIST, '--port', String(PORT), '--ip', '127.0.0.1'], { cwd: TOOLS, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
const stop = () => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid); } catch { /* gone */ } };
process.on('exit', stop);
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 60 && !/Ready on/.test(log); i++) await sleep(1000);
if (!/Ready on/.test(log)) { console.error('the worker never became ready\n' + log.slice(-800)); stop(); process.exit(1); }

const kb = n => `${(n / 1024).toFixed(0)} KB`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
async function load(cpu) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const files = [];
  page.on('response', async r => {
    const u = new URL(r.url());
    if (u.host !== `127.0.0.1:${PORT}`) return;
    const type = r.headers()['content-type'] || '';
    if (!/javascript|css/.test(type)) return;
    try { files.push({ path: u.pathname, bytes: (await r.body()).length }); } catch { /* aborted */ }
  });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'commit' });
  await page.waitForSelector('input', { timeout: 60000 }).catch(() => {});
  const toInput = Date.now() - t0;
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  const toIdle = Date.now() - t0;
  return { ctx, page, files, toInput, toIdle };
}

const plain = await load(1);
const total = plain.files.reduce((s, f) => s + f.bytes, 0);
console.log(`\nFirst load of the sign-in route — ${plain.files.length} script/style files, ${kb(total)} (not compressed; the host compresses them on the wire)`);
for (const f of plain.files.sort((a, b) => b.bytes - a.bytes).slice(0, 12)) console.log(`  ${kb(f.bytes).padStart(8)}  ${f.path}`);
console.log(`  time to the sign-in form: ${plain.toInput} ms · network idle: ${plain.toIdle} ms   (this machine, no throttling)`);

const slow = await load(4);
console.log(`  with the CPU slowed 4× (a cheap phone): sign-in form after ${slow.toInput} ms · idle ${slow.toIdle} ms`);
await slow.ctx.close();

// ---- no network
await plain.ctx.setOffline(true);
let offline = 'the page is gone';
try { await plain.page.reload({ timeout: 15000 }); offline = (await plain.page.locator('input').count()) > 0 ? 'the page loaded' : 'the page is gone (blank)'; } catch { offline = 'the page is gone (the browser shows its offline page)'; }
const sw = await plain.page.evaluate(async () => ('serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : -1)).catch(() => 'n/a');
console.log(`\nReload with the network off: ${offline}. Service workers registered: ${sw}.`);

// ---- the screens' own chunks
const dir = join(DIST, 'assets');
const chunks = readdirSync(dir).filter(f => f.endsWith('.js')).map(f => ({ f, bytes: statSync(join(dir, f)).size })).sort((a, b) => b.bytes - a.bytes);
console.log(`\nLargest chunks in dist/assets (${chunks.length} files, ${(chunks.reduce((s, c) => s + c.bytes, 0) / 1048576).toFixed(1)} MB):`);
for (const c of chunks.slice(0, 10)) console.log(`  ${kb(c.bytes).padStart(8)}  ${c.f}`);
await browser.close(); stop();
