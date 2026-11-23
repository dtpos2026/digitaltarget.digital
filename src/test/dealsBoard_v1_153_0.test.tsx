// ============================================================
// v1.153.0 — Deals & combos as the design draws it (SW-15): "N active deals", New deal, and a card per deal — a coloured banner, the name with an on / off switch, the
// combo price beside the regular price struck through with "Save Rs X", and the ticked list. Pinned: the pricing rules in lib/dealsBoard.ts, every control against the saved
// deals and the menu they sync to, the old look and the stylesheet.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { getCategories, getDeals, getMenuItems } from '@/lib/store';
import { BANNER_TONES, bannerTone, dealLine, dealsSubtitle, lineUnitPrice, regularPrice, saving } from '@/lib/dealsBoard';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() }) }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));

const MENU = () => [
  { id: 'm0', name: 'Pizza', price: 1000, categoryId: 'c0', pricingType: 'fixed', isActive: true, sizeVariants: [{ name: 'M', price: 1000 }, { name: 'L', price: 1400 }], inchVariants: [{ name: '12 Inch', price: 1500 }] },
  { id: 'm1', name: 'Fries', price: 290, categoryId: 'c4', pricingType: 'fixed', isActive: true },
  { id: 'm2', name: '1.5 L drink', price: 250, categoryId: 'c5', pricingType: 'fixed', isActive: true },
  { id: 'm3', name: 'Zinger Burger', price: 650, categoryId: 'c1', pricingType: 'fixed', isActive: true },
  { id: 'm6', name: 'Seekh Kabab', price: 0, ratePerKg: 1800, categoryId: 'c2', pricingType: 'weight', isActive: true },
] as any[];
const L = (id: string, q: number, v?: string, t?: 'size' | 'inch') => ({ menuItemId: id, quantity: q, variantName: v, variantType: t });
const DEALS = () => [
  { id: 'd1', name: 'Family Deal', price: 3290, isActive: true, createdAt: '2026-11-01T00:00:00Z', items: [L('m0', 2, 'L', 'size'), L('m1', 1), L('m2', 1)] },
  { id: 'd2', name: 'Burger Duo', price: 1190, isActive: true, createdAt: '2026-11-02T00:00:00Z', items: [L('m3', 2), L('m1', 2)] },
  { id: 'd3', name: 'Kabab Box', price: 900, isActive: false, createdAt: '2026-11-03T00:00:00Z', items: [L('m6', 1), L('m1', 1)] },
] as any[];

describe('the pricing rules', () => {
  it('lineUnitPrice: the dish, or the size / inch it is bought in; unknown when the dish is gone, the variant is gone, or it is sold by weight', () => {
    const m = MENU();
    expect(lineUnitPrice(L('m1', 1), m)).toBe(290);
    expect(lineUnitPrice(L('m0', 1, 'L', 'size'), m)).toBe(1400);
    expect(lineUnitPrice(L('m0', 1, '12 Inch', 'inch'), m)).toBe(1500);
    expect(lineUnitPrice(L('m0', 1, '12 Inch'), m)).toBe(1500);               // no type given: found anyway
    expect(lineUnitPrice(L('m0', 1, 'XXL', 'size'), m)).toBeNull();
    expect(lineUnitPrice(L('gone', 1), m)).toBeNull();
    expect(lineUnitPrice(L('m6', 1), m)).toBeNull();
  });
  it('regularPrice and saving: what the same things cost one by one, and what the combo saves; nothing to say when it cannot be priced or is not cheaper', () => {
    const m = MENU(), d = DEALS();
    expect(regularPrice(d[0], m)).toBe(3340);                                  // 2 × 1,400 + 290 + 250
    expect(saving(d[0], m)).toEqual({ regular: 3340, save: 50 });
    expect(saving(d[1], m)).toEqual({ regular: 1880, save: 690 });
    expect(saving(d[2], m)).toBeNull();                                        // a weighed dish: no price per piece
    expect(saving({ items: [L('m1', 1)], price: 290 }, m)).toBeNull();         // same price: no saving
    expect(saving({ items: [L('m1', 1)], price: 500 }, m)).toBeNull();         // dearer than separately
    expect(regularPrice({ items: [] }, m)).toBeNull();
  });
  it('dealsSubtitle, dealLine, bannerTone', () => {
    expect(dealsSubtitle([])).toBe('No deals yet');
    expect(dealsSubtitle([{ isActive: true }])).toBe('1 active deal');
    expect(dealsSubtitle([{ isActive: true }, { isActive: true }, { isActive: false }])).toBe('2 active deals · 1 off');
    expect(dealLine(L('m0', 2, 'M'), id => (id === 'm0' ? 'Pizza' : ''))).toBe('2 × Pizza (M)');
    expect(dealLine(L('x', 1), () => '')).toBe('1 × —');
    expect(dealLine(L('m1', 0), () => 'Fries')).toBe('1 × Fries');
    expect([0, 1, 2, 6, 7].map(bannerTone)).toEqual([BANNER_TONES[0], BANNER_TONES[1], BANNER_TONES[2], BANNER_TONES[0], BANNER_TONES[1]]);
  });
});

function seed(over: Record<string, unknown> = {}) {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ' },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [{ id: 'c0', name: 'Pizza', sortOrder: 1 }], menuItems: MENU(), deals: DEALS(),
    orders: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], inventory: [], transactions: [], orderCounter: 1, ...over,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  reload();
}
const mount = async () => { const { default: Page } = await import('@/pages/VariationsDealsPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const card = (id: string) => document.querySelector(`[data-dl-card="${id}"]`) as HTMLElement;
const cards = () => [...document.querySelectorAll('[data-dl-card]')].map(c => c.getAttribute('data-dl-card'));

describe('the page under DT Refined', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); window.location.hash = '#/variations'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
  afterEach(() => cleanup());

  it('the title, "N active deals" and New deal', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Deals & combos');
    expect(document.querySelector('[data-dl-subtitle]')!.textContent).toBe('2 active deals · 1 off');
    expect(screen.getByRole('button', { name: /New deal/ })).toBeInTheDocument();
  });

  it('a card per deal: price, the regular price struck through, "Save Rs X" and the ticked lines', async () => {
    await mount();
    expect(cards()).toEqual(['d1', 'd2', 'd3']);
    const a = card('d1');
    expect(a.querySelector('[data-dl-price]')!.textContent).toBe('Rs 3,290');
    expect(a.querySelector('[data-dl-regular]')!.textContent).toBe('Rs 3,340');
    expect(a.querySelector('[data-dl-save]')!.textContent).toBe('Save Rs 50');
    expect([...a.querySelectorAll('.dl-lines li')].map(l => l.textContent)).toEqual(['2 × Pizza (L)', '1 × Fries', '1 × 1.5 L drink']);
    expect(card('d2').querySelector('[data-dl-save]')!.textContent).toBe('Save Rs 690');
    expect(card('d3').querySelector('[data-dl-save]')).toBeNull();              // a weighed dish: no regular price to compare
    expect(card('d3').hasAttribute('data-off')).toBe(true);
  });

  it('the switch puts a deal on or off the menu: the deal and its menu item follow', async () => {
    await mount();
    const sw = within(card('d2')).getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    expect(getDeals().find(d => d.id === 'd2')!.isActive).toBe(false);
    expect(getMenuItems().find(i => i.id === 'd2')!.isActive).toBe(false);
    expect(within(card('d2')).getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('[data-dl-subtitle]')!.textContent).toBe('1 active deal · 2 off');
    fireEvent.click(within(card('d3')).getByRole('switch'));
    expect(getDeals().find(d => d.id === 'd3')!.isActive).toBe(true);
    expect(getMenuItems().find(i => i.id === 'd3')!.isActive).toBe(true);
  });

  it('New deal opens the form; a name, a price and an item save it, put it in the Deals category and show it as a card', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /New deal/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByPlaceholderText('Family Deal 2'), { target: { value: 'Snack Pack' } });
    fireEvent.change(within(dlg).getByRole('spinbutton'), { target: { value: '500' } });
    fireEvent.click(within(dlg).getByRole('button', { name: /Fries/ }));
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Deal' }));
    await waitFor(() => expect(getDeals().some(d => d.name === 'Snack Pack')).toBe(true));
    const deal = getDeals().find(d => d.name === 'Snack Pack')!;
    expect(deal.price).toBe(500); expect(deal.items).toEqual([{ menuItemId: 'm1', quantity: 1, variantName: undefined, variantType: undefined }]);
    expect(getMenuItems().find(i => i.id === deal.id)).toMatchObject({ name: 'Snack Pack', price: 500, isActive: true });
    expect(getCategories().some(c => c.name === 'Deals')).toBe(true);
    expect(cards().length).toBe(4);
  });

  it('a deal with no name or no items is refused', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /New deal/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Deal' }));
    expect(getDeals().length).toBe(3);
  });

  it('Edit opens the same form with the deal in it; Save keeps the change', async () => {
    await mount();
    fireEvent.click(within(card('d1')).getByRole('button', { name: 'Edit Family Deal' }));
    const dlg = await screen.findByRole('dialog');
    const name = within(dlg).getByPlaceholderText('Family Deal 2') as HTMLInputElement;
    expect(name.value).toBe('Family Deal');
    fireEvent.change(within(dlg).getAllByRole('spinbutton')[0], { target: { value: '3100' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Deal' }));
    await waitFor(() => expect(getDeals().find(d => d.id === 'd1')!.price).toBe(3100));
    expect(card('d1').querySelector('[data-dl-save]')!.textContent).toBe('Save Rs 240');
  });

  it('Delete asks first: No keeps the deal, Yes removes it and its menu item', async () => {
    await mount();
    Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: vi.fn(() => false) });
    fireEvent.click(within(card('d2')).getByRole('button', { name: 'Delete Burger Duo' }));
    expect(getDeals().length).toBe(3);
    (window.confirm as any) = vi.fn(() => true);
    fireEvent.click(within(card('d2')).getByRole('button', { name: 'Delete Burger Duo' }));
    expect(getDeals().map(d => d.id)).toEqual(['d1', 'd3']);
    expect(cards()).toEqual(['d1', 'd3']);
  });

  it('with no deals the empty line says how to make one', async () => {
    cleanup(); localStorage.clear(); seed({ deals: [] }); setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    await mount();
    expect(document.querySelector('[data-dl-subtitle]')!.textContent).toBe('No deals yet');
    expect(document.querySelector('[data-dl-empty]')!.textContent).toContain('New deal');
  });

  it('another look keeps the old page: "Deals / Combos" and Add Deal', async () => {
    cleanup(); localStorage.clear(); seed(); setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(document.querySelector('[data-dl-page]')).toBeNull();
    expect(screen.getByText('Deals / Combos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Deal/ })).toBeInTheDocument();
  });
});

describe('the stylesheet', () => {
  it('is imported and every rule is scoped to DT Refined', () => {
    const css = read('src/styles/ui-refined-deals.css');
    expect(read('src/styles.css')).toContain('ui-refined-deals.css');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
});
