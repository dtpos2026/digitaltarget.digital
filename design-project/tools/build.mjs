// Builds the whole design project: every screen as HTML + PNG, a gallery per product, SCREENS.md per product.
//   node design-project/tools/build.mjs            (from the repo root; needs Node >= 22.18 and Playwright)
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CSS } from './css.mjs';
import { TOKENS } from './tokens.mjs';
import { missingIcons } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

import { PRODUCTS } from './products.mjs';

const page = (body, title = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${CSS}</style></head><body>${body}</body></html>`;
const SUP = { existing: ['Exists in the software', 'ok'], 'ui-new': ['New UI on existing data', 'info'], 'needs-backend': ['Needs backend work', 'warn'] };
const slug = (s, sfx = '') => s.id.toLowerCase() + sfx;

async function load(files) {
  const all = [];
  for (const f of files) { const p = join(HERE, f + '.mjs'); if (existsSync(p)) all.push(...(await import(pathToFileURL(p).href)).default); }
  return all;
}

const browser = await chromium.launch();
const pg = await browser.newPage();
const summary = {};

for (const P of PRODUCTS) {
  const screens = await load(P.files);
  if (!screens.length) continue;
  const dir = join(OUT, P.dir); mkdirSync(join(dir, 'screens'), { recursive: true }); mkdirSync(join(dir, 'previews'), { recursive: true });
  const rendered = screens.flatMap(s => { const base = { s, html: s.render(), sfx: '' }; return s.renderDesktop ? [base, { s: { ...s, id: s.id, name: s.name + ' (desktop)', purpose: s.purpose }, html: s.renderDesktop(), sfx: '-d' }] : [base]; });

  // 1) every screen: standalone HTML + PNG
  for (const { s, html, sfx } of rendered) {
    writeFileSync(join(dir, 'screens', slug(s, sfx) + '.html'), page(html, `${s.id} ${s.name}`));
    await pg.setViewportSize({ width: 1500, height: 1000 });
    await pg.setContent(page(`<div style="padding:20px;display:inline-block">${html}</div>`), { waitUntil: 'load' });
    const el = await pg.$('.desk, .phone');
    const phone = await pg.$('.phone');
    const scale = phone ? 2 : 1;
    if (el) { const box = await el.boundingBox(); await pg.setViewportSize({ width: Math.ceil(box.width + 60), height: Math.ceil(box.height + 60) }); }
    const target = await pg.$('.desk, .phone');
    await (target || pg).screenshot({ path: join(dir, 'previews', slug(s, sfx) + '.png'), type: 'png', scale: 'device' });
  }

  // 2) gallery page (self-contained, every screen scaled)
  const cell = ({ s, html, sfx }) => {
    const isPhone = /class="phone"/.test(html), isTab = /desk tab/.test(html), w = isPhone ? 410 : isTab ? 820 : 1440, h = isPhone ? 864 : isTab ? 1100 : 900, k = isPhone ? 0.62 : isTab ? 0.5 : 0.36;
    const sup = SUP[s.support || 'existing'];
    return `<figure id="${slug(s, sfx)}" style="margin:0 0 28px"><div style="width:${w * k}px;height:${h * k}px;overflow:hidden;border-radius:10px"><div style="transform:scale(${k});transform-origin:0 0;width:${w}px;height:${h}px">${html}</div></div><figcaption style="margin-top:8px;max-width:${Math.max(w * k, 240)}px"><b>${s.id}</b> · ${s.name} <span class="badge ${sup[1]}">${sup[0]}</span><div class="t-cap">${s.purpose}</div></figcaption></figure>`;
  };
  writeFileSync(join(dir, 'index.html'), page(`<div style="padding:28px 32px"><div class="t-over">DT POS design project</div><div class="t-h1">${P.title}</div>${P.parked ? '<div class="banner warn" style="max-width:80ch;margin:12px 0"><span><b>Parked for later.</b> Not part of the current scope: customers order on the ordering website. This design is kept so a branded multi-restaurant customer app (Foodpanda-style) can be built later without starting over.</span></div>' : ''}<p class="muted" style="max-width:80ch">${screens.length} screens, drawn from the real modules of the software. Sample content only. Each tile links to the full-size HTML in <code>screens/</code> and the PNG in <code>previews/</code>.</p><div style="display:flex;flex-wrap:wrap;gap:0 28px;margin-top:24px">${rendered.map(cell).join('')}</div></div>`, P.title));

  // 3) SCREENS.md
  const md = [`# ${P.title} — screen inventory`, '', ...(P.parked ? ['> **Parked for later.** Not part of the current scope — customers order on the ordering website. Kept so a branded multi-restaurant customer app can be built later.', ''] : []), `${screens.length} screens. Preview PNGs: \`previews/<id>.png\`; full-size HTML: \`screens/<id>.html\`. Sample content only — no figure on any screen is real data.`, '',
    '| Status | Meaning |', '|---|---|', '| Exists in the software | the module / feature is in the code today; this is a redesign of it |', '| New UI on existing data | a new screen, but every field comes from tables/RPCs that exist |', '| Needs backend work | the design is ready, the backend cannot do it yet (named in the screen) |', ''];
  for (const s of screens) {
    const sup = SUP[s.support || 'existing'];
    md.push(`## ${s.id} — ${s.name}`, '', `![${s.name}](previews/${slug(s)}.png)`, s.renderDesktop ? `![${s.name} — desktop](previews/${slug(s)}-d.png)` : '', '',
      `- **Purpose:** ${s.purpose}`, `- **Route / entry:** ${s.route || '—'}`, s.roles ? `- **Roles:** ${s.roles}` : '', `- **Status:** ${sup[0]}${s.evidence ? ` — evidence: \`${s.evidence}\`` : ''}`, `- **Data shown:** ${s.data || '—'}`,
      `- **Layout:** ${s.layout}`, `- **Components:** ${(s.comps || []).join(' · ')}`, `- **Buttons and actions:** ${(s.actions || []).join(' · ')}`, `- **Navigation:** ${s.nav || '—'}`,
      `- **Empty state:** ${s.empty}`, `- **Loading state:** ${s.loading}`, `- **Error state:** ${s.error}`, `- **Responsive:** ${s.resp}`, s.note ? `- **Note:** ${s.note}` : '', '');
  }
  writeFileSync(join(dir, 'SCREENS.md'), md.filter(l => l !== '').join('\n').replace(/\n(## )/g, '\n\n$1') + '\n');
  summary[P.id] = screens.length;
  console.log(P.id, screens.length, 'screens');
}
await browser.close();
const miss = missingIcons(); if (miss.length) console.log('missing icons:', miss.join(', '));
writeFileSync(join(OUT, 'tools', 'summary.json'), JSON.stringify(summary));
