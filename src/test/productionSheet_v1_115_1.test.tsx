// v1.115.1 — the bakery's day sheet: planned, made, sold, left on the shelf, and the gap — per branch and day, a synced document.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { Order } from '@/lib/types';
import { soldOn } from '@/lib/productionPlan';
import { addItem, addMade, cleanLeftover, reconcile, setLine, sheetFromPlan, sheetId, totals } from '@/lib/productionSheet';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const items = [{ id: 'cr', name: 'Croissant', pricingType: 'fixed' }, { id: 'br', name: 'Bun', pricingType: 'fixed' }, { id: 'kg', name: 'Cheese', pricingType: 'weight' }];
let n = 0;
const order = (day: string, branchId: string, lines: [string, number][], status = 'paid') => ({ id: `o${++n}`, branchId, status, createdAt: `${day}T11:00:00`, items: lines.map(([menuItemId, quantity]) => ({ menuItemId, quantity })) }) as unknown as Order;

describe('sold on the day', () => {
  it('counts the day’s sold bills for the branch; not other days, other branches, void or weighed lines', () => {
    const orders = [
      order('2026-11-17', 'b1', [['cr', 20], ['kg', 3]]), order('2026-11-17', 'b1', [['cr', 5], ['br', 7]], 'complimentary'),
      order('2026-11-17', 'b2', [['cr', 99]]), order('2026-11-16', 'b1', [['cr', 99]]), order('2026-11-17', 'b1', [['cr', 99]], 'void'),
    ];
    const m = soldOn(orders, items, '2026-11-17', 'b1');
    expect(m.get('cr')).toBe(25);
    expect(m.get('br')).toBe(7);
    expect(m.has('kg')).toBe(false);
    expect(soldOn(orders, items, '2026-11-17').get('cr')).toBe(124);       // no branch = every branch
  });
});

describe('the sheet', () => {
  const base = sheetFromPlan('2026-11-17', 'b1', [{ itemId: 'cr', name: 'Croissant', qty: 48 }, { itemId: 'br', name: 'Bun', qty: 24 }, { itemId: 'zz', name: 'Nothing', qty: 0 }], 'Sana');
  it('starts from the plan: planned filled, nothing made, items with nothing planned left out; one id per branch and day', () => {
    expect(base.lines).toEqual([{ menuItemId: 'cr', name: 'Croissant', planned: 48, made: 0, leftover: null }, { menuItemId: 'br', name: 'Bun', planned: 24, made: 0, leftover: null }]);
    expect(base.id).toBe(sheetId('2026-11-17', 'b1'));
    expect(sheetId('2026-11-17')).toBe('main:2026-11-17');
  });
  it('trays are added one by one and never take the count below zero', () => {
    let s = addMade(base, 'cr', 12); s = addMade(s, 'cr', 12);
    expect(s.lines[0].made).toBe(24);
    expect(addMade(s, 'cr', -100).lines[0].made).toBe(0);
    expect(setLine(s, 'cr', { made: 30.9 }).lines[0].made).toBe(30);
    expect(setLine(s, 'cr', { leftover: 4 }).lines[0].leftover).toBe(4);
    expect(setLine(s, 'cr', { leftover: '' as unknown as number }).lines[0].leftover).toBeNull();
    expect(cleanLeftover('')).toBeNull();
    expect(cleanLeftover(0)).toBe(0);
  });
  it('unsold = made − sold; gap = unsold − counted on the shelf; waste % = unsold ÷ made', () => {
    let s = setLine(base, 'cr', { made: 48, leftover: 10 });
    s = setLine(s, 'br', { made: 24 });
    const rows = reconcile(s.lines, new Map([['cr', 30], ['br', 24]]));
    expect(rows[0]).toMatchObject({ sold: 30, unsold: 18, leftover: 10, gap: 8, wastePct: 37.5 });      // 8 pieces neither sold nor on the shelf
    expect(rows[1]).toMatchObject({ unsold: 0, leftover: null, gap: null, wastePct: 0 });
    expect(totals(rows)).toMatchObject({ planned: 72, made: 72, sold: 54, unsold: 18, gap: 8, counted: 1, wastePct: 25 });
  });
  it('more sold than made (yesterday’s stock) is not counted as waste', () => {
    const rows = reconcile(setLine(base, 'cr', { made: 10 }).lines, new Map([['cr', 14]]));
    expect(rows[0]).toMatchObject({ unsold: -4, wastePct: 0 });
    expect(totals(rows).unsold).toBe(0);
  });
  it('an item can be added once', () => {
    const s = addItem(base, 'new', 'Rye');
    expect(s.lines).toHaveLength(3);
    expect(addItem(s, 'new', 'Rye').lines).toHaveLength(3);
  });
});

// ---- the panel, with the store replaced
const saved: unknown[] = [];
const orders = [order('2026-11-17', 'b1', [['cr', 30], ['br', 24]]), order('2026-11-10', 'b1', [['cr', 40]])];
vi.mock('@/lib/store', () => ({
  getOrders: () => orders,
  getMenuItems: () => [{ id: 'cr', name: 'Croissant', categoryId: 'bk', pricingType: 'fixed', isActive: true }, { id: 'br', name: 'Bun', categoryId: 'bk', pricingType: 'fixed', isActive: true }],
  getBranches: () => [{ id: 'b1', name: 'Main', isActive: true, sortOrder: 1 }],
  getCurrentUser: () => ({ name: 'Sana', role: 'admin' }),
  getProductionSheets: () => [],
  saveProductionSheet: (s: unknown) => { saved.push(s); },
}));
vi.mock('@/lib/cashierScope', () => ({ scopeToBranch: (o: unknown) => o }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('Day sheet panel', () => {
  beforeEach(() => { saved.length = 0; });
  it('starts from the plan, takes trays and a shelf count, shows sold from the bills, and saves one document', async () => {
    const { default: Panel } = await import('@/components/production/ProductionSheetPanel');
    render(<Panel />);
    fireEvent.change(document.querySelector('[data-sheet-date]')!, { target: { value: '2026-11-17' } });
    expect(document.querySelector('[data-sheet-empty]')).not.toBeNull();
    fireEvent.click(document.querySelector('[data-sheet-start]')!);       // history: 2026-11-10 (the same weekday) sold 40 croissants
    const cr = within(document.querySelector('[data-sheet-row="cr"]') as HTMLElement);
    expect(cr.getByText('44')).toBeInTheDocument();                       // 40 + 10%
    fireEvent.click(document.querySelector('[data-sheet-add="cr|12"]')!);
    fireEvent.click(document.querySelector('[data-sheet-add="cr|12"]')!);
    fireEvent.click(document.querySelector('[data-sheet-add="cr|12"]')!);
    fireEvent.click(document.querySelector('[data-sheet-add="cr|12"]')!);
    expect((document.querySelector('[data-sheet-made="cr"]') as HTMLInputElement).value).toBe('48');
    // sold 30 on the 17th → unsold 18; counted 10 on the shelf → gap 8
    fireEvent.change(document.querySelector('[data-sheet-left="cr"]')!, { target: { value: '10' } });
    expect(document.querySelector('[data-sheet-row="cr"] [data-sheet-gap-cell]')?.textContent).toBe('+8');
    expect(document.querySelector('[data-sheet-gap]')?.textContent).toBe('8 pieces unaccounted');
    fireEvent.click(document.querySelector('[data-sheet-save]')!);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: 'b1:2026-11-17', date: '2026-11-17', branchId: 'b1', updatedBy: 'Sana' });
    expect((saved[0] as { lines: unknown[] }).lines[0]).toEqual({ menuItemId: 'cr', name: 'Croissant', planned: 44, made: 48, leftover: 10 });
    expect((document.querySelector('[data-sheet-save]') as HTMLButtonElement).disabled).toBe(true);     // nothing new to save
  });
});

describe('where it lives', () => {
  it('is a synced document collection like the stock transfers: no new table', () => {
    expect(read('src/lib/supabaseStore.ts')).toContain("'stockTransfers', 'branchTargets', 'productionSheets'");
    expect(read('src/lib/store.ts')).toContain("'branchTargets', 'productionSheets', 'prepRecipes', 'productionBatches', 'marketingContacts'");
    expect(read('src/lib/store.ts')).toContain("scheduleReload('productionSheets');");
    expect(read('src/lib/seed-data.ts')).toContain('productionSheets: [],');
    expect(read('src/lib/types.ts')).toContain('productionSheets: ProductionSheet[];');
  });
  it('the Production page has the two tabs, the Plan and the Day sheet', () => {
    const page = read('src/pages/ProductionPlanPage.tsx');
    expect(page).toContain('<TabsTrigger value="plan"');
    expect(page).toContain('<TabsTrigger value="sheet"');
    expect(page).toContain('<ProductionSheetPanel />');
  });
});
