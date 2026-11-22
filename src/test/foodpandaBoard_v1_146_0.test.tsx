// ============================================================
// v1.146.0 — Foodpanda orders as the design draws it (SW-38): "Entered at the counter", New order, lanes New · Preparing · Ready · Picked of white cards —
// the reference in monospace, the amount, "Next →". Pinned: the rules in lib/foodpandaBoard.ts, every button against the saved order (Picked takes the money,
// Cancelled voids the sale), the mode switch, the search, the old look and the stylesheet.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { getOrders, getSettings } from '@/lib/store';
import { fpLanes, fpRef, fpStatus, FP_ACTIVE, FP_LANES, FP_NEXT, matchesFoodpanda, nextWord } from '@/lib/foodpandaBoard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/store', async (orig) => ({ ...(await orig<typeof import('@/lib/store')>()), refreshOrdersFromCloud: vi.fn(async () => {}) }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

const fp = (no: number, ref: string | undefined, st: string | undefined, total: number, age: number, extra: Record<string, unknown> = {}) => ({
  id: `f${no}`, orderNumber: no, orderType: 'foodpanda', status: 'running', source: 'pos', foodpandaRef: ref, foodpandaStatus: st,
  items: [{ id: `i${no}`, menuItemId: 'm1', name: 'Karahi', pricingType: 'fixed', price: total, quantity: 2, lineTotal: total, note: '' }],
  subtotal: total, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, grandTotal: total, notes: '', payments: [], amountPaid: 0, createdAt: ago(age), ...extra,
});
const ORDERS = () => [
  fp(2001, 'FP-9921', 'new', 1480, 3), fp(2002, 'FP-9918', 'preparing', 2290, 12), fp(2003, 'FP-9915', 'ready', 990, 20), fp(2004, 'FP-9910', 'picked', 1650, 40, { status: 'paid' }),
  fp(2005, 'FP-9905', 'cancelled', 700, 60, { status: 'cancelled' }), fp(2006, undefined, undefined, 500, 1, { customer: { id: 'c', name: 'Hamza', phone: '', address: '' } }),
  { ...fp(2007, undefined, undefined, 300, 5), orderType: 'dining' },                       // not a Foodpanda order
];

describe('the rules', () => {
  it('the lanes, in the design\'s order; Cancelled is history; one step forward each', () => {
    expect(FP_LANES.map(l => l.label)).toEqual(['New', 'Preparing', 'Ready', 'Picked', 'Cancelled']);
    expect(FP_ACTIVE).toEqual(['new', 'preparing', 'ready', 'picked']);
    expect(FP_NEXT).toEqual({ new: 'preparing', preparing: 'ready', ready: 'picked', picked: null, cancelled: null });
    expect(nextWord('new')).toBe('Mark preparing'); expect(nextWord('picked')).toBe('');
    expect(fpStatus({ foodpandaStatus: undefined })).toBe('new');
  });

  it('the chip is the rider app\'s reference, else our bill number; the search reads bill, reference and customer', () => {
    expect(fpRef({ foodpandaRef: 'FP-9921', orderNumber: 2001 })).toBe('FP-9921');
    expect(fpRef({ foodpandaRef: ' ', orderNumber: 2006 })).toBe('#2006');
    const o = ORDERS() as any[];
    expect(matchesFoodpanda(o[0], 'fp-99')).toBe(true); expect(matchesFoodpanda(o[0], '#2001')).toBe(true); expect(matchesFoodpanda(o[5], 'hamza')).toBe(true); expect(matchesFoodpanda(o[0], 'zzz')).toBe(false);
  });

  it('the lanes hold only Foodpanda orders, oldest first; an order with no status is New', () => {
    const l = fpLanes(ORDERS() as any[]);
    expect(l.new.map(o => o.orderNumber)).toEqual([2001, 2006]);      // 2001 is 3 min old, 2006 only 1: the one that has waited longer is first
    expect(l.preparing.length).toBe(1); expect(l.ready.length).toBe(1); expect(l.picked.length).toBe(1); expect(l.cancelled.length).toBe(1);
    expect(Object.values(l).flat().some(o => o.orderNumber === 2007)).toBe(false);
    expect(fpLanes(ORDERS() as any[], 'hamza').new.map(o => o.orderNumber)).toEqual([2006]);
  });
});

function seed(enabled = true) {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ', foodpandaEnabled: enabled },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [], menuItems: [], orders: ORDERS(), tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], transactions: [], inventory: [], orderCounter: 2100,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  reload();
}
const mount = async () => { const { default: Page } = await import('@/pages/FoodpandaOrdersPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const lane = (k: string) => document.querySelector(`[data-fp-lane="${k}"]`) as HTMLElement;
const card = (ref: string) => document.querySelector(`[data-fp-card="${ref}"]`) as HTMLElement;
const counts = () => ['new', 'preparing', 'ready', 'picked'].map(k => lane(k).querySelector('.fp-count')!.textContent);
const saved = (id: string) => getOrders().find(o => o.id === id)!;

describe('the page under DT Refined', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/foodpanda-orders'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
  afterEach(() => cleanup());

  it('the title, "Entered at the counter", New order, and four lanes with the reference and the amount on each card', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Foodpanda orders');
    expect(document.querySelector('.fp-titles p')!.textContent).toBe('Entered at the counter');
    expect([...document.querySelectorAll('.fp-lane-head b')].map(b => b.textContent)).toEqual(['New', 'Preparing', 'Ready', 'Picked']);
    expect(counts()).toEqual(['2', '1', '1', '1']);
    expect(card('FP-9921').textContent).toContain('Rs 1,480');
    expect(card('FP-9921').textContent).toContain('#2001');
    expect(within(lane('new')).getByText('#2006')).toBeInTheDocument();          // no reference yet: the bill number is the chip
    expect(document.querySelector('[data-fp-card="FP-9910"] [data-fp-next]')).toBeNull();      // Picked is the last step
    expect(document.querySelector('[data-fp-lane="cancelled"]')).toBeNull();
  });

  it('Next moves an order one step and saves it; Picked takes the money', async () => {
    await mount();
    fireEvent.click(within(card('FP-9921')).getByRole('button', { name: /Next/ }));
    expect(saved('f2001').foodpandaStatus).toBe('preparing');
    expect(within(lane('preparing')).getByText('FP-9921')).toBeInTheDocument();
    fireEvent.click(within(card('FP-9915')).getByRole('button', { name: /Next/ }));
    expect(saved('f2003').foodpandaStatus).toBe('picked');
    expect(saved('f2003').status).toBe('paid');
    expect(saved('f2003').paidAt).toBeTruthy();
    expect(within(lane('picked')).getByText('FP-9915')).toBeInTheDocument();
  });

  it('Cancel (in the ⋯) cancels the order and voids the sale', async () => {
    await mount();
    fireEvent.click(within(card('FP-9918')).getByRole('button', { name: /More for FP-9918/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Cancel order/ }));
    expect(saved('f2002').foodpandaStatus).toBe('cancelled');
    expect(saved('f2002').status).toBe('cancelled');
    expect(counts()).toEqual(['2', '0', '1', '1']);
  });

  it('Show cancelled brings the fifth lane; the search narrows every lane', async () => {
    await mount();
    fireEvent.click(document.querySelector('[data-fp-history]')!);
    expect(within(lane('cancelled')).getByText('FP-9905')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Foodpanda orders' }), { target: { value: 'hamza' } });
    expect(counts()).toEqual(['1', '0', '0', '0']);
  });

  it('the mode switch turns Foodpanda mode off and on, in the settings', async () => {
    await mount();
    expect(document.querySelector('[data-fp-off]')).toBeNull();
    fireEvent.click(document.querySelector('[data-fp-mode]')!);
    expect(getSettings().foodpandaEnabled).toBe(false);
    expect(document.querySelector('[data-fp-off]')).not.toBeNull();                // the page says what it means
    fireEvent.click(document.querySelector('[data-fp-mode]')!);
    expect(getSettings().foodpandaEnabled).toBe(true);
  });

  it('New order goes to the till when the mode is on, and asks for the mode first when it is off', async () => {
    await mount();
    fireEvent.click(document.querySelector('[data-fp-new]')!);
    expect(window.location.hash).toMatch(/^#\/?$/);
    cleanup(); window.location.hash = '#/foodpanda-orders'; localStorage.clear(); seed(false); setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    await mount();
    fireEvent.click(document.querySelector('[data-fp-new]')!);
    expect(window.location.hash).toBe('#/foodpanda-orders');
  });

  it('no Foodpanda orders at all: it says how to start', async () => {
    const data = JSON.parse(localStorage.getItem('desi-pos-data')!); data.orders = [];
    localStorage.setItem('desi-pos-data', JSON.stringify(data)); reload();
    await mount();
    expect(document.querySelector('[data-fp-empty]')!.textContent).toMatch(/No Foodpanda orders yet/);
  });
});

describe('every other look', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/foodpanda-orders'; seed(); });
  afterEach(() => cleanup());
  it('keeps the page: the status tabs and "Mark" buttons', async () => {
    setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(document.querySelector('[data-fp-page]')).toBeNull();
    expect(screen.getByRole('tab', { name: /All \(6\)/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Mark preparing/ }).length).toBeGreaterThan(0);
  });
});

describe('the stylesheet', () => {
  it('is imported and every rule is scoped to DT Refined', () => {
    const css = read('src/styles/ui-refined-foodpanda.css');
    expect(read('src/styles.css')).toContain('ui-refined-foodpanda.css');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
});
