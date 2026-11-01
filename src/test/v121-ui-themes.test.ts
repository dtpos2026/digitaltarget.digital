// ============================================================
// MODERN THEMES — twelve complete looks (red, orange, green, yellow, white …).
//
// What is pinned:
//   • the list: unique ids, the food colours a restaurant asks for are all there;
//   • every theme is READABLE — text on the accent, the accent used as text,
//     body and muted text on the page, the dark sidebar's text;
//   • the stylesheet and the theme list agree (a change to one without the
//     other fails here), and every theme has its surface block;
//   • choosing a theme sets an attribute and a few variables, drops any accent
//     override, stores ONE key, and Classic removes every trace;
//   • it all stays presentation: no data, licence, user or printer key.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  UI_ACCENT_KEY, UI_STYLE_KEY, UI_THEME_KEY, applyUiStyle, getAccentOverride, getThemeId, hslToRgb, resolveLook,
  setAccent, setTheme, setUiStyle, clearAccent,
} from '@/lib/uiStyle';
import { DEFAULT_THEME_ID, INK_ON_ACCENT, UI_THEMES, findTheme, type Triplet } from '@/lib/uiThemes';

const root = () => document.documentElement;
const tokens = readFileSync(resolve(__dirname, '..', 'styles', 'ui-tokens.css'), 'utf8');

// ---- colour helpers (WCAG 2.x) ----
const parse = (t: Triplet) => {
  const [h, s, l] = t.replace(/%/g, '').split(/\s+/).map(Number);
  return { h, s, l };
};
const rgb = (t: Triplet) => hslToRgb(parse(t));
const lum = ([r, g, b]: number[]) => {
  const c = [r, g, b].map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const acc = (a: { h: number; s: number; l: number }) => hslToRgb(a);
const WHITE = [255, 255, 255];

/** The declarations of every stylesheet block for one theme (surfaces, and the dark sidebar palette), merged. */
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

beforeEach(() => {
  localStorage.clear();
  // The cloud app's default style is Classic (DT Enterprise); these tests are about a restaurant that chose Modern.
  localStorage.setItem('dtpos-ui-style', 'modern');
  ['data-ui', 'data-ui-theme', 'data-sidebar', 'data-on-accent', 'data-theme', 'style'].forEach(a => root().removeAttribute(a));
});

describe('the theme list', () => {
  it('has thirteen themes with unique ids, names and taglines', () => {
    expect(UI_THEMES).toHaveLength(13);
    expect(new Set(UI_THEMES.map(t => t.id)).size).toBe(13);
    expect(new Set(UI_THEMES.map(t => t.name)).size).toBe(13);
    for (const t of UI_THEMES) { expect(t.name.length).toBeGreaterThan(3); expect(t.tagline.length).toBeGreaterThan(10); }
    expect(findTheme(DEFAULT_THEME_ID).id).toBe('ember');
  });

  it('covers the colours a restaurant asks for: red, orange, green, yellow and white', () => {
    const hue = (id: string) => findTheme(id).accent.h;
    expect(hue('tomato')).toBeGreaterThanOrEqual(350); // red
    expect([...UI_THEMES].some(t => t.id === 'ember' && t.accent.h >= 10 && t.accent.h <= 24)).toBe(true); // orange
    expect(hue('fresh')).toBeGreaterThanOrEqual(120); expect(hue('fresh')).toBeLessThanOrEqual(170); // green
    expect(hue('sunny')).toBeGreaterThanOrEqual(38); expect(hue('sunny')).toBeLessThanOrEqual(52); // yellow
    expect(findTheme('white').accent.s).toBeLessThan(30); // white / graphite: almost no colour
    for (const id of ['pizza', 'ocean', 'coffee', 'rose', 'violet', 'teal', 'charcoal', 'navy']) expect(findTheme(id).id).toBe(id);
  });

  it('an unknown id falls back to the default theme', () => {
    expect(findTheme('nope').id).toBe(DEFAULT_THEME_ID);
    expect(findTheme(null).id).toBe(DEFAULT_THEME_ID);
  });
});

describe('every theme is readable', () => {
  it.each(UI_THEMES.map(t => [t.id, t] as const))('%s: text on the accent, the accent as text, body and muted text', (_id, t) => {
    const look = resolveLook(t.id, null);
    // text on the accent (white, or near-black for the light yellow)
    const onAccent = look.darkOnAccent ? rgb(INK_ON_ACCENT) : WHITE;
    expect(contrast(acc(look.accent), onAccent), 'text on the accent').toBeGreaterThanOrEqual(look.darkOnAccent ? 7 : 4.5);
    // the accent used as text on white panels AND on the page
    expect(contrast(acc(look.text), WHITE), 'accent text on white').toBeGreaterThanOrEqual(4.5);
    expect(contrast(acc(look.text), rgb(t.surface.background)), 'accent text on the page').toBeGreaterThanOrEqual(4.5);
    // body text and quiet text on the page and on white
    expect(contrast(rgb(t.surface.foreground), rgb(t.surface.background))).toBeGreaterThanOrEqual(12);
    expect(contrast(rgb(t.surface.mutedForeground), rgb(t.surface.background)), 'muted text on the page').toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(t.surface.mutedForeground), WHITE), 'muted text on white').toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(t.surface.mutedForeground), rgb(t.surface.muted)), 'muted text on chips').toBeGreaterThanOrEqual(4.5);
    // the panel edge must be visible against the page but never harsh
    expect(contrast(rgb(t.surface.border), rgb(t.surface.background))).toBeGreaterThan(1.05);
  });

  it.each(UI_THEMES.filter(t => t.sidebar === 'dark').map(t => [t.id, t] as const))('%s: the dark sidebar reads', (id, t) => {
    const b = block(id);
    expect(b['--ui-sb-bg']).toBe(t.sidebarColor);
    const bg = rgb(b['--ui-sb-bg']);
    expect(contrast(rgb(b['--ui-sb-fg']), bg), 'menu text').toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(b['--ui-sb-muted-fg']), bg), 'quiet text').toBeGreaterThanOrEqual(4.5);
    expect(contrast(WHITE, rgb(b['--ui-sb-hover'])), 'white on the hover fill').toBeGreaterThanOrEqual(7);
    // the selected item is the accent, with the on-accent text on it
    expect(contrast(acc(t.accent), WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('a pale accent of the shop’s own is still darkened until white text on it reads', () => {
    const look = resolveLook('sunny', '#ffe600');
    expect(look.overridden).toBe(true);
    expect(look.darkOnAccent).toBe(false);
    expect(contrast(acc(look.accent), WHITE)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the stylesheet and the theme list agree', () => {
  it.each(UI_THEMES.map(t => [t.id, t] as const))('%s: surface values match ui-tokens.css', (id, t) => {
    const b = block(id);
    expect(b['--background']).toBe(t.surface.background);
    expect(b['--foreground']).toBe(t.surface.foreground);
    expect(b['--muted-foreground']).toBe(t.surface.mutedForeground);
    expect(b['--muted']).toBe(t.surface.muted);
    expect(b['--border']).toBe(t.surface.border);
    // the derived values exist too
    for (const k of ['--card-foreground', '--popover-foreground', '--secondary', '--accent', '--accent-foreground', '--input', '--pos-grid-bg']) {
      expect(b[k], `${id} is missing ${k}`).toBeTruthy();
    }
  });

  it('every dark-sidebar theme has its sidebar palette, every light one has none', () => {
    for (const t of UI_THEMES) {
      const b = block(t.id);
      expect('--ui-sb-bg' in b).toBe(t.sidebar === 'dark');
    }
  });
});

describe('choosing a theme', () => {
  it('sets the attributes and the accent variables and stores one key', () => {
    applyUiStyle('modern');
    expect(root().getAttribute('data-ui-theme')).toBe('ember');
    expect(getThemeId()).toBe('ember');

    setTheme('tomato');
    expect(getThemeId()).toBe('tomato');
    expect(localStorage.getItem(UI_THEME_KEY)).toBe('tomato');
    expect(root().getAttribute('data-ui-theme')).toBe('tomato');
    expect(root().getAttribute('data-sidebar')).toBe('light');
    expect(root().getAttribute('data-on-accent')).toBe('light');
    expect(root().style.getPropertyValue('--ui-accent-h')).toBe(String(findTheme('tomato').accent.h));
    expect(root().style.getPropertyValue('--ui-on-accent')).toBe('0 0% 100%');
  });

  it('Sunny Yellow puts dark text on the accent and a deep amber where the accent is text', () => {
    setTheme('sunny');
    expect(root().getAttribute('data-on-accent')).toBe('dark');
    expect(root().style.getPropertyValue('--ui-on-accent')).toBe(INK_ON_ACCENT);
    const t = findTheme('sunny');
    expect(root().style.getPropertyValue('--ui-text-h')).toBe(String(t.accentText!.h));
    expect(root().style.getPropertyValue('--ui-accent-h')).toBe(String(t.accent.h));
  });

  it('a dark-sidebar theme says so', () => {
    setTheme('navy');
    expect(root().getAttribute('data-sidebar')).toBe('dark');
    setTheme('ember');
    expect(root().getAttribute('data-sidebar')).toBe('light');
  });

  it('picking a theme drops the shop’s own accent; the accent override still layers on a theme', () => {
    setTheme('fresh');
    setAccent('#175fd3');
    expect(getAccentOverride()).toBe('#175fd3');
    expect(getThemeId()).toBe('fresh');
    expect(root().getAttribute('data-ui-theme')).toBe('fresh'); // surfaces stay green-white
    expect(root().style.getPropertyValue('--ui-accent-h')).not.toBe(String(findTheme('fresh').accent.h));

    setTheme('coffee');
    expect(getAccentOverride()).toBeNull();
    expect(root().style.getPropertyValue('--ui-accent-h')).toBe(String(findTheme('coffee').accent.h));

    setAccent('emerald');
    clearAccent();
    expect(getAccentOverride()).toBeNull();
    expect(localStorage.getItem(UI_ACCENT_KEY)).toBeNull();
  });

  it('a stored unknown theme falls back to the default; an unknown id is ignored', () => {
    localStorage.setItem(UI_THEME_KEY, '<script>');
    expect(getThemeId()).toBe(DEFAULT_THEME_ID);
    setTheme('tomato');
    setTheme('does-not-exist');
    expect(getThemeId()).toBe('tomato');
  });

  it('Classic removes every trace, and Modern brings the same theme back', () => {
    setTheme('rose');
    setUiStyle('classic');
    for (const a of ['data-ui', 'data-ui-theme', 'data-sidebar', 'data-on-accent']) expect(root().hasAttribute(a), a).toBe(false);
    for (const v of ['--ui-accent-h', '--ui-accent-s', '--ui-accent-l', '--ui-text-h', '--ui-on-accent', '--ui-soft-s', '--ui-gold-on-dark']) {
      expect(root().style.getPropertyValue(v), v).toBe('');
    }
    setUiStyle('modern');
    expect(root().getAttribute('data-ui-theme')).toBe('rose'); // the choice survived the round trip
  });

  it('touches only its own keys — no data, licence, user or printer key', () => {
    localStorage.setItem('desi-pos-data', '{"orders":[1,2,3]}');
    localStorage.setItem('pos-user-id', 'admin-default');
    localStorage.setItem('dtpos-printer-settings-v1', '{"printers":[]}');
    const before = new Map<string, string>();
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; before.set(k, localStorage.getItem(k)!); }

    for (const t of UI_THEMES) setTheme(t.id);
    setUiStyle('classic');
    setUiStyle('modern');

    for (const [k, v] of before) expect(localStorage.getItem(k), `${k} changed`).toBe(v);
    const added: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (!before.has(k)) added.push(k); }
    // (the style key was already set by the setup above — this restaurant chose Modern — so only the theme key is new)
    expect(added.sort()).toEqual([UI_THEME_KEY]);
  });
});
