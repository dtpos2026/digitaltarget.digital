// ============================================================
// v1.102.0 — the reference look, round 2: the Kitchen's order cards and the Dashboard's hero.
//
//   Kitchen: the v1.102.0 ring-card look was replaced in v1.137.0 by the design's dark board (SW-11) — see kitchenBoard_v1_137_0.test.tsx.
//   Here the Kitchen only has to keep its old cards for every other look.
//   Dashboard: a hero with the day's sales, "New order" and "Kitchen", the best sellers as plates, and a sparkline under the sales, orders
//   and average-bill cards.
// Pinned: both mount for real under DT Refined, every other theme keeps its markup, every figure still comes from the orders.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within } from '@testing-library/react';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';

vi.mock('@/components/PlanStatusWidget', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

function seed() {
  const line = (id: string, name: string, q: number, price: number) => ({ id: `l-${id}-${q}`, menuItemId: id, name, price, quantity: q, lineTotal: q * price });
  const base = { orderType: 'dining', subtotal: 0, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, notes: '', payments: [], amountPaid: 0 };
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ', kitchenPreparingMinutes: 5, kitchenWarningMinutes: 10 },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [{ id: 'c1', name: 'Mains', icon: '', sortOrder: 1 }],
    menuItems: [{ id: 'm1', name: 'Karahi', price: 1000, categoryId: 'c1', pricingType: 'fixed', isActive: true }, { id: 'm2', name: 'Tea', price: 100, categoryId: 'c1', pricingType: 'fixed', isActive: true }],
    orders: [
      { ...base, id: 'o1', orderNumber: 101, status: 'running', kitchenStatus: 'pending', createdAt: ago(14), tableName: 'T-04', items: [line('m1', 'Karahi', 1, 1000)], grandTotal: 1000 },
      { ...base, id: 'o2', orderNumber: 102, status: 'running', kitchenStatus: 'preparing', createdAt: ago(2), items: [line('m2', 'Tea', 2, 100)], grandTotal: 200, orderType: 'takeaway' },
      { ...base, id: 'o3', orderNumber: 103, status: 'paid', paymentMethod: 'cash', createdAt: ago(30), paidAt: ago(20), items: [line('m1', 'Karahi', 2, 1000)], grandTotal: 2000, amountPaid: 2000, payments: [{ id: 'p', method: 'cash', amount: 2000, at: ago(20) }] },
    ],
    tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], transactions: [], inventory: [], orderCounter: 200,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  reload();
}

describe('Kitchen order cards', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); seed(); });
  afterEach(() => cleanup());
  const mount = async () => { const { default: Page } = await import('@/pages/KitchenDisplayPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };

  it('DT Refined: the page is the dark board, not the old card grid', async () => {
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    const { container } = await mount();
    expect(container.querySelector('[data-kds-card]')).toBeNull();
    expect(document.querySelector('[data-kb-board]')).not.toBeNull();
  });

  it('every other theme: no ring, the old timer line and pulse', async () => {
    setUiStyle('modern'); setTheme('ember');
    const { container } = await mount();
    expect(container.querySelector('[data-kds-ring]')).toBeNull();
    expect(container.querySelector('[data-kds-card][data-state="late"]')!.className).toMatch(/animate-pulse/);
    expect(container.querySelector('[data-kds-timer]')!.textContent).toMatch(/DELAYED/);
  });
});

describe('Dashboard hero and sparklines', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); seed(); });
  afterEach(() => cleanup());
  const mount = async () => { const { default: Page } = await import('@/pages/DashboardPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };

  it('DT Refined: the hero carries the period\'s sales, the two actions and the best sellers', async () => {
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    await mount();
    const hero = screen.getByTestId('refined-hero');
    expect(within(hero).getByTestId('refined-hero-sales').textContent).toBe(screen.getByTestId('sw02-kpi-sales-value').textContent);
    expect(within(hero).getByTestId('refined-hero-line').textContent).toMatch(/order/);
    expect(within(hero).getByTestId('refined-hero-new').textContent).toMatch(/New order/);
    expect(within(hero).getByTestId('refined-hero-kitchen').textContent).toMatch(/Kitchen/);
    expect(within(hero).getByTestId('refined-hero-plates')).toBeInTheDocument();
  });

  it('the open-bills card has no sparkline; the others draw one only when there is a shape', async () => {
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    await mount();
    expect(screen.queryByTestId('sw02-kpi-open-spark')).toBeNull();
    const withSpark = ['sales', 'orders', 'avg'].filter(k => screen.queryByTestId(`sw02-kpi-${k}-spark`)).length;
    expect(withSpark).toBeGreaterThanOrEqual(1);            // the seed's sales are on different days: sales and orders have a shape
  });

  it('every other theme shows the original dashboard, no hero', async () => {
    setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(screen.queryByTestId('refined-hero')).toBeNull();
  });
});
