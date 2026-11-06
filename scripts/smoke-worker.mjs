// ============================================================================
// SMOKE — does the BUILT worker actually start?
//
// Run after `npm run build`:   npm run smoke:worker
//
// WHY THIS EXISTS (v1.108.1). v1.107.0 built cleanly, passed 3,500 tests and rendered fine under `vite dev` — and the live
// site answered "This page didn't load" on every page. The production bundle is a different program from the dev server:
// the bundler had split the server entry into two chunks that imported each other, and the Cloudflare worker died at
// start-up with "__exportAll2 is not a function". Nothing the build or the tests do ever starts that worker.
//
// This does: it runs dist/ in workerd (the runtime Cloudflare uses, through wrangler), requests the home page and the
// custom-site route, and fails unless the home page is a 200 HTML page and the route answers JSON instead of crashing.
// wrangler is installed once into a scratch folder, so the project's own dependencies do not change.
// ============================================================================
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
if (!existsSync(join(DIST, '_worker.js', 'index.js'))) {
  console.error('[smoke] dist/_worker.js is missing — run `npm run build` first.');
  process.exit(2);
}

const TOOLS = join(tmpdir(), 'dt-smoke-wrangler');
const BIN = join(TOOLS, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
if (!existsSync(BIN)) {
  console.log('[smoke] installing wrangler into', TOOLS, '(once)');
  mkdirSync(TOOLS, { recursive: true });
  writeFileSync(join(TOOLS, 'package.json'), '{"name":"dt-smoke","private":true}\n');
  const r = spawnSync('npm', ['i', 'wrangler@4', '--no-audit', '--no-fund'], { cwd: TOOLS, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error('[smoke] could not install wrangler'); process.exit(2); }
}

const PORT = 8700 + Math.floor(Math.random() * 200);
const child = spawn(BIN, ['pages', 'dev', DIST, '--port', String(PORT), '--ip', '127.0.0.1'], {
  cwd: TOOLS, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', detached: process.platform !== 'win32',
});
let log = '';
child.stdout.on('data', d => { log += d; });
child.stderr.on('data', d => { log += d; });
const stop = () => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid); } catch { /* already gone */ } };
process.on('exit', stop);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function get(path, init) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { ...init, signal: AbortSignal.timeout(30000) }); return { status: r.status, text: await r.text(), type: r.headers.get('content-type') || '' }; }
  catch { return null; }
}

let ready = false;
for (let i = 0; i < 60 && !ready; i++) { await sleep(1000); ready = /Ready on/.test(log); }
if (!ready) { console.error('[smoke] the worker never became ready\n' + log.slice(-1500)); stop(); process.exit(1); }

let failed = false;
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${msg}`); if (!ok) failed = true; };

const home = await get('/');
check(home?.status === 200 && /<html/i.test(home.text), `GET /  → ${home?.status ?? 'no answer'}${home?.status === 200 ? '' : '  (the site would show "This page didn\'t load")'}`);
const route = await get('/api/custom-site/order/00000000-0000-4000-8000-000000000000', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
check(!!route && /json/.test(route.type), `POST /api/custom-site/order/<id>  → ${route?.status ?? 'no answer'} (${route?.type || 'n/a'}) — JSON, not a crash page`);
const missing = await get('/definitely-not-a-page');
check(!!missing && missing.status < 500, `GET /definitely-not-a-page  → ${missing?.status ?? 'no answer'} (not a server error)`);

if (failed) console.error('\n[smoke] worker log (tail):\n' + log.split('\n').filter(l => /ERROR|TypeError|Error:/.test(l)).slice(-8).join('\n'));
stop();
console.log(failed ? '\n[smoke] FAILED — do not deploy this build.' : '\n[smoke] the built worker starts and answers.');
process.exit(failed ? 1 : 0);
