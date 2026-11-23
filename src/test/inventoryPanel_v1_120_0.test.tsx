// v1.120.0 — Inventory in the master-detail layout: tap an item and see what its stock means (how long it lasts, where it is used, what moved)
// beside the list; the buttons that were on the row work as before.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import type { InventoryItem, MenuItem, Recipe, StockLog } from '@/lib/types';
import type { PrepRecipe } from '@/lib/prep';
import { coverDays, recentMovements, stockStatus, stockValue, usagePerDay, whereUsed } from '@/lib/inventoryPanel';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }));
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const NOW = new Date('2026-11-18T12:00:00');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const log = (id: string, itemId: string, type: StockLog['type'], quantity: number, ago: number, note = ''): StockLog => ({ id, inventoryItemId: itemId, type, quantity, note, date: daysAgo(ago) });
const item = (id: string, name: string, quantity: number, extra: Partial<InventoryItem> = {}): InventoryItem => ({ id, name, sku: id.toUpperCase(), categoryId: 'c1', unit: 'kg', baseUnit: 'kg', quantity, costPrice: 100, avgCostPrice: 120, salePrice: 0, lowStockThreshold: 5, isActive: true, ...extra } as InventoryItem);

describe('the numbers', () => {
  it('status: out at zero, low at or under the reorder level, otherwise fine', () => {
    expect([0, 3, 5, 6].map(q => stockStatus({ quantity: q, lowStockThreshold: 5 }))).toEqual(['out', 'low', 'low', 'ok']);
  });
  it('what it is worth: quantity × average cost, falling back to the last cost', () => {
    expect(stockValue(item('a', 'A', 10))).toBe(1200);
    expect(stockValue(item('a', 'A', 10, { avgCostPrice: undefined }))).toBe(1000);
  });
  it('use per day counts sales and stock-outs in the window, not receipts, counts or older movements', () => {
    const logs = [log('1', 'a', 'sale', 7, 2), log('2', 'a', 'out', 7, 5), log('3', 'a', 'in', 100, 1), log('4', 'a', 'adjustment', -9, 1), log('5', 'a', 'sale', 50, 30), log('6', 'b', 'sale', 99, 1)];
    expect(usagePerDay(logs, 'a', NOW, 14)).toBe(1);                              // (7 + 7) / 14
  });
  it('how long it lasts: stock ÷ use; nothing promised when it is not used; zero when it is already out', () => {
    expect(coverDays(10, 2)).toBe(5);
    expect(coverDays(10, 0)).toBeNull();
    expect(coverDays(0, 2)).toBe(0);
  });
  it('where it is used: menu recipes (with the size) and prep recipes, sorted', () => {
    const recipes: Recipe[] = [
      { id: 'r1', menuItemId: 'm2', components: [{ inventoryItemId: 'a', quantity: 200, unit: 'g' }] },
      { id: 'r2', menuItemId: 'm1', variantKey: 'size:Large', components: [{ inventoryItemId: 'a', quantity: 50, unit: 'g' }, { inventoryItemId: 'z', quantity: 1, unit: 'kg' }] },
      { id: 'r3', menuItemId: 'm3', components: [{ inventoryItemId: 'z', quantity: 1, unit: 'kg' }] },
    ];
    const preps = [{ id: 'dg', outputItemId: 'dg', yieldQty: 1, yieldUnit: 'kg', updatedAt: '', components: [{ inventoryItemId: 'a', quantity: 600, unit: 'g' }] }] as PrepRecipe[];
    const u = whereUsed('a', recipes, [{ id: 'm1', name: 'Pizza' }, { id: 'm2', name: 'Bread' }, { id: 'm3', name: 'Salad' }] as MenuItem[], preps, [{ id: 'dg', name: 'Dough' }]);
    expect(u.menu.map(m => `${m.name}${m.variant ? `/${m.variant}` : ''}`)).toEqual(['Bread', 'Pizza/Large']);
    expect(u.preps).toEqual([{ id: 'dg', name: 'Dough', qty: 600, unit: 'g' }]);
  });
  it('the latest movements of one item, newest first, at most n', () => {
    const logs = [log('1', 'a', 'in', 1, 5), log('2', 'a', 'sale', 1, 1), log('3', 'b', 'sale', 1, 0), log('4', 'a', 'out', 1, 3)];
    expect(recentMovements(logs, 'a', 2).map(l => l.id)).toEqual(['2', '4']);
  });
});

// ---------------------------------------------------------------- the screen, through the real store
const STORE_KEY = 'desi-pos-data';
const seed = () => {
  localStorage.clear();
  // the screen reads the real clock, so these movements are dated from the real "now" (a fixed date made this test fail once the 9-day-old movement left the 14-day window)
  const real = (id: string, type: StockLog['type'], quantity: number, ago: number, note: string): StockLog => ({ ...log(id, 'fl', type, quantity, 0, note), date: new Date(Date.now() - ago * 86_400_000).toISOString() });
  const logs = [real('l1', 'sale', 14, 3, 'Sale • Order #7'), real('l2', 'in', 40, 6, 'GRN'), real('l3', 'out', 14, 9, 'Stock Out')];
  localStorage.setItem(STORE_KEY, JSON.stringify({
    settings: { name: 'Butt Bakers', currencySymbol: 'Rs ', costTrackingEnabled: true },
    users: [{ id: 'u-admin', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    branches: [], categories: [{ id: 'c1', name: 'Dry goods', icon: '🌾' }],
    inventory: [item('fl', 'Flour', 20), item('sg', 'Sugar', 0)],
    stockLogs: logs, menuItems: [{ id: 'm1', name: 'Bread', categoryId: 'c1', price: 100, pricingType: 'fixed', isActive: true }],
    recipes: [{ id: 'r1', menuItemId: 'm1', components: [{ inventoryItemId: 'fl', quantity: 300, unit: 'g' }] }],
    prepRecipes: [], stockLots: [], orders: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], transactions: [], orderCounter: 1,
  }));
  localStorage.setItem('pos-user-id', 'u-admin'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-tenant-plan', 'enterprise');
  window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
};

describe('the Inventory screen', () => {
  beforeEach(() => { cleanup(); seed(); });

  it('tapping a row opens its panel: status, quantity, what it is worth, where it is used, what moved', async () => {
    const { default: Page } = await import('@/pages/InventoryPage');
    render(<Page />);
    expect(document.querySelector('[data-inventory-panel]')).toBeNull();
    fireEvent.click(document.querySelector('[data-inventory-row="fl"]')!);
    const panel = document.querySelector('[data-inventory-panel="fl"]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.querySelector('[data-panel-status]')!.getAttribute('data-panel-status')).toBe('ok');
    expect(panel.querySelector('[data-panel-qty]')!.textContent).toContain('20 kg');
    expect(panel.querySelector('[data-panel-value]')!.textContent).toContain('2,400');           // 20 × 120
    expect(panel.querySelector('[data-panel-used]')!.textContent).toContain('Bread');
    expect(panel.querySelector('[data-panel-moves]')!.textContent).toContain('GRN');
    // 14 kg sold and 14 kg out in the last 14 days (the 9-day-old out counts) = 28 / 14 = 2 per day → 20 kg lasts 10 days
    expect(panel.querySelector('[data-panel-cover]')!.textContent).toContain('10');
    expect(panel.querySelector('[data-panel-use]')!.textContent).toContain('2 kg a day');
  });

  it('an item with no stock says so, and no promise is made about how long it lasts', async () => {
    const { default: Page } = await import('@/pages/InventoryPage');
    render(<Page />);
    fireEvent.click(document.querySelector('[data-inventory-row="sg"]')!);
    const panel = document.querySelector('[data-inventory-panel="sg"]') as HTMLElement;
    expect(panel.querySelector('[data-panel-status]')!.getAttribute('data-panel-status')).toBe('out');
    expect(panel.querySelector('[data-panel-cover]')!.textContent).toBe('—');
    expect(panel.querySelector('[data-panel-used]')!.textContent).toContain('No recipe uses it yet');
  });

  it('the tick box and the row buttons do not open the panel — they do what they always did', async () => {
    const { default: Page } = await import('@/pages/InventoryPage');
    render(<Page />);
    const row = document.querySelector('[data-inventory-row="fl"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox'));
    expect(document.querySelector('[data-inventory-panel]')).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: /in/i }));
    expect(document.querySelector('[data-inventory-panel]')).toBeNull();
    expect(document.body.textContent).toContain('Stock In');                                    // the stock dialog opened
  });

  it('the panel’s own Stock in opens the same dialog', async () => {
    const { default: Page } = await import('@/pages/InventoryPage');
    render(<Page />);
    fireEvent.click(document.querySelector('[data-inventory-row="fl"]')!);
    fireEvent.click(document.querySelector('[data-panel-in]')!);
    expect(document.body.textContent).toContain('Stock In');
  });

  it('dated stock shows its first expiry in the panel', async () => {
    const s = await import('@/lib/store');
    const soon = new Date(); soon.setDate(soon.getDate() + 2);
    const ymd = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
    s.saveStockLot({ id: 'lot1', inventoryItemId: 'fl', itemName: 'Flour', receivedAt: '2026-11-10', expiryDate: ymd, qty: 5, remaining: 5, unitCost: 120, source: 'receiving' });
    const { default: Page } = await import('@/pages/InventoryPage');
    render(<Page />);
    fireEvent.click(document.querySelector('[data-inventory-row="fl"]')!);
    expect(document.querySelector('[data-panel-expiry]')!.textContent).toContain(ymd);
  });

  it('is built on MasterDetail like the other desktop screens', () => {
    const src = read('src/pages/InventoryPage.tsx');
    expect(src).toContain("import MasterDetail, { useWideScreen } from '@/components/layout/MasterDetail'");
    expect(src).toContain('<MasterDetail');
    expect(src).toContain('onClick={e => e.stopPropagation()}');
  });
});
