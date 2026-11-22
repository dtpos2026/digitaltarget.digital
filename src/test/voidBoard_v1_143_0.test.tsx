// ============================================================
// v1.143.0 — Void / comp / cancel as the design draws it (SW-40): "Needs a manager", a search with All · Void · Complimentary · Cancelled, and one table —
// Bill · Status · Amount · Reason · By · When. Pinned: the rules in lib/voidBoard.ts, the filters and search, the printed list, the old look and the stylesheet.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { billSub, exitRow, exitRows, exitTotals, kindOf, matchesQuery, voidTotalsLine, whenLabel } from '@/lib/voidBoard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

const bill = (no: number, status: string, total: number, extra: Record<string, unknown> = {}) => ({
  id: `v${no}`, orderNumber: no, orderType: 'dining', status, source: 'pos',
  items: [{ id: `i${no}`, menuItemId: 'm1', name: 'Karahi', pricingType: 'fixed', price: total, quantity: 2, lineTotal: total, note: '' }],
  subtotal: total, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, grandTotal: total, notes: '', payments: [], amountPaid: 0, createdAt: ago(300),
  customer: { id: `c${no}`, name: 'Sara Khan', phone: `0300111${no}`, address: '' }, ...extra,
});
const ORDERS = () => [
  bill(1036, 'void', 1290, { voidReason: 'Customer left', voidBy: 'Sana', voidedAt: ago(20) }),
  bill(1021, 'complimentary', 650, { complimentaryReason: "Owner's guest", complimentaryBy: 'Admin', complimentaryAt: ago(70), reprintCount: 2 }),
  bill(1011, 'cancelled', 2100, { cancelReason: 'Duplicate order', cancelledBy: 'Sana', cancelledAt: ago(100) }),
  bill(1050, 'paid', 800),                                                      // a paid bill is not an exit
  bill(1051, 'void', 400, { voidReason: 'Wrong table', voidBy: 'Ali', voidedAt: ago(60 * 30) }),
];

describe('the rules', () => {
  it('which bills left the sale on purpose', () => {
    expect(kindOf({ status: 'void' })).toBe('void');
    expect(kindOf({ status: 'complimentary' })).toBe('comp');
    expect(kindOf({ status: 'cancelled' })).toBe('cancel');
    expect(kindOf({ status: 'paid' })).toBeNull();
    expect(kindOf({ status: 'rejected' })).toBeNull();
  });

  it('the exit: the reason, who and when for its own kind (else when the bill was made)', () => {
    const [v, c, x] = ORDERS();
    expect(exitRow(v as any)).toMatchObject({ kind: 'void', reason: 'Customer left', by: 'Sana' });
    expect(exitRow(c as any)).toMatchObject({ kind: 'comp', reason: "Owner's guest", by: 'Admin' });
    expect(exitRow(x as any)).toMatchObject({ kind: 'cancel', reason: 'Duplicate order', by: 'Sana' });
    const bare = exitRow(bill(1, 'void', 100) as any)!;
    expect(bare.reason).toBe(''); expect(bare.by).toBe(''); expect(bare.at).toBeTruthy();
    expect(exitRow(bill(2, 'paid', 100) as any)).toBeNull();
  });

  it('the table: the kind chosen, the search over number, customer, phone, reason and name; newest exit first; totals by kind', () => {
    const all = ORDERS() as any[];
    expect(exitRows(all, 'all').map(r => r.order.orderNumber)).toEqual([1036, 1021, 1011, 1051]);
    expect(exitRows(all, 'void').map(r => r.order.orderNumber)).toEqual([1036, 1051]);
    expect(exitRows(all, 'comp').map(r => r.order.orderNumber)).toEqual([1021]);
    expect(exitRows(all, 'all', '#1011').map(r => r.order.orderNumber)).toEqual([1011]);
    expect(exitRows(all, 'all', 'guest').map(r => r.order.orderNumber)).toEqual([1021]);
    expect(exitRows(all, 'all', 'ali').map(r => r.order.orderNumber)).toEqual([1051]);
    expect(exitRows(all, 'all', '03001111036').map(r => r.order.orderNumber)).toEqual([1036]);
    expect(matchesQuery(exitRow(all[0])!, 'nobody')).toBe(false);
    const t = exitTotals(exitRows(all, 'all'));
    expect(t.void).toEqual({ count: 2, amount: 1690 }); expect(t.comp).toEqual({ count: 1, amount: 650 }); expect(t.cancel).toEqual({ count: 1, amount: 2100 });
    expect(voidTotalsLine(exitRows(all, 'all'), n => `Rs ${n.toLocaleString('en-US')}`)).toBe('4 bills · Void Rs 1,690 · Complimentary Rs 650 · Cancelled Rs 2,100');
  });

  it('the words: the time today, the date otherwise; what a bill was', () => {
    const now = Date.UTC(2026, 10, 22, 12, 0, 0);
    const d = new Date(now); d.setHours(9, 5, 0, 0);
    expect(whenLabel(d.toISOString(), now)).toBe('09:05');
    const y = new Date(now - 3 * 86_400_000); y.setHours(14, 30, 0, 0);
    expect(whenLabel(y.toISOString(), now)).toMatch(/^\d{1,2} \w{3} 14:30$/);
    expect(whenLabel('nope', now)).toBe('—');
    expect(billSub(ORDERS()[0] as any)).toBe('Dining · Sara Khan · 2 items');
  });
});

function seed() {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ' },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [], menuItems: [], orders: ORDERS(),
    tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], transactions: [], inventory: [], orderCounter: 2000,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  reload();
}
const mount = async () => { const { default: Page } = await import('@/pages/VoidBillsPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const rows = () => [...document.querySelectorAll('[data-vd-row]')].map(r => r.getAttribute('data-vd-row'));

describe('the page under DT Refined', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/void-bills'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
  afterEach(() => cleanup());

  it('the title, "Needs a manager", and one table of every bill that left the sale', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Void / comp / cancel');
    expect(document.querySelector('.vd-titles p')!.textContent).toBe('Needs a manager');
    expect(rows()).toEqual(['1036', '1021', '1011', '1051']);
    const r = document.querySelector('[data-vd-row="1021"]') as HTMLElement;
    expect(within(r).getByText('Complimentary')).toBeInTheDocument();
    expect(r.textContent).toContain('Rs 650'); expect(r.textContent).toContain("Owner's guest"); expect(r.textContent).toContain('Admin');
    expect(r.textContent).toContain('Dining · Sara Khan · 2 items · reprinted 2×');
    expect(within(document.querySelector('[data-vd-row="1036"]') as HTMLElement).getByText('Void')).toBeInTheDocument();
    expect(within(document.querySelector('[data-vd-row="1011"]') as HTMLElement).getByText('Cancelled')).toBeInTheDocument();
    expect(document.querySelector('[data-vd-totals]')!.textContent).toBe('4 bills · Void Rs 1,690 · Complimentary Rs 650 · Cancelled Rs 2,100');
  });

  it('the chips and the search narrow the table (and its totals)', async () => {
    await mount();
    fireEvent.click(document.querySelector('[data-vd-filter="void"]')!);
    expect(rows()).toEqual(['1036', '1051']);
    expect(document.querySelector('[data-vd-totals]')!.textContent).toMatch(/^2 bills · Void Rs 1,690/);
    fireEvent.click(document.querySelector('[data-vd-filter="comp"]')!);
    expect(rows()).toEqual(['1021']);
    fireEvent.click(document.querySelector('[data-vd-filter="all"]')!);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search void, comp and cancel' }), { target: { value: 'duplicate' } });
    expect(rows()).toEqual(['1011']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search void, comp and cancel' }), { target: { value: 'zzz' } });
    expect(document.querySelector('[data-vd-empty]')!.textContent).toBe('No bills match.');
  });

  it('Print writes what is shown — with a Status column — into a print window', async () => {
    const doc = { write: vi.fn(), close: vi.fn() };
    const print = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue({ document: doc, print } as any);
    await mount();
    fireEvent.click(document.querySelector('[data-vd-filter="void"]')!);
    fireEvent.click(screen.getByRole('button', { name: /Print/ }));
    expect(open).toHaveBeenCalled();
    const html = String(doc.write.mock.calls[0][0]);
    expect(html).toContain('Void bills');
    expect(html).toContain('<th>Status</th>');
    expect(html).toContain('Customer left'); expect(html).toContain('Wrong table'); expect(html).not.toContain('Duplicate order');
    expect(print).toHaveBeenCalled();
    open.mockRestore();
  });

  it('no exits at all: it says so, and Print is off', async () => {
    const data = JSON.parse(localStorage.getItem('desi-pos-data')!); data.orders = [bill(1, 'paid', 100)];
    localStorage.setItem('desi-pos-data', JSON.stringify(data)); reload();
    await mount();
    expect(document.querySelector('[data-vd-empty]')!.textContent).toBe('No void, complimentary or cancelled bills yet.');
    expect(screen.getByRole('button', { name: /Print/ })).toBeDisabled();
  });
});

describe('every other look', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/void-bills'; seed(); });
  afterEach(() => cleanup());
  it('keeps the page: the three totals and the tabs', async () => {
    setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(document.querySelector('[data-vd-page]')).toBeNull();
    expect(screen.getByRole('tab', { name: /Void \(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Complimentary \(1\)/ })).toBeInTheDocument();
  });
});

describe('the stylesheet', () => {
  it('is imported and every rule is scoped to DT Refined', () => {
    const css = read('src/styles/ui-refined-voids.css');
    expect(read('src/styles.css')).toContain('ui-refined-voids.css');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
});
