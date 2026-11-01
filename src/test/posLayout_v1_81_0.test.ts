// ============================================================
// RESPONSIVE POS — Premium Phase 1, "Responsive test".
//
// The product grid used to follow window breakpoints while the menu, the
// category panel and a fixed 380 px cart took their space first. These pin
// the engine that replaced that (lib/posLayout.ts) at the screen sizes named
// in the acceptance list, through the same containerFor() the preview uses.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  computePosLayout, containerFor, detectMode, aspectLabel, shouldCollapseMenu, sanitizeConfig,
  loadScreenConfig, saveScreenConfig, resetScreenConfig, AUTO_CONFIG, SCREEN_LAYOUTS_KEY,
  type ScreenLayoutConfig,
} from '@/lib/posLayout';

function layoutFor(w: number, h: number, opts: { touch?: boolean; cat?: 'top' | 'side'; config?: Partial<ScreenLayoutConfig>; preferred?: number } = {}) {
  const config = { ...AUTO_CONFIG, ...(opts.config || {}) };
  const c = containerFor(w, h, config);
  const l = computePosLayout({
    width: c.width, height: c.height, touch: !!opts.touch,
    categoryLayoutSetting: opts.cat || 'top', preferredColumns: opts.preferred ?? 6, config,
  });
  return { c, l };
}

describe('acceptance screen sizes', () => {
  it.each([
    [1920, 1080, 'wide'],
    [1366, 768, 'standard'],
    [1280, 720, 'standard'],
  ] as const)('%i×%i: %s, products keep most of the width, cards stay usable', (w, h, mode) => {
    for (const cat of ['top', 'side'] as const) {
      const { c, l } = layoutFor(w, h, { cat });
      expect(l.mode).toBe(mode);
      expect(l.cartPlacement).toBe('side');
      expect(l.productColumns).toBeGreaterThanOrEqual(5);
      expect(l.cardWidth).toBeGreaterThanOrEqual(116);
      // The cart never takes more than about a third of the POS width.
      expect(l.cartWidth / c.width).toBeLessThanOrEqual(0.34);
      // The product area is the largest region.
      expect(l.productAreaWidth).toBeGreaterThan(l.cartWidth + (l.categoryPlacement === 'side' ? l.categoryWidth : 0));
    }
  });

  it('REGRESSION 1366×768 with side categories: no longer 6 columns squeezed into ~550 px', () => {
    // v1.11: 230 px menu + 176 px categories + 380 px cart → ~550 px for xl:grid-cols-6 (~85 px cards).
    const { l } = layoutFor(1366, 768, { cat: 'side' });
    expect(l.cardWidth).toBeGreaterThan(110);
    expect(l.productColumns).toBeGreaterThanOrEqual(5);
  });

  it('narrow (800×600): slimmer side panels, still 3+ columns', () => {
    const { l } = layoutFor(800, 600, { cat: 'side' });
    expect(l.mode).toBe('narrow');
    expect(l.density).toBe('compact');
    expect(l.cartWidth).toBeLessThanOrEqual(320);
    expect(l.productColumns).toBeGreaterThanOrEqual(3);
  });

  it('square (1024×768 touch): categories move to the top, touch-sized targets', () => {
    const { l } = layoutFor(1024, 768, { touch: true, cat: 'side' });
    expect(l.mode).toBe('square');
    expect(l.categoryPlacement).toBe('top');
    expect(l.touchTarget).toBeGreaterThanOrEqual(44);
    expect(l.cardSize).toBe('large');
    expect(l.cardWidth).toBeGreaterThanOrEqual(150);
  });

  it('5:4 (1280×1024) is treated as square, not squeezed as landscape', () => {
    expect(layoutFor(1280, 1024).l.mode).toBe('square');
  });

  it('portrait (1080×1920): cart moves to the bottom, full-width products', () => {
    const { c, l } = layoutFor(1080, 1920, { touch: true });
    expect(l.mode).toBe('portrait');
    expect(l.cartPlacement).toBe('bottom');
    expect(l.productAreaWidth).toBeGreaterThan(c.width * 0.9);
  });

  it('very small windows use a pop-up cart', () => {
    expect(computePosLayout({ width: 600, height: 700, touch: false, categoryLayoutSetting: 'top', config: AUTO_CONFIG }).cartPlacement).toBe('drawer');
  });
});

describe('space is reclaimed from side panels before columns are lost', () => {
  it('automatic cart and category widths shrink to their floor when columns would drop', () => {
    const full = computePosLayout({ width: 1000, height: 700, touch: false, categoryLayoutSetting: 'side', preferredColumns: 6, config: AUTO_CONFIG });
    const fixed = computePosLayout({ width: 1000, height: 700, touch: false, categoryLayoutSetting: 'side', preferredColumns: 6, config: { ...AUTO_CONFIG, cartWidth: 380, categoryWidth: 176 } });
    expect(full.cartWidth).toBeLessThan(380);
    expect(full.categoryWidth).toBeLessThan(176);
    expect(full.productColumns).toBeGreaterThan(fixed.productColumns);
  });

  it('a fixed column count is honoured, and lowered only when cards would be illegible', () => {
    expect(layoutFor(1920, 1080, { config: { productColumns: 4 } }).l.productColumns).toBe(4);
    const tight = computePosLayout({ width: 700, height: 600, touch: false, categoryLayoutSetting: 'top', config: { ...AUTO_CONFIG, productColumns: 8 } });
    expect(tight.productColumns).toBeLessThan(8);
    expect(tight.columnsLimited).toBe(true);
    expect(tight.cardWidth).toBeGreaterThanOrEqual(88);
  });

  it('auto never exceeds the restaurant\'s "items per row"', () => {
    expect(layoutFor(1920, 1080, { preferred: 4 }).l.productColumns).toBe(4);
  });

  it('explicit choices override automatic ones', () => {
    const l = layoutFor(1366, 768, { config: { mode: 'narrow', cartWidth: 300, categoryPlacement: 'side', categoryWidth: 140, density: 'compact', cardSize: 'medium' } }).l;
    expect(l).toMatchObject({ mode: 'narrow', cartWidth: 300, categoryPlacement: 'side', categoryWidth: 140, density: 'compact', cardSize: 'medium' });
  });
});

describe('screen facts', () => {
  it('names common aspect ratios', () => {
    expect(aspectLabel(1366, 768)).toBe('16:9');
    expect(aspectLabel(1920, 1080)).toBe('16:9');
    expect(aspectLabel(1280, 800)).toBe('16:10');
    expect(aspectLabel(1024, 768)).toBe('4:3');
    expect(aspectLabel(1280, 1024)).toBe('5:4');
    expect(aspectLabel(1080, 1920)).toBe('9:16');
  });
  it('mode detection', () => {
    expect(detectMode(1690, 1032)).toBe('wide');
    expect(detectMode(900, 600)).toBe('narrow');
    expect(detectMode(700, 1200)).toBe('portrait');
  });
  it('menu collapses on tight screens only in automatic mode', () => {
    expect(shouldCollapseMenu(1366, 768, AUTO_CONFIG)).toBe(true);
    expect(shouldCollapseMenu(1920, 1080, AUTO_CONFIG)).toBe(false);
    expect(shouldCollapseMenu(1366, 768, { ...AUTO_CONFIG, menuCollapse: 'expanded' })).toBe(false);
    expect(shouldCollapseMenu(1920, 1080, { ...AUTO_CONFIG, menuCollapse: 'collapsed' })).toBe(true);
  });
});

describe('saved per screen', () => {
  beforeEach(() => localStorage.clear());

  it('each screen keeps its own choices', () => {
    saveScreenConfig('1366x768@100', { ...AUTO_CONFIG, productColumns: 5 });
    saveScreenConfig('1920x1080@125', { ...AUTO_CONFIG, cartWidth: 420 });
    expect(loadScreenConfig('1366x768@100').productColumns).toBe(5);
    expect(loadScreenConfig('1920x1080@125').cartWidth).toBe(420);
    expect(loadScreenConfig('1024x768@100')).toEqual(AUTO_CONFIG);
    resetScreenConfig('1366x768@100');
    expect(loadScreenConfig('1366x768@100')).toEqual(AUTO_CONFIG);
    expect(JSON.parse(localStorage.getItem(SCREEN_LAYOUTS_KEY) || '{}')['1920x1080@125']).toBeTruthy();
  });

  it('a cart width the cashier dragged in v1.11 carries over once; the old default does not', () => {
    localStorage.setItem('dtpos-cart-width', '440');
    expect(loadScreenConfig('x').cartWidth).toBe(440);
    localStorage.setItem('dtpos-cart-width', '380');
    expect(loadScreenConfig('x').cartWidth).toBe('auto');
  });

  it('garbage in storage falls back to automatic', () => {
    expect(sanitizeConfig({ mode: 'huge' as never, productColumns: 40, cartWidth: -5, keypad: 'maybe' as never })).toEqual(AUTO_CONFIG);
  });
});

describe('the POS screen uses the engine', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../pages/POSScreen.tsx'), 'utf8');
  it('no product grid follows window breakpoints any more', () => {
    // v1.81.0 (cloud): the Modern look follows the engine; the Classic look keeps its own classes, in one place.
    expect(src).toMatch(/usePosLayout\(posRootRef/);
    expect(src).toMatch(/gridTemplateColumns: `repeat\(\$\{layout\.productColumns\}/);
    expect(src.match(/xl:grid-cols-6/g)?.length).toBe(2);   // only inside legacyGridClass (sizes 5 and 6)
    expect(src).toMatch(/const legacyGridClass/);
  });
});

describe('categories on the right, next to the bill (v1.18)', () => {
  const right = (w: number, h: number, config: Partial<ScreenLayoutConfig> = {}) => {
    const cfg = { ...AUTO_CONFIG, ...config };
    const c = containerFor(w, h, cfg);
    return computePosLayout({ width: c.width, height: c.height, touch: false, categoryLayoutSetting: 'right', preferredColumns: 6, config: cfg });
  };

  it.each([[1920, 1080], [1366, 768], [1280, 720]] as const)('%i×%i: a right panel takes the same room as a left one', (w, h) => {
    const r = right(w, h);
    const { l } = layoutFor(w, h, { cat: 'side' });
    expect(r.categoryPlacement).toBe('right');
    expect(r.categoryWidth).toBe(l.categoryWidth);
    expect(r.productAreaWidth).toBe(l.productAreaWidth);
    expect(r.productColumns).toBe(l.productColumns);
    expect(r.cardWidth).toBeGreaterThanOrEqual(110);
  });

  it('square and very small screens still use the top ribbon', () => {
    expect(right(1024, 768).categoryPlacement).toBe('top');
    expect(right(600, 700).categoryPlacement).toBe('top');
  });

  it('a screen can choose it, and the choice is kept', () => {
    expect(right(1366, 768, { categoryPlacement: 'side' }).categoryPlacement).toBe('side');
    expect(computePosLayout({ width: 1300, height: 700, touch: false, categoryLayoutSetting: 'top', config: { ...AUTO_CONFIG, categoryPlacement: 'right' } }).categoryPlacement).toBe('right');
    expect(sanitizeConfig({ categoryPlacement: 'right' } as any).categoryPlacement).toBe('right');
    expect(sanitizeConfig({ categoryPlacement: 'middle' } as any).categoryPlacement).toBe('auto');
  });

  it('the POS, the Settings and the preview all offer it', () => {
    const src = (f: string) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
    // The cloud POS draws it. Its Settings → Screen & Layout tab and the preview are not ported yet (see docs/CHANGELOG v1.81.0).
    expect(src('pages/POSScreen.tsx')).toMatch(/data-pos-categories=\{catPlacement === 'right' \? 'right' : 'left'\}/);
  });
});

describe('short screens keep the bill readable (v1.18)', () => {
  it.each([[800, 600, true], [1024, 600, true], [1280, 720, true], [1366, 768, false], [1024, 768, false], [1920, 1080, false]] as const)(
    '%i×%i → short %s', (w, h, short) => {
      expect(layoutFor(w, h).l.short).toBe(short);
    },
  );
  it('on a short screen the cloud POS tightens the bill through the stylesheet', () => {
    const pos = fs.readFileSync(path.resolve(__dirname, '..', 'pages/POSScreen.tsx'), 'utf8');
    expect(pos).toMatch(/data-short=\{layout\.short \? 'true' : undefined\}/);
    // NOT PORTED (open): folding Discount / Promo / customer fields behind one line on a short screen, and the shortcut strip.
  });
});
