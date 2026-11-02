// ============================================================
// v1.96.0 — DT Refined colour schemes (Settings → Appearance → Colour scheme).
//
// DT Refined was one fixed look: lavender page, white panels, DT purple. A restaurant can now choose the page colour
// (lavender, clean grey, warm cream, cool mist, night) and the accent, or a ready-made scheme that sets both. Night makes
// the whole page dark. Presentation only: one stored preference and one attribute on <html>.
//
// Pinned: the preference and what it sets on <html> (and that it is only for Refined, and is removed with the rest);
// every surface has a complete token block in the stylesheet and readable text on it; the shell follows the tokens
// instead of a fixed white and purple; the Appearance card offers the schemes only for Refined and applies them.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_REFINED_SURFACE, REFINED_SURFACES, REFINED_SURFACE_KEY, applyUiStyle, getRefinedSurface, setAccent, setRefinedSurface, setTheme,
  setUiStyle, getAccentOverride,
} from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import InterfaceStyleCard, { REFINED_SCHEMES } from '@/components/settings/InterfaceStyleCard';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const html = () => document.documentElement;

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn() } }));

beforeEach(() => { cleanup(); localStorage.clear(); html().removeAttribute('style'); for (const a of Array.from(html().attributes)) if (a.name.startsWith('data-')) html().removeAttribute(a.name); });
afterEach(() => cleanup());

describe('the surface preference', () => {
  it('defaults to the design package\'s lavender, accepts the five surfaces, ignores anything else', () => {
    expect(getRefinedSurface()).toBe(DEFAULT_REFINED_SURFACE);
    expect(DEFAULT_REFINED_SURFACE).toBe('lavender');
    expect(REFINED_SURFACES.map(s => s.id)).toEqual(['lavender', 'white', 'warm', 'cool', 'night']);
    for (const s of REFINED_SURFACES) { setRefinedSurface(s.id); expect(getRefinedSurface()).toBe(s.id); }
    setRefinedSurface('purple-haze' as never);
    expect(getRefinedSurface()).toBe('night');                       // unchanged by the bad value
    localStorage.setItem(REFINED_SURFACE_KEY, 'junk');
    expect(getRefinedSurface()).toBe('lavender');
  });
});

describe('what it sets on <html>', () => {
  it('only under DT Refined: the surface attribute, and Night also makes the whole page dark with a dark sidebar', () => {
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    expect(html().getAttribute('data-refined-surface')).toBe('lavender');
    expect(html().hasAttribute('data-ui-mode')).toBe(false);
    setRefinedSurface('warm');
    expect(html().getAttribute('data-refined-surface')).toBe('warm');
    expect(html().hasAttribute('data-ui-mode')).toBe(false);
    setRefinedSurface('night');
    expect(html().getAttribute('data-refined-surface')).toBe('night');
    expect(html().getAttribute('data-ui-mode')).toBe('dark');
    expect(html().getAttribute('data-sidebar')).toBe('dark');
    setRefinedSurface('cool');
    expect(html().hasAttribute('data-ui-mode')).toBe(false);          // leaving Night puts the light page back
    expect(html().getAttribute('data-sidebar')).toBe('light');
  });

  it('is not set for any other theme, and is removed with the rest when Classic is chosen', () => {
    setRefinedSurface('night');
    setUiStyle('modern'); setTheme('ember');
    expect(html().hasAttribute('data-refined-surface')).toBe(false);
    expect(html().hasAttribute('data-ui-mode')).toBe(false);          // the stored Night choice does not darken a Modern theme
    setTheme(REFINED_THEME_ID);
    expect(html().getAttribute('data-ui-mode')).toBe('dark');         // …and comes back with Refined
    setUiStyle('classic');
    expect(html().hasAttribute('data-refined-surface')).toBe(false);
    expect(html().hasAttribute('data-ui-mode')).toBe(false);
    expect(html().hasAttribute('data-ui')).toBe(false);
  });
});

// ------------------------------------------------------------------ the stylesheet
const TOKENS = read('src/styles/ui-tokens.css');
const REFINED_CSS = read('src/styles/ui-refined.css');

function block(surface: string): Record<string, string> {
  const re = new RegExp(`:root\\[data-ui="modern"\\]\\[data-ui-theme="dt-refined"\\]\\[data-refined-surface="${surface}"\\]\\s*\\{([^}]*)\\}`);
  const m = TOKENS.match(re);
  expect(m, `no token block for ${surface}`).toBeTruthy();
  const out: Record<string, string> = {};
  for (const line of (m![1] || '').split(';')) { const kv = line.split(':'); if (kv.length === 2) out[kv[0].trim()] = kv[1].trim(); }
  return out;
}
const hslToRgb = (t: string): [number, number, number] => {
  const [h, s, l] = t.replace(/%/g, '').split(/\s+/).map(Number);
  const S = s / 100, L = l / 100, k = (n: number) => (n + h / 30) % 12, a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
};
const lum = ([r, g, b]: number[]) => { const c = [r, g, b].map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a: string, b: string) => { const [x, y] = [lum(hslToRgb(a)), lum(hslToRgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('the surfaces in the stylesheet', () => {
  const NEEDED = ['--background', '--foreground', '--card-foreground', '--popover-foreground', '--secondary', '--secondary-foreground', '--muted', '--muted-foreground', '--accent',
    '--accent-foreground', '--border', '--input', '--pos-grid-bg', '--pos-sidebar-foreground', '--sidebar-foreground', '--sidebar-border', '--dt-accent-tint'];

  it('every non-default surface has a complete token block', () => {
    for (const id of ['white', 'warm', 'cool', 'night']) {
      const b = block(id);
      for (const k of NEEDED) expect(b[k], `${id} is missing ${k}`).toMatch(/^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/);
    }
    // Night carries its own panel and status colours; the light ones keep the base white card and status colours
    const night = block('night');
    expect(night['--card']).toBeTruthy();
    for (const k of ['--dt-ok-bg', '--dt-warn-bg', '--dt-bad-bg', '--dt-info-bg']) expect(night[k], k).toBeTruthy();
    for (const id of ['white', 'warm', 'cool']) expect(block(id)['--card']).toBeUndefined();
  });

  it('text is readable on every surface: body 7:1 on the page and the panel, quiet text 4.5:1', () => {
    for (const id of ['white', 'warm', 'cool', 'night']) {
      const b = block(id);
      const card = b['--card'] || '0 0% 100%';
      expect(contrast(b['--foreground'], b['--background']), `${id} body on page`).toBeGreaterThanOrEqual(7);
      expect(contrast(b['--foreground'], card), `${id} body on panel`).toBeGreaterThanOrEqual(7);
      expect(contrast(b['--muted-foreground'], b['--background']), `${id} quiet on page`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(b['--muted-foreground'], card), `${id} quiet on panel`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(b['--muted-foreground'], b['--muted']), `${id} quiet on chips`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the gallery swatches match the stylesheet', () => {
    const hex = (t: string) => '#' + hslToRgb(t).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    const near = (a: string, b: string) => [1, 3, 5].every(i => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 3);
    for (const id of ['white', 'warm', 'cool', 'night']) {
      const sw = REFINED_SURFACES.find(s => s.id === id)!; const b = block(id);
      expect(near(hex(b['--background']), sw.page), `${id} page`).toBe(true);
      expect(near(hex(b['--card'] || '0 0% 100%'), sw.card), `${id} panel`).toBe(true);
    }
  });

  it('the Refined shell follows the tokens: no fixed white, no fixed purple', () => {
    expect(REFINED_CSS).not.toMatch(/background:\s*#fff\b/);
    expect(REFINED_CSS).not.toMatch(/hsl\(263 69% 42%/);              // the DT purple, as a fixed colour
    expect(REFINED_CSS).not.toMatch(/hsl\(26[01] \d+% \d+%/);         // the lavender text and border colours
    expect(REFINED_CSS).toContain('[data-ui-shell="sidebar"] { background: hsl(var(--card)); }');
    expect(REFINED_CSS).toContain('[data-ui-shell="header"] { background: hsl(var(--card)); }');
  });
});

// ------------------------------------------------------------------ the Appearance card
describe('the Appearance card', () => {
  it('offers the colour schemes for DT Refined only', () => {
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    const first = render(<InterfaceStyleCard />);
    expect(screen.getByTestId('refined-schemes')).toBeInTheDocument();
    expect(first.container.querySelectorAll('[data-scheme]')).toHaveLength(REFINED_SCHEMES.length);
    expect(first.container.querySelectorAll('[data-surface]')).toHaveLength(REFINED_SURFACES.length);
    first.unmount();

    setTheme('ember');
    render(<InterfaceStyleCard />);
    expect(screen.queryByTestId('refined-schemes')).toBeNull();
  });

  it('a ready-made scheme sets the page colour and the accent together; DT Purple clears the accent', () => {
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    const { container } = render(<InterfaceStyleCard />);
    const click = (id: string) => fireEvent.click(container.querySelector(`[data-scheme="${id}"]`)!);

    click('ocean');
    expect(getRefinedSurface()).toBe('cool');
    expect(getAccentOverride()).toBe('#0369a1');
    expect(html().getAttribute('data-refined-surface')).toBe('cool');

    click('night');
    expect(getRefinedSurface()).toBe('night');
    expect(getAccentOverride()).toBe('#8b5cf6');
    expect(html().getAttribute('data-ui-mode')).toBe('dark');

    click('dt-purple');
    expect(getRefinedSurface()).toBe('lavender');
    expect(getAccentOverride()).toBeNull();
    expect(html().hasAttribute('data-ui-mode')).toBe(false);
    expect(container.querySelector('[data-scheme="dt-purple"]')!.getAttribute('aria-checked')).toBe('true');
  });

  it('the page colour and the accent can be set separately, and the accent stays on when only the page colour changes', () => {
    setUiStyle('modern'); setTheme(REFINED_THEME_ID); setAccent('#c2410c');
    const { container } = render(<InterfaceStyleCard />);
    fireEvent.click(container.querySelector('[data-surface="warm"]')!);
    expect(getRefinedSurface()).toBe('warm');
    expect(getAccentOverride()).toBe('#c2410c');
    // the accent chooser is the same one Modern has
    expect(container.querySelector('#accent-hex')).toBeTruthy();
    expect(container.querySelectorAll('[role="radiogroup"][aria-label="Accent colour"] [role="radio"]').length).toBeGreaterThan(3);
  });

  it('the ready-made schemes are the intended nine, each with a known surface', () => {
    expect(REFINED_SCHEMES.map(s => s.id)).toEqual(['dt-purple', 'ocean', 'emerald', 'sunset', 'rose', 'graphite', 'berry', 'sunrise', 'night']);
    for (const s of REFINED_SCHEMES) {
      expect(REFINED_SURFACES.some(x => x.id === s.surface), s.id).toBe(true);
      if (s.accent) expect(s.accent).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
