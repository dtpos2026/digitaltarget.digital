// ============================================================================
// SMOKE — open every module in a real browser and prove it renders
//
// REPORTED, repeatedly: "kuch module click karo, white screen" — on Windows
// AND on the web. Static checks could not find it: all 74 lazy pages resolve,
// all 85 route elements are defined, and every page chunk is emitted by the
// build. None of that proves a page MOUNTS.
//
// This drives the built SPA in Chromium and visits every route, recording what
// each one actually put on screen and any uncaught error. It is the only check
// here that would catch a page which builds fine and dies on mount.
//
//   npm run smoke            # build:app first — this reads dist/client
//
// Off-box requests are aborted rather than left to time out: Supabase is not
// reachable from CI or from a sandbox, and waiting for each call to expire
// turned a one-minute run into twenty. Aborting them also makes this a
// genuine OFFLINE test — every page has to render its empty or error state
// rather than a blank screen, which is exactly the failure being hunted.
// ============================================================================
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createServer } from 'node:http';
// The route list is derived from App.tsx, so a new module is covered the day
// it is added rather than when someone remembers to update a fixture.
const appSrc = readFileSync('src/App.tsx', 'utf8');
const seen = new Set();
const routes = [];
for (const m of appSrc.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<(\w+)/g)) {
  const [, path, component] = m;
  if (component === 'Navigate' || path.includes('*') || path.includes(':')) continue;
  if (seen.has(path)) continue;
  seen.add(path);
  routes.push({ path, component });
}
if (!routes.length) { console.error('[smoke] no routes found in src/App.tsx'); process.exit(1); }

// Serve the built SPA ourselves, so this is one command with no side process.
const ROOT = 'dist/client';
if (!existsSync(join(ROOT, 'index.html'))) {
  console.error(`[smoke] no build at ${ROOT}/index.html — run: npm run build:app`);
  process.exit(1);
}
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png',
  '.ico':'image/x-icon', '.webmanifest':'application/manifest+json', '.woff2':'font/woff2' };
const server = createServer((req, res) => {
  let f = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(ROOT, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise(r => server.listen(4173, r));
const BASE = 'http://127.0.0.1:4173';
const TENANT = 'fd3ead3d-af9a-4ff2-b78d-5f93d1e6e3fb';

// PLAYWRIGHT_BROWSERS_PATH is set in CI and in the sandbox; fall back to
// Playwright's own resolution on a developer machine.
const launch = { args: ['--no-sandbox'] };
if (process.env.SMOKE_CHROME) launch.executablePath = process.env.SMOKE_CHROME;
const browser = await chromium.launch(launch);
const ctx = await browser.newContext();
await ctx.addInitScript(([tid]) => {
  try {
    localStorage.setItem('pos-tenant-id', tid);
    localStorage.setItem('pos-tenant-name', 'Probe Restaurant');
    localStorage.setItem('pos-workspace-code', '6FC459');
    localStorage.setItem('pos-current-user', JSON.stringify({
      id: 'probe', username: 'probe', name: 'Probe', role: 'admin',
      permissions: ['*'], branchId: null, isActive: true,
    }));
  } catch {}
}, [TENANT]);

const page = await ctx.newPage();
// Off-box calls are unreachable here and would only add their timeout to every
// route. Fail them fast so each page renders its offline/error state instead.
await page.route('**/*', r =>
  r.request().url().startsWith(BASE) ? r.continue() : r.abort());

let bucket = [];
page.on('pageerror', e => bucket.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') bucket.push(`console: ${m.text().slice(0, 180)}`); });

await page.goto(`${BASE}/#/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2500);

const results = [];
for (const r of routes) {
  bucket = [];
  let text = '', html = 0;
  try {
    // Hash navigation inside the already-loaded SPA — no reload per route.
    await page.evaluate(p => { window.location.hash = p; }, r.path);
    await page.waitForTimeout(700);
    text = (await page.evaluate(() => document.body.innerText || '')).trim();
    html = await page.evaluate(() => document.body.innerHTML.length);
  } catch (e) { bucket.push(`nav: ${e.message}`); }
  // A page that CRASHED now renders PageBoundary's card rather than nothing,
  // which is the whole point of that boundary — and which means "not blank"
  // is no longer enough to call a module healthy. Verified the hard way: a
  // deliberately broken page passed this check until the card was detected.
  const boundary = /this screen could not open/i.test(text);
  results.push({
    path: r.path, component: r.component, chars: text.length, html, boundary,
    blank: text.length < 5,
    sample: text.replace(/\s+/g, ' ').slice(0, 80),
    errors: [...new Set(bucket)].slice(0, 3),
  });
}
await browser.close();
await new Promise(r => server.close(r));
if (process.env.SMOKE_JSON) writeFileSync(process.env.SMOKE_JSON, JSON.stringify(results, null, 2));
const blank = results.filter(r => r.blank);
console.log(`routes driven : ${results.length}`);
console.log(`rendered      : ${results.length - blank.length}`);
console.log(`BLANK         : ${blank.length}`);
for (const b of blank) console.log(`   BLANK ${b.path.padEnd(24)} ${b.component.padEnd(24)} html=${b.html} ${b.errors[0] ?? ''}`);

const crashed = results.filter(r => r.errors.some(e => e.startsWith('pageerror')));
console.log(`uncaught errors: ${crashed.length}`);
for (const c of crashed) console.log(`   CRASH ${c.path.padEnd(24)} ${c.errors.find(e => e.startsWith('pageerror'))}`);

const caught = results.filter(r => r.boundary);
console.log(`modules that threw: ${caught.length}`);
for (const c of caught) console.log(`   THREW ${c.path.padEnd(24)} ${c.component.padEnd(24)} ${c.sample.slice(0, 60)}`);

// ===== the check that stops this lying =====
//
// The POS gates every authenticated screen on a live Supabase session, and
// seeding localStorage does NOT satisfy it. Without that session the router
// serves the sign-in screen for every protected path — and the first version
// of this script happily reported "76/76 rendered, 0 blank" while 71 of those
// were the same login page. It even passed a module I had deliberately broken.
//
// So: if most routes came back with identical text, this run never got past
// the gate and proves nothing about the modules. Say so and fail, rather than
// hand back a green tick that means nothing.
const byText = new Map();
for (const r of results) {
  const k = r.sample.slice(0, 50);
  byText.set(k, (byText.get(k) ?? 0) + 1);
}
const [topText, topCount] = [...byText.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
const gated = topCount > results.length / 2;
if (gated) {
  console.log(`\nINCONCLUSIVE — ${topCount}/${results.length} routes returned the same screen:`);
  console.log(`   ${JSON.stringify(topText)}`);
  console.log('This run never signed in, so the authenticated modules were never');
  console.log('reached. It covers the PUBLIC routes only. Point it at a reachable');
  console.log('backend with a real session to cover the rest.');
  process.exit(2);
}

// Blank, uncaught, or caught-by-the-boundary all mean a module is broken.
if (blank.length || crashed.length || caught.length) process.exit(1);
console.log('every module rendered.');
