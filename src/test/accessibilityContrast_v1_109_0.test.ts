// v1.109.0 — WCAG 2.2 AA contrast for every colour scheme (text on the accent, the accent as text, muted text) and the other
// accessibility promises the master plan makes: reduced motion, a visible focus ring, a name on every icon-only button.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AA_LARGE, AA_TEXT, contrastRatio, hexToRgb, hslTokenToRgb } from '@/lib/contrast';
import { REFINED_SCHEMES } from '@/lib/refinedSchemes';
import { REFINED_SURFACES, hslToHex, resolveLook } from '@/lib/uiStyle';

const surface = (id: string) => REFINED_SURFACES.find(s => s.id === id)!;
const tokens = readFileSync('src/styles/ui-tokens.css', 'utf8');

describe('contrast helpers', () => {
  it('match the WCAG reference values', () => {
    expect(contrastRatio(hexToRgb('#000000'), hexToRgb('#ffffff'))).toBeCloseTo(21, 1);
    expect(contrastRatio(hexToRgb('#777777'), hexToRgb('#ffffff'))).toBeCloseTo(4.48, 1);
    expect(hslTokenToRgb('0 0% 100%')).toEqual([255, 255, 255]);
    expect(hslTokenToRgb('hsl(0 100% 50%)')).toEqual([255, 0, 0]);
  });
});

describe('every colour scheme is readable (AA)', () => {
  for (const sc of REFINED_SCHEMES) {
    const look = resolveLook('dt-refined', sc.accent);
    const accent = look.accent;
    const accentRgb = hexToRgb(hslToHex(accent));
    const onAccent = hexToRgb(look.onAccent.startsWith('#') ? look.onAccent : '#ffffff');
    const page = hexToRgb(surface(sc.surface).page);
    const card = hexToRgb(surface(sc.surface).card);

    it(`${sc.name}: the text on the accent (buttons, the active tab) reads at 4.5:1`, () => {
      expect(contrastRatio(accentRgb, onAccent)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    it(`${sc.name}: the accent used as text or an icon on the page and on a panel`, () => {
      const textRgb = hexToRgb(hslToHex(look.text));
      expect(contrastRatio(textRgb, card), 'on a panel').toBeGreaterThanOrEqual(AA_LARGE);
      expect(contrastRatio(textRgb, page), 'on the page').toBeGreaterThanOrEqual(AA_LARGE);
    });
  }
});

describe('quiet text is readable on every surface', () => {
  it('muted text on the light surfaces', () => {
    const muted = hslTokenToRgb('25 8% 40%');   // --muted-foreground of DT Refined (ui-tokens.css)
    expect(tokens).toContain('--muted-foreground: 25 8% 40%');
    for (const id of ['lavender', 'white', 'warm', 'cool']) {
      expect(contrastRatio(muted, hexToRgb(surface(id).page)), `${id} page`).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(muted, hexToRgb(surface(id).card)), `${id} panel`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
  it('the main ink on every surface', () => {
    for (const s of REFINED_SURFACES) {
      expect(contrastRatio(hexToRgb(s.ink), hexToRgb(s.page)), `${s.id} page`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(hexToRgb(s.ink), hexToRgb(s.card)), `${s.id} panel`).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('the other promises', () => {
  const css = readFileSync('src/styles/ui-screen.css', 'utf8') + readFileSync('src/index.css', 'utf8');
  it('reduced motion switches animation and transition off', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation-duration: 0\.01ms/);
  });
  it('keyboard focus is visible', () => {
    const all = ['src/index.css', 'src/styles/ui-refined.css', 'src/styles/ui-refined-components.css', 'src/styles/ui-tokens.css']
      .map(f => readFileSync(f, 'utf8')).join('\n');
    expect(all).toMatch(/:focus-visible/);
  });

  // Every <Button ... size="icon"> has no words, so it needs an accessible name: aria-label, title or sr-only text.
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { if (e !== 'test') walk(p, out); } else if (p.endsWith('.tsx')) out.push(p);
    }
    return out;
  }
  it('every icon-only Button has a name', () => {
    const bad: string[] = [];
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/<Button\b([^>]*?\bsize=["']icon["'][^>]*)>([\s\S]*?)<\/Button>/g)) {
        const attrs = m[1], inner = m[2];
        if (!/aria-label=|title=|aria-labelledby=/.test(attrs) && !/sr-only/.test(inner)) bad.push(`${file}: ${attrs.trim().slice(0, 70)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
