// ============================================================================
// Two-device sync test.
//
// Two independent browser contexts (separate localStorage, separate IndexedDB,
// separate websockets) signed into the same restaurant, talking to one shared
// backend. Device A acts; Device B must see it WITHOUT a manual refresh.
//
// Then A goes offline, keeps working, comes back, and B must receive it.
// ============================================================================
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APP = 'http://127.0.0.1:5199';
const MOCK = 'http://127.0.0.1:54321';
const T = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const BRANCH = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// The backend is started fresh for every run. A long-lived mock keeps the rows
// of the previous run, and a test that inherits yesterday's tombstones reports
// failures that have nothing to do with the code under test.
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const children = [];
const stopChildren = () => { for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch {} try { c.kill('SIGKILL'); } catch {} } };
process.on('exit', stopChildren);

function start(cmd, args, ready, ms, env) {
  const c = spawn(cmd, args, {
    cwd: root, stdio: ['ignore', 'pipe', 'inherit'], detached: true,
    env: { ...process.env, ...(env ?? {}) },
  });
  children.push(c);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${cmd} ${args.join(' ')} did not start`)), ms);
    c.stdout.on('data', d => { if (ready.test(String(d))) { clearTimeout(t); resolve(); } });
  });
}

const mock = start(process.execPath, [join(here, 'mock-supabase.mjs')], /mock-supabase on/, 10000);

// ===== The dev server is started HERE, fresh, on purpose =====
//
// Vite's HMR hands an edited module back under a cache-busting URL
// (`/src/lib/store.ts?t=...`). The app then holds THAT instance while a test
// importing the plain `/src/lib/store.ts` gets a SECOND copy of the module —
// with its own in-memory store cache. Every "device B never received it"
// failure then comes from reading a different object than the one sync wrote.
// A server started fresh for the run serves exactly one instance.
//
// ===== The dev server MUST be pointed at the stand-in backend =====
//
// `.env` carries the production Supabase URL, and Vite reads it. Without this
// override the two browsers open websockets to the real project: in a sandbox
// that refuses egress the run dies with ERR_CERT_AUTHORITY_INVALID and 0
// realtime joins, and on a machine that CAN reach Supabase it is far worse —
// the test writes its menu items, bills and tombstones into a live restaurant.
// Vite merges VITE_-prefixed variables from the environment over .env, so
// passing it here is enough.
const vite = start(
  'npx', ['vite', '--port', '5199', '--host', '127.0.0.1', '--strictPort'],
  /ready in|Local:/, 120000,
  { VITE_SUPABASE_URL: MOCK },
);
await Promise.all([mock, vite]);

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

function seed(page, uid) {
  return page.addInitScript(({ T, BRANCH, uid }) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const app_metadata = { tenant_id: T, branch_id: BRANCH, role: 'admin', all_branches: true };
    const jwt = [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: uid, exp, aud: 'authenticated', role: 'authenticated', app_metadata }), 'sig'].join('.');
    localStorage.setItem('dtpos-auth', JSON.stringify({
      access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp,
      user: { id: uid, aud: 'authenticated', role: 'authenticated', email: `${uid}@x.test`, app_metadata, user_metadata: {}, created_at: new Date().toISOString() },
    }));
    localStorage.setItem('pos-tenant-id', T);
    localStorage.setItem('pos-user-id', 'u1');
    localStorage.setItem('pos-user-role', 'admin');
    localStorage.setItem('dtpos-auth-backend', 'supabase');
    localStorage.setItem('dt_pos_current_user', JSON.stringify({ id: 'u1', name: 'Admin', username: 'admin', role: 'admin' }));
    localStorage.setItem('dt_pos_current_branch', JSON.stringify({ id: BRANCH, name: 'Main Branch' }));
    const base = { _tenantId: T, settings: { name: 'Sync Test Restaurant', currencyCode: 'PKR', businessTypeSetupDone: true }, orderCounter: 0 };
    for (const k of ['orders','categories','menuItems','tables','floors','kitchens','waiters','riders','users','inventory','stockLogs','employees','attendance','leaves','payslips','advances','accountCategories','transactions','parties','ledger','dailyCashCloses','receivingEntries','marketingContacts','recipes','wastages','customers','branches','creditPayments','promoCodes','paymentAccounts','deals','shifts','refunds']) base[k] = [];
    base.users = [{ id: 'u1', name: 'Admin', username: 'admin', role: 'admin', isActive: true, _updatedAt: Date.now() }];
    base.branches = [{ id: BRANCH, name: 'Main Branch', isActive: true, sortOrder: 0, _updatedAt: Date.now() }];
    localStorage.setItem(`desi-pos-data:${T}`, JSON.stringify(base));
  }, { T, BRANCH, uid });
}

/** Run inside the page: call the store's own API, exactly as the UI does. */
const store = (page, fn, arg) => page.evaluate(async ({ fn, arg }) => {
  const m = await import('/src/lib/store.ts');
  return await m[fn](...(arg ?? []));
}, { fn, arg });

const read = (page, fn) => page.evaluate(async ({ fn }) => {
  const m = await import('/src/lib/store.ts');
  const v = m[fn]();
  return JSON.parse(JSON.stringify(v));
}, { fn });

const settle = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  // The agent sandbox exports HTTPS_PROXY; Chromium would tunnel even 127.0.0.1
  // through it and the mock backend would answer ERR_TUNNEL_CONNECTION_FAILED.
  args: ['--no-proxy-server'],
});
const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const A = await ctxA.newPage();
const B = await ctxB.newPage();
await seed(A, 'device-a'); await seed(B, 'device-b');
for (const [tag, pg] of [['A', A], ['B', B]]) {
  pg.on('pageerror', e => console.log(`  ${tag}!! pageerror: ${e.message.slice(0,160)}`));
  pg.on('console', m => { const t = m.text(); if (m.type() === 'error' || t.includes('realtime') || t.includes('[store]') || t.includes('[sync]')) console.log(`  ${tag}! ${t.slice(0,180)}`); });
}

await A.goto(APP + '/#/', { waitUntil: 'domcontentloaded' });
await B.goto(APP + '/#/', { waitUntil: 'domcontentloaded' });

// Wait for the readiness signal rather than a fixed sleep: a cold dev server
// can take far longer than any sleep worth hard-coding, and a device that
// acts before its realtime channel has joined reports failures that say
// nothing about the sync code.
async function waitForRealtime(minJoins, ms = 90000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const d = await (await fetch(MOCK + '/__dump')).json();
    const lines = (d.log ?? []).filter(l => l.startsWith('JOIN '));
    // Distinct sockets, not distinct joins — one device opening two channels
    // must not be mistaken for both devices being ready.
    const socks = new Set(lines.map(l => (/sock=(\d+)/.exec(l) || [])[1]));
    if (socks.size >= minJoins) { console.log(`  realtime ready: ${socks.size} device socket(s), ${lines.length} channel join(s)`); return socks.size; }
    const joins = lines.length;
    if (Date.now() > deadline) throw new Error(`only ${joins} realtime JOIN(s) after ${ms}ms — both devices must be subscribed before the test can mean anything`);
    await settle(500);
  }
}
await waitForRealtime(2);
await settle(2500);   // let the initial cloud load finish after the join

// ---------------------------------------------------------------- 1. menu
await store(A, 'saveMenuItem', [{ id: 'mi-sync-1', name: 'Chicken Karahi', price: 1200, categoryId: 'cat-1', pricingType: 'fixed', ratePerKg: 0, isActive: true, flavors: [], sizeVariants: [], inchVariants: [] }]);
await settle(5000);
// NOTE ON IDS: the POS maps a local id to a deterministic uuid on the way out
// (cloudId()), and tables without a `data` document cannot carry the original
// back. So a device that learned the item FROM the cloud holds it under the
// uuid, while the device that created it keeps its local id. Both resolve to
// the same cloud row, and foreign keys go through the same mapping — so the
// record is shared even though the local ids differ. Matching on the business
// identity (the name) is the assertion that actually means "B received it".
let bItems = await read(B, 'getMenuItems');
check('A creates a menu item -> B receives it without refresh',
  bItems.some(i => i.name === 'Chicken Karahi'), `B sees ${bItems.length} item(s)`);

// ---------------------------------------------------------------- 2. update
await store(A, 'saveMenuItem', [{ id: 'mi-sync-1', name: 'Chicken Karahi (Large)', price: 1500, categoryId: 'cat-1', pricingType: 'fixed', ratePerKg: 0, isActive: true, flavors: [], sizeVariants: [], inchVariants: [] }]);
await settle(5000);
bItems = await read(B, 'getMenuItems');
const upd = bItems.find(i => /Chicken Karahi/.test(i.name || ''));
check('A edits the item -> B sees the new name and price',
  upd?.name === 'Chicken Karahi (Large)' && upd?.price === 1500, `B has "${upd?.name}" @ ${upd?.price}`);

// ---------------------------------------------------------------- 3. order
await store(A, 'saveOrder', [{ id: 'ord-sync-1', orderNumber: 501, orderType: 'dining', status: 'paid', branchId: BRANCH,
  items: [{ id: 'l1', menuItemId: 'mi-sync-1', name: 'Chicken Karahi', price: 1500, quantity: 1, lineTotal: 1500, pricingType: 'fixed', note: '' }],
  payments: [{ id: 'p1', method: 'cash', amount: 1500, at: new Date().toISOString() }],
  subtotal: 1500, discount: 0, tax: 0, grandTotal: 1500, createdAt: new Date().toISOString() }]);
await settle(5000);
let bOrders = await read(B, 'getOrders');
check('A takes a bill -> B receives the order',
  bOrders.some(o => o.id === 'ord-sync-1'), `B sees ${bOrders.length} order(s)`);

// ---------------------------------------------------------------- 4. branding
await store(A, 'saveSettings', [{ name: 'Renamed From Device A', currencyCode: 'PKR', businessTypeSetupDone: true, logo: 'https://example.com/logo.png' }]);
await settle(6000);
let bSettings = await read(B, 'getSettings');
check('A changes the restaurant name and logo -> B receives it',
  bSettings.name === 'Renamed From Device A' && bSettings.logo === 'https://example.com/logo.png',
  `B shows "${bSettings.name}"`);

// ---------------------------------------------------------------- 5. delete
await store(A, 'deleteMenuItem', ['mi-sync-1']);
await settle(5000);
bItems = await read(B, 'getMenuItems');
check('A deletes the item -> it disappears on B and does NOT resurrect',
  !bItems.some(i => /Chicken Karahi/.test(i.name || '')), `B sees ${bItems.length} item(s)`);

// ---------------------------------------------------------------- 6. offline
await ctxA.setOffline(true);
await A.evaluate(() => window.dispatchEvent(new Event('offline')));
await settle(1200);
await store(A, 'saveMenuItem', [{ id: 'mi-offline-1', name: 'Made While Offline', price: 300, categoryId: 'cat-1', pricingType: 'fixed', ratePerKg: 0, isActive: true, flavors: [], sizeVariants: [], inchVariants: [] }]);
await store(A, 'saveOrder', [{ id: 'ord-offline-1', orderNumber: 502, orderType: 'takeaway', status: 'paid', branchId: BRANCH,
  items: [{ id: 'l2', menuItemId: 'mi-offline-1', name: 'Made While Offline', price: 300, quantity: 2, lineTotal: 600, pricingType: 'fixed', note: '' }],
  payments: [], subtotal: 600, discount: 0, tax: 0, grandTotal: 600, createdAt: new Date().toISOString() }]);
await settle(2500);

const pending = await A.evaluate(async () => (await import('/src/lib/deferredSync.ts')).deferredPendingCount());
check('offline work is queued rather than attempted', pending > 0, `${pending} op(s) queued`);

bItems = await read(B, 'getMenuItems');
check('while A is offline, B has not seen the offline work yet',
  !bItems.some(i => i.name === 'Made While Offline'), 'as expected');

// ---------------------------------------------------------------- 7. reconnect
await ctxA.setOffline(false);
await A.evaluate(() => window.dispatchEvent(new Event('online')));
await settle(3000);
await A.evaluate(async () => { await (await import('/src/lib/deferredSync.ts')).flushDeferredOps(); });
await settle(6000);

// The queue retries on a backoff schedule, so give it the second pass the
// real app would get from its 20s timer rather than demanding one shot.
let pendingAfter = await A.evaluate(async () => (await import('/src/lib/deferredSync.ts')).deferredPendingCount());
if (pendingAfter > 0) {
  await A.evaluate(async () => {
    const m = await import('/src/lib/deferredSync.ts');
    for (const op of m.getDeferredOps()) op.at = 0;   // wind past the backoff
    await m.flushDeferredOps();
  });
  await settle(4000);
  pendingAfter = await A.evaluate(async () => (await import('/src/lib/deferredSync.ts')).deferredPendingCount());
}
const stuck = await A.evaluate(async () => (await import('/src/lib/deferredSync.ts')).getDeferredOps().map(o => `${o.col}:${o.entityId} attempts=${o.attempts} err=${(o.lastError||'').slice(0,80)}`));
check('the queue drains on reconnect', pendingAfter === 0, pendingAfter ? JSON.stringify(stuck) : 'empty');

bItems = await read(B, 'getMenuItems');
bOrders = await read(B, 'getOrders');
check('A reconnects -> B receives the offline menu item',
  bItems.some(i => i.name === 'Made While Offline'), `B sees ${bItems.length} item(s)`);
check('A reconnects -> B receives the offline bill',
  bOrders.some(o => o.id === 'ord-offline-1'), `B sees ${bOrders.length} order(s)`);

// ---------------------------------------------------------------- 8. duplicates
const dump = await (await fetch(MOCK + '/__dump')).json();
const menuRows = Object.values(dump.tables.menu_items ?? {});
const orderRows = Object.values(dump.tables.orders ?? {});
const ids = orderRows.map(o => o.id);
check('no duplicate orders reached the backend',
  new Set(ids).size === ids.length, `${ids.length} row(s), ${new Set(ids).size} unique`);
const inserts = (dump.log ?? []).filter(l => l.startsWith('INSERT orders')).length;
check('the reconnect did not re-insert an already-synced bill',
  inserts <= orderRows.length, `${inserts} insert(s) for ${orderRows.length} order(s)`);

// ---------------------------------------------------------------- 9. B -> A
await store(B, 'saveMenuItem', [{ id: 'mi-from-b', name: 'Created On Device B', price: 99, categoryId: 'cat-1', pricingType: 'fixed', ratePerKg: 0, isActive: true, flavors: [], sizeVariants: [], inchVariants: [] }]);
await settle(5000);
const aItems = await read(A, 'getMenuItems');
check('sync is bidirectional: B creates -> A receives',
  aItems.some(i => i.name === 'Created On Device B'), `A sees ${aItems.length} item(s)`);

const finalDump = await (await fetch(MOCK + '/__dump')).json();
console.log('\n---- backend log ----');
for (const l of (finalDump.log ?? [])) console.log('   ' + l);
console.log('\n================ SUMMARY ================');
const passed = results.filter(r => r.pass).length;
console.log(`${passed}/${results.length} passed`);
for (const r of results.filter(r => !r.pass)) console.log(`  FAILED: ${r.name}`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
