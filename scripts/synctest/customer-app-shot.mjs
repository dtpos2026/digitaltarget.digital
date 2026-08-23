// Renders the customer ordering site and opens the account dialog, so the
// signup form can be seen rather than assumed.
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

const T = '11111111-1111-4111-8111-111111111111';
const post = (t, rows) => fetch(`${MOCK}/rest/v1/${t}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rows) });

await post('tenants', [{ id: T, name: 'Tami Restaurant', slug: 'tami', is_active: true }]);
await post('customer_apps', [{ tenant_id: T, enabled: true, app_name: 'Tami Express',
  theme: { primary: '#e11d48', mode: 'dark' }, whatsapp_number: '923001234567',
  features: { ordering: true, tracking: true, history: true, support: true, whatsapp: true } }]);
await post('categories', [{ id: 'c1', tenant_id: T, name: 'Starters', sort_order: 1, is_active: true }]);
await post('menu_items', [{ id: 'm1', tenant_id: T, category_id: 'c1', name: 'Chicken Karahi',
  price: 1200, is_active: true, pricing_type: 'fixed' }]);
await post('tenant_settings', [{ tenant_id: T, data: { name: 'Tami Restaurant', currencyCode: 'PKR',
  businessTypeSetupDone: true, onlineOrderingEnabled: true } }]);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 480, height: 1000 } });
page.on('pageerror', e => console.log('  !! ' + e.message.slice(0, 200)));

await page.goto(`${APP}/#/order/${T}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);

const brand = await page.evaluate(() => ({
  title: document.title,
  primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
  waHref: (document.querySelector('a[href*="wa.me"]') || {}).href || null,
}));
console.log('BRAND ' + JSON.stringify(brand));

const login = page.getByRole('button', { name: /login/i }).first();
if (await login.count()) {
  await login.click();
  await page.waitForTimeout(800);
  const create = page.getByText(/First time here\? Create an account/i).first();
  if (await create.count()) { await create.click(); await page.waitForTimeout(800); }
  else console.log('  (create-account link not found)');
} else {
  console.log('  (Login button not found)');
}
await page.screenshot({ path: join(here, 'customer-signup.png'), fullPage: true });
console.log('shot -> customer-signup.png');
await browser.close();
process.exit(0);
