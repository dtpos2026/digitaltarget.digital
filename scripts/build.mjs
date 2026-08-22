// ============================================================================
// BUILD — pinned to the Cloudflare PAGES preset
//
// ===== WHY THIS FILE EXISTS =====
// The deploy command for this project is:
//
//     wrangler pages deploy dist --project-name dt-pos
//
// That is Cloudflare **Pages**, and Pages wants a single directory whose root
// holds the static assets plus an advanced-mode `_worker.js` for SSR.
//
// Nitro's default target here was `cloudflare` — the **Workers** preset, which
// writes a completely different shape to `.output/` (assets in
// .output/public, server in .output/server/index.mjs). There is no `dist/`,
// which is why "dist file nahi banti" and why a copied `.output` folder still
// did not deploy: it is not just a different path, it is a different artifact.
//
// `cloudflare_pages` writes straight to `dist/`, in the exact layout the
// existing deploy command and the attached domain already expect. Nothing
// about the project structure or the hosting setup changes.
//
// The preset is set here rather than as a shell variable because
// `NITRO_PRESET=... npm run build` does not work in Windows CMD, and Vite does
// not copy .env into process.env.
// ============================================================================
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ===== Cloudflare compatibility_date =====
// Nitro stamps the BUILD MACHINE's current date into
// dist/_worker.js/wrangler.json. Cloudflare then rejects any date it considers
// to be in the future:
//
//     X [ERROR] Failed to publish your Function.
//       Can't set compatibility date in the future: 2026-08-22
//
// Whose "today" wins depends on your timezone versus Cloudflare's UTC clock,
// so a deploy late in the evening can fail while the same build deploys fine
// the next morning. That is not something to leave to chance on a live domain.
//
// Pinning it removes the clock from the equation entirely. It also makes the
// Workers runtime behaviour reproducible: compatibility_date is what decides
// which runtime semantics you get, so a date that silently changes on every
// build means the deployed runtime can shift under you without any code
// change.
//
// Must stay >= 2024-09-23 for nodejs_compat v2. Bump deliberately, and test,
// rather than letting it drift.
const COMPATIBILITY_DATE = process.env.CF_COMPATIBILITY_DATE || '2026-06-01';

process.env.NITRO_PRESET = process.env.NITRO_PRESET || 'cloudflare_pages';
console.log(`[build] NITRO_PRESET=${process.env.NITRO_PRESET}`);

const r = spawnSync('npx', ['vite', 'build'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});
if (r.status !== 0) process.exit(r.status ?? 1);

// Fail loudly here rather than at `wrangler pages deploy`, where the error is
// far less obvious and the domain is already involved.
const dist = resolve(process.cwd(), 'dist');
const worker = resolve(dist, '_worker.js');
const missing = [
  !existsSync(dist) && 'dist/',
  !existsSync(worker) && 'dist/_worker.js (SSR entry — server functions will 404 without it)',
].filter(Boolean);

if (missing.length) {
  console.error(`\n[build] BUILD INCOMPLETE — missing: ${missing.join(', ')}`);
  console.error('[build] Do NOT deploy this. Expected the cloudflare_pages preset.');
  process.exit(1);
}
// Rewrite the date Nitro just stamped in.
const wranglerCfg = resolve(dist, '_worker.js', 'wrangler.json');
if (existsSync(wranglerCfg)) {
  const cfg = JSON.parse(readFileSync(wranglerCfg, 'utf8'));
  const stamped = cfg.compatibility_date;
  if (stamped !== COMPATIBILITY_DATE) {
    cfg.compatibility_date = COMPATIBILITY_DATE;
    writeFileSync(wranglerCfg, JSON.stringify(cfg, null, 2) + '\n');
    console.log(`[build] compatibility_date pinned: ${stamped} -> ${COMPATIBILITY_DATE}`);
  }
} else {
  console.warn('[build] WARNING: dist/_worker.js/wrangler.json not found — compatibility_date not pinned.');
}

console.log('\n[build] OK — dist/ is ready for: wrangler pages deploy dist --project-name dt-pos');
