// v1.115.0 — the Production Plan page: suggested numbers, per-branch columns for the central bakery, editing, sharing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { localDay } from '@/lib/productionPlan';

const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return localDay(d); };
const mkOrder = (n: number, date: string, branchId: string, lines: [string, number][]) => ({ id: `o${n}`, orderNumber: n, branchId, status: 'paid', createdAt: `${date}T13:00:00`, items: lines.map(([menuItemId, quantity]) => ({ id: `l${n}${menuItemId}`, menuItemId, name: menuItemId, quantity })) });

// tomorrow is the planned day: its weekday is 7 / 14 days back
const orders = [
  mkOrder(1, day(-6), 'b1', [['cr', 20], ['lt', 30]]), mkOrder(2, day(-6), 'b2', [['cr', 10]]),
  mkOrder(3, day(-13), 'b1', [['cr', 30]]), mkOrder(4, day(-13), 'b2', [['cr', 14]]),
];
vi.mock('@/lib/store', () => ({
  getOrders: () => orders,
  getMenuItems: () => [{ id: 'cr', name: 'Croissant', categoryId: 'bk', pricingType: 'fixed', isActive: true }, { id: 'lt', name: 'Latte', categoryId: 'cf', pricingType: 'fixed', isActive: true }],
  getCategories: () => [{ id: 'bk', name: 'Bakery' }, { id: 'cf', name: 'Coffee' }],
  getBranches: () => [{ id: 'b1', name: 'Main', isActive: true, sortOrder: 1 }, { id: 'b2', name: 'DHA', isActive: true, sortOrder: 2 }],
}));
vi.mock('@/lib/cashierScope', () => ({ scopeToBranch: (o: unknown) => o }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ProductionPlanPage from '@/pages/ProductionPlanPage';

beforeEach(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true }); });
afterEach(() => { document.body.innerHTML = ''; });

describe('Production Plan page', () => {
  it('with two branches it opens with one column each and a total, from each branch’s own history', () => {
    render(<ProductionPlanPage />);
    const row = within(document.querySelector('[data-plan-row="cr"]') as HTMLElement);
    // Main: (20+30)/2 = 25 → +10% = 28 ; DHA: (10+14)/2 = 12 → +10% = 14 ; total 42
    expect((document.querySelector('[data-plan-qty="cr|b1"]') as HTMLInputElement).value).toBe('28');
    expect((document.querySelector('[data-plan-qty="cr|b2"]') as HTMLInputElement).value).toBe('14');
    expect(document.querySelector('[data-plan-row="cr"] [data-plan-row-total]')?.textContent).toBe('42');
    expect(row.getByText('Croissant')).toBeInTheDocument();
  });
  it('a figure can be changed; the total follows; "back to the suggested numbers" undoes it', () => {
    render(<ProductionPlanPage />);
    fireEvent.change(document.querySelector('[data-plan-qty="cr|b2"]')!, { target: { value: '20' } });
    expect(document.querySelector('[data-plan-row="cr"] [data-plan-row-total]')?.textContent).toBe('48');
    fireEvent.click(document.querySelector('[data-plan-reset]')!);
    expect(document.querySelector('[data-plan-row="cr"] [data-plan-row-total]')?.textContent).toBe('42');
  });
  it('one branch shows what it sold on each of the earlier days and its average', () => {
    render(<ProductionPlanPage />);
    fireEvent.change(document.querySelector('[data-plan-branch]')!, { target: { value: 'b1' } });
    const row = document.querySelector('[data-plan-row="cr"]') as HTMLElement;
    expect(row.textContent).toContain('20');         // sold 6 days before
    expect(row.textContent).toContain('30');
    expect((document.querySelector('[data-plan-qty="cr|b1"]') as HTMLInputElement).value).toBe('28');
  });
  it('limiting to Bakery leaves the coffee out; trays of 12 round up', () => {
    render(<ProductionPlanPage />);
    fireEvent.change(document.querySelector('[data-plan-branch]')!, { target: { value: 'b1' } });
    expect(document.querySelector('[data-plan-row="lt"]')).not.toBeNull();
    fireEvent.click(within(document.querySelector('[data-plan-cats]') as HTMLElement).getByRole('button', { name: 'Bakery' }));
    expect(document.querySelector('[data-plan-row="lt"]')).toBeNull();
    fireEvent.change(document.querySelector('[data-plan-batch]')!, { target: { value: '12' } });
    expect((document.querySelector('[data-plan-qty="cr|b1"]') as HTMLInputElement).value).toBe('36');   // 28 → 36
  });
  it('Copy puts the plan on the clipboard as text, with the branch split', async () => {
    render(<ProductionPlanPage />);
    fireEvent.click(document.querySelector('[data-plan-copy]')!);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const text = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text).toContain('Production plan —');
    expect(text).toContain('Croissant — 42 (Main 28 · DHA 14)');
    expect((document.querySelector('[data-plan-whatsapp]') as HTMLAnchorElement).href).toContain('https://wa.me/?text=');
  });
  it('a day with no history says so instead of inventing numbers', () => {
    render(<ProductionPlanPage />);
    fireEvent.change(document.querySelector('[data-plan-date]')!, { target: { value: '2031-01-01' } });
    expect(document.querySelector('[data-plan-empty]')).not.toBeNull();
    expect((document.querySelector('[data-plan-copy]') as HTMLButtonElement).disabled).toBe(true);
  });
});
