// v1.121.0 — the Owner app shows the bakery side: today's cake orders, what is going off, what was baked — the same figures as the desktop.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { HashRouter } from '@/lib/hash-router';
import type { CakeOrder } from '@/lib/cakeOrders';
import type { StockLot } from '@/lib/lots';
import type { ProductionBatch } from '@/lib/prep';
import { bakerySummary, cakeRows, expiryRows, liveLots } from '@/lib/ownerBakery';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }));
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const TODAY = '2026-11-18';
const ymd = (n: number) => { const d = new Date(TODAY + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const cake = (id: string, dueDate: string, total: number, paid: number, extra: Partial<CakeOrder> = {}): CakeOrder => ({ id, number: `CK-${id}`, createdAt: '2026-11-10T10:00:00Z', customerName: `Cust ${id}`, phone: '0300 111', description: 'Black forest', quantity: 1, dueDate, handover: 'pickup', total, payments: paid ? [{ id: 'p' + id, kind: 'advance', amount: paid, method: 'cash', at: '2026-11-11T10:00:00Z' }] : [], status: 'new', updatedAt: '2026-11-10T10:00:00Z', ...extra });
const lot = (id: string, itemId: string, remaining: number, expiryDate: string): StockLot => ({ id, inventoryItemId: itemId, itemName: itemId === 'cr' ? 'Fresh cream' : 'Dough', receivedAt: '2026-11-01', expiryDate, qty: remaining, remaining, unitCost: 100, source: 'receiving' });
const batch = (id: string, date: string, cost: number): ProductionBatch => ({ id, date, prepId: 'dg', outputItemId: 'dg', outputName: 'Dough', batches: 1, outputBaseQty: 1, outputUnit: 'kg', lines: [], totalCost: cost, unitCost: cost, createdAt: date + 'T08:00:00Z' });

describe('the numbers', () => {
  it('a restaurant that never used the bakery side has nothing to show', () => {
    expect(bakerySummary({ cakes: [], lots: [], batches: [], onHand: () => 0, today: TODAY }).used).toBe(false);
  });
  it('cakes: open, due today, overdue, what is still to collect and what is held', () => {
    const s = bakerySummary({ cakes: [cake('1', TODAY, 4000, 2000), cake('2', ymd(-1), 3000, 1000), cake('3', ymd(3), 5000, 0), cake('4', TODAY, 1000, 1000, { status: 'delivered' })], lots: [], batches: [], onHand: () => 0, today: TODAY });
    expect(s.used).toBe(true);
    expect(s.cakes).toEqual({ open: 3, dueToday: 1, overdue: 1, balance: 9000, advance: 3000 });
  });
  it('expiry counts what is really on the shelf: a lot never claims more than is in stock', () => {
    const lots = [lot('a', 'cr', 2, ymd(-2)), lot('b', 'cr', 4, ymd(2)), lot('c', 'cr', 3, ymd(9))];
    const onHand = (id: string) => (id === 'cr' ? 6 : 0);                     // 9 claimed, 6 there: the 3 missing come off the soonest-to-expire end
    const live = liveLots(lots, onHand);
    expect(live.map(l => [l.id, l.remaining])).toEqual([['b', 3], ['c', 3]]);
    const s = bakerySummary({ cakes: [], lots, batches: [], onHand, today: TODAY });
    expect(s.expiry.expired.lots).toBe(0);                                      // the expired lot is gone from the shelf already
    expect(s.expiry.soon).toEqual({ lots: 1, value: 300 });
  });
  it('batches: only today’s', () => {
    const s = bakerySummary({ cakes: [], lots: [], batches: [batch('1', TODAY, 706.88), batch('2', TODAY, 353.44), batch('3', ymd(-1), 999)], onHand: () => 0, today: TODAY });
    expect(s.batches).toEqual({ count: 2, cost: 1060.32 });
  });
  it('the cake list: open orders, soonest first, with the tag, the balance and the phone', () => {
    const r = cakeRows([cake('late', ymd(5), 100, 0), cake('soon', TODAY, 4000, 1500, { dueTime: '18:00' }), cake('done', TODAY, 10, 10, { status: 'delivered' })], TODAY);
    expect(r.map(x => x.id)).toEqual(['soon', 'late']);
    expect(r[0]).toMatchObject({ tag: 'today', balance: 2500, paid: 1500, due: `${TODAY} 18:00`, phone: '0300 111' });
    expect(r[1].tag).toBeNull();
  });
  it('the expiry list: expired and within a week, most urgent first; fine lots are left out', () => {
    const r = expiryRows([lot('x', 'cr', 2, ymd(-3)), lot('y', 'cr', 2, ymd(0)), lot('z', 'dg', 1, ymd(5)), lot('w', 'dg', 1, ymd(30))], () => 99, id => (id === 'cr' ? 'l' : 'kg'), TODAY, 7);
    expect(r.map(x => [x.id, x.status])).toEqual([['x', 'expired'], ['y', 'today'], ['z', 'soon']]);
    expect(r[0]).toMatchObject({ item: 'Fresh cream', unit: 'l', value: 200 });
  });
});

// ---------------------------------------------------------------- through the real store
const STORE_KEY = 'desi-pos-data';
const seed = (extra: Record<string, unknown> = {}) => {
  localStorage.clear();
  const today = new Date(); const y = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  localStorage.setItem(STORE_KEY, JSON.stringify({
    settings: { name: 'Butt Bakers', currencySymbol: 'Rs ' },
    users: [{ id: 'u-admin', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    branches: [], inventory: [{ id: 'cr', name: 'Fresh cream', sku: 'CR', categoryId: 'c', unit: 'l', baseUnit: 'l', quantity: 9, costPrice: 100, avgCostPrice: 100, salePrice: 0, lowStockThreshold: 2, isActive: true }],
    cakeOrders: [cake('1', y(0), 4000, 1500, { dueTime: '18:00' }), cake('2', y(-1), 3000, 1000), cake('3', y(4), 5000, 0)],
    stockLots: [lot('a', 'cr', 2, y(-2)), lot('b', 'cr', 4, y(2))], productionBatches: [batch('b1', y(0), 706.88)],
    orders: [], menuItems: [], categories: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], transactions: [], recipes: [], stockLogs: [], orderCounter: 1, ...extra,
  }));
  localStorage.setItem('pos-user-id', 'u-admin'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-tenant-plan', 'enterprise');
  window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
};
const ALL = { cakes: true, expiry: true, production: true };

describe('the Owner app block', () => {
  beforeEach(() => { cleanup(); seed(); window.location.hash = '#/owner-app'; });
  it('shows cake orders, what is going off and what was baked, with the right figures', async () => {
    const { BakeryToday } = await import('@/components/owner/OwnerBakery');
    render(<HashRouter><BakeryToday caps={ALL} /></HashRouter>);
    expect(document.querySelector('[data-testid="own-bakery-cakes-text"]')!.textContent).toBe('3 open · 1 due today · 1 overdue · Rs 9,500 to collect');
    expect(document.querySelector('[data-testid="own-bakery-expiry-text"]')!.textContent).toContain('1 within 3 days');
    expect(document.querySelector('[data-testid="own-bakery-batches"]')!.textContent).toContain('1 batch');
  });
  it('a tap opens the list', async () => {
    const { BakeryToday } = await import('@/components/owner/OwnerBakery');
    render(<HashRouter><BakeryToday caps={ALL} /></HashRouter>);
    fireEvent.click(document.querySelector('[data-testid="own-bakery-cakes"]')!);
    expect(window.location.hash).toBe('#/owner-app/cakes');
    fireEvent.click(document.querySelector('[data-testid="own-bakery-expiry"]')!);
    expect(window.location.hash).toBe('#/owner-app/expiry');
  });
  it('shows only what the account may open, and nothing at all for a restaurant that never used it', async () => {
    const { BakeryToday } = await import('@/components/owner/OwnerBakery');
    const v = render(<HashRouter><BakeryToday caps={{ cakes: true, expiry: false, production: false }} /></HashRouter>);
    expect(document.querySelector('[data-testid="own-bakery-cakes"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="own-bakery-expiry"]')).toBeNull();
    expect(document.querySelector('[data-testid="own-bakery-batches"]')).toBeNull();
    v.unmount(); cleanup();
    seed({ cakeOrders: [], stockLots: [], productionBatches: [] });
    render(<HashRouter><BakeryToday caps={ALL} /></HashRouter>);
    expect(document.querySelector('[data-testid="own-bakery"]')).toBeNull();
  });
  it('the cake list and the expiry list render the rows', async () => {
    const { OwnerCakes, OwnerExpiry } = await import('@/components/owner/OwnerBakery');
    render(<HashRouter><OwnerCakes /></HashRouter>);
    const rows = [...document.querySelectorAll('[data-testid^="own-cake-"]')].map(r => r.getAttribute('data-testid'));
    expect(rows).toEqual(['own-cake-2', 'own-cake-1', 'own-cake-3']);          // overdue, today, later
    expect(document.querySelector('[data-testid="own-cake-1"] a[href^="tel:"]')).not.toBeNull();
    cleanup();
    render(<HashRouter><OwnerExpiry /></HashRouter>);
    expect(document.querySelector('[data-testid="own-lot-b"]')!.textContent).toContain('2 d left');
    expect(document.querySelector('[data-testid="own-lot-a"]')!.textContent).toContain('Expired 2 d ago');   // 9 in stock, 6 dated: both lots are on the shelf
  });
});

describe('where it lives', () => {
  it('overview, More and the routes are wired, each behind its module’s permission', () => {
    expect(read('src/components/owner/OwnerOverview.tsx')).toContain('<BakeryToday caps={caps.bakery} />');
    const app = read('src/pages/OwnerAppPage.tsx');
    expect(app).toContain("guard(can('cake-orders'), 'Cake orders', <OwnerCakes />)");
    expect(app).toContain("guard(can('expiry'), 'Expiry', <OwnerExpiry />)");
    expect(app).toMatch(/profile\|profit\|switches\|devices\|cakes\|expiry/);
    expect(read('src/components/owner/OwnerMore.tsx')).toContain("caps.can('cake-orders')");
  });
});
