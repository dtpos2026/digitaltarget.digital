// v1.117.1 — stock lots and expiry: a receipt or a batch with an expiry date opens a lot, stock leaves the soonest-to-expire lot first,
// the Expiry screen lists what is going off, and expired stock is written off as wastage.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { InventoryItem } from '@/lib/types';
import { consumeFefo, daysLeft, effectiveLots, expiredByItem, expiryStatus, fefoOrder, newLot, summarizeLots, type StockLot } from '@/lib/lots';
import { localDay } from '@/lib/productionPlan';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return localDay(d); };
const lot = (id: string, remaining: number, expiryDate: string | undefined, receivedAt = '2026-11-01', extra: Partial<StockLot> = {}): StockLot =>
  ({ id, inventoryItemId: 'cr', itemName: 'Cream', receivedAt, expiryDate, qty: remaining, remaining, unitCost: 10, source: 'receiving', ...extra });

describe('the lot rules', () => {
  it('soonest to expire first; undated after dated; ties by arrival', () => {
    const l = [lot('c', 1, undefined), lot('b', 1, '2026-12-10'), lot('a', 1, '2026-12-01'), lot('d', 1, '2026-12-01', '2026-11-05')].sort(fefoOrder);
    expect(l.map(x => x.id)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('taking stock out uses the oldest lot up first, then the next; what no lot covers is just undated stock', () => {
    const r = consumeFefo([lot('late', 5, '2026-12-20'), lot('soon', 3, '2026-12-05')], 4);
    expect(Object.fromEntries(r.changed.map(x => [x.id, x.remaining]))).toEqual({ soon: 0, late: 4 });
    expect(r.unallocated).toBe(0);
    const over = consumeFefo([lot('a', 2, '2026-12-05')], 5);
    expect(over.changed[0].remaining).toBe(0);
    expect(over.unallocated).toBe(3);
    expect(consumeFefo([], 3).unallocated).toBe(3);
  });
  it('if stock was brought down by hand, the lots shrink from the soonest-to-expire end', () => {
    const lots = [lot('soon', 3, '2026-12-05'), lot('late', 5, '2026-12-20')];
    const e = effectiveLots(lots, 6);                       // 8 claimed, 6 really there → 2 missing, taken from "soon"
    expect(Object.fromEntries(e.map(x => [x.id, x.remaining]))).toEqual({ soon: 1, late: 5 });
    expect(effectiveLots(lots, 0)).toEqual([]);
    expect(effectiveLots(lots, 100).map(x => x.remaining)).toEqual([3, 5]);
  });
  it('days left and the status: before today expired, today the last day, a week soon', () => {
    expect(daysLeft('2026-11-20', '2026-11-18')).toBe(2);
    expect(daysLeft('2026-11-17', '2026-11-18')).toBe(-1);
    expect(daysLeft(undefined, '2026-11-18')).toBeNull();
    expect(daysLeft('not a date', '2026-11-18')).toBeNull();
    expect([-1, 0, 1, 7, 8, null].map(d => expiryStatus(d as number | null))).toEqual(['expired', 'today', 'soon', 'soon', 'ok', 'none']);
    expect(daysLeft('2027-01-01', '2026-12-31')).toBe(1);                       // across a year end
  });
  it('the summary counts and values expired, last-day and soon lots', () => {
    const t = '2026-11-18';
    const s = summarizeLots([lot('x', 2, '2026-11-10'), lot('y', 1, '2026-11-18'), lot('z', 4, '2026-11-22'), lot('o', 9, '2027-01-01'), lot('n', 3, undefined), lot('gone', 0, '2026-11-01')], t, 7);
    expect(s.expired).toEqual({ lots: 1, value: 20 });
    expect(s.today).toEqual({ lots: 1, value: 10 });
    expect(s.soon).toEqual({ lots: 1, value: 40 });
    expect(s.ok).toBe(2);
  });
  it('what has expired, per item, with its value', () => {
    const m = expiredByItem([lot('x', 2, '2026-11-10'), lot('y', 1.5, '2026-11-12'), lot('z', 4, '2026-11-22')], '2026-11-18');
    expect(m.get('cr')).toEqual({ qty: 3.5, value: 35, name: 'Cream' });
  });
  it('a lot needs a quantity; a bad date is dropped, not stored', () => {
    expect(newLot({ id: 'a', inventoryItemId: 'cr', itemName: 'Cream', receivedAt: 'd', qty: 0, unitCost: 1, source: 'opening' })).toBeNull();
    expect(newLot({ id: 'a', inventoryItemId: 'cr', itemName: 'Cream', receivedAt: 'd', qty: 2, unitCost: 1, source: 'opening', expiryDate: 'soon' })!.expiryDate).toBeUndefined();
  });
});

// ---------------------------------------------------------------- through the real store
const STORE_KEY = 'desi-pos-data';
const item = (id: string, name: string, quantity: number, avg: number): InventoryItem => ({ id, name, sku: id, categoryId: 'c', unit: 'kg', baseUnit: 'kg', quantity, costPrice: avg, avgCostPrice: avg, salePrice: 0, lowStockThreholdPlaceholder: 0, lowStockThreshold: 0, isActive: true } as unknown as InventoryItem);
const seed = (lots: StockLot[] = []) => {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    settings: { name: 'Butt Bakers', currencySymbol: 'Rs ', costTrackingEnabled: true },
    users: [{ id: 'u-admin', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    branches: [], inventory: [item('cr', 'Cream', 10, 10), item('fl', 'Flour', 50, 100)], stockLogs: [], stockLots: lots, wastages: [], receivingEntries: [], parties: [], ledger: [],
    recipes: [], menuItems: [], categories: [], orders: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], transactions: [], orderCounter: 1,
  }));
  localStorage.setItem('pos-user-id', 'u-admin'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-tenant-plan', 'enterprise');
  window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
};

describe('through the real store', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); seed(); });

  it('a receipt with an expiry date opens a lot; one without opens none', async () => {
    const s = await import('@/lib/store');
    s.saveReceivingEntry({ id: 'r1', supplierName: '', inventoryItemId: 'cr', itemName: 'Cream', quantity: 5, unit: 'kg', rate: 12, receivedBy: 'x', notes: '', date: new Date().toISOString(), expiryDate: day(3) });
    s.saveReceivingEntry({ id: 'r2', supplierName: '', inventoryItemId: 'fl', itemName: 'Flour', quantity: 5, unit: 'kg', rate: 100, receivedBy: 'x', notes: '', date: new Date().toISOString() });
    const lots = s.getStockLots();
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ inventoryItemId: 'cr', qty: 5, remaining: 5, expiryDate: day(3), source: 'receiving', refId: 'r1' });
    expect(s.getInventory().find(i => i.id === 'cr')!.quantity).toBe(15);        // stock moved exactly as before
  });

  it('a sale takes from the lot that expires first, and a replayed movement takes nothing more', async () => {
    seed([lot('old', 3, day(2), day(-5)), lot('new', 5, day(9), day(-1))]);
    const s = await import('@/lib/store');
    s.adjustStock('cr', 4, 'sale', 'sale', { movementId: 'sale:o1:cr:1' });
    const rem = () => Object.fromEntries(s.getStockLots().map(l => [l.id, l.remaining]));
    expect(rem()).toEqual({ old: 0, new: 4 });
    s.adjustStock('cr', 4, 'sale', 'sale', { movementId: 'sale:o1:cr:1' });         // duplicate
    expect(rem()).toEqual({ old: 0, new: 4 });
    expect(s.getInventory().find(i => i.id === 'cr')!.quantity).toBe(6);
  });

  it('stock added back, or an item without lots, changes no lot and costs nothing', async () => {
    seed([lot('old', 3, day(2))]);
    const s = await import('@/lib/store');
    s.adjustStock('cr', 4, 'in', 'in');
    s.adjustStock('fl', 5, 'sale', 'sale');
    expect(s.getStockLots()[0].remaining).toBe(3);
  });

  it('write off expired takes the expired stock out as wastage, uses the lot up, and leaves the rest alone', async () => {
    seed([lot('dead', 2, day(-3), day(-10)), lot('fine', 5, day(6), day(-1))]);
    const s = await import('@/lib/store');
    const r = s.writeOffExpired(day(0), 'Ayesha');
    expect(r).toEqual({ items: 1, value: 20 });
    const w = s.getWastages();
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ inventoryItemId: 'cr', quantity: 2, reason: 'expired', costValue: 20 });
    expect(s.getInventory().find(i => i.id === 'cr')!.quantity).toBe(8);
    expect(Object.fromEntries(s.getStockLots().map(l => [l.id, l.remaining]))).toEqual({ dead: 0, fine: 5 });
    expect(s.writeOffExpired(day(0))).toEqual({ items: 0, value: 0 });               // nothing left to write off
  });

  it('a lot cannot claim more than is on the shelf: after a count brought stock down, the soonest-to-expire part is what is missing', async () => {
    seed([lot('soon', 6, day(1)), lot('late', 6, day(10))]);             // 12 claimed, 10 in stock
    const s = await import('@/lib/store');
    const live = s.effectiveLotsByItem(s.getStockLots(), new Map(s.getInventory().map(i => [i.id, i])));
    expect(Object.fromEntries(live.map(l => [l.id, l.remaining]))).toEqual({ soon: 4, late: 6 });
  });
});

describe('the Expiry screen', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); seed([lot('dead', 2, day(-3), day(-10)), lot('soon', 1, day(2), day(-2)), lot('fine', 5, day(20), day(-1))]); });
  it('lists the lots soonest first with their status, and the summary says what is lost', async () => {
    const { default: Page } = await import('@/pages/ExpiryPage');
    render(<Page />);
    const rows = [...document.querySelectorAll('[data-lot-row]')];
    expect(rows.map(r => r.getAttribute('data-lot-row'))).toEqual(['dead', 'soon', 'fine']);
    expect(rows.map(r => r.getAttribute('data-lot-status'))).toEqual(['expired', 'soon', 'ok']);
    expect(rows[0].textContent).toContain('Expired 3 days ago');
    expect(document.querySelector('[data-expiry-expired]')!.textContent).toContain('1');
    expect(document.querySelector('[data-expiry-expired]')!.textContent).toContain('20');
  });
  it('the filters narrow the list', async () => {
    const { default: Page } = await import('@/pages/ExpiryPage');
    render(<Page />);
    fireEvent.click(document.querySelector('[data-expiry-show="expired"]')!);
    expect([...document.querySelectorAll('[data-lot-row]')].map(r => r.getAttribute('data-lot-row'))).toEqual(['dead']);
    fireEvent.click(document.querySelector('[data-expiry-show="all"]')!);
    fireEvent.change(document.querySelector('[data-expiry-search]')!, { target: { value: 'zzz' } });
    expect(document.querySelector('[data-lot-row]')).toBeNull();
  });
  it('Write off expired asks first, then does it once', async () => {
    const { default: Page } = await import('@/pages/ExpiryPage');
    const s = await import('@/lib/store');
    render(<Page />);
    fireEvent.click(document.querySelector('[data-expiry-writeoff]')!);
    expect(s.getWastages()).toHaveLength(0);                                         // nothing yet: it asked
    fireEvent.click(document.querySelector('[data-expiry-confirm-writeoff]')!);
    expect(s.getWastages()).toHaveLength(1);
    expect(document.querySelector('[data-lot-row="dead"]')).toBeNull();               // gone from the list
    expect((document.querySelector('[data-expiry-writeoff]') as HTMLButtonElement).disabled).toBe(true);
  });
  it('dating existing stock refuses more than is in stock without a date', async () => {
    const { default: Page } = await import('@/pages/ExpiryPage');
    const s = await import('@/lib/store');
    s.saveInventoryItem({ ...s.getInventory().find(i => i.id === 'fl')!, quantity: 4 });
    render(<Page />);
    fireEvent.click(document.querySelector('[data-expiry-add]')!);
    expect((document.querySelector('[data-expiry-add-save]') as HTMLButtonElement).disabled).toBe(true);   // nothing chosen yet
    expect(read('src/pages/ExpiryPage.tsx')).toContain('is in stock without a date');
  });
});

describe('where it lives', () => {
  it('Receiving takes an expiry date; the screen is in the Inventory group, routed, and a synced document collection', () => {
    expect(read('src/pages/ReceivingPage.tsx')).toContain('data-receiving-expiry');
    expect(read('src/lib/permissions.ts')).toContain("key: 'expiry', path: '/expiry'");
    expect(read('src/App.tsx')).toContain('path="/expiry"');
    expect(read('src/lib/supabaseStore.ts')).toContain("'stockLots'");
    expect(read('src/components/production/PrepPanel.tsx')).toContain('openStockLot');
  });
});
