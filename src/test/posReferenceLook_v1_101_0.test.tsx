// ============================================================
// v1.101.0 — the POS in the look of the owner's food-POS references (GoFood, Sweetco, TastyIgniter, Tst Food).
//
// What those references share, and what the POS now does under DT Refined:
//   photo-first item cards (padded rounded photo, name, category, price in the accent, a pill "Add") in FEWER, BIGGER columns;
//   category choices as icon tiles in a row, the active one filled with the accent;
//   order lines that lead with the item's photo.
// Pinned: the layout engine's photo-card rule (bigger cards, at most four across, a 4:3 photo, never more columns than before),
// the markup that carries it (mounted for real), and that every other theme is exactly as before.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HashRouter } from '@/lib/hash-router';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { computePosLayout, AUTO_CONFIG } from '@/lib/posLayout';

vi.mock('@/lib/store', async (orig) => ({ ...(await orig<typeof import('@/lib/store')>()), refreshOrdersFromCloud: async () => {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

const base = { touch: false, categoryLayoutSetting: 'top' as const, preferredColumns: 6, config: { ...AUTO_CONFIG } };

describe('layout engine — photo cards', () => {
  it('a photo card is never narrower than 176 px, and a normal till window gets four across', () => {
    for (const w of [1100, 1190, 1366, 1440, 1920]) {
      const photo = computePosLayout({ ...base, width: w, height: 800, photoCards: true });
      expect(photo.cardWidth, `${w}`).toBeGreaterThanOrEqual(176);
    }
    expect(computePosLayout({ ...base, width: 1190, height: 836, photoCards: true }).productColumns).toBe(4);
  });

  it('never gives MORE columns than the plain cards, and keeps the cart at its normal width', () => {
    for (const w of [1100, 1366, 1440, 1920]) {
      const plain = computePosLayout({ ...base, width: w, height: 800 });
      const photo = computePosLayout({ ...base, width: w, height: 800, photoCards: true });
      expect(photo.productColumns).toBeLessThanOrEqual(plain.productColumns);
    }
    const wide = computePosLayout({ ...base, width: 1190, height: 836, photoCards: true });
    expect(wide.cartWidth).toBeGreaterThanOrEqual(320);
  });

  it('the photo is about 4:3 and larger than the plain card photo', () => {
    const plain = computePosLayout({ ...base, width: 1190, height: 836 });
    const photo = computePosLayout({ ...base, width: 1190, height: 836, photoCards: true });
    expect(photo.cardImageHeight).toBeGreaterThan(plain.cardImageHeight);
    expect(photo.cardImageHeight / (photo.cardWidth - 20)).toBeGreaterThan(0.6);
    expect(photo.cardImageHeight / (photo.cardWidth - 20)).toBeLessThan(0.75);
  });

  it('without the flag nothing changes (every other theme)', () => {
    const a = computePosLayout({ ...base, width: 1190, height: 836 });
    const b = computePosLayout({ ...base, width: 1190, height: 836, photoCards: false });
    expect(b).toEqual(a);
  });

  it('a saved card size still wins over the photo rule only upward', () => {
    const big = computePosLayout({ ...base, width: 1190, height: 836, photoCards: true, config: { ...AUTO_CONFIG, cardSize: 'large' } });
    expect(big.cardWidth).toBeGreaterThanOrEqual(176);
  });
});

const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
function seed() {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Sample Restaurant', currencySymbol: 'Rs ' },
    users: [{ id: 'a1', name: 'Owner', username: 'owner', password: 'x', role: 'admin', isActive: true }],
    categories: [{ id: 'burgers', name: 'Burgers', icon: '', sortOrder: 1 }, { id: 'drinks', name: 'Drinks', icon: '', sortOrder: 2 }],
    menuItems: [
      { id: 'm1', name: 'Zinger Burger', price: 650, categoryId: 'burgers', pricingType: 'fixed', isActive: true, image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' },
      { id: 'm2', name: 'Mint Margarita', price: 350, categoryId: 'drinks', pricingType: 'fixed', isActive: true },
    ],
    orders: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], orderCounter: 40,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Owner');
  reload();
}
async function mountPos() {
  const { default: POSScreen } = await import('@/pages/POSScreen');
  window.location.hash = '#/';
  return render(<QueryClientProvider client={new QueryClient()}><TooltipProvider><HashRouter><POSScreen /></HashRouter></TooltipProvider></QueryClientProvider>);
}

describe('the POS, mounted', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); seed(); });
  afterEach(() => cleanup());

  it('DT Refined: cards carry the category line and an Add pill; categories are icon tiles; lines lead with a thumbnail', async () => {
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    const { container } = await mountPos();
    const cards = [...container.querySelectorAll('[data-pos-card]')];
    expect(cards.length).toBe(2);
    expect(cards.map(c => c.querySelector('[data-pos-card-sub]')?.textContent).sort()).toEqual(['Burgers', 'Drinks']);
    expect(cards.every(c => /Add/.test(c.querySelector('[data-pos-card-add]')?.textContent || ''))).toBe(true);
    // the item with a photo shows it; the one without gets the tinted tile with an icon
    expect(container.querySelectorAll('[data-pos-card-image] img').length).toBe(1);
    expect(container.querySelectorAll('[data-pos-card-image][data-initials] svg').length).toBe(1);
    // every category tile (All + two) carries an outline icon and its own name
    const tiles = [...container.querySelectorAll('.cat-ribbon .cat-pill:not(.cat-grid-btn)')];
    expect(tiles.map(t => t.querySelector('[data-cat-name]')?.textContent)).toEqual(['All', 'Burgers', 'Drinks']);
    expect(tiles.every(t => !!t.querySelector('[data-cat-icon] svg'))).toBe(true);

    fireEvent.click(cards[0]);
    const thumb = container.querySelector('[data-pos-line-thumb]');
    expect(thumb).toBeTruthy();
  });

  it('every other theme: the plain cards and pills, none of the Refined markup', async () => {
    setUiStyle('modern'); setTheme('ember');
    const { container } = await mountPos();
    expect(container.querySelector('[data-pos-card-sub]')).toBeNull();
    expect(container.querySelector('[data-pos-card-add] span')).toBeNull();
    expect(container.querySelector('[data-cat-icon] svg')).toBeNull();
    fireEvent.click(container.querySelector('[data-pos-card]')!);
    expect(container.querySelector('[data-pos-line-thumb]')).toBeNull();
  });
});

describe('the stylesheet', () => {
  const css = read('src/styles/ui-refined-pos.css');
  it('styles the photo card, the icon tiles and the line thumbnail, all scoped to DT Refined', () => {
    for (const sel of ['[data-pos-card]', '[data-pos-card-sub]', '[data-pos-card-add]', '.cat-ribbon .cat-pill', '[data-pos-line-thumb]']) expect(css).toContain(sel);
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const block of body.split('}')) {
      const sel = block.split('{')[0].trim().replace(/^@media[^{]*$/, '');
      if (!sel || sel.startsWith('@')) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
});
