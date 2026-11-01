// ============================================================
// ESPRESSO ORANGE — the DT Retail POS v1.8 look, as an eighth DT Retail theme.
//
// Pinned:
//   • the theme's colours are the ones read from the v1.8 screens (espresso
//     sidebar #34160a → #1a0a04, orange #ea580c, cream page #faf6f2, hero
//     #923611 → #f5802d) and its stylesheet block carries the sign-in glows;
//   • the sign-in panel: "Welcome to <shop>", the subtitle, six chips, Developed
//     by Digital Target and the licence holder; the other themes keep theirs;
//   • the header clock reads "05:06 pm / Wed, 07 Oct 2026";
//   • each POS category gets a colour (a dot; the selected one filled in it);
//   • the default-password warning shows to an admin only, in this theme only;
//   • every Espresso rule is scoped to the theme, so no other look changes.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from '@/lib/hash-router';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESPRESSO_THEME_ID, RETAIL_THEMES, findTheme, isRetailTheme } from '@/lib/uiThemes';
import { stackedClockText } from '@/components/shell/HeaderClock';
import { CATEGORY_DOT_COLORS, categoryDotColor } from '@/lib/categoryColors';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
afterEach(() => cleanup());

function hslToRgb(t: string): [number, number, number] {
  const [h, s, l] = t.replace(/%/g, '').split(/\s+/).map(Number);
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255)) as [number, number, number];
}
const lum = ([r, g, b]: number[]) => {
  const c = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const hex = (t: string) => '#' + hslToRgb(t).map(v => v.toString(16).padStart(2, '0')).join('');

describe('the theme', () => {
  const t = findTheme(ESPRESSO_THEME_ID);
  it('is the eighth DT Retail theme, with the v1.8 colours', () => {
    expect(RETAIL_THEMES.at(-1)!.id).toBe('dtr-espresso');
    expect(isRetailTheme('dtr-espresso')).toBe(true);
    expect(t.name).toBe('Espresso Orange');
    expect(t.accent).toEqual({ h: 21, s: 90, l: 48 }); // #ea580c
    expect(t.surface.background).toBe('30 44% 96%'); // #faf6f2
    // within one step per channel of the colours measured on the screenshots
    const near = (a: string, b: string) => [1, 3, 5].every(i => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 2);
    const want = { sidebar: ['#34160a', '#1a0a04'], hero: ['#923611', '#f5802d'] };
    t.sidebarGradient!.map(hex).forEach((h, i) => expect(near(h, want.sidebar[i]), `${h} vs ${want.sidebar[i]}`).toBe(true));
    t.hero!.map(hex).forEach((h, i) => expect(near(h, want.hero[i]), `${h} vs ${want.hero[i]}`).toBe(true));
  });
  it('its stylesheet block carries the sidebar, hero and sign-in colours', () => {
    const css = read('styles/ui-tokens.css');
    const block = css.match(/:root\[data-ui="modern"\]\[data-ui-theme="dtr-espresso"\] \{([\s\S]*?)\n\}/)![1];
    expect(block).toMatch(/--dtr-sb-top: 17 68% 12%;/);
    expect(block).toMatch(/--dtr-sb-bot: 16 73% 6%;/);
    expect(block).toMatch(/--dtr-hero-a: 17 79% 32%;/);
    expect(block).toMatch(/--dtr-hero-b: 25 91% 57%;/);
    expect(block).toMatch(/--dtr-glow-a: [\d.]+ [\d.]+% [\d.]+%;/);
    expect(block).toMatch(/--dtr-glow-b: [\d.]+ [\d.]+% [\d.]+%;/);
  });
});

describe('the header clock', () => {
  it('"05:06 pm" over "Wed, 07 Oct 2026"', () => {
    expect(stackedClockText(new Date(2026, 9, 7, 17, 6))).toEqual({ time: '05:06 pm', date: 'Wed, 07 Oct 2026' });
    expect(stackedClockText(new Date(2026, 0, 1, 0, 5)).time).toBe('12:05 am');
    expect(stackedClockText(new Date(2026, 0, 1, 12, 0)).time).toBe('12:00 pm');
  });
  it('is used in Espresso only', () => {
    expect(read('components/shell/ModernHeader.tsx')).toMatch(/<HeaderClock variant=\{espresso \? 'stacked' : 'modern'\} \/>/);
  });
});

describe('POS category colours', () => {
  it('cycle by position and read with white text on the selected one', () => {
    expect(categoryDotColor(0)).toBe(CATEGORY_DOT_COLORS[0]);
    expect(categoryDotColor(CATEGORY_DOT_COLORS.length)).toBe(CATEGORY_DOT_COLORS[0]);
    expect(categoryDotColor(-1)).toBe(CATEGORY_DOT_COLORS.at(-1));
    expect(categoryDotColor(NaN)).toBe(CATEGORY_DOT_COLORS[0]);
    for (const c of CATEGORY_DOT_COLORS) expect(contrast(hslToRgb(c), [255, 255, 255]), c).toBeGreaterThanOrEqual(3);
  });
  it('every category pill carries its colour and a dot (shown by the Espresso stylesheet only)', () => {
    const pos = read('pages/POSScreen.tsx');
    expect(pos.match(/\['--cat-c' as string\]: categoryDotColor\(catIndex\)/g)).toHaveLength(2);
    expect(pos.match(/<span data-cat-dot aria-hidden className="hidden" \/>/g)).toHaveLength(2);
  });
});

// "a, b:is(c, d)" → ["a", "b:is(c, d)"]: split on commas outside brackets only.
function topLevelParts(list: string): string[] {
  const parts: string[] = []; let depth = 0, cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

describe('scoped to the theme', () => {
  it('every Espresso rule names the theme, so the other looks are untouched', () => {
    const css = read('styles/ui-retail.css');
    const part = css.slice(css.lastIndexOf('/*', css.indexOf('ESPRESSO ORANGE')));
    const selectors = part.replace(/\/\*[\s\S]*?\*\//g, '').match(/^[^{}@\n][^{}]*(?=\{)/gm)!.map(s => s.trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(8);
    for (const sel of selectors) {
      for (const one of topLevelParts(sel)) expect(one.trim(), one).toMatch(/^html(:not\(\[data-anim="off"\]\))?\[data-ui="modern"\]\[data-look="retail"\]\[data-ui-theme="dtr-espresso"\] /);
    }
  });
});

// NOT PORTED, on purpose (v1.78.0): the offline POS's Espresso sign-in panel ("Welcome to <shop>", PIN page) and its
// default-password warning. The cloud app signs in through its own reference design (v1.71.0 / v1.72.0) and passwords
// live on the server, so neither screen exists here. Their tests were removed with them.
