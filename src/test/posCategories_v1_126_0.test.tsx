// v1.126.0 — the POS categories in the design's look: one clear name per category (the Urdu name on its own line), an icon tile per
// category in the side panel and in the All Categories picker, no count in the design's pills. The restaurant's saved choice of where the
// categories sit (top / side / right) is not touched.
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitCategoryName } from '@/lib/categoryName';
import CategoryGridDialog from '@/components/pos/CategoryGridDialog';
import type { Category } from '@/lib/types';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('splitting "English (اردو)"', () => {
  it('the English name leads and the Urdu name follows', () => {
    expect(splitCategoryName('Chicken Karahi (چکن کڑاہی)')).toEqual({ primary: 'Chicken Karahi', secondary: 'چکن کڑاہی' });
    expect(splitCategoryName('Chicken Boneless Handi (چکن بون لیس ہانڈی)')).toEqual({ primary: 'Chicken Boneless Handi', secondary: 'چکن بون لیس ہانڈی' });
    expect(splitCategoryName('  Fish  ( فش ) ')).toEqual({ primary: 'Fish', secondary: 'فش' });
    expect(splitCategoryName('BBQ（بار بی کیو）')).toEqual({ primary: 'BBQ', secondary: 'بار بی کیو' });         // full-width brackets
  });
  it('anything else stays exactly as it is — a bracket without Urdu is part of the name', () => {
    expect(splitCategoryName('Chicken Karahi (half)')).toEqual({ primary: 'Chicken Karahi (half)' });
    expect(splitCategoryName('Pizza (7")')).toEqual({ primary: 'Pizza (7")' });
    expect(splitCategoryName('Wings & Fries')).toEqual({ primary: 'Wings & Fries' });
    expect(splitCategoryName('چکن کڑاہی')).toEqual({ primary: 'چکن کڑاہی' });                                      // only Urdu: no English to lead with
    expect(splitCategoryName('(چکن)')).toEqual({ primary: '(چکن)' });                                              // nothing before the bracket
    expect(splitCategoryName('چکن (Chicken)')).toEqual({ primary: 'چکن (Chicken)' });                              // Urdu first: left alone
    expect(splitCategoryName('')).toEqual({ primary: '' });
    expect(splitCategoryName(undefined as unknown as string)).toEqual({ primary: '' });
  });
});

describe('the All Categories picker', () => {
  const cats: Category[] = [
    { id: 'c1', name: 'Chicken Karahi (چکن کڑاہی)', icon: '📋' } as Category,
    { id: 'c2', name: 'Pizza', icon: '📋' } as Category,
    { id: 'c3', name: 'Desserts', icon: '📋', image: 'data:image/png;base64,AAAA' } as Category,
  ];
  const counts = { all: 9, byCat: new Map([['c1', 6], ['c2', 1], ['c3', 2]]) };
  const show = (iconStyle?: 'tile' | 'emoji', onSelect = vi.fn()) => {
    cleanup();
    render(<CategoryGridDialog open onOpenChange={() => {}} categories={cats} counts={counts} selected="all" onSelect={onSelect} iconStyle={iconStyle} />);
    return onSelect;
  };
  it('design look: a coloured icon tile per category (its photo when it has one), the name on its own line and the Urdu under it', () => {
    show('tile');
    const k = document.querySelector('[data-cat-grid-item="c1"]')!;
    expect(k.querySelector('[data-cat-grid-tile]')).not.toBeNull();
    expect(k.querySelector('[data-cat-grid-name]')!.textContent).toBe('Chicken Karahi');
    expect(k.querySelector('[data-cat-grid-sub]')!.textContent).toBe('چکن کڑاہی');
    expect(k.querySelector('[data-cat-grid-sub]')!.getAttribute('dir')).toBe('rtl');
    expect(k.getAttribute('title')).toBe('Chicken Karahi (چکن کڑاہی)');                                            // the full saved name is still one hover away
    expect(document.querySelector('[data-cat-grid-item="c2"] [data-cat-grid-sub]')).toBeNull();                    // no Urdu, no second line
    expect(document.querySelector('[data-cat-grid-item="c3"] img')).not.toBeNull();                                // a photo wins over the tile
    expect(document.querySelector('[data-cat-grid-item="c3"] [data-cat-grid-tile]')).toBeNull();
    expect(document.querySelector('[data-cat-grid-item="all"] [data-cat-grid-tile]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('📋');                                                          // the one clipboard for every category is gone
  });
  it('the icon follows the name (a karahi is a pot, a pizza is a slice) and a name keeps its colour', () => {
    show('tile');
    const tone = (id: string) => (document.querySelector(`[data-cat-grid-item="${id}"] [data-cat-grid-tile]`) as HTMLElement).className.match(/from-\S+ to-\S+/)![0];
    const first = tone('c1');
    show('tile');
    expect(tone('c1')).toBe(first);
  });
  it('other looks keep the category’s own emoji', () => {
    show('emoji');
    expect(document.querySelector('[data-cat-grid-tile]')).toBeNull();
    expect(document.querySelector('[data-cat-grid-item="c1"]')!.textContent).toContain('📋');
    show();                                                                                                         // no iconStyle = the old look, as before
    expect(document.querySelector('[data-cat-grid-tile]')).toBeNull();
  });
  it('picking a category still selects it and closes the picker; counts are on every tile', () => {
    const onSelect = show('tile');
    expect(document.querySelector('[data-cat-grid-item="c1"]')!.textContent).toContain('6 items');
    expect(document.querySelector('[data-cat-grid-item="c2"]')!.textContent).toContain('1 item');
    expect(document.querySelector('[data-cat-grid-item="c2"]')!.textContent).not.toContain('1 items');
    fireEvent.click(document.querySelector('[data-cat-grid-item="c1"]')!);
    expect(onSelect).toHaveBeenCalledWith('c1');
  });
  it('the tiles are equal in height whatever the name length (a grid of auto-rows-fr)', () => {
    show('tile');
    expect(document.querySelector('[role="listbox"]')!.className).toContain('auto-rows-fr');
    expect(document.querySelector('[data-cat-grid-item="c1"]')!.className).toContain('h-full');
  });
});

describe('the POS screen', () => {
  const pos = read('src/pages/POSScreen.tsx');
  it('uses the one name splitter in the side panel, the ribbon, the picker and the item cards; every pill shows the full name on hover', () => {
    expect(pos).toContain("import { splitCategoryName } from '@/lib/categoryName';");
    expect((pos.match(/splitCategoryName\(/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(pos).toContain("iconStyle={photoLook ? 'tile' : 'emoji'}");
    expect(pos).toContain('data-pos-card-sub className="truncate" title=');
  });
  it('DT Refined puts the categories on top, as the design package does, whatever the restaurant saved; the saved choice is not changed and still rules the other looks', () => {
    expect(pos).toContain('const designCategoriesOnTop = refined && !isOrderTaker;');
    expect(pos).toContain("categoryLayoutSetting: designCategoriesOnTop ? 'top' : ((settings.categoryLayout as string) === 'side'");
    expect(pos).toContain("const catPlacement: 'top' | 'side' | 'right' = designCategoriesOnTop ? 'top' : modern ? layout.categoryPlacement");
    expect(pos).not.toMatch(/categoryLayout\s*[:=]\s*'top'\s*[,;]?\s*\n.*saveSettings/);          // nothing writes the setting
  });
  it('the design card: no category line and no "Add" word under DT Refined; the other looks keep them', () => {
    expect(pos).toContain('const designCard = refined && !isOrderTaker;');
    expect(pos).toContain('{photoLook && !designCard && <p data-pos-card-sub');
    expect(pos).toContain('{photoLook && !designCard && <span>Add</span>}');
  });
});

describe('the look: the design package\'s SW-03 (design-project/02-restaurant-software/screens/sw-03.html)', () => {
  const css = read('src/styles/ui-refined-pos.css');
  const design = read('design-project/02-restaurant-software/screens/sw-03.html');
  const refined = ':root[data-ui="modern"][data-ui-theme="dt-refined"]:not([data-app="otk"])';
  it('the package really draws categories as one row of 32px pills, text only, the active one filled with the accent — and that is what the CSS says', () => {
    expect(design).toContain('.chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;');
    expect(design).toContain('.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}');
    expect(design).toMatch(/<div class="row wrap"><span class="chip  ">All<\/span><span class="chip on ">Pizza<\/span>/);
    expect(css).toContain(`${refined} .cat-ribbon .cat-pill {`);
    expect(css).toMatch(/height: 32px; min-width: 0; padding: 0 12px; border-radius: 999px;/);
    expect(css).toContain('font-size: 13px; font-weight: 600; white-space: nowrap');
    expect(css).toContain(`${refined} .cat-ribbon .cat-pill[data-active="true"] {`);
    expect(css).toContain('flex-wrap: wrap;');                                                          // the design's row wraps
  });
  it('no icon, no count, no Urdu line and no scroll arrows in the pill row; the 4-box picker is a 32px pill', () => {
    expect(css).toMatch(/\.cat-ribbon \.cat-pill \[data-cat-icon\],\s+[^{]*\[data-cat-count\],\s+[^{]*\[data-cat-sub\],\s+[^{]*img \{ display: none; \}/);
    expect(css).toContain('[data-cat-ribbon] > button[aria-label^="Scroll categories"] { display: none; }');
    expect(css).toContain('.cat-pill.cat-grid-btn { width: 32px; min-width: 32px; padding: 0; }');
  });
  it('the soft + button of the design card', () => {
    expect(design).toContain('btn icon soft sm');
    expect(css).toContain(`${refined} [data-pos-card-add] {`);
    expect(css).toContain('background: hsl(var(--dt-accent-tint)); color: hsl(var(--primary));');
  });
  it('the phone Order Taker keeps its icon-tile row (its own design), now scoped to it alone', () => {
    expect(css).toContain(':root[data-app="otk"] .cat-ribbon .cat-pill {');
    expect(css).toContain(':root[data-app="otk"] .cat-ribbon .cat-pill [data-cat-sub] { display: none; }');
  });
});
