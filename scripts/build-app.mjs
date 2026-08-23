// ============================================================================
// BUILD — Android (Capacitor) target
//
// The APK repository's capacitor.config.json declares `"webDir": "dist/client"`.
// The Cloudflare build never produced that directory: it emits an SSR worker
// (`_worker.js`) plus assets, with no index.html anywhere. So the APK had
// nothing to package.
//
// This is the same SPA build the desktop shell uses — one client bundle, one
// prerendered shell — written where Capacitor expects it. Same application
// code: routes, components, store, sync, auth. Nothing is duplicated.
//
// TENANT BINDING
// The APK is built for ONE restaurant. Pass its id and the app opens straight
// into that restaurant's customer site instead of asking which one:
//
//     DT_APP_TENANT=<tenant-uuid> npm run build:app
//
// The binding is a starting route, not a security boundary. Isolation is
// enforced by the database: every customer RPC is scoped to the tenant it is
// given, and one restaurant's app cannot read another's customers even if the
// id in the request is changed. See public_customer_* in the migrations.
// ============================================================================
import { spawnSync } from 'node:child_process';
import { existsSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const OUT = 'dist-desktop';          // what the SPA build emits
const APP = join('dist', 'client');  // what Capacitor reads

const tenant = (process.env.DT_APP_TENANT || '').trim();
if (tenant && !/^[0-9a-f-]{36}$/i.test(tenant)) {
  console.error(`[build:app] DT_APP_TENANT is not a uuid: ${tenant}`);
  process.exit(1);
}

process.env.DT_BUILD_TARGET = 'desktop';
console.log(`[build:app] building the client bundle${tenant ? ` for tenant ${tenant}` : ''}`);

const r = spawnSync('npx', ['vite', 'build'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});
if (r.status !== 0) process.exit(r.status ?? 1);

const src = resolve(process.cwd(), OUT, 'client');
if (!existsSync(join(src, 'index.html'))) {
  console.error(`[build:app] BUILD INCOMPLETE — no index.html under ${OUT}/client`);
  process.exit(1);
}

const dest = resolve(process.cwd(), APP);
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });

if (tenant) {
  // The app is a hash-routed SPA, so the restaurant is chosen by the opening
  // route. Rewriting it here rather than at runtime means the packaged APK
  // never shows a restaurant picker it has no business showing.
  const indexPath = join(dest, 'index.html');
  const html = readFileSync(indexPath, 'utf8');
  const boot = `<script>(function(){try{if(!location.hash||location.hash==='#/'){location.hash='#/order/${tenant}';}}catch(e){}})();</script>`;
  writeFileSync(indexPath, html.replace('</head>', `${boot}</head>`), 'utf8');
  writeFileSync(join(dest, 'dt-app.json'), JSON.stringify({ tenantId: tenant }, null, 2) + '\n');
  console.log(`[build:app] bound to tenant ${tenant}`);
}

// dist/ is also where the Cloudflare artifact lives. build:app only writes the
// client/ subdirectory, so it does not damage that artifact — but a deploy run
// afterwards would upload this bundle alongside the website.
if (existsSync(resolve(process.cwd(), 'dist', '_worker.js'))) {
  console.warn('\n[build:app] NOTE: dist/ also holds a Cloudflare build.');
  console.warn('[build:app] Run `npm run build` again before deploying the website,');
  console.warn('[build:app] or `wrangler pages deploy` will ship dist/client too.');
}

console.log(`\n[build:app] OK — ${APP} is ready for: npx cap sync android`);
