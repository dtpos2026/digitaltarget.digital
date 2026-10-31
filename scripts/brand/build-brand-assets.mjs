// ============================================================================
// Builds the brand kit from src/lib/brand.ts and the master artwork branding/dt-pos-icon.svg:
//
//   branding/icons/<app>.svg                  the app icon, one colour per app, same artwork
//   branding/marks/mark-*.svg                 the mark alone (white, purple, ink)
//   branding/export/<app>/                    1024 / 512 / 192 PNG, maskable 512, Apple 180, favicons (pos)
//   branding/export/android/<Folder>/res/     drop-in Android resources: legacy + round + adaptive-foreground
//                                             icons at five densities, portrait and landscape splash screens,
//                                             and values/ic_launcher_background.xml
//   branding/brand-guide.html                 one self-contained page: marks, icons, palette, splash, usage
//
//   node scripts/brand/build-brand-assets.mjs            (needs Node >= 22.18 and Playwright; set
//                                                         PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs if it is not installed here)
// Rendering uses a real browser so the text in the splash screens is set in Inter and the PNGs are crisp.
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Lucide from 'lucide-react';
import { BRAND, BRAND_APPS, ICON_GEOMETRY as G, MARK_TRIANGLES, PALETTE, ANDROID_DENSITIES } from '../../src/lib/brand.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'branding');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const write = (rel, data) => { const f = join(OUT, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, data); return f; };
const b64 = (s) => Buffer.from(s).toString('base64');

// ---------------------------------------------------------------- artwork
const TEMPLATE = readFileSync(join(OUT, 'dt-pos-icon.svg'), 'utf8');   // the purple master
const PURPLE = BRAND_APPS.find(a => a.id === 'pos').accent;
const recolor = (svg, a) => svg
  .replaceAll(PURPLE.light, a.light).replaceAll(PURPLE.mid, a.mid).replaceAll(PURPLE.dark, a.dark)
  .replaceAll(PURPLE.tint, a.tint).replaceAll(PURPLE.shadow, a.shadow);
const baseSvg = (app) => recolor(TEMPLATE, app.accent);
const MARK_GROUP = /<g filter="url\(#lift\)" fill="url\(#mark\)">[\s\S]*?<\/g>/;

/** The Lucide glyph as SVG children (24 × 24 units, stroked). */
const glyphInner = (name, color) => {
  const svg = renderToStaticMarkup(createElement(Lucide[name], { size: 24, strokeWidth: 2, color }));
  return svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));
};

// Role apps: the mark moves to the upper left and shrinks, and the app's job sits in a white badge at the lower right.
// (Centre 700, radius 225 keeps the badge inside the circle of the round launcher icon too.)
const MARK = { origin: 130, cell: 175 };
const BADGE = { cx: 700, cy: 700, r: 225, glyph: 310 };
const roleMarkPoints = () => MARK_TRIANGLES.map(t => t.split(' ').map(p => p.split(',').map(Number).map(v => (MARK.origin + v * MARK.cell).toFixed(1)).join(',')).join(' '));
function roleGroup(app, { shadow, fill }) {
  const f = shadow ? ' filter="url(#lift)"' : '';
  const glyph = glyphInner(app.glyph, app.accent.mid);
  const k = BADGE.glyph / 24;
  return `<g${f} fill="${fill}">${roleMarkPoints().map(p => `<polygon points="${p}"/>`).join('')}</g>
  <g${f}><circle cx="${BADGE.cx}" cy="${BADGE.cy}" r="${BADGE.r}" fill="#ffffff"/></g>
  <g transform="translate(${BADGE.cx - BADGE.glyph / 2} ${BADGE.cy - BADGE.glyph / 2}) scale(${k})" fill="none" stroke="${app.accent.mid}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`;
}
const iconSvg = (app) => app.glyph ? baseSvg(app).replace(MARK_GROUP, () => roleGroup(app, { shadow: true, fill: 'url(#mark)' })) : baseSvg(app);
const squareSvg = (app) => iconSvg(app).replace(/rx="23[0-9]"|rx="229"/g, 'rx="0"');
const roundSvg = (app) => iconSvg(app).replace(/rx="232"/, 'rx="512"').replace(/rx="229"/, 'rx="509"');

/** Android adaptive foreground: mark (and badge) only, inside the 61 % safe zone, on a transparent canvas. */
function foregroundSvg(app) {
  const defs = `<defs><linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${app.accent.tint}"/></linearGradient></defs>`;
  if (app.glyph) {
    const mid = MARK.origin + MARK.cell, ext = (MARK.origin + (BADGE.cx + BADGE.r)) / 2;   // centre of the composition's bounding box
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G.size} ${G.size}" width="${G.size}" height="${G.size}">${defs}
  <g transform="translate(512 512) scale(0.66) translate(${-ext} ${-ext})">${roleGroup(app, { shadow: false, fill: 'url(#m)' })}</g></svg>`;
  }
  const side = G.size * G.adaptiveMarkRatio, o = (G.size - side) / 2, c = side / 2;
  const pts = MARK_TRIANGLES.map(t => t.split(' ').map(p => p.split(',').map((v) => (o + Number(v) * c).toFixed(1)).join(',')).join(' '));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G.size} ${G.size}" width="${G.size}" height="${G.size}">${defs}
  <g fill="url(#m)">${pts.map(p => `<polygon points="${p}"/>`).join('')}</g></svg>`;
}
const markSvg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2" width="256" height="256" fill="${fill}"><title>Digital Target</title>${MARK_TRIANGLES.map(p => `<polygon points="${p}"/>`).join('')}</svg>`;

// ---------------------------------------------------------------- rendering
const browser = await chromium.launch();
const page = await browser.newPage();
async function shotHtml(html, w, h, transparent = true) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent;width:${w}px;height:${h}px;overflow:hidden">${html}</body></html>`);
  await page.waitForTimeout(40);
  return page.screenshot({ type: 'png', omitBackground: transparent });
}
const png = (svg, s) => shotHtml(`<img src="data:image/svg+xml;base64,${b64(svg)}" width="${s}" height="${s}" style="display:block">`, s, s);

function splashHtml(app, w, h) {
  const m = Math.min(w, h), a = app.accent;
  const mark = `<svg width="${m * 0.26}" height="${m * 0.26}" viewBox="0 0 2 2" fill="#fff">${MARK_TRIANGLES.map(p => `<polygon points="${p}"/>`).join('')}</svg>`;
  return `<div style="width:${w}px;height:${h}px;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;
    background:${a.mid};
    font-family:Inter,system-ui,sans-serif;color:#fff">
    ${mark}
    <div style="margin-top:${m * 0.05}px;font-size:${m * 0.072}px;font-weight:600;letter-spacing:${m * 0.002}px">${app.label}</div>
    <div style="position:absolute;bottom:${m * 0.06}px;font-size:${m * 0.034}px;font-weight:500">${BRAND.poweredBy}</div></div>`;
}

const files = [];
const emit = (rel, data) => { files.push(rel); return write(rel, data); };

for (const m of [['mark-white', '#ffffff'], ['mark-purple', PALETTE.purpleDeep], ['mark-ink', PALETTE.ink]]) emit(`marks/${m[0]}.svg`, markSvg(m[1]));

const thumbs = {};
for (const app of BRAND_APPS) {
  emit(`icons/${app.id}.svg`, iconSvg(app));
  for (const s of [1024, 512, 192]) emit(`export/${app.id}/icon-${s}.png`, await png(iconSvg(app), s));
  emit(`export/${app.id}/icon-maskable-512.png`, await png(squareSvg(app).replace(/<g filter="url\(#lift\)" fill="url\(#mark\)">/, '<g transform="translate(512 512) scale(0.82) translate(-512 -512)" filter="url(#lift)" fill="url(#mark)">'), 512));
  if (app.id === 'pos') {
    emit('export/pos/apple-touch-icon-180.png', await png(squareSvg(app), 180));
    for (const s of [48, 32, 16]) emit(`export/pos/favicon-${s}.png`, await png(iconSvg(app), s));
  }
  thumbs[app.id] = { icon: (await png(iconSvg(app), 256)).toString('base64') };

  if (app.androidFolder) {
    const res = `export/android/${app.androidFolder}/res`;
    for (const dn of ANDROID_DENSITIES) {
      emit(`${res}/mipmap-${dn.d}/ic_launcher.png`, await png(iconSvg(app), dn.icon));
      emit(`${res}/mipmap-${dn.d}/ic_launcher_round.png`, await png(roundSvg(app), dn.icon));
      emit(`${res}/mipmap-${dn.d}/ic_launcher_foreground.png`, await png(foregroundSvg(app), dn.fg));
      emit(`${res}/drawable-port-${dn.d}/splash.png`, await shotHtml(splashHtml(app, ...dn.port), ...dn.port, false));
      emit(`${res}/drawable-land-${dn.d}/splash.png`, await shotHtml(splashHtml(app, ...dn.land), ...dn.land, false));
    }
    emit(`${res}/drawable/splash.png`, await shotHtml(splashHtml(app, 480, 320), 480, 320, false));
    emit(`${res}/values/ic_launcher_background.xml`, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${app.accent.mid.toUpperCase()}</color>\n</resources>`);
    thumbs[app.id].splash = (await shotHtml(splashHtml(app, 320, 480), 320, 480, false)).toString('base64');
  }
}

// ---------------------------------------------------------------- the brand guide
const lum = (hex) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const swatch = (name, hex, on = '#ffffff') => `<div class="sw" style="background:${hex};color:${on}"><b>${name}</b><span>${hex}</span><span>${ratio(hex, on).toFixed(2)} : 1 with ${on === '#ffffff' ? 'white' : 'ink'}</span></div>`;
const markInline = (fill, s) => `<svg width="${s}" height="${s}" viewBox="0 0 2 2" fill="${fill}">${MARK_TRIANGLES.map(p => `<polygon points="${p}"/>`).join('')}</svg>`;
const lockup = (fill, s) => `<div class="lockup" style="color:${fill}">${markInline(fill, s)}<div><div>${BRAND.wordmark[0]}</div><div>${BRAND.wordmark[1]}</div></div></div>`;

const guide = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DT POS — Brand guide</title><style>
:root{--ink:${PALETTE.ink};--muted:${PALETTE.muted};--deep:${PALETTE.purpleDeep};--lav:${PALETTE.lavender}}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;color:var(--ink);background:#fff;line-height:1.55}
header{background:linear-gradient(120deg,${PALETTE.purpleDeep},${PALETTE.purple});color:#fff;padding:56px 7vw}
header h1{margin:18px 0 6px;font-size:40px;letter-spacing:-.5px}header p{margin:0;opacity:.92;max-width:62ch}
main{padding:10px 7vw 60px;max-width:1180px;margin:0 auto}h2{margin:48px 0 6px;font-size:24px}h2+p{margin:0 0 20px;color:var(--muted);max-width:70ch}
.row{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}.card{border:1px solid #e4def0;border-radius:18px;padding:22px;background:#fff;text-align:center}.card .icon{width:auto;margin-top:8px}
.lockup{display:flex;align-items:center;gap:14px;font-weight:600;font-size:26px;line-height:1.05;letter-spacing:.5px}
.tile{border-radius:18px;padding:30px 36px;display:flex;align-items:center;justify-content:center;min-width:290px}
.icons{display:flex;flex-wrap:wrap;gap:28px}.icon{text-align:center;font-size:13px;color:var(--muted);width:215px}.icon img{display:block;margin:0 auto 8px}.icon b{display:block;color:var(--ink);font-size:15px}
.sizes{display:flex;gap:14px;align-items:flex-end;justify-content:center;margin-top:8px}
.pal{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}.sw{border-radius:14px;padding:16px;min-height:104px;display:flex;flex-direction:column;justify-content:flex-end;font-size:12.5px}.sw b{font-size:15px}
.splash{display:flex;gap:18px;flex-wrap:wrap}.splash img{width:150px;border-radius:14px;border:1px solid #e4def0;display:block}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:10px 12px;border-bottom:1px solid #ece8f3;text-align:left;vertical-align:top}th{color:var(--muted);font-weight:600}
code{background:var(--lav);padding:1px 6px;border-radius:6px;font-size:12.5px}.do{display:grid;grid-template-columns:1fr 1fr;gap:20px}.do ul{margin:6px 0 0;padding-left:18px}.do h3{margin:0;font-size:15px}
.ok h3{color:#15803d}.no h3{color:#b91c1c}@media(max-width:760px){.do{grid-template-columns:1fr}}
</style></head><body>
<header>${lockup('#fff', 54)}<h1>${BRAND.product} — brand guide</h1><p>${BRAND.tagline}. One mark, one app icon, one set of colours — on the software, the owner portal, the invoices and every phone app. Generated from <code style="background:rgba(255,255,255,.16);color:#fff">src/lib/brand.ts</code>.</p></header><main>

<h2>1 · The mark and the lockup</h2><p>Four right triangles in a square. It is always drawn as a shape, never as a picture, and takes one flat colour.</p>
<div class="row">
 <div class="tile" style="background:${PALETTE.purple}">${lockup('#fff', 52)}</div>
 <div class="tile" style="background:#fff;border:1px solid #e4def0">${lockup(PALETTE.purpleDeep, 52)}</div>
 <div class="tile" style="background:${PALETTE.ink}">${lockup('#fff', 52)}</div>
</div>
<div class="row" style="margin-top:16px">
 <div class="card">${markInline(PALETTE.purpleDeep, 96)}<div class="icon">mark · purple</div></div>
 <div class="card" style="background:${PALETTE.purple}">${markInline('#fff', 96)}<div class="icon" style="color:#fff">mark · white</div></div>
 <div class="card"><table style="width:300px"><tr><th>Clear space</th><td>half the mark's width on every side</td></tr><tr><th>Minimum</th><td>16 px mark · 96 px lockup</td></tr><tr><th>Wordmark</th><td>DIGITAL / TARGET, two lines, semi-bold</td></tr><tr><th>Under the product</th><td><i>${BRAND.poweredBy}</i></td></tr></table></div>
</div>

<h2>2 · App icons</h2><p>The same artwork — a squircle with a soft gradient, a light glow, and the white mark — in one colour per app. The three phone apps add a white badge with their job: a bag for the customer, a motorbike for the rider, an order pad for the order taker.</p>
<div class="icons">${BRAND_APPS.map(a => `<div class="icon"><img src="data:image/png;base64,${thumbs[a.id].icon}" width="148" height="148" alt="${a.label}"><b>${a.label}</b>${a.packageId ? a.packageId + '<br>' : ''}${a.role || ''}</div>`).join('')}</div>
<p style="margin-top:22px">At launcher sizes:</p>
<div class="icons">${BRAND_APPS.map(a => `<div class="icon"><div class="sizes">${[72, 48, 32, 16].map(s => `<img src="data:image/png;base64,${thumbs[a.id].icon}" width="${s}" height="${s}" alt="" style="margin:0">`).join('')}</div></div>`).join('')}</div>

<h2>3 · Colour</h2><p>Text on a brand colour is always white (or, on a pale colour, the ink) and the pair is measured. Each app's <i>mid</i> colour is also its Android adaptive-icon background.</p>
<div class="pal">${swatch('Purple deep', PALETTE.purpleDeep)}${swatch('Purple', PALETTE.purple)}${swatch('Lavender', PALETTE.lavender, PALETTE.ink)}${swatch('Ink', PALETTE.ink)}${swatch('Muted', PALETTE.muted)}
${BRAND_APPS.map(a => swatch(a.label + ' · mid', a.accent.mid)).join('')}${BRAND_APPS.map(a => swatch(a.label + ' · light', a.accent.light)).join('')}</div>

<h2>4 · Splash screens</h2><p>Flat in the app's colour (so every splash screen stays a few kilobytes), the white mark, the app's name, and <i>${BRAND.poweredBy}</i>. Portrait and landscape at five densities.</p>
<div class="splash">${BRAND_APPS.filter(a => a.androidFolder).map(a => `<div><img src="data:image/png;base64,${thumbs[a.id].splash}" alt="${a.label} splash"><div class="icon">${a.label}</div></div>`).join('')}</div>

<h2>5 · Using it</h2><p>&nbsp;</p>
<div class="do"><div class="ok"><h3>Do</h3><ul><li>Use the mark as an SVG, in white on a brand colour or in purple on white.</li><li>Put the mark and the wordmark directly on the colour — no tile behind them.</li><li>Show a restaurant's own logo beside <i>${BRAND.poweredBy}</i>.</li><li>Read colours from <code>src/lib/brand.ts</code> or the theme tokens.</li></ul></div>
<div class="no"><h3>Don't</h3><ul><li>Place a picture of the old logo on a coloured square.</li><li>Redraw, rotate, outline, stretch or add a shadow to the mark.</li><li>Put the mark on a colour it does not read on (below 3 : 1).</li><li>Type the phone numbers or the e-mail into a screen — import them from the brand file.</li></ul></div></div>

<h2>6 · What is in the kit</h2>
<table><tr><th>Path</th><th>What</th></tr>
<tr><td><code>branding/icons/*.svg</code></td><td>the four app icons — the master artwork recoloured, with the app's job in a badge for the three phone apps</td></tr>
<tr><td><code>branding/marks/*.svg</code></td><td>the mark alone: white, purple, ink</td></tr>
<tr><td><code>branding/export/&lt;app&gt;/</code></td><td>1024, 512 (store), 192, maskable 512; for the POS also Apple 180 and favicons</td></tr>
<tr><td><code>branding/export/android/&lt;App&gt;/res/</code></td><td>drop-in Android resources: <code>mipmap-*</code> (legacy, round, adaptive foreground), <code>drawable-port-*</code> / <code>drawable-land-*</code> splash, <code>values/ic_launcher_background.xml</code></td></tr>
<tr><td><code>scripts/brand/build-brand-assets.mjs</code></td><td>regenerates all of the above from <code>src/lib/brand.ts</code></td></tr></table>
<p style="margin-top:30px;color:var(--muted);font-size:13px">${BRAND.name} · ${BRAND.phones.join(' · ')} · ${BRAND.email} · ${BRAND.web}. Text in the generated splash screens is set in Inter.</p>
</main></body></html>`;
write('brand-guide.html', guide);
writeFileSync(join(OUT, 'export', 'MANIFEST.json'), JSON.stringify({ generatedBy: 'scripts/brand/build-brand-assets.mjs', files: files.sort() }, null, 2));
await browser.close();
console.log(`brand kit: ${files.length} files`);
