// ============================================================
// v1.150.0 — Profit & loss as the design draws it (SW-27): a Summary (Net sales · Food cost · Gross profit · Expenses · Net profit and its margin) beside
// "Margin by item" (Item · Sold · Price · Cost · Margin, "no recipe" where the dish has none). Pinned: the sums and words in lib/profitBoard.ts, the page under
// DT Refined (every figure against the seeded sales, recipes, wastage and expenses; the orders of the table; the date range; Export; the recipe notice),
// the old look and the stylesheet.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { expensesIn, itemRows, marginTone, plSummary, rangeLabel, soldLabel } from '@/lib/profitBoard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('the sums', () => {
  it('plSummary: net sales − food cost = gross profit; − wastage − expenses = net profit; margin and food-cost percentage to one decimal', () => {
    const s = plSummary({ revenue: 4300, foodCost: 1800, wastage: 100, expenses: 500, recipeRevenue: 4000 });
    expect(s).toEqual({ netSales: 4300, foodCost: 1800, grossProfit: 2500, wastage: 100, expenses: 500, netProfit: 1900, marginPct: 44.2, foodCostPct: 45 });
    expect(plSummary({ revenue: 0, foodCost: 0, wastage: 0, expenses: 0 })).toMatchObject({ netProfit: 0, marginPct: 0, foodCostPct: 0 });
    expect(plSummary({ revenue: 1000, foodCost: 0, wastage: 0, expenses: 1500 })).toMatchObject({ netProfit: -500, marginPct: -50 });      // a loss is a negative, not a zero
    expect(plSummary({ revenue: NaN as any, foodCost: 'x' as any, wastage: 0, expenses: 0 }).netSales).toBe(0);
  });

  it('expensesIn: only expense entries whose day is inside the window (an entry has a day, not a time)', () => {
    const start = new Date(2026, 9, 24, 8).getTime(), end = new Date(2026, 10, 23, 3).getTime();
    const t = (date: string, type: 'income' | 'expense', amount: number) => ({ date, type, amount });
    expect(expensesIn([t('2026-10-24', 'expense', 100), t('2026-11-22', 'expense', 200), t('2026-11-23', 'expense', 400), t('2026-10-23', 'expense', 800), t('2026-11-01', 'income', 999), t('junk', 'expense', 5)], start, end)).toBe(300);
    expect(expensesIn([], start, end)).toBe(0);
  });

  it('marginTone: green from 50 %, amber from 30 %, red below', () => {
    expect([marginTone(68), marginTone(50), marginTone(49.9), marginTone(30), marginTone(29), marginTone(-5)]).toEqual(['ok', 'ok', 'warn', 'warn', 'bad', 'bad']);
  });

  it('itemRows: price is what it sold at, cost is per unit, no recipe means no cost and no margin; the three orders', () => {
    const items = [{ name: 'Burger', revenue: 2000, cost: 1600, qty: 4 }, { name: 'Pizza', revenue: 2000, cost: 200, qty: 2 }, { name: 'Wrap', revenue: 300, cost: 0, qty: 1 }, { name: 'Kabab', revenue: 1560, cost: 0, qty: 1.5 }];
    const sold = itemRows(items, 'sold');
    expect(sold.map(r => r.name)).toEqual(['Burger', 'Pizza', 'Kabab', 'Wrap']);
    expect(sold[0]).toMatchObject({ price: 500, unitCost: 400, margin: 20 });
    expect(sold[1]).toMatchObject({ price: 1000, unitCost: 100, margin: 90 });
    expect(sold[3]).toMatchObject({ price: 300, unitCost: null, margin: null });
    expect(itemRows(items, 'best').map(r => r.name)).toEqual(['Pizza', 'Burger', 'Kabab', 'Wrap']);     // dishes with no recipe sit last in both margin orders
    expect(itemRows(items, 'low').map(r => r.name)).toEqual(['Burger', 'Pizza', 'Kabab', 'Wrap']);
    expect(itemRows([], 'sold')).toEqual([]);
  });

  it('soldLabel and rangeLabel', () => {
    expect(soldLabel(180)).toBe('180'); expect(soldLabel(1.5)).toBe('1.5'); expect(soldLabel(2.25)).toBe('2.3');
    const a = new Date(2026, 9, 24, 8).getTime(), b = new Date(2026, 10, 23, 3).getTime();
    expect(rangeLabel(a, b, 'month')).toBe('Last 30 days · 24 Oct – 23 Nov');
    expect(rangeLabel(new Date(2026, 10, 16, 8).getTime(), b, 'week')).toBe('Last 7 days · 16 – 23 Nov');
    expect(rangeLabel(a, b, 'today')).toBe('Today'); expect(rangeLabel(a, b, 'yesterday')).toBe('Yesterday');
    expect(rangeLabel(a, b, 'custom')).toBe('24 Oct – 23 Nov 2026');
  });
});

const inv = (id: string, cost: number) => ({ id, name: id, sku: id, categoryId: 'ic', unit: 'kg', baseUnit: 'kg', quantity: 100, costPrice: cost, avgCostPrice: cost, salePrice: 0, lowStockThreshold: 1, isActive: true });
const line = (id: string, menuItemId: string, name: string, price: number, qty: number) => ({ id, menuItemId, name, pricingType: 'fixed', price, quantity: qty, lineTotal: price * qty });
const order = (id: string, no: number, status: string, paid: Date, items: any[]) => ({
  id, orderNumber: no, orderType: 'takeaway', status, source: 'pos', items, subtotal: 0, discount: 0, tax: 0, serviceCharge: 0, grandTotal: items.reduce((s, i) => s + i.lineTotal, 0),
  createdAt: paid.toISOString(), paidAt: status === 'paid' ? paid.toISOString() : undefined, payments: [], paymentMethod: 'cash',
});

function seed(over: Record<string, unknown> = {}) {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ' },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], parties: [], orderCounter: 100,
    menuItems: [
      { id: 'mp', name: 'Pizza', price: 1000, categoryId: 'c', pricingType: 'fixed', isActive: true },
      { id: 'mb', name: 'Burger', price: 500, categoryId: 'c', pricingType: 'fixed', isActive: true },
      { id: 'mw', name: 'Wrap', price: 300, categoryId: 'c', pricingType: 'fixed', isActive: true },
    ],
    inventory: [inv('fl', 200)],
    recipes: [
      { id: 'rp', menuItemId: 'mp', components: [{ inventoryItemId: 'fl', quantity: 0.5, unit: 'kg' }] },      // 100 a pizza
      { id: 'rb', menuItemId: 'mb', components: [{ inventoryItemId: 'fl', quantity: 2, unit: 'kg' }] },        // 400 a burger
    ],
    orders: [
      order('o1', 1, 'paid', daysAgo(2), [line('l1', 'mp', 'Pizza', 1000, 2), line('l2', 'mb', 'Burger', 500, 4)]),
      order('o2', 2, 'paid', daysAgo(3), [line('l3', 'mw', 'Wrap', 300, 1)]),
      order('o3', 3, 'running', daysAgo(1), [line('l4', 'mp', 'Pizza', 1000, 9)]),              // not paid: not in it
      order('o4', 4, 'paid', daysAgo(60), [line('l5', 'mp', 'Pizza', 1000, 9)]),                 // outside the 30 days
    ],
    wastages: [{ id: 'w1', date: daysAgo(2).toISOString(), inventoryItemId: 'fl', inventoryItemName: 'fl', quantity: 0.5, unit: 'kg', costValue: 100, reason: 'expired' }],
    transactions: [
      { id: 'x1', date: ymd(daysAgo(3)), type: 'expense', categoryId: 'c', categoryName: 'Utilities', amount: 500, paymentMethod: 'cash', description: 'Gas' },
      { id: 'x2', date: ymd(daysAgo(60)), type: 'expense', categoryId: 'c', categoryName: 'Rent', amount: 10000, paymentMethod: 'cash', description: 'Old rent' },
      { id: 'x3', date: ymd(daysAgo(3)), type: 'income', categoryId: 'c', categoryName: 'Catering', amount: 999, paymentMethod: 'cash', description: 'Tray' },
    ],
    ...over,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  reload();
}
const mount = async () => { const { default: Page } = await import('@/pages/ProfitabilityPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const line$ = (k: string) => document.querySelector(`[data-pl-line="${k}"]`)!.textContent;
const names = () => [...document.querySelectorAll('[data-pl-row]')].map(r => r.getAttribute('data-pl-row'));
const row = (n: string) => document.querySelector(`[data-pl-row="${n}"]`) as HTMLElement;

describe('the page under DT Refined', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/profitability'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
  afterEach(() => cleanup());

  it('the title, the window in words and Export', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Profit & loss');
    expect(document.querySelector('[data-pl-subtitle]')!.textContent).toMatch(/^Last 30 days · \d{1,2} \w{3} – \d{1,2} \w{3}$/);
    expect(screen.getByRole('button', { name: /Export/ })).toBeInTheDocument();
  });

  it('the Summary: every line against the seeded sales, recipes, wastage and expenses', async () => {
    await mount();
    expect(line$('netSales')).toBe('Rs 4,300');                 // 2,000 + 2,000 + 300 — the running bill and the 60-day-old one are not in it
    expect(line$('foodCost')).toBe('− Rs 1,800');               // 2 × 100 + 4 × 400
    expect(line$('grossProfit')).toBe('Rs 2,500');
    expect(line$('wastage')).toBe('− Rs 100');
    expect(line$('expenses')).toBe('− Rs 500');                 // the 60-day-old rent and the income entry are not in it
    expect(line$('netProfit')).toBe('Rs 1,900');
    expect(document.querySelector('[data-pl-margin]')!.textContent).toBe('Margin 44.2% · 2 bills');
    expect(document.querySelector('[data-pl-foodpct]')!.textContent).toContain('45%');
    expect(document.querySelector('[data-pl-net]')!.hasAttribute('data-neg')).toBe(false);
    expect(document.querySelector('[data-pl-notice]')).toBeNull();                  // two of three dishes have a recipe
  });

  it('Margin by item: Item · Sold · Price · Cost · Margin, best sellers first; no recipe says so', async () => {
    await mount();
    expect([...document.querySelectorAll('[data-pl-items] thead th')].map(t => t.textContent)).toEqual(['Item', 'Sold', 'Price', 'Cost', 'Margin']);
    expect(names()).toEqual(['Burger', 'Pizza', 'Wrap']);
    const b = [...row('Burger').querySelectorAll('td')].map(t => t.textContent);
    expect(b).toEqual(['Burger', '4', 'Rs 500', 'Rs 400', '20%']);
    expect(row('Burger').querySelector('.pl-margin')!.getAttribute('data-tone')).toBe('bad');
    expect(row('Pizza').querySelector('.pl-margin')!.getAttribute('data-tone')).toBe('ok');
    expect([...row('Wrap').querySelectorAll('td')].map(t => t.textContent)).toEqual(['Wrap', '1', 'Rs 300', 'no recipe', '—']);
  });

  it('the order of the table: Best margin and Lowest margin keep the dishes with no recipe last', async () => {
    await mount();
    fireEvent.click(document.querySelector('[data-pl-sort="best"]')!);
    expect(names()).toEqual(['Pizza', 'Burger', 'Wrap']);
    expect(document.querySelector('[data-pl-sort="best"]')!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(document.querySelector('[data-pl-sort="low"]')!);
    expect(names()).toEqual(['Burger', 'Pizza', 'Wrap']);
    fireEvent.click(document.querySelector('[data-pl-sort="sold"]')!);
    expect(names()).toEqual(['Burger', 'Pizza', 'Wrap']);
  });

  it('a loss shows as a negative net profit in red', async () => {
    cleanup(); localStorage.clear();
    seed({ transactions: [{ id: 'x9', date: ymd(daysAgo(1)), type: 'expense', categoryId: 'c', categoryName: 'Rent', amount: 9000, paymentMethod: 'cash', description: 'Rent' }] });
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    await mount();
    expect(line$('netProfit')).toBe('− Rs 6,600');                  // 4,300 − 1,800 − 100 − 9,000
    expect(document.querySelector('[data-pl-net]')!.hasAttribute('data-neg')).toBe(true);
    expect(document.querySelector('[data-pl-margin]')!.textContent).toContain('Margin -153.5%');
  });

  it('the date range still works: Today has no sales, so the table says so and the Summary reads zero', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(document.querySelector('[data-pl-subtitle]')!.textContent).toBe('Today'));
    expect(document.querySelector('[data-pl-empty]')!.textContent).toBe('No sales in these dates.');
    expect(line$('netSales')).toBe('Rs 0');
    expect(document.querySelector('[data-pl-margin]')!.textContent).toBe('Margin 0% · 0 bills');
  });

  it('with few recipes an amber note says so', async () => {
    cleanup(); localStorage.clear();
    seed({ recipes: [{ id: 'rp', menuItemId: 'mp', components: [{ inventoryItemId: 'fl', quantity: 0.5, unit: 'kg' }] }] });
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    await mount();
    expect(document.querySelector('[data-pl-notice]')!.textContent).toContain('Only 1 of 3 active menu items have recipes');
  });

  it('Export opens Print · PDF · POS · JPG, and Print hands the report to a print window', async () => {
    const write = vi.fn();
    (window as any).open = vi.fn(() => ({ document: { write, close: vi.fn() }, print: vi.fn() }));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    const menu = await screen.findByText('Print');
    expect(menu).toBeInTheDocument();
    for (const k of ['pdf', 'pos', 'jpg']) expect(document.querySelector(`[data-report-${k}]`)).not.toBeNull();
    fireEvent.click(document.querySelector('[data-report-print]')!);
    expect(write).toHaveBeenCalledTimes(1);
    const html = String(write.mock.calls[0][0]);
    expect(html).toContain('Profit &amp; loss');
    expect(html).toContain('Burger'); expect(html).toContain('no recipe'); expect(html).toContain('Net profit');
  });

  it('another look keeps the old page: "Profitability Dashboard" and its six cards', async () => {
    cleanup(); localStorage.clear(); seed(); setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(document.querySelector('[data-pl-page]')).toBeNull();
    expect(screen.getByText('Profitability Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Top Items by Revenue')).toBeInTheDocument();
  });
});

describe('the stylesheet', () => {
  it('is imported and every rule is scoped to DT Refined', () => {
    const css = read('src/styles/ui-refined-profit.css');
    expect(read('src/styles.css')).toContain('ui-refined-profit.css');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
});
