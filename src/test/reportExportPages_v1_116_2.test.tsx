// v1.116.2 — what the Print button of a real screen puts on paper is what the screen shows (the report is built from the screen's own rows).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { localDay } from '@/lib/productionPlan';

const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return localDay(d); };
const mkOrder = (n: number, date: string, branchId: string, lines: [string, number][]) => ({ id: `o${n}`, orderNumber: n, branchId, status: 'paid', createdAt: `${date}T13:00:00`, items: lines.map(([menuItemId, quantity]) => ({ id: `l${n}${menuItemId}`, menuItemId, name: menuItemId, quantity })) });
const orders = [mkOrder(1, day(-6), 'b1', [['cr', 20]]), mkOrder(2, day(-6), 'b2', [['cr', 10]]), mkOrder(3, day(-13), 'b1', [['cr', 30]]), mkOrder(4, day(-13), 'b2', [['cr', 14]])];

vi.mock('@/lib/store', () => ({
  getSettings: () => ({ name: 'Butt Bakers', paperSize: '80mm', receiptScale: 100 }),
  getOrders: () => orders,
  getMenuItems: () => [{ id: 'cr', name: 'Croissant', categoryId: 'bk', pricingType: 'fixed', isActive: true }],
  getCategories: () => [{ id: 'bk', name: 'Bakery' }, { id: 'dry', name: 'Dry goods' }],
  getBranches: () => [{ id: 'b1', name: 'Main', isActive: true, sortOrder: 1 }, { id: 'b2', name: 'DHA', isActive: true, sortOrder: 2 }],
  getInventory: () => [{ id: 'fl', name: 'Flour', sku: 'FL-1', categoryId: 'dry', unit: 'kg', baseUnit: 'kg', quantity: 50, costPrice: 100, avgCostPrice: 120, isActive: true }],
  adjustStock: vi.fn(), genId: () => 's1', getCurrentUser: () => ({ name: 'Owner', role: 'admin' }),
}));
vi.mock('@/lib/cashierScope', () => ({ scopeToBranch: (o: unknown) => o }));
vi.mock('@/lib/tenant', () => ({ getTenantId: () => 't1' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let written: string[] = [];
beforeEach(() => {
  written = []; localStorage.clear();
  window.open = vi.fn(() => ({ document: { write: (h: string) => written.push(h), close: vi.fn() }, print: vi.fn() })) as unknown as typeof window.open;
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});
afterEach(() => { document.body.innerHTML = ''; });

describe('Production plan — Print / POS', () => {
  it('two branches: one column each and the total, with the same numbers as the screen (28 + 14 = 42)', async () => {
    const { default: Page } = await import('@/pages/ProductionPlanPage');
    render(<Page />);
    fireEvent.click(document.querySelector('[data-report-print]')!);
    const html = written[0];
    expect(html).toContain('Production plan');
    for (const w of ['Croissant', '>Main<', '>DHA<', '>Total<']) expect(html).toContain(w);
    expect(html).toMatch(/<td style="text-align:right">28<\/td><td style="text-align:right">14<\/td><td style="text-align:right">42<\/td>/);
    expect(html).toContain('Average of the days the branch traded, plus 10%');
  });
  it('a change made on the screen is what prints (Main edited to 40 → total 54)', async () => {
    const { default: Page } = await import('@/pages/ProductionPlanPage');
    render(<Page />);
    fireEvent.change(document.querySelector('[data-plan-qty="cr|b1"]')!, { target: { value: '40' } });
    fireEvent.click(document.querySelector('[data-report-pos]')!);
    expect(written[0]).toContain('PRODUCTION PLAN');
    expect(written[0]).toContain('54');
  });
  it('one branch: what it sold on the earlier days, the average and what to make', async () => {
    const { default: Page } = await import('@/pages/ProductionPlanPage');
    render(<Page />);
    fireEvent.change(document.querySelector('[data-plan-branch]')!, { target: { value: 'b1' } });
    fireEvent.click(document.querySelector('[data-report-print]')!);
    expect(written[0]).toContain('20 · 30');
    expect(written[0]).toContain('<b>Branch:</b> Main');
  });
});

describe('Stock count — Print', () => {
  it('prints the counted figure, the difference and its value', async () => {
    const { default: Page } = await import('@/pages/StockCountPage');
    render(<Page />);
    fireEvent.change(document.querySelector('[data-count-input="fl"]')!, { target: { value: '47' } });
    fireEvent.click(document.querySelector('[data-report-print]')!);
    const html = written[0];
    expect(html).toContain('Stock count');
    expect(html).toContain('Flour');
    expect(html).toMatch(/>50<\/td><td style="text-align:right">47<\/td><td style="text-align:right">-3<\/td>/);
    expect(html).toContain('−Rs 360');                                                // 3 kg × 120 average cost, shown as a loss
  });
});
