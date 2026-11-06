// v1.111.0 — the website's categories: ONE line under the hero (about 5 on a phone, 8 on a tablet, 12 on a computer) with the
// software's 4-box button that opens every category; bordered chips; a tap shows that category's products.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Category, MenuItem } from '@/lib/types';
import { categoryTiles } from '@/lib/websiteHome';
import { CategoryRail, RAIL_LIMITS, railChips } from '@/components/website/siteBits';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const mk = (n: number) => {
  const cats = Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, name: `Category ${i + 1}`, sortOrder: i + 1 }) as Category);
  const items = cats.map((c, i) => ({ id: `m${i + 1}`, name: `Item ${i + 1}`, categoryId: c.id, price: 100, isActive: true }) as MenuItem);
  return categoryTiles(cats, items);
};
const media = (width: number) => {
  window.matchMedia = ((q: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0);
    return { matches: width >= min, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
};
afterEach(() => { delete (window as { matchMedia?: unknown }).matchMedia; });

describe('how many chips the line shows', () => {
  it('5 on a phone, 8 on a tablet, 12 on a computer', () => {
    expect(RAIL_LIMITS).toEqual({ phone: 5, tablet: 8, desktop: 12 });
    const tiles = mk(20);
    for (const [w, n] of [[360, 5], [768, 8], [1366, 12]] as const) {
      media(w);
      const { unmount } = render(<CategoryRail tiles={tiles} active="all" onPick={() => {}} totalItems={20} />);
      expect(document.querySelectorAll('[data-rail-chip]:not([data-rail-chip="all"])').length, `${w}px`).toBe(n);
      unmount();
    }
  });
  it('without matchMedia the phone line is used, and a short menu shows everything', () => {
    render(<CategoryRail tiles={mk(3)} active="all" onPick={() => {}} totalItems={3} />);
    expect(document.querySelectorAll('[data-rail-chip]:not([data-rail-chip="all"])').length).toBe(3);
  });
  it('an open category that would not fit is brought into the line', () => {
    const tiles = mk(20);
    expect(railChips(tiles, 'c2', 5).map(t => t.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(railChips(tiles, 'c17', 5).map(t => t.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c17']);
    expect(railChips(tiles, 'all', 5)).toHaveLength(5);
    expect(railChips(tiles, 'gone', 5)).toHaveLength(5);
  });
});

describe('the line', () => {
  it('is one scrolling line: the 4-box button, All, then the chips — each with a border', () => {
    render(<CategoryRail tiles={mk(8)} active="c2" onPick={() => {}} totalItems={8} />);
    const line = document.querySelector('[data-rail-line]')!;
    expect(line.className).toContain('overflow-x-auto');
    expect(line.className).not.toContain('flex-wrap');
    expect(screen.getByRole('button', { name: 'All categories' })).toBeInTheDocument();
    const on = document.querySelector('[data-rail-chip="c2"]') as HTMLElement;
    expect(on.getAttribute('aria-selected')).toBe('true');
    expect(on.className).toContain('border-2');
    expect(on.className).toContain('border-primary');
    expect((document.querySelector('[data-rail-chip="c3"]') as HTMLElement).className).toContain('border-border');
  });
  it('a chip shows that category; All shows everything', () => {
    const pick = vi.fn();
    render(<CategoryRail tiles={mk(8)} active="all" onPick={pick} totalItems={8} />);
    fireEvent.click(document.querySelector('[data-rail-chip="c3"]')!);
    expect(pick).toHaveBeenLastCalledWith('c3');
    fireEvent.click(document.querySelector('[data-rail-chip="all"]')!);
    expect(pick).toHaveBeenLastCalledWith('all');
  });
});

describe('the 4-box button', () => {
  it('opens every category — the ones that did not fit on the line too — and picking one closes it', () => {
    media(360);
    const pick = vi.fn();
    render(<CategoryRail tiles={mk(12)} active="all" onPick={pick} totalItems={12} />);
    expect(document.querySelector('[data-rail-chip="c11"]')).toBeNull();                 // not on a phone's line…
    fireEvent.click(screen.getByRole('button', { name: 'All categories' }));
    const grid = within(screen.getByTestId('site-category-grid'));
    expect(grid.getAllByRole('button').filter(b => b.hasAttribute('data-category-tile'))).toHaveLength(12);   // …but in the grid
    fireEvent.click(document.querySelector('[data-category-tile="c11"]')!);
    expect(pick).toHaveBeenCalledWith('c11');
    expect(screen.queryByTestId('site-category-grid')).toBeNull();
  });
  it('"Everything on the menu" is there too, with the count', () => {
    const pick = vi.fn();
    render(<CategoryRail tiles={mk(4)} active="c1" onPick={pick} totalItems={4} />);
    fireEvent.click(screen.getByRole('button', { name: 'All categories' }));
    expect(screen.getByText('Everything on the menu')).toBeInTheDocument();
    fireEvent.click(document.querySelector('[data-rail-all]')!);
    expect(pick).toHaveBeenCalledWith('all');
  });
});

describe('the page', () => {
  const page = read('src/pages/OnlineOrderPage.tsx');
  it('the rail is on the home view and on an opened category, under the hero; the old tile block and "← All" row are gone', () => {
    expect(page).toContain('<CategoryRail');
    expect(page).not.toContain('← All');
    expect(page).not.toContain('<CategoryTiles');
    expect(page.indexOf('<HeroBanner')).toBeLessThan(page.indexOf('<CategoryRail'));
    expect(page).toMatch(/\{tiles\.length > 0 && \(\s*<CategoryRail/);   // not only on home
  });
  it('a category pick clears the search so its products show', () => {
    expect(page).toMatch(/onPick=\{id => \{\s*setSearch\(''\);\s*setActiveCat\(id\);/);
  });
  it('the header shows the customer\'s own picture, and the sign-in button says what an account is for', () => {
    expect(page).toContain('accountPhoto={profile?.photoUrl ?? null}');
    const bits = read('src/components/website/siteBits.tsx');
    expect(bits).toContain('data-account-photo');
    expect(bits).toContain('get offers and discount codes');
  });
});
