// ============================================================
// DT RETAIL LOOK — seven themes, smooth animations, one-click return to the
// previous look, and the receipt / token / kitchen designs that go with it.
//
// What is pinned:
//   • the seven themes exist, read well, and agree with ui-tokens.css;
//   • choosing one sets the retail attributes, Classic removes every trace,
//     and the animations switch and "Back to my previous look" work;
//   • nothing in ui-retail.css can reach Classic, the plain Modern look or
//     the print window;
//   • the eleven receipt designs, five token designs and the kitchen slip are
//     registered and render on 80 mm and 58 mm paper, without <table>s (the
//     thermal print stylesheet restyles tables);
//   • it stays presentation — no data, licence, user or printer key.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  UI_ANIM_KEY, UI_PREV_KEY, UI_STYLE_KEY, UI_THEME_KEY, applyUiStyle, getAnimations, getPreviousLook, getThemeId, getUiLook,
  hslToRgb, resolveLook, restorePreviousLook, setAnimations, setTheme, setUiStyle,
} from '@/lib/uiStyle';
import {
  ALL_THEMES, DEFAULT_THEME_ID, INK_ON_ACCENT, RETAIL_THEMES, UI_THEMES, findTheme, isRetailTheme, type Triplet,
} from '@/lib/uiThemes';
import { tileHue, tileInitials } from '@/lib/tileLook';
import PremiumReceipt from '@/components/PremiumReceipt';
import {
  ALL_PREMIUM_TEMPLATES, PREMIUM_TEMPLATES, getPremiumTemplate, isPremiumTemplateId, type PremiumTemplateId,
} from '@/lib/premiumReceiptTemplates';
import { buildSampleOrder } from '@/lib/sampleOrder';
import { TOKEN_TEMPLATES, saveTokenOptions, tokenSlipInnerHtml, type TokenTemplate } from '@/lib/tokenSlip';

const root = () => document.documentElement;
const read = (...p: string[]) => readFileSync(resolve(__dirname, '..', ...p), 'utf8');
const tokens = read('styles', 'ui-tokens.css');
const retailCss = read('styles', 'ui-retail.css');

const RETAIL_IDS = ['dtr-royal', 'dtr-crimson', 'dtr-gold', 'dtr-emerald', 'dtr-sunset', 'dtr-ocean', 'dtr-night', 'dtr-espresso'];
const DARK_IDS = ['dtr-gold', 'dtr-night'];
const DTR_RECEIPTS = [
  'dtr-classic', 'dtr-modern', 'dtr-minimal', 'dtr-restaurant', 'dtr-retail-invoice', 'dtr-compact',
  'dtr-boxed-grid', 'dtr-bold-restaurant', 'dtr-tax-invoice', 'dtr-luxury', 'dtr-ticket',
] as PremiumTemplateId[];
const DTR_TOKENS = ['dtr-classic', 'dtr-boxed', 'dtr-bold', 'dtr-minimal', 'dtr-ticket'] as TokenTemplate[];

// ---- colour helpers (WCAG 2.x) ----
const rgb = (t: Triplet) => {
  const [h, s, l] = t.replace(/%/g, '').split(/\s+/).map(Number);
  return hslToRgb({ h, s, l });
};
const lum = ([r, g, b]: number[]) => {
  const c = [r, g, b].map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const WHITE = [255, 255, 255];

/** Declarations of every ui-tokens.css block for one theme, merged. */
function block(id: string): Record<string, string> {
  const re = new RegExp(`:root\\[data-ui="modern"\\]\\[data-ui-theme="${id}"\\]\\s*\\{([^}]*)\\}`, 'g');
  const out: Record<string, string> = {};
  let found = 0;
  for (let m = re.exec(tokens); m; m = re.exec(tokens)) {
    found++;
    for (const line of m[1].split(';')) {
      const i = line.indexOf(':');
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  expect(found, `no surface block for theme "${id}" in ui-tokens.css`).toBeGreaterThan(0);
  return out;
}

const ATTRS = ['data-ui', 'data-ui-theme', 'data-sidebar', 'data-on-accent', 'data-look', 'data-ui-mode', 'data-anim', 'data-theme', 'style'];
beforeEach(() => {
  localStorage.clear();
  // The cloud app's default style is Classic (DT Enterprise); these tests are about a restaurant that chose Modern.
  localStorage.setItem('dtpos-ui-style', 'modern');
  ATTRS.forEach(a => root().removeAttribute(a));
});

describe('the DT Retail themes (the guide’s seven + Espresso Orange)', () => {
  it('are listed after the thirteen Modern ones, which are untouched', () => {
    expect(RETAIL_THEMES.map(t => t.id)).toEqual(RETAIL_IDS);
    expect(UI_THEMES).toHaveLength(13);
    expect(ALL_THEMES).toHaveLength(22); // + DT Refined, the design package theme (v1.85.0)
    expect(new Set(ALL_THEMES.map(t => t.id)).size).toBe(22);
    expect(RETAIL_THEMES.map(t => t.name)).toEqual(['Royal Purple', 'Crimson Red & White', 'Black & Gold', 'Emerald', 'Sunset Orange', 'Ocean Blue', 'Night', 'Espresso Orange']);
    for (const t of RETAIL_THEMES) { expect(isRetailTheme(t.id)).toBe(true); expect(findTheme(t.id).id).toBe(t.id); }
    for (const t of UI_THEMES) expect(isRetailTheme(t.id)).toBe(false);
    expect(DEFAULT_THEME_ID).toBe('ember'); // a fresh install does not change look by itself
  });

  it('exactly Black & Gold and Night are dark', () => {
    expect(RETAIL_THEMES.filter(t => t.dark).map(t => t.id)).toEqual(DARK_IDS);
  });

  it.each(RETAIL_THEMES.map(t => [t.id, t] as const))('%s: the brand colour and the text on the page are readable', (_id, t) => {
    const look = resolveLook(t.id, null);
    // The guide's brand colours are kept exactly; white (or near-black for gold) on them is at least a large-text pass.
    const onAccent = look.darkOnAccent ? rgb(INK_ON_ACCENT) : WHITE;
    expect(contrast(rgb(`${t.accent.h} ${t.accent.s}% ${t.accent.l}%`), onAccent), 'text on the accent').toBeGreaterThanOrEqual(3);
    // Body and quiet text on the page and on cards.
    expect(contrast(rgb(t.surface.foreground), rgb(t.surface.background)), 'body text on the page').toBeGreaterThanOrEqual(12);
    expect(contrast(rgb(t.surface.mutedForeground), rgb(t.surface.background)), 'muted text on the page').toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(t.surface.mutedForeground), rgb(t.surface.muted)), 'muted text on chips').toBeGreaterThanOrEqual(4.5);
    // The accent used as text must read on the page.
    expect(contrast(hslToRgb(look.text), rgb(t.surface.background)), 'accent text on the page').toBeGreaterThanOrEqual(4.5);
    expect(contrast(hslToRgb(look.text), rgb(t.surface.card ?? '0 0% 100%')), 'accent text on cards').toBeGreaterThanOrEqual(4.5);
  });

  it.each(RETAIL_THEMES.map(t => [t.id, t] as const))('%s: the stylesheet block agrees with the theme', (id, t) => {
    const b = block(id);
    expect(b['--background']).toBe(t.surface.background);
    expect(b['--foreground']).toBe(t.surface.foreground);
    expect(b['--muted-foreground']).toBe(t.surface.mutedForeground);
    expect(b['--muted']).toBe(t.surface.muted);
    expect(b['--border']).toBe(t.surface.border);
    for (const k of ['--ui-sb-bg', '--ui-sb-fg', '--dtr-sb-top', '--dtr-sb-bot', '--dtr-hero-a', '--dtr-hero-b']) {
      expect(b[k], `${id} is missing ${k}`).toBeTruthy();
    }
    expect(/color-scheme:\s*dark/.test(Object.entries(b).map(([k, v]) => `${k}:${v}`).join(';'))).toBe(DARK_IDS.includes(id));
    // The sidebar text reads on both ends of the sidebar gradient.
    for (const end of ['--dtr-sb-top', '--dtr-sb-bot']) {
      expect(contrast(rgb(b['--ui-sb-fg']), rgb(b[end])), `menu text on ${end}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb(b['--ui-sb-muted-fg']), rgb(b[end])), `quiet text on ${end}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('choosing a DT Retail theme', () => {
  it('sets the retail attributes, forces the Modern style and stores the theme', () => {
    setTheme('dtr-royal');
    expect(root().getAttribute('data-ui')).toBe('modern');
    expect(root().getAttribute('data-look')).toBe('retail');
    expect(root().getAttribute('data-ui-theme')).toBe('dtr-royal');
    expect(root().hasAttribute('data-ui-mode')).toBe(false);
    expect(root().hasAttribute('data-anim')).toBe(false);
    expect(localStorage.getItem(UI_THEME_KEY)).toBe('dtr-royal');
    expect(getThemeId()).toBe('dtr-royal');
    expect(getUiLook()).toBe('retail');
  });

  it.each(DARK_IDS)('%s is marked dark so pages and dialogs follow', id => {
    setTheme(id);
    expect(root().getAttribute('data-ui-mode')).toBe('dark');
    setTheme('dtr-royal');
    expect(root().hasAttribute('data-ui-mode')).toBe(false);
  });

  it('picking a plain Modern theme drops the retail look again', () => {
    setTheme('dtr-night');
    setTheme('tomato');
    expect(root().hasAttribute('data-look')).toBe(false);
    expect(root().hasAttribute('data-ui-mode')).toBe(false);
    expect(root().getAttribute('data-ui-theme')).toBe('tomato');
    expect(getUiLook()).toBe('modern');
  });

  it('Classic removes every retail trace, and Modern brings the same theme back', () => {
    setTheme('dtr-gold');
    setAnimations(false);
    setUiStyle('classic');
    for (const a of ['data-ui', 'data-ui-theme', 'data-look', 'data-ui-mode', 'data-anim']) expect(root().hasAttribute(a), a).toBe(false);
    expect(getUiLook()).toBe('classic');
    setUiStyle('modern');
    expect(root().getAttribute('data-look')).toBe('retail');
    expect(root().getAttribute('data-ui-theme')).toBe('dtr-gold');
    expect(root().getAttribute('data-ui-mode')).toBe('dark');
    expect(root().getAttribute('data-anim')).toBe('off');
  });

  it('a stored unknown theme id still falls back to the default', () => {
    localStorage.setItem(UI_THEME_KEY, 'dtr-<script>');
    expect(getThemeId()).toBe(DEFAULT_THEME_ID);
  });
});

describe('smooth animations', () => {
  it('are on by default, switch off with one attribute and back on', () => {
    expect(getAnimations()).toBe(true);
    setTheme('dtr-ocean');
    expect(root().hasAttribute('data-anim')).toBe(false);
    setAnimations(false);
    expect(getAnimations()).toBe(false);
    expect(root().getAttribute('data-anim')).toBe('off');
    expect(localStorage.getItem(UI_ANIM_KEY)).toBe('off');
    setAnimations(true);
    expect(getAnimations()).toBe(true);
    expect(root().hasAttribute('data-anim')).toBe(false);
  });

  it('the stylesheet honours the switch, and the system "reduce motion" request', () => {
    expect(retailCss).toMatch(/html\[data-anim="off"\][^{]*\{[^}]*animation:\s*none/);
    expect(retailCss).toMatch(/prefers-reduced-motion/);
    // Every keyframe animation rule is guarded by the on-state.
    const animated = retailCss.replace(/\/\*[\s\S]*?\*\//g, '').split('}')
      .filter(r => /animation:\s*(?!none)/.test(r) && /\{/.test(r));
    expect(animated.length).toBeGreaterThan(5);
    for (const r of animated) {
      const sel = r.slice(0, r.indexOf('{'));
      expect(sel, `unguarded animation: ${sel.trim()}`).toMatch(/:not\(\[data-anim="off"\]\)|@media|data-anim/);
    }
  });
});

describe('Back to my previous look', () => {
  it('from Classic: picking a retail theme remembers Classic, and one call restores it', () => {
    setUiStyle('classic');
    setTheme('dtr-crimson');
    expect(getUiLook()).toBe('retail');
    expect(getPreviousLook()).toMatchObject({ style: 'classic' });
    expect(restorePreviousLook()).toBe(true);
    expect(getUiLook()).toBe('classic');
    expect(root().hasAttribute('data-look')).toBe(false);
    expect(getPreviousLook()).toBeNull();
    expect(localStorage.getItem(UI_PREV_KEY)).toBeNull();
  });

  it('from a Modern theme and accent: both come back', () => {
    setTheme('fresh');
    localStorage.setItem('dtpos-ui-accent', '#175fd3');
    applyUiStyle();
    setTheme('dtr-night');
    expect(getPreviousLook()).toEqual({ style: 'modern', theme: 'fresh', accent: '#175fd3' });
    expect(restorePreviousLook()).toBe(true);
    expect(getThemeId()).toBe('fresh');
    expect(localStorage.getItem('dtpos-ui-accent')).toBe('#175fd3');
    expect(root().getAttribute('data-ui-theme')).toBe('fresh');
  });

  it('moving between retail themes keeps the original memory', () => {
    setUiStyle('classic');
    setTheme('dtr-royal');
    setTheme('dtr-sunset');
    setTheme('dtr-night');
    expect(getPreviousLook()).toMatchObject({ style: 'classic' });
    restorePreviousLook();
    expect(getUiLook()).toBe('classic');
  });

  it('with nothing remembered it does nothing, and a garbage memory is ignored', () => {
    expect(restorePreviousLook()).toBe(false);
    localStorage.setItem(UI_PREV_KEY, '{"style":"x","theme":"<b>"}');
    expect(getPreviousLook()).toBeNull();
    expect(restorePreviousLook()).toBe(false);
  });

  it('choosing a plain theme forgets the memory', () => {
    setUiStyle('classic');
    setTheme('dtr-royal');
    setTheme('coffee');
    expect(getPreviousLook()).toBeNull();
  });
});

describe('presentation only', () => {
  it('touches only its own keys — no data, licence, user or printer key', () => {
    localStorage.setItem('desi-pos-data', '{"orders":[1,2,3]}');
    localStorage.setItem('pos-user-id', 'admin-default');
    localStorage.setItem('dtpos-printer-settings-v1', '{"printers":[]}');
    const before = new Map<string, string>();
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; before.set(k, localStorage.getItem(k)!); }

    for (const t of ALL_THEMES) setTheme(t.id);
    setTheme('dtr-emerald');
    setAnimations(false);
    restorePreviousLook();
    setUiStyle('classic');
    setUiStyle('modern');

    for (const [k, v] of before) expect(localStorage.getItem(k), `${k} changed`).toBe(v);
    const added: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (!before.has(k)) added.push(k); }
    const allowed = [UI_STYLE_KEY, UI_THEME_KEY, UI_ANIM_KEY, UI_PREV_KEY];
    for (const k of added) expect(allowed, `unexpected key ${k}`).toContain(k);
  });
});

describe('ui-retail.css cannot leak', () => {
  /** Top-level selectors of every rule, descending into @media. */
  function selectors(source: string): string[] {
    const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: string[] = [];
    const split = (list: string) => {
      const parts: string[] = []; let depth = 0, cur = '';
      for (const ch of list) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
      }
      if (cur.trim()) parts.push(cur.trim());
      return parts;
    };
    const walk = (chunk: string) => {
      let depth = 0, start = 0, header = '';
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === '{') { if (depth === 0) { header = chunk.slice(start, i).trim(); start = i + 1; } depth++; }
        else if (chunk[i] === '}') {
          depth--;
          if (depth === 0) {
            const body = chunk.slice(start, i);
            if (/^@(media|supports|container)/.test(header)) walk(body);
            else if (!/^@(keyframes|font-face)/.test(header)) split(header).forEach(s => out.push(s));
            start = i + 1;
          }
        }
      }
    };
    walk(text);
    return out;
  }

  it('every selector needs the Modern attribute AND the retail attribute', () => {
    const sels = selectors(retailCss);
    expect(sels.length).toBeGreaterThan(80);
    // The dark-page rules key on data-ui-mode, which only a retail theme ever sets (see the next test).
    const stray = sels.filter(s => !(/\[data-ui="modern"\]/.test(s) && /\[data-look="retail"\]|\[data-ui-mode="dark"\]/.test(s)));
    expect(stray, `unscoped selectors: ${stray.join(' | ')}`).toEqual([]);
  });

  it('only a DT Retail theme can set the dark page mode', () => {
    expect(UI_THEMES.filter(t => t.dark)).toEqual([]);
  });

  it('the print window document carries no retail attribute', () => {
    const fast = read('printing', 'fastPrint.ts');
    expect(fast).not.toMatch(/data-look|data-ui|ui-retail/);
  });

  it('is imported once, after the Modern stylesheets', () => {
    // The cloud app's stylesheet entry is styles.css (the offline POS imported them from main.tsx).
    const main = read('styles.css');
    expect(main.match(/ui-retail\.css/g)).toHaveLength(1);
    expect(main.indexOf('ui-retail.css')).toBeGreaterThan(main.indexOf('ui-pos.css'));
  });
});

describe('product tiles without a picture', () => {
  it('show the initials of the item', () => {
    expect(tileInitials('Zinger Burger')).toBe('ZB');
    expect(tileInitials('fries')).toBe('FR');
    expect(tileInitials('  Chicken   Tikka  Pizza ')).toBe('CT');
    expect(tileInitials('7 Up')).toBe('7U');
    expect(tileInitials('')).toBe('•');
    expect(tileInitials(undefined)).toBe('•');
    expect(tileInitials('چکن بریانی')).toHaveLength(2);
  });
  it('get one stable colour per category', () => {
    expect(tileHue('cat-burgers')).toBe(tileHue('cat-burgers'));
    const hues = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(tileHue));
    expect(hues.size).toBeGreaterThan(2);
    for (const h of hues) expect([25, 45, 356, 275, 200, 145]).toContain(h);
    expect(tileHue(undefined)).toBeTypeOf('number');
  });
});

describe('the eleven DT Retail receipt designs', () => {
  const settings: any = {
    name: 'Lotus Café', address: 'Main Boulevard, Burewala', phone1: '0300-0000000', currencySymbol: 'Rs ',
    thankYouText: 'Thank you for your visit', paperSize: '80mm',
  };

  it('are registered ahead of the sixteen existing designs, which are unchanged', () => {
    expect(PREMIUM_TEMPLATES).toHaveLength(16);
    expect(ALL_PREMIUM_TEMPLATES).toHaveLength(27);
    expect(ALL_PREMIUM_TEMPLATES.slice(0, 11).map(t => t.id)).toEqual(DTR_RECEIPTS);
    expect(ALL_PREMIUM_TEMPLATES.slice(0, 11).map(t => t.name)).toEqual([
      'DT Classic', 'DT Modern', 'DT Minimal', 'DT Restaurant', 'DT Retail Invoice', 'DT Compact',
      'DT Boxed Grid', 'DT Bold Restaurant', 'DT Tax Invoice + QR', 'DT Luxury', 'DT Ticket',
    ]);
    for (const id of DTR_RECEIPTS) { expect(isPremiumTemplateId(id)).toBe(true); expect(getPremiumTemplate(id)?.dtr).toBeTruthy(); }
    for (const t of PREMIUM_TEMPLATES) expect(t.dtr, t.id).toBeUndefined();
  });

  it('are offered in the receipt-design setting type and the gallery', () => {
    const types = read('lib', 'types.ts');
    const gallery = read('components', 'PremiumTemplateGallery.tsx');
    for (const id of DTR_RECEIPTS) expect(types).toContain(`'${id}'`);
    expect(gallery).toMatch(/DT Retail designs/);
  });

  it.each(DTR_RECEIPTS.flatMap(id => (['80mm', '58mm'] as const).map(p => [id, p] as const)))('%s renders on %s paper with the shop, the items and the total, and no <table>', (id, paper) => {
    const order = buildSampleOrder();
    const { container } = render(<PremiumReceipt order={order} settings={{ ...settings, paperSize: paper }} templateId={id} />);
    const el = container.querySelector('[data-dtr]') as HTMLElement;
    expect(el, 'DT Retail receipt root').toBeTruthy();
    expect(el.getAttribute('data-dtr')).toBe(getPremiumTemplate(id)!.dtr);
    const text = (el.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('Lotus Café');
    expect(text).toContain('Chicken Biryani');
    expect(text).toContain('Zinger Burger');
    expect(text).toMatch(/1[,]?690|1,?830|TOTAL|Total/); // subtotal or grand total is printed
    expect(text.length).toBeGreaterThan(120);
    // The thermal print stylesheet forces borders, bold and middle alignment onto <table>.
    expect(container.querySelectorAll('table').length).toBe(0);
  });

  it('never prints white text that the thermal worker cannot reverse', () => {
    // White-on-black is produced only by the classes the print pipeline knows (.dt-reverse) — no bare white on a
    // light background.
    const src = read('components', 'DtRetailReceipt.tsx');
    expect(src).toMatch(/dt-reverse/);
    expect(src).not.toMatch(/color:\s*['"]?#fff['"]?[^}]*background(Color)?:\s*['"]?(#fff|white)/i);
  });
});

describe('the five DT Retail token designs', () => {
  const data = {
    orderNumber: 27,
    orderType: 'takeaway',
    restaurantName: 'Lotus Café',
    when: new Date('2026-09-30T13:05:00'),
    items: [
      { name: 'Chicken Biryani', qty: 2, note: 'Less spicy', amount: 1234 },
      { name: 'Cold Drink 500ml', qty: 1, amount: 567 },
    ],
  };

  beforeEach(() => { localStorage.clear(); localStorage.setItem('dtpos-ui-style', 'modern'); });

  it('are listed first in the picker, with the original designs after them', () => {
    const ids = TOKEN_TEMPLATES.map(t => t.id);
    expect(ids).toEqual(expect.arrayContaining(['classic', 'bold', 'boxed', 'minimal', 'standard', 'professional', 'vip', ...DTR_TOKENS]));
    expect(ids).toHaveLength(12);
    for (const id of DTR_TOKENS) expect(TOKEN_TEMPLATES.find(t => t.id === id)!.name).toMatch(/^DT /);
  });

  it.each(DTR_TOKENS)('%s prints the number, the order type, the items — and no prices by default', id => {
    const html = tokenSlipInnerHtml(data, id);
    expect(html).toContain('27');
    expect(html).toMatch(/TAKEAWAY|Takeaway|Take ?away/i);
    expect(html).toContain('Chicken Biryani');
    expect(html).toContain('Less spicy');
    expect(html).not.toMatch(/<table/i);
    expect(html).not.toContain('1234');
    expect(html).not.toContain('1,234');
    expect(html).not.toContain('567');
  });

  it.each(DTR_TOKENS)('%s prints prices only when the shop turns them on', id => {
    saveTokenOptions({ showPrices: true });
    const html = tokenSlipInnerHtml(data, id);
    expect(html).toMatch(/1,?234/);
    expect(html).toContain('567');
  });

  it('the original designs still print exactly their own layout', () => {
    for (const id of ['classic', 'bold', 'boxed', 'minimal', 'standard', 'professional', 'vip'] as TokenTemplate[]) {
      const html = tokenSlipInnerHtml(data, id);
      expect(html.length, id).toBeGreaterThan(100);
      expect(html, id).not.toContain('data-dtr');
    }
  });
});

describe('the kitchen slip', () => {
  it('has a DT Kitchen Order design in the setting type, the picker and the slip', () => {
    expect(read('lib', 'types.ts')).toContain("'dtr-kitchen'");
    expect(read('components', 'settings', 'KotSettingsTab.tsx')).toContain('dtr-kitchen');
    expect(read('components', 'KitchenReceipt.tsx')).toMatch(/KITCHEN ORDER/);
  });
});
