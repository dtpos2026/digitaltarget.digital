// v1.130.0 — the POS as the design draws it (SW-03): four tiles to a row at 1440 px, each with a 92 px picture, and a colour per kind of food.
import { describe, it, expect } from 'vitest';
import { computePosLayout, AUTO_CONFIG } from '@/lib/posLayout';
import { tileTone } from '@/lib/tileLook';

const layout = (width: number, height: number, over: Record<string, unknown> = {}) => computePosLayout({
  width, height, touch: false, categoryLayoutSetting: 'top', preferredColumns: 6, photoCards: true, designTiles: true, config: { ...AUTO_CONFIG }, ...over,
});

describe('the design tile in the layout engine', () => {
  it('1440 × 900 (the design\'s frame, less the 72 px rail): four tiles to a row, ~225 px wide, a 92 px picture, 14 px gaps', () => {
    const l = layout(1440 - 72, 840);
    expect(l.productColumns).toBe(4);
    expect(l.cardWidth).toBeGreaterThanOrEqual(200);
    expect(l.cardWidth).toBeLessThanOrEqual(240);
    expect(l.cardImageHeight).toBe(92);
    expect(l.gap).toBe(14);
    expect(l.padding).toBe(20);
  });

  it('the picture is 92 px whatever the window; wider windows get more tiles, never stretched ones', () => {
    expect(layout(1920 - 72, 960).cardImageHeight).toBe(92);
    expect(layout(1920 - 72, 960).productColumns).toBeGreaterThanOrEqual(5);
    expect(layout(1366 - 72, 700).productColumns).toBe(4);
    expect(layout(1366 - 72, 700).cardImageHeight).toBeLessThanOrEqual(92);
  });

  it('a narrow window gets three smaller tiles rather than two big ones', () => {
    expect(layout(1100 - 72, 800).productColumns).toBeGreaterThanOrEqual(3);
  });

  it('without the flag nothing changes (the classic and Order Taker grids keep their engine)', () => {
    const old = layout(1440 - 72, 840, { designTiles: false });
    expect(old.gap).toBe(10);
    expect(old.cardImageHeight).not.toBe(92);
  });
});

describe('the tile colour', () => {
  it('a category named like the design\'s takes the design\'s colour', () => {
    expect(tileTone('Pizza')).toBe(1);
    expect(tileTone('Burgers')).toBe(2);
    expect(tileTone('Karahi & BBQ')).toBe(2);
    expect(tileTone('Wraps')).toBe(3);
    expect(tileTone('Desserts')).toBe(4);
    expect(tileTone('Drinks')).toBe(5);
    expect(tileTone('Sides')).toBe(1);
  });

  it('any other category gets one of the five, always the same one', () => {
    for (const n of ['Chinese', 'Ramadan Specials', 'چائے', '']) {
      const t = tileTone(n, 'cat-' + n);
      expect([1, 2, 3, 4, 5]).toContain(t);
      expect(tileTone(n, 'cat-' + n)).toBe(t);
    }
  });
});
