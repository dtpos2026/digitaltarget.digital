// Renders the Super Admin Device Management screen and Login Map against the
// stand-in backend, with device rows shaped exactly as the real table stores
// them, and screenshots both.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APP = 'http://127.0.0.1:5199';
const MOCK = 'http://127.0.0.1:54321';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const kids = [];
process.on('exit', () => kids.forEach(c => { try { process.kill(-c.pid, 'SIGKILL'); } catch {} }));
function start(cmd, args, ready, ms) {
  const c = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], detached: true });
  kids.push(c);
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(cmd + ' did not start')), ms);
    c.stdout.on('data', d => { if (ready.test(String(d))) { clearTimeout(t); res(); } });
  });
}
await Promise.all([
  start(process.execPath, [join(here, 'mock-supabase.mjs')], /mock-supabase on/, 10000),
  start('npx', ['vite', '--port', '5199', '--host', '127.0.0.1', '--strictPort'], /ready in|Local:/, 120000),
]);

const T1 = '11111111-1111-4111-8111-111111111111';
const B1 = '22222222-2222-4222-8222-222222222222';
const B2 = '33333333-3333-4333-8333-333333333333';
const post = (t, rows) => fetch(`${MOCK}/rest/v1/${t}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rows) });

await post('tenants', [{ id: T1, name: 'Tami Restaurant', slug: 'tami', plan: 'pro',
  plan_expires_at: '2027-01-01', is_active: true, created_at: '2026-01-01', custom_device_limit: 5 }]);
await post('branches', [
  { id: B1, tenant_id: T1, name: 'Burewala', lat: 30.1667, lng: 72.6833, is_active: true },
  { id: B2, tenant_id: T1, name: 'Multan',   lat: 30.1575, lng: 71.5249, is_active: true },
]);
await post('devices', [
  // Approved, reported its own approximate position.
  { id: 'd1', tenant_id: T1, branch_id: B1, device_label: 'Counter 1', hardware_id: 'hw-aaa',
    fingerprint: 'fp-shared', platform: 'Chrome / Windows', app_version: '1.26.9', approved: true,
    blocked: false, blocked_at: null, last_seen_at: '2026-08-22T21:00:00Z',
    lat: 30.1669, lng: 72.6840, accuracy_m: 1800, ip: '203.0.113.9', meta: {},
    last_login_at: '2026-08-22T21:00:00Z', login_count: 42 },
  // Same machine, different browser profile -> must merge into the row above.
  { id: 'd2', tenant_id: T1, branch_id: B1, device_label: 'Counter 1 (Edge)', hardware_id: 'hw-bbb',
    fingerprint: 'fp-shared', platform: 'Edge / Windows', app_version: '1.26.9', approved: true,
    blocked: false, blocked_at: null, last_seen_at: '2026-08-22T20:00:00Z',
    lat: null, lng: null, accuracy_m: null, ip: '203.0.113.9', meta: {},
    last_login_at: '2026-08-22T20:00:00Z', login_count: 7 },
  // Blocked, no device location at all -> map must fall back to the branch and say so.
  { id: 'd3', tenant_id: T1, branch_id: B2, device_label: 'Multan Till', hardware_id: 'hw-ccc',
    fingerprint: 'fp-multan', platform: 'Chrome / Android', app_version: '1.26.8', approved: true,
    blocked: true, blocked_at: '2026-08-22T18:00:00Z', last_seen_at: '2026-08-22T17:00:00Z',
    lat: null, lng: null, accuracy_m: null, ip: '198.51.100.4', meta: {},
    last_login_at: '2026-08-22T17:00:00Z', login_count: 3 },
  // Awaiting approval.
  { id: 'd4', tenant_id: T1, branch_id: B2, device_label: 'New Tablet', hardware_id: 'hw-ddd',
    fingerprint: 'fp-new', platform: 'Chrome / Android', app_version: '1.26.9', approved: false,
    blocked: false, blocked_at: null, last_seen_at: '2026-08-22T22:00:00Z',
    lat: 30.1580, lng: 71.5260, accuracy_m: 45000, ip: '198.51.100.7', meta: {},
    last_login_at: '2026-08-22T22:00:00Z', login_count: 1 },
]);
await post('super_admins', [{ id: 'sa1', email: 'owner@dtpos.test', can_manage_team: true, is_active: true }]);
await post('customer_apps', [{
  tenant_id: T1, enabled: true, app_name: 'Tami Express', logo_url: 'https://example.com/logo.png',
  icon_url: 'https://example.com/icon.png', theme: { primary: '#e11d48', mode: 'dark' },
  whatsapp_number: '923001234567',
  features: { ordering: true, tracking: true, history: true, offers: true, support: true, whatsapp: true, loyalty: false },
  app_version: '1.2.0', min_supported_version: '1.0.0', update_url: 'https://example.com/app.apk',
  update_required: false,
}]);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('console', m => { if (m.type() === 'error') console.log('  ! ' + m.text().slice(0, 200)); });
page.on('pageerror', e => console.log('  !! ' + e.message.slice(0, 250)));

await page.addInitScript(() => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = o => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const app_metadata = { role: 'super_admin' };
  const jwt = [b64({ alg: 'HS256', typ: 'JWT' }),
               b64({ sub: 'sa1', exp, aud: 'authenticated', role: 'authenticated', app_metadata,
                     email: 'owner@dtpos.test' }), 'sig'].join('.');
  localStorage.setItem('dtpos-auth', JSON.stringify({
    access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'sa1', aud: 'authenticated', role: 'authenticated', email: 'owner@dtpos.test',
            app_metadata, user_metadata: {}, created_at: new Date().toISOString() },
  }));
  localStorage.setItem('dtpos-auth-backend', 'supabase');
  sessionStorage.setItem('pos-super-admin', '1');
});

await page.goto(APP + '/#/', { waitUntil: 'domcontentloaded' });
await page.getByText('Super Admin Console').first().waitFor({ timeout: 120000 });
await page.waitForTimeout(4000);
const heading = await page.locator('body').innerText();
console.log('--- first 300 chars of page ---\n' + heading.slice(0, 300));

for (const [tab, file] of [['Customer Apps', 'superadmin-customer-apps.png']]) {
  const btn = page.getByRole('button', { name: new RegExp('^' + tab, 'i') }).first();
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(2500);
    // Expand the first restaurant so the whole configuration form is visible.
    const row = page.getByText('Tami Restaurant').first();
    if (await row.count()) { await row.click(); await page.waitForTimeout(1200); }
  }
  else console.log(`  (no "${tab}" tab button found)`);
  await page.screenshot({ path: join(root, 'scripts/synctest', file), fullPage: true });
  console.log('shot ->', file);
}
await browser.close();
process.exit(0);
