// ============================================================================
// v1.68.0 — the reference theme set (13 Modern + 8 DT Retail)
//
// REQUESTED: "baki themes wagaira jitne kafi sare hain iske andar bahut acche
// theme hai, theek hai, branding ke sath bhi hai" — the reference package's
// themes, with their branding.
//
// Its own rule number 5 is "readable by test": every theme is checked for
// contrast, by a test and not by eye. That is the heart of this file. The other
// rules it states are also asserted: a theme is presentation only, every rule
// is scoped, and nothing leaks into a theme that is not using it.
// ============================================================================
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { themes, applyTheme, type ThemeId } from '@/lib/themes';
import { REFERENCE_THEME_SPECS, referenceThemes } from '@/lib/referenceThemes';
import { PREMIUM_THEME_IDS, isPremiumTheme } from '@/lib/premiumTheme';
import { contrast, hexToHsl, fmtHsl, parseHsl, safeAccent, hslToRgb } from '@/lib/colorContrast';

const css = readFileSync('src/index.css', 'utf8');
const refStart = css.lastIndexOf('/*', css.indexOf('REFERENCE THEMES — shared rules'));   // from the comment's own opening

const byId = (id: string) => themes.find(t => t.id === id)!;
const ids = REFERENCE_THEME_SPECS.map(s => s.id);

describe('the set is what the reference package lists', () => {
  it('has 13 Modern and 8 DT Retail themes', () => {
    expect(REFERENCE_THEME_SPECS.filter(s => s.family === 'modern')).toHaveLength(13);
    expect(REFERENCE_THEME_SPECS.filter(s => s.family === 'retail')).toHaveLength(8);
  });
  it('every id is unique and none collides with an existing theme', () => {
    expect(new Set(themes.map(t => t.id)).size).toBe(themes.length);
    expect(themes.length).toBe(11 + 21);
  });
  it('all 21 are registered, in the picker, under their collection heading', () => {
    for (const id of ids) expect(byId(id), id).toBeTruthy();
    expect(referenceThemes.filter(t => t.group.includes('Modern'))).toHaveLength(13);
    expect(referenceThemes.filter(t => t.group.includes('DT Retail'))).toHaveLength(8);
  });
  it('DT Retail themes use the accent values the document gives', () => {
    // hue/saturation are never touched by the readability pass, only lightness
    const espresso = parseHsl(byId('dtr-espresso').variables['--primary']);
    expect(Math.round(espresso[0])).toBe(21);
    expect(Math.round(espresso[1])).toBe(90);
  });
});

describe('every one is readable — contrast, by test', () => {
  it.each(ids)('%s', (id) => {
    const v = byId(id).variables;
    const dark = v['--theme-mode'] === 'dark';
    // body text on the page and on cards (the reference asks 7:1)
    expect(contrast(v['--foreground'], v['--background']), 'text on page').toBeGreaterThanOrEqual(7);
    expect(contrast(v['--card-foreground'], v['--card']), 'text on card').toBeGreaterThanOrEqual(7);
    // everything else 4.5:1
    expect(contrast(v['--muted-foreground'], v['--background']), 'muted on page').toBeGreaterThanOrEqual(4.5);
    expect(contrast(v['--muted-foreground'], v['--card']), 'muted on card').toBeGreaterThanOrEqual(4.5);
    expect(contrast(v['--muted-foreground'], v['--muted']), 'muted on muted').toBeGreaterThanOrEqual(4.5);
    expect(contrast(v['--primary-foreground'], v['--primary']), 'text on accent').toBeGreaterThanOrEqual(4.5);
    expect(contrast(v['--secondary-foreground'], v['--secondary']), 'text on secondary').toBeGreaterThanOrEqual(4.5);
    expect(contrast(v['--accent-foreground'], v['--accent']), 'text on hover surface').toBeGreaterThanOrEqual(4.5);
    expect(contrast(v['--pos-sidebar-foreground'], v['--pos-sidebar']), 'sidebar text').toBeGreaterThanOrEqual(4.5);
    expect(contrast(v['--sidebar-accent-foreground'], v['--sidebar-accent']), 'sidebar hover').toBeGreaterThanOrEqual(4.5);
    expect(contrast(v['--gold-foreground'], v['--gold']), 'text on highlight').toBeGreaterThanOrEqual(4.5);
    // the accent used AS TEXT (prices, links) on the page
    const asText = v['--primary-text'] ?? v['--primary'];
    expect(contrast(asText, v['--background']), 'accent as text on page').toBeGreaterThanOrEqual(4.5);
    expect(contrast(asText, v['--card']), 'accent as text on card').toBeGreaterThanOrEqual(4.5);
    // a dark page declares itself so scoped CSS can adapt
    expect(!!dark).toBe(!!REFERENCE_THEME_SPECS.find(s => s.id === id)!.darkPage === true);
  });

  it.each(REFERENCE_THEME_SPECS.filter(s => s.family === 'retail').map(s => s.id))('%s: sidebar text reads on BOTH ends of the gradient', (id) => {
    const v = byId(id).variables;
    for (const end of [v['--sidebar-gradient-from'], v['--sidebar-gradient-to']]) {
      expect(contrast('0 0% 100%', end)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('every Modern theme has a hero banner white text can sit on', () => {
  it.each(REFERENCE_THEME_SPECS.filter(s => s.family === 'modern').map(s => s.id))('%s', (id) => {
    const v = byId(id).variables;
    for (const end of [v['--hero-from'], v['--hero-to']]) {
      expect(contrast('0 0% 100%', end), `white on ${end}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('light sidebars are flagged, and text on them reads', () => {
  it('a light-sidebar theme sets data-sidebar; a dark one does not; switching clears it', () => {
    applyTheme('ember');
    expect(document.documentElement.getAttribute('data-sidebar')).toBe('light');
    applyTheme('charcoal');
    expect(document.documentElement.getAttribute('data-sidebar')).toBeNull();
    applyTheme('dtr-espresso');
    expect(document.documentElement.getAttribute('data-sidebar')).toBeNull();
  });
  it('Soft Light has a hero banner white text can sit on', () => {
    const v = byId('soft-light').variables;
    expect(contrast('0 0% 100%', v['--hero-from'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast('0 0% 100%', v['--hero-to'])).toBeGreaterThanOrEqual(4.5);
  });
  it('Soft Light (white sidebar) is flagged too', () => {
    applyTheme('soft-light');
    expect(document.documentElement.getAttribute('data-sidebar')).toBe('light');
  });
  it.each(REFERENCE_THEME_SPECS.filter(s => !('sidebar' in s) && !('darkSidebar' in s)).map(s => s.id))('%s: the sidebar subtitle ("gold") reads on the sidebar', (id) => {
    const v = byId(id).variables;
    expect(contrast(v['--gold'], v['--pos-sidebar'])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the readability pass never repaints a brand colour', () => {
  it('safeAccent keeps hue and saturation and only moves lightness', () => {
    for (const s of REFERENCE_THEME_SPECS) {
      const given = parseHsl(s.accent);
      const out = safeAccent(given, s.textOnAccent);
      expect(out[0]).toBe(given[0]);
      expect(out[1]).toBe(given[1]);
    }
  });
  it('an accent that already reads is left exactly as given', () => {
    const navy = parseHsl('217 80% 46%');
    expect(safeAccent(navy, 'light')).toEqual(navy);   // white on this blue is already > 4.5
  });
  it('Sunny Yellow keeps dark text on the yellow and a deeper shade for text', () => {
    const v = byId('sunny').variables;
    expect(v['--primary-foreground']).not.toBe('0 0% 100%');
    expect(v['--primary-text']).toBe('34 90% 30%');
  });
});

describe('colour maths', () => {
  it('black on white is 21:1, white on white is 1:1', () => {
    expect(contrast('0 0% 0%', '0 0% 100%')).toBeCloseTo(21, 0);
    expect(contrast('0 0% 100%', '0 0% 100%')).toBeCloseTo(1, 5);
  });
  it('hex -> HSL -> RGB round-trips', () => {
    const [r, g, b] = hslToRgb(hexToHsl('#e9590c'));
    expect(Math.abs(r - 0xe9)).toBeLessThanOrEqual(1);
    expect(Math.abs(g - 0x59)).toBeLessThanOrEqual(1);
    expect(Math.abs(b - 0x0c)).toBeLessThanOrEqual(1);
  });
  it('formats a triplet the way CSS variables hold it', () => {
    expect(fmtHsl([263, 70, 50])).toBe('263 70% 50%');
  });
});

describe('premium — one gate, one switch', () => {
  it('every reference theme is premium-gated, so no restaurant sees one unless Super Admin allows it', () => {
    for (const id of ids) {
      expect(PREMIUM_THEME_IDS, id).toContain(id);
      expect(isPremiumTheme(id as ThemeId)).toBe(true);
    }
  });
  it('the earlier themes keep their status', () => {
    expect(isPremiumTheme('vince-premium')).toBe(true);
    expect(isPremiumTheme('soft-light')).toBe(true);
    expect(isPremiumTheme('dt-pos-purple')).toBe(false);
  });
});

describe('applying a theme', () => {
  afterEach(() => {
    const root = document.documentElement;
    for (const a of ['data-look', 'data-ui-mode', 'data-accent', 'data-sidebar', 'data-theme']) root.removeAttribute(a);
    root.removeAttribute('style');
  });
  const root = () => document.documentElement;

  it('a DT Retail theme sets the look, and its own sidebar and hero gradients', () => {
    applyTheme('dtr-espresso');
    expect(root().getAttribute('data-look')).toBe('retail');
    expect(root().style.getPropertyValue('--gradient-sidebar')).toContain('17 68% 12%');
    expect(root().style.getPropertyValue('--gradient-sidebar')).toContain('16 73% 6%');
    expect(root().style.getPropertyValue('--gradient-primary')).toContain('17 79% 32%');
  });
  it('a dark-page theme says so', () => {
    applyTheme('dtr-night');
    expect(root().getAttribute('data-ui-mode')).toBe('dark');
  });
  it('a theme with a second text shade switches the text-colour override on', () => {
    applyTheme('sunny');
    expect(root().getAttribute('data-accent')).toBe('split');
    applyTheme('dtr-night');
    expect(root().getAttribute('data-accent')).toBe('split');
    applyTheme('tomato');                       // one value does both jobs
    expect(root().getAttribute('data-accent')).toBeNull();
  });
  it('switching back to an ordinary theme leaves nothing of the retail look behind', () => {
    applyTheme('dtr-night');
    applyTheme('dt-pos-purple');
    expect(root().getAttribute('data-look')).toBeNull();
    expect(root().getAttribute('data-ui-mode')).toBeNull();
    expect(root().getAttribute('data-accent')).toBeNull();
    expect(root().style.getPropertyValue('--gradient-sidebar')).not.toContain('222 48% 11%');
    expect(root().style.getPropertyValue('--gradient-primary')).not.toContain('273 84% 22%');
  });
  it('an ordinary theme still derives its gradients exactly as before', () => {
    applyTheme('dt-pos-purple');
    expect(root().style.getPropertyValue('--gradient-sidebar')).toMatch(/linear-gradient\(180deg, hsl\(.+\), hsl\(.+ \/ 0\.88\)\)/);
  });
});

describe('the shared CSS is scoped and colour-free', () => {
  const block = css.slice(refStart);
  it('exists', () => { expect(refStart).toBeGreaterThan(0); });
  it('every selector hangs off an attribute only the right themes set', () => {
    const sels = block.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}').map(chunk => chunk.split('{')[0])
      .flatMap(head => head.split(',')).map(x => x.trim()).filter(Boolean);
    expect(sels.length).toBeGreaterThan(5);
    for (const s of sels) expect(s, s).toMatch(/^\[data-(look|accent|ui-mode|sidebar)=/);
  });
  it('hard-codes no hex or rgb colour — it follows the theme variables', () => {
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/rgba?\(/);
  });
});

describe('a theme is presentation only', () => {
  it('the builder and colour helpers import nothing from the store, sync or billing code', () => {
    for (const f of ['src/lib/referenceThemes.ts', 'src/lib/colorContrast.ts']) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/from '\.\/(store|supabase|supabaseStore|supabaseSync|taxEngine|sales|orderNumbers)'/);
    }
  });
});
