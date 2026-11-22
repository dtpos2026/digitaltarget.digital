// v1.135.0 — Reports Center is the design's (SW-26): a list of reports on the left, the period as a chip, four figures and the daily bars.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { dayKey } from '@/lib/salesReports';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const daysAgo = (n: number, h = 12) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const line = (id: string, menuItemId: string, name: string, quantity: number, lineTotal: number) => ({ id, menuItemId, name, quantity, price: lineTotal / quantity, lineTotal });
const sale = (o: Record<string, unknown>) => ({ status: 'paid', orderType: 'dining', subtotal: 0, discount: 0, tax: 0, serviceCharge: 0, payments: [], paymentMethod: 'cash', ...o });

function seed() {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Sample', currencySymbol: 'Rs ' },
    users: [{ id: 'a1', name: 'Owner', username: 'owner', password: 'x', role: 'admin', isActive: true }],
    categories: [{ id: 'c1', name: 'Burgers', icon: '', sortOrder: 1 }, { id: 'c2', name: 'Drinks', icon: '', sortOrder: 2 }],
    menuItems: [{ id: 'm1', name: 'Zinger', price: 650, categoryId: 'c1', pricingType: 'fixed', isActive: true }, { id: 'm2', name: 'Cola', price: 150, categoryId: 'c2', pricingType: 'fixed', isActive: true }],
    orders: [
      sale({ id: 'o1', orderNumber: 1, grandTotal: 1450, tax: 100, createdAt: daysAgo(0, 13), cashierName: 'Bilal', items: [line('l1', 'm1', 'Zinger', 2, 1300), line('l2', 'm2', 'Cola', 1, 150)] }),
      sale({ id: 'o2', orderNumber: 2, grandTotal: 650, orderType: 'delivery', paymentMethod: 'card', createdAt: daysAgo(0, 20), cashierName: 'Sana', items: [line('l3', 'm1', 'Zinger', 1, 650)] }),
      sale({ id: 'o3', orderNumber: 3, grandTotal: 300, discount: 50, createdAt: daysAgo(0, 14), items: [line('l4', 'm2', 'Cola', 2, 300)] }),
      sale({ id: 'o4', orderNumber: 4, grandTotal: 9999, createdAt: daysAgo(90), items: [] }),                       // far outside this month
      sale({ id: 'o5', orderNumber: 5, grandTotal: 400, status: 'void', createdAt: daysAgo(0, 15), items: [] }),
    ],
    tables: [], floors: [], kitchens: [], waiters: [], riders: [], inventory: [], orderCounter: 10,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Owner');
  reload();
}
const mount = async () => {
  const { default: Page } = await import('@/pages/ReportsCenterPage');
  window.location.hash = '#/reports-center';
  return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>);
};
beforeEach(() => { cleanup(); localStorage.clear(); seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
afterEach(cleanup);
const open = (c: HTMLElement, key: string) => fireEvent.click(c.querySelector(`[data-report="${key}"]`)!);

describe('the Reports screen in DT Refined', () => {
  it('opens on Sales summary for this month: the title, the period under it, four figures and the daily bars', async () => {
    const { container } = await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sales summary');
    const from = new Date(); from.setDate(1);
    expect(container.querySelector('[data-report-filters] select[aria-label="Period"]')).toHaveValue('month');
    expect([...container.querySelectorAll('[data-report-kpis] [data-kpi]')].map(k => k.getAttribute('data-kpi'))).toEqual(['Net sales', 'Bills', 'Discounts', 'Tax']);
    const kpi = (n: string) => (container.querySelector(`[data-kpi="${n}"]`) as HTMLElement).textContent!;
    expect(kpi('Bills')).toMatch(/3/);                                  // the sale 90 days ago and the void are not in this month's sales
    expect(kpi('Net sales')).toMatch(/2,400/);
    expect(kpi('Discounts')).toMatch(/50/);
    expect(kpi('Tax')).toMatch(/100/);
    expect(container.querySelector('[data-daily-bars]')).toBeTruthy();
    expect(container.querySelectorAll('[data-bar]').length).toBeGreaterThan(0);
    expect(dayKey(new Date())).toMatch(/^\d{4}-\d\d-\d\d$/);
  });

  it('the left list has the design\'s ten reports, then the ones this software already had', async () => {
    const { container } = await mount();
    const keys = [...container.querySelectorAll('[data-reports-nav] [data-report]')].map(b => b.getAttribute('data-report'));
    expect(keys.slice(0, 10)).toEqual(['summary', 'byitem', 'bycat', 'byhour', 'methods', 'types', 'staff', 'discvoid', 'tax', 'dayclose']);
    expect(keys.slice(10)).toEqual(['paid', 'accounts', 'credit', 'discount', 'catdisc', 'recovery', 'kitchen', 'kitchenkot', 'mgmtcontrol']);
    expect(container.querySelector('[data-report="summary"]')!.getAttribute('aria-current')).toBe('page');
  });

  it('Sales by item, by category, by hour, payment methods, order types, staff and tax each show their table', async () => {
    const { container } = await mount();
    const rows = () => [...container.querySelectorAll('[data-report-table] tbody tr')].map(r => [...r.querySelectorAll('td')].map(td => td.textContent));
    open(container, 'byitem');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sales by item');
    expect(rows()[0].slice(0, 3)).toEqual(['Zinger', '3', expect.stringMatching(/1,950/)]);
    open(container, 'bycat');
    expect(rows().map(r => r[0])).toEqual(['Burgers', 'Drinks']);
    open(container, 'byhour');
    expect(rows().map(r => r[0])).toEqual(['13:00', '14:00', '20:00']);
    open(container, 'methods');
    expect(rows().map(r => r[0])).toEqual(['Cash', 'Card']);
    open(container, 'types');
    expect(rows().map(r => r[0])).toEqual(['Dining', 'Delivery', 'Takeaway']);              // all three, a quiet one at zero
    open(container, 'staff');
    expect(rows().map(r => r[0])).toEqual(['Bilal', 'Sana', 'Not recorded']);
    open(container, 'tax');
    expect(rows()).toHaveLength(1);
    expect(container.textContent).toMatch(/Tax collected/);
  });

  it('Discounts & voids shows its figures and the lists; Day close points to the Day Close screen', async () => {
    const { container } = await mount();
    open(container, 'discvoid');
    expect([...container.querySelectorAll('[data-kpi]')].map(k => k.getAttribute('data-kpi'))).toEqual(['Discount given', 'Void', 'Complimentary', 'Cancelled']);
    open(container, 'dayclose');
    fireEvent.click(screen.getByRole('button', { name: 'Open Day Close' }));
    expect(window.location.hash).toBe('#/day-close');
  });

  it('the period chip, the order type and the payment method narrow every report', async () => {
    const { container } = await mount();
    fireEvent.change(screen.getByLabelText('Order type'), { target: { value: 'delivery' } });
    expect((container.querySelector('[data-kpi="Bills"]') as HTMLElement).textContent).toMatch(/1/);
    fireEvent.change(screen.getByLabelText('Order type'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'card' } });
    expect((container.querySelector('[data-kpi="Net sales"]') as HTMLElement).textContent).toMatch(/650/);
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'all' } });
    expect((container.querySelector('[data-kpi="Bills"]') as HTMLElement).textContent).toMatch(/4/);   // the old sale is in All time
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'custom' } });
    expect(screen.getByLabelText('From')).toBeInTheDocument();
  });

  it('the reports this software had before are still one click away, with their own figures strip and print', async () => {
    const { container } = await mount();
    open(container, 'paid');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Paid sales (bills)');
    expect(container.textContent).toMatch(/Paid Sales \(Credit Excluded\)/);
    expect(container.textContent).toMatch(/Credit \/ Udhaar/);                           // the six-figure strip of the old page
    expect(container.querySelector('[data-report-print]')).toBeTruthy();
    open(container, 'mgmtcontrol');
    expect(container.querySelector('[data-report-print]')).toBeNull();                   // no printer for this one
  });

  it('another look keeps the old page', async () => {
    setTheme('ember');
    const { container } = await mount();
    expect(container.querySelector('[data-reports-screen]')).toBeNull();
    expect(screen.getByRole('tab', { name: /Paid Sales/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export Full PDF/ })).toBeInTheDocument();
  });
});
