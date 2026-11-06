// ============================================================
// v1.86.0 — the Owner app (design package 06-owner-app: OWN-04/05/06/07/11/13/14/15) and Owner Management on the
// same figures.
//
// What is pinned:
//   • money taken / still owed / open now / void are the Owner Management rules, now in one place (lib/ownerApp.ts);
//     "still owed" no longer counts bills that are simply open on the floor;
//   • every branch gets a card (an empty one too), bills without a branch are shown apart, a branch-limited manager
//     sees only their branch;
//   • periods compare like with like; the series, splits, badges, search, timeline, menu, stock and expense rules;
//   • the screens through the real store: figures, navigation, the menu switch and price, adding an expense, low
//     stock with the supplier's phone; who may open what; and the App wiring outside the till's shell.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter, Route, Routes } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AccountCategory, Category, InventoryItem, MenuItem, Order, Party, ReceivingEntry, Transaction } from '@/lib/types';
import {
  UNASSIGNED, branchFigures, buildExpense, filterOrders, localYmd, lowStockRows, menuRows, moneySeries, monthExpenses, orderBadge,
  orderCharges, orderSubtitle, orderTimeline, orderTitle, owedOn, parsePrice, paymentSplit, pctChange, previousRange, rangeOf,
  salesReport, shares, takenOn, topItems, typeSplit,
} from '@/lib/ownerApp';
import { PAGES } from '@/lib/permissions';
import { PLANS } from '@/lib/plans';

const access = vi.hoisted(() => ({ ids: null as string[] | null, all: true }));
vi.mock('@/lib/branchAccess', () => ({
  loadBranchAccess: () => Promise.resolve(),
  authorizedBranchIds: () => access.ids,
  hasAllBranchAccess: () => access.all,
  isBranchAllowed: (id?: string | null) => !id || access.all || access.ids === null || access.ids.includes(id),
  filterAllowedBranches: <T,>(l: T[]) => l,
  resetBranchAccess: () => {},
}));
vi.mock('@/lib/restaurantIdentity', () => ({ resolveRestaurantIdentity: async () => ({ workspaceCode: 'DT-4821' }) }));

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

// Tuesday 3 Nov 2026, 15:30 local
const NOW = new Date(2026, 10, 3, 15, 30, 0);
const at = (d: number, h: number, min = 0, m = 11) => new Date(2026, m - 1, d, h, min).toISOString();
let seq = 0;
const line = (menuItemId: string, name: string, quantity: number, lineTotal: number) => ({ id: `${menuItemId}-${++seq}`, menuItemId, name, quantity, lineTotal, price: lineTotal / quantity });
const order = (o: Partial<Order> = {}): Order => {
  const n = ++seq;
  return {
    id: `o${n}`, orderNumber: 1000 + n, orderType: 'dining', status: 'paid', paymentMethod: 'cash', branchId: 'A',
    items: [line('m-karahi', 'Karahi', 1, 1000)], subtotal: 1000, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0,
    grandTotal: 1000, amountPaid: 1000, createdAt: at(3, 12), paidAt: at(3, 12), notes: '', ...o,
  } as Order;
};

// ------------------------------------------------------------------ periods
describe('periods compare like with like', () => {
  it('Today against yesterday up to the same clock time; Yesterday against the day before', () => {
    const p = previousRange('today', NOW);
    expect(p.from.getDate()).toBe(2);
    expect(p.to.getTime() - p.from.getTime()).toBe(NOW.getTime() - rangeOf('today', NOW).from.getTime());
    const y = previousRange('yesterday', NOW);
    expect([y.from.getDate(), y.to.getDate()]).toEqual([1, 1]);
  });
  it('Last 7 days against the 7 before; This month against the same days of last month; This year to the same date', () => {
    const w = previousRange('week', NOW);
    expect(w.from.getDate()).toBe(21);           // 21–27 Oct
    expect(w.to.getDate()).toBe(27);
    const m = previousRange('month', NOW);
    expect([m.from.getMonth(), m.from.getDate(), m.to.getMonth(), m.to.getDate()]).toEqual([9, 1, 9, 3]);
    const y = previousRange('year', NOW);
    expect([y.from.getFullYear(), y.to.getFullYear(), y.to.getMonth(), y.to.getDate()]).toEqual([2025, 2025, 10, 3]);
  });
  it('a month whose day does not exist last month ends on last month\'s last day', () => {
    const m = previousRange('month', new Date(2026, 2, 31, 10)); // 31 Mar → 1–28 Feb
    expect([m.to.getMonth(), m.to.getDate()]).toEqual([1, 28]);
  });
  it('percent change, and no comparison against nothing', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(10, 0)).toBeNull();
  });
});

// ------------------------------------------------------------------ money
describe('money taken and still owed', () => {
  it('a part-paid bill counts what was received as taken and the rest as owed', () => {
    const o = order({ status: 'partial', grandTotal: 3000, amountPaid: 1000 });
    expect(takenOn(o)).toBe(1000);
    expect(owedOn(o)).toBe(2000);
  });
  it('a credit bill is owed until collected', () => {
    expect(owedOn(order({ status: 'credit_pending', paymentMethod: 'credit', amountPaid: 0, grandTotal: 800 }))).toBe(800);
    expect(owedOn(order({ status: 'credit_received', paymentMethod: 'credit', amountPaid: 800, grandTotal: 800 }))).toBe(0);
  });
  it('a bill open on the floor is not owed; a paid bill an old till never stamped is not owed; a void is nothing', () => {
    expect(owedOn(order({ status: 'running', amountPaid: 0, paidAt: undefined }))).toBe(0);
    expect(owedOn(order({ status: 'paid', amountPaid: undefined }))).toBe(0);
    expect(takenOn(order({ status: 'paid', amountPaid: undefined, grandTotal: 700 }))).toBe(700);
    expect(owedOn(order({ status: 'void' }))).toBe(0);
    expect(takenOn(order({ status: 'void' }))).toBe(0);
  });
  it('shares always add to 100', () => {
    expect(shares([184200, 96500, 61300])).toEqual([54, 28, 18]);
    expect(shares([1, 1, 1]).reduce((s, x) => s + x, 0)).toBe(100);
    expect(shares([0, 0])).toEqual([0, 0]);
  });
});

// ------------------------------------------------------------------ overview
const BRANCHES = [{ id: 'A', name: 'Main Branch · Gulberg' }, { id: 'B', name: 'Johar Town' }, { id: 'C', name: 'DHA Phase 5' }];
function fleet(): Order[] {
  seq = 0;
  return [
    order({ grandTotal: 2000, amountPaid: 2000 }),
    order({ grandTotal: 1000, amountPaid: 1000, paymentMethod: 'card', orderType: 'delivery', createdAt: at(3, 13), paidAt: at(3, 13) }),
    order({ status: 'partial', grandTotal: 3000, amountPaid: 1000, createdAt: at(3, 14), paidAt: at(3, 14) }),
    order({ status: 'running', amountPaid: 0, paidAt: undefined, createdAt: at(3, 15), grandTotal: 1300 }),
    order({ status: 'running', amountPaid: 0, paidAt: undefined, createdAt: at(1, 22), grandTotal: 900 }), // open from Sunday
    order({ status: 'void', createdAt: at(3, 12, 30), paidAt: undefined }),
    order({ branchId: 'B', grandTotal: 1500, amountPaid: 1500, paymentMethod: 'online', orderType: 'takeaway' }),
    order({ branchId: 'B', status: 'credit_pending', paymentMethod: 'credit', grandTotal: 800, amountPaid: 0, paidAt: undefined }),
    order({ branchId: undefined, grandTotal: 500, amountPaid: 500 }),                                   // no branch recorded
    order({ branchId: 'Z', grandTotal: 250, amountPaid: 250 }),                                         // a deleted branch
    order({ grandTotal: 9999, amountPaid: 9999, createdAt: at(2, 12), paidAt: at(2, 12) }),             // yesterday
  ];
}

describe('overview: every branch side by side', () => {
  it('today: money taken, bills, still owed, open now and voids per branch, with the group totals', () => {
    const { rows, totals } = branchFigures(fleet(), BRANCHES, rangeOf('today', NOW), { showUnassigned: true });
    const by = Object.fromEntries(rows.map(r => [r.id, r]));
    expect(by.A).toMatchObject({ revenue: 4000, bills: 3, owed: 2000, openNow: 2, voided: 1, avgBill: 1333 });
    expect(by.B).toMatchObject({ revenue: 1500, bills: 1, owed: 800, openNow: 0, voided: 0 });
    expect(by.C).toMatchObject({ revenue: 0, bills: 0, owed: 0, share: 0 });          // an empty branch keeps its card
    expect(by[UNASSIGNED]).toMatchObject({ name: 'No branch recorded', revenue: 500, unassigned: true });
    expect(by.Z).toMatchObject({ name: 'Unknown branch', revenue: 250 });
    expect(totals).toEqual({ revenue: 6250, bills: 6, owed: 2800, openNow: 2, voided: 1 });
    expect(rows.map(r => r.id)).toEqual(['A', 'B', UNASSIGNED, 'Z', 'C']);              // by money taken
    expect(rows.reduce((s, r) => s + r.share, 0)).toBe(100);
  });
  it('a branch-limited manager sees only their branch and never the bills without one', () => {
    const { rows, totals } = branchFigures(fleet(), BRANCHES, rangeOf('today', NOW), { allowed: id => id === 'A', showUnassigned: false });
    expect(rows.map(r => r.id)).toEqual(['A']);
    expect(totals.revenue).toBe(4000);
  });
  it('open now is the floor right now, whatever the period', () => {
    const { totals } = branchFigures(fleet(), BRANCHES, rangeOf('year', NOW), { showUnassigned: true });
    expect(totals.openNow).toBe(2);
    expect(totals.revenue).toBe(6250 + 9999);
  });
});

describe('branch detail: hour by hour, payments, order types', () => {
  const a = () => fleet().filter(o => o.branchId === 'A');
  it('today is by hour, trimmed to the busy hours and at least 8 wide', () => {
    const s = moneySeries(a(), rangeOf('today', NOW));
    expect(s.length).toBeGreaterThanOrEqual(8);
    expect(s.find(p => p.label === '12')!.value).toBe(2000);
    expect(s.find(p => p.label === '14')!.value).toBe(1000); // only the part received
    expect(s.reduce((x, p) => x + p.value, 0)).toBe(4000);
  });
  it('a week is a bar per weekday; a month a bar per date; a year a bar per month', () => {
    expect(moneySeries(a(), rangeOf('week', NOW), 'week').map(p => p.label)).toEqual(['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue']);
    expect(moneySeries(a(), rangeOf('month', NOW), 'month').map(p => p.label)).toEqual(['1', '2', '3']);
    expect(moneySeries(a(), rangeOf('month', NOW)).map(p => p.label)).toEqual(['Sun', 'Mon', 'Tue']); // no preset: a short span reads as weekdays
    const y = moneySeries(a(), rangeOf('year', NOW), 'year');
    expect(y).toHaveLength(11);
    expect(y[10]).toMatchObject({ label: 'Nov', value: 4000 + 9999 });
  });
  it('the payment split divides a split bill by its payments, scaled to what it counts as taken', () => {
    const split = paymentSplit([
      order({ grandTotal: 1500, amountPaid: 1500, payments: [{ id: 'p', method: 'cash', amount: 600, at: at(3, 12) }, { id: 'q', method: 'online', amount: 1200, at: at(3, 12) }] }),
      order({ grandTotal: 1000, amountPaid: 1000, paymentMethod: 'card' }),
      order({ status: 'credit_pending', paymentMethod: 'credit', amountPaid: 0, paidAt: undefined }),
    ], rangeOf('today', NOW));
    expect(Object.fromEntries(split.map(s => [s.key, s.amount]))).toEqual({ cash: 500, online: 1000, card: 1000 });
    expect(split.reduce((s, x) => s + x.pct, 0)).toBe(100);
  });
  it('order types by money taken', () => {
    expect(typeSplit(a(), rangeOf('today', NOW)).map(t => [t.name, t.pct])).toEqual([['Dining', 75], ['Delivery', 25]]);
  });
});

// ------------------------------------------------------------------ orders
describe('orders: badges, titles, filters', () => {
  it('one word for where a bill is', () => {
    expect(orderBadge(order({ status: 'running' })).label).toBe('Running');
    expect(orderBadge(order({ status: 'running', kitchenStatus: 'preparing' })).label).toBe('Cooking');
    expect(orderBadge(order({ status: 'running', kitchenStatus: 'ready' })).label).toBe('Ready');
    expect(orderBadge(order({ status: 'running', orderType: 'delivery', deliveryStatus: 'onway' })).label).toBe('On the way');
    expect(orderBadge(order({})).label).toBe('Paid');
    expect(orderBadge(order({ status: 'partial' })).label).toBe('Partial');
    expect(orderBadge(order({ status: 'void' }))).toEqual({ label: 'Void', tone: 'danger' });
    expect(orderBadge(order({ status: 'credit_pending', paymentMethod: 'credit' })).label).toBe('On credit');
    expect(orderBadge(order({ status: 'pending_approval' })).label).toBe('Needs approval');
  });
  it('"#1042 · Dining · T-07" and "Ahmed Raza · 12:41"', () => {
    const o = order({ orderNumber: 1042, tableName: 'T-07', customer: { id: 'c', name: 'Ahmed Raza', phone: '0300', address: '' }, createdAt: at(3, 12, 41) });
    expect(orderTitle(o)).toBe('#1042 · Dining · T-07');
    expect(orderSubtitle(o)).toBe('Ahmed Raza · 12:41');
    expect(orderSubtitle(order({ orderType: 'takeaway', createdAt: at(3, 9, 5) }))).toBe('Walk-in · 09:05');
  });
  it('chips: Running is the floor (any date); the rest keep to the period; newest first', () => {
    const all = fleet();
    const today = rangeOf('today', NOW);
    expect(filterOrders(all, { chip: 'running', range: today })).toHaveLength(2);
    expect(filterOrders(all, { chip: 'void', range: today }).map(o => o.status)).toEqual(['void']);
    expect(filterOrders(all, { chip: 'delivery', range: today })).toHaveLength(1);
    expect(filterOrders(all, { chip: 'credit', range: today }).map(o => o.status).sort()).toEqual(['credit_pending', 'partial']);
    const everything = filterOrders(all, { chip: 'all', range: today });
    expect(everything.some(o => o.createdAt === at(1, 22))).toBe(true);      // an open bill from Sunday still shows
    expect(everything.some(o => o.createdAt === at(2, 12))).toBe(false);     // yesterday's paid bill does not
    const times = everything.map(o => Date.parse(o.createdAt));
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });
  it('search by number (with or without #), customer, table or item; branch filter', () => {
    const all = [order({ orderNumber: 2042, customer: { id: 'c', name: 'Sara Khan', phone: '0321', address: '' }, items: [line('m-z', 'Zinger Burger', 2, 1300)] }), order({ orderNumber: 77, branchId: 'B' })];
    const r = rangeOf('today', NOW);
    expect(filterOrders(all, { chip: 'all', query: '#2042', range: r })).toHaveLength(1);
    expect(filterOrders(all, { chip: 'all', query: 'sara', range: r })).toHaveLength(1);
    expect(filterOrders(all, { chip: 'all', query: 'zinger', range: r })).toHaveLength(1);
    expect(filterOrders(all, { chip: 'all', branchId: 'B', range: r }).map(o => o.orderNumber)).toEqual([77]);
  });
});

describe('order detail: who did what, from the stamps the bill carries', () => {
  it('placed online → approved → kitchen → ready → rider → paid, oldest first, with names', () => {
    const o = order({
      source: 'website', orderType: 'delivery', createdAt: at(3, 12, 38), approvedAt: at(3, 12, 40), approvedByName: 'Bilal',
      kotFirstPrintedAt: at(3, 12, 41), readyAt: at(3, 12, 58), riderName: 'Usman', delivery: { riderAssignedAt: at(3, 13) } as Order['delivery'],
      dispatchedAt: at(3, 13, 2), payments: [{ id: 'p', method: 'cash', amount: 2150, at: at(3, 13, 30), by: 'Bilal' }],
    });
    expect(orderTimeline(o).map(e => [e.label, e.who])).toEqual([
      ['Placed online', undefined], ['Approved', 'Bilal'], ['Sent to kitchen', undefined], ['Ready', undefined],
      ['Rider assigned', 'Usman'], ['On the way', 'Usman'], ['Paid 2,150 · Cash', 'Bilal'],
    ]);
  });
  it('a void says why and who; nothing is invented for stamps that are missing', () => {
    const o = order({ status: 'void', createdAt: at(3, 11), paidAt: undefined, voidedAt: at(3, 11, 20), voidReason: 'Customer left', voidBy: 'Manager Ali' });
    expect(orderTimeline(o).map(e => e.label)).toEqual(['Bill opened', 'Voided — Customer left']);
    expect(orderTimeline(o)[1].who).toBe('Manager Ali');
  });
  it('charges list only what applies', () => {
    expect(orderCharges(order({ discount: 100, discountTitle: 'Eid 10%', tax: 0, deliveryChargeAmount: 140 }))).toEqual([
      { label: 'Eid 10%', amount: -100 }, { label: 'Delivery fee', amount: 140 },
    ]);
  });
});

// ------------------------------------------------------------------ reports
describe('sales report', () => {
  it('this week against the 7 days before, a bar per day, the best sellers by quantity', () => {
    seq = 0;
    const orders = [
      order({ grandTotal: 3000, amountPaid: 3000, items: [line('m-t', 'Chicken Tikka Pizza', 2, 3000)] }),
      order({ grandTotal: 1300, amountPaid: 1300, createdAt: at(30, 20, 0, 10), paidAt: at(30, 20, 0, 10), items: [line('m-z', 'Zinger Burger', 2, 1300)] }),
      order({ grandTotal: 650, amountPaid: 650, createdAt: at(31, 20, 0, 10), paidAt: at(31, 20, 0, 10), items: [line('m-z', 'Zinger Burger', 1, 650)] }),
      order({ grandTotal: 4000, amountPaid: 4000, createdAt: at(25, 13, 0, 10), paidAt: at(25, 13, 0, 10) }), // the week before
      order({ status: 'void', items: [line('m-x', 'Void Item', 9, 9000)] }),
    ];
    const r = salesReport(orders, 'week', NOW, [{ id: 'm-z', name: 'Zinger Burger', image: 'data:image/png;base64,AA' } as MenuItem]);
    expect(r.total).toBe(4950);
    expect(r.bills).toBe(3);
    expect(r.prevTotal).toBe(4000);
    expect(r.pct).toBe(23.8);
    expect(r.bars).toHaveLength(7);
    expect(r.top.map(t => [t.name, t.qty, t.amount])).toEqual([['Zinger Burger', 3, 1950], ['Chicken Tikka Pizza', 2, 3000]]);
    expect(r.top[0].image).toBe('data:image/png;base64,AA');
    expect(topItems(orders, rangeOf('today', NOW), [], 1)).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ menu, stock, expenses
describe('menu, low stock and expenses rules', () => {
  const cats: Category[] = [{ id: 'burgers', name: 'Burgers', icon: '', sortOrder: 2 }, { id: 'pizza', name: 'Pizza', icon: '', sortOrder: 1 }, { id: 'old', name: 'Old', icon: '', sortOrder: 0, deleted: true }];
  const items = [
    { id: 'z', name: 'Zinger Burger', categoryId: 'burgers', pricingType: 'fixed', price: 650, isActive: true },
    { id: 't', name: 'Chicken Tikka Pizza', categoryId: 'pizza', pricingType: 'size', price: 0, isActive: true },
    { id: 'b', name: 'Beef Smash Burger', categoryId: 'burgers', pricingType: 'fixed', price: 890, isActive: false },
  ] as MenuItem[];
  it('menu rows in the menu\'s category order, searchable, filterable; sizes are not edited on the phone', () => {
    expect(menuRows(items, cats).map(r => r.name)).toEqual(['Chicken Tikka Pizza', 'Beef Smash Burger', 'Zinger Burger']);
    expect(menuRows(items, cats, { categoryId: 'burgers' }).map(r => [r.name, r.isActive])).toEqual([['Beef Smash Burger', false], ['Zinger Burger', true]]);
    expect(menuRows(items, cats, { query: 'zing' }).map(r => r.id)).toEqual(['z']);
    expect(menuRows(items, cats).find(r => r.id === 't')!.fixedPrice).toBe(false);
  });
  it('a typed price must be a positive amount', () => {
    expect(parsePrice('1,450')).toBe(1450);
    expect(parsePrice('Rs 650')).toBe(650);
    expect(parsePrice('0')).toBeNull();
    expect(parsePrice('-5')).toBeNull();
    expect(parsePrice('12abc')).toBeNull();
  });
  it('low stock: at or below the reorder level, lowest first, with the supplier who last delivered and their phone', () => {
    const inv = [
      { id: 'i1', name: 'Chicken', quantity: 4, lowStockThreshold: 20, isActive: true, unit: 'kg', baseUnit: 'kg' },
      { id: 'i2', name: 'Cooking oil', quantity: 12, lowStockThreshold: 30, isActive: true, unit: 'L' },
      { id: 'i3', name: 'Salt', quantity: 50, lowStockThreshold: 10, isActive: true, unit: 'kg' },
      { id: 'i4', name: 'Old item', quantity: 0, lowStockThreshold: 5, isActive: false, unit: 'kg' },
    ] as InventoryItem[];
    const receiving = [
      { id: 'r1', supplierName: 'Old Supplier', inventoryItemId: 'i1', itemName: 'Chicken', date: '2026-10-01' },
      { id: 'r2', supplierName: 'Al-Madina Traders', inventoryItemId: 'i1', itemName: 'Chicken', date: '2026-10-30' },
      { id: 'r3', supplierName: 'Karim Store', itemName: 'cooking oil', date: '2026-10-20' }, // legacy row, matched by name
    ] as ReceivingEntry[];
    const parties = [{ id: 'p1', type: 'supplier', name: 'Al-Madina Traders', phone: '0300-1234567' }] as Party[];
    const rows = lowStockRows(inv, receiving, parties);
    expect(rows.map(r => [r.name, r.qty, r.min])).toEqual([['Chicken', 4, 20], ['Cooking oil', 12, 30]]);
    expect(rows[0].supplier).toEqual({ name: 'Al-Madina Traders', phone: '0300-1234567' });
    expect(rows[1].supplier).toEqual({ name: 'Karim Store', phone: undefined });
    expect(rows[0].level).toBeCloseTo(0.2);
  });
  it('this month\'s expenses grouped by day, newest first, with the month total', () => {
    const tx = [
      { id: 'a', type: 'expense', date: '2026-11-03', amount: 18500, categoryName: 'Utilities', description: 'Gas cylinders' },
      { id: 'b', type: 'expense', date: '2026-11-01', amount: 92000, categoryName: 'Ingredients', description: 'Chicken' },
      { id: 'c', type: 'expense', date: '2026-11-03', amount: 6400, categoryName: 'Other', description: 'Staff meals' },
      { id: 'd', type: 'expense', date: '2026-10-31', amount: 999, categoryName: 'Other', description: 'last month' },
      { id: 'e', type: 'income', date: '2026-11-02', amount: 5000, categoryName: 'Sales', description: '' },
    ] as Transaction[];
    const m = monthExpenses(tx, NOW);
    expect(m.month).toBe('Nov 2026');
    expect(m.total).toBe(116900);
    expect(m.days.map(d => [d.label, d.total, d.rows.length])).toEqual([['3 Nov', 24900, 2], ['1 Nov', 92000, 1]]);
  });
  it('an expense is checked and saved as the same record Accounts saves', () => {
    const cats2: AccountCategory[] = [{ id: 'u', name: 'Utilities', type: 'expense' }, { id: 's', name: 'Sales', type: 'income' }];
    const ctx = { id: 'x1', createdBy: 'Owner', today: '2026-11-03' };
    expect(buildExpense({ amount: '', categoryId: 'u', note: '', date: '2026-11-03' }, cats2, ctx)).toEqual({ ok: false, error: 'Enter the amount, e.g. 1500' });
    expect(buildExpense({ amount: '500', categoryId: 's', note: '', date: '2026-11-03' }, cats2, ctx)).toEqual({ ok: false, error: 'Choose a category' });
    expect(buildExpense({ amount: '500', categoryId: 'u', note: '', date: '2026-11-04' }, cats2, ctx)).toEqual({ ok: false, error: 'The date cannot be in the future' });
    const ok = buildExpense({ amount: '18,500', categoryId: 'u', note: ' Gas cylinders ', date: '2026-11-03', paymentMethod: 'card' }, cats2, ctx);
    expect(ok).toEqual({ ok: true, txn: { id: 'x1', date: '2026-11-03', type: 'expense', categoryId: 'u', categoryName: 'Utilities', amount: 18500, paymentMethod: 'card', description: 'Gas cylinders', reference: '', partyId: '', partyName: '', createdBy: 'Owner' } });
  });
  it('the local date, not the UTC one', () => {
    expect(localYmd(new Date(2026, 10, 3, 0, 30))).toBe('2026-11-03');
  });
});

// ------------------------------------------------------------------ the screens, through the real store
const STORE_KEY = 'desi-pos-data';
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));

function seedStore(opts: { role?: 'admin' | 'manager' | 'cashier'; plan?: string; permissions?: string[] } = {}) {
  const orders = fleet();
  localStorage.setItem(STORE_KEY, JSON.stringify({
    settings: { name: 'Sample Restaurant', currencySymbol: 'Rs ', costTrackingEnabled: true },
    users: [
      { id: 'u-admin', name: 'Ayesha Khan', username: 'admin', password: 'x', role: 'admin', isActive: true },
      { id: 'u-man', name: 'Bilal', username: 'bilal', password: 'x', role: 'manager', isActive: true, ...(opts.permissions ? { permissions: opts.permissions } : {}) },
      { id: 'u-cash', name: 'Hina', username: 'hina', password: 'x', role: 'cashier', isActive: true },
    ],
    branches: BRANCHES,
    categories: [{ id: 'burgers', name: 'Burgers', icon: '', sortOrder: 1 }],
    menuItems: [
      { id: 'z', name: 'Zinger Burger', categoryId: 'burgers', pricingType: 'fixed', price: 650, isActive: true },
      { id: 'b', name: 'Beef Smash Burger', categoryId: 'burgers', pricingType: 'fixed', price: 890, isActive: true },
    ],
    orders,
    inventory: [{ id: 'i1', name: 'Chicken', quantity: 4, lowStockThreshold: 20, isActive: true, unit: 'kg', baseUnit: 'kg' }],
    receivingEntries: [{ id: 'r1', supplierName: 'Al-Madina Traders', inventoryItemId: 'i1', itemName: 'Chicken', date: '2026-10-30', quantity: 10, unit: 'kg', rate: 900, receivedBy: 'x', notes: '' }],
    parties: [{ id: 'p1', type: 'supplier', name: 'Al-Madina Traders', phone: '0300-1234567', address: '', openingBalance: 0, isActive: true }],
    transactions: [{ id: 't1', type: 'expense', date: '2026-11-02', amount: 18500, categoryId: 'u', categoryName: 'Utilities', description: 'Gas cylinders', paymentMethod: 'cash' }],
    accountCategories: [{ id: 'u', name: 'Utilities', type: 'expense' }],
    tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], orderCounter: 2000,
  }));
  const id = opts.role === 'manager' ? 'u-man' : opts.role === 'cashier' ? 'u-cash' : 'u-admin';
  localStorage.setItem('pos-user-id', id);
  localStorage.setItem('pos-user-role', opts.role || 'admin');
  localStorage.setItem('pos-tenant-plan', opts.plan || 'enterprise');
  reload();
}

async function mount(at = '/owner-app') {
  const { default: OwnerAppPage } = await import('@/pages/OwnerAppPage');
  window.location.hash = '#' + at;
  return render(
    <TooltipProvider><HashRouter><Routes><Route path="/owner-app/*" element={<OwnerAppPage onLogout={() => {}} />} /></Routes></HashRouter></TooltipProvider>,
  );
}
const hash = () => window.location.hash.replace(/^#/, '');

describe('the Owner app, rendered', () => {
  beforeEach(() => {
    cleanup(); localStorage.clear(); access.ids = null; access.all = true;
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('Overview: the five figures and every branch, the empty one too; a branch opens its detail', async () => {
    seedStore();
    await mount();
    expect(screen.getByTestId('owner-app')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sample Restaurant');
    expect(screen.getByTestId('own-kpi-revenue-value').textContent).toMatch(/6,250/);
    expect(screen.getByTestId('own-kpi-bills-value').textContent).toBe('6');
    expect(screen.getByTestId('own-kpi-owed-value').textContent).toMatch(/2,800/);
    expect(screen.getByTestId('own-kpi-open-value').textContent).toBe('2');
    expect(screen.getByTestId('own-kpi-void-value').textContent).toBe('1');
    const cards = within(screen.getByTestId('own-branches'));
    expect(cards.getByText('Main Branch · Gulberg')).toBeInTheDocument();
    expect(cards.getByText('DHA Phase 5')).toBeInTheDocument();
    expect(cards.getByText('No branch recorded')).toBeInTheDocument();
    expect(screen.getByTestId('own-branch-A').textContent).toMatch(/2 open now/);
    expect(screen.getByTestId('own-branch-A').textContent).toMatch(/64% of the business · 1 void \/ cancelled/);
    expect(screen.getByTestId('own-shortcuts').textContent).toMatch(/1 item is at or below the reorder level/);
    fireEvent.click(screen.getByTestId('own-branch-A'));
    await waitFor(() => expect(hash()).toBe('/owner-app/branch/A'));
    await waitFor(() => expect(screen.getByTestId('owner-branch')).toBeInTheDocument());
    expect(screen.getByTestId('own-branch-total').textContent).toMatch(/4,000/);
    expect(within(screen.getByTestId('own-branch-open')).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByTestId('own-branch-pay').textContent).toMatch(/Cash/);
  });

  it('Yesterday: the period changes the figures; open now stays the floor', async () => {
    seedStore();
    await mount();
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Period' })).getByRole('tab', { name: 'Yesterday' }));
    await waitFor(() => expect(screen.getByTestId('own-kpi-revenue-value').textContent).toMatch(/9,999/));
    expect(screen.getByTestId('own-kpi-open-value').textContent).toBe('2');
  });

  it('a manager limited to one branch sees only that branch', async () => {
    access.all = false; access.ids = ['A'];
    seedStore({ role: 'manager' });
    await mount();
    const cards = within(screen.getByTestId('own-branches'));
    expect(cards.getByText('Main Branch · Gulberg')).toBeInTheDocument();
    expect(cards.queryByText('Johar Town')).toBeNull();
    expect(cards.queryByText('No branch recorded')).toBeNull();
    expect(screen.getByTestId('own-kpi-revenue-value').textContent).toMatch(/4,000/);
  });

  it('Orders: chips, search, and a bill opens read-only with its timeline', async () => {
    seedStore();
    await mount('/owner-app/orders');
    const list = () => within(screen.getByTestId('own-order-list'));
    expect(list().getAllByTestId('own-order-row').length).toBe(10); // today's bills + Sunday's open one
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Status' })).getByRole('tab', { name: 'Running' }));
    await waitFor(() => expect(list().getAllByTestId('own-order-row')).toHaveLength(2));
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Status' })).getByRole('tab', { name: 'All' }));
    const partial = fleet().find(o => o.status === 'partial')!; // the same deterministic numbering as the seed
    fireEvent.change(screen.getByLabelText('Search orders'), { target: { value: `#${partial.orderNumber}` } });
    await waitFor(() => expect(list().getAllByTestId('own-order-row')).toHaveLength(1));
    fireEvent.click(list().getByTestId('own-order-row'));
    await waitFor(() => expect(screen.getByTestId('owner-order-detail')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`Order #${partial.orderNumber}`);
    expect(screen.getByTestId('own-order-total').textContent).toMatch(/3,000/);
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getByTestId('own-order-timeline').textContent).toMatch(/Bill opened/);
    expect(screen.queryByRole('button', { name: /void|refund|edit/i })).toBeNull();
  });

  it('Orders: nothing matches → a way back', async () => {
    seedStore();
    await mount('/owner-app/orders');
    fireEvent.change(screen.getByLabelText('Search orders'), { target: { value: 'nobody-by-this-name' } });
    await waitFor(() => expect(screen.getByText('No orders match')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByTestId('own-order-list')).toBeInTheDocument());
  });

  it('Menu: switching an item off saves it; a new price saves; a bad price does not', async () => {
    seedStore();
    await mount('/owner-app/menu');
    const { getMenuItems } = await import('@/lib/store');
    fireEvent.click(screen.getByRole('switch', { name: 'Beef Smash Burger available' }));
    expect(getMenuItems().find(i => i.id === 'b')!.isActive).toBe(false);
    await waitFor(() => expect(screen.getByTestId('own-menu-b').textContent).toMatch(/sold out/));
    fireEvent.click(screen.getByRole('button', { name: 'Edit the price of Zinger Burger' }));
    fireEvent.change(screen.getByLabelText('New price'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(getMenuItems().find(i => i.id === 'z')!.price).toBe(650);
    fireEvent.change(screen.getByLabelText('New price'), { target: { value: '700' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(getMenuItems().find(i => i.id === 'z')!.price).toBe(700);
  });

  it('Low stock: the item, its level and a call to the supplier who last delivered it', async () => {
    seedStore();
    await mount('/owner-app/stock');
    expect(screen.getByTestId('own-stock-banner').textContent).toMatch(/1 item is at or below the reorder level/);
    const call = screen.getByRole('link', { name: 'Call Al-Madina Traders' });
    expect(call.getAttribute('href')).toBe('tel:03001234567');
  });

  it('Expenses: the month, and adding one (a missing amount keeps the sheet open)', async () => {
    seedStore();
    await mount('/owner-app/expenses');
    expect(screen.getByTestId('own-expense-total').textContent).toMatch(/18,500/);
    fireEvent.click(screen.getByTestId('own-add-expense'));
    fireEvent.click(screen.getByTestId('own-save-expense'));
    expect(screen.getByRole('alert').textContent).toBe('Enter the amount, e.g. 1500');
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '6400' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'u' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Staff meals' } });
    fireEvent.click(screen.getByTestId('own-save-expense'));
    const { getTransactions } = await import('@/lib/store');
    const saved = getTransactions().find(t => t.description === 'Staff meals')!;
    expect(saved).toMatchObject({ type: 'expense', amount: 6400, categoryId: 'u', categoryName: 'Utilities', date: '2026-11-03', paymentMethod: 'cash', createdBy: 'Ayesha Khan' });
    await waitFor(() => expect(screen.queryByTestId('own-expense-sheet')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('own-expense-total').textContent).toMatch(/24,900/));
  });

  it('More: only what this account may open, and the workspace code', async () => {
    seedStore();
    await mount('/owner-app/more');
    expect(screen.getByText('Delivery and riders')).toBeInTheDocument();
    expect(screen.getByText('Website and app switches')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/DT-4821/)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('own-more-stock'));
    await waitFor(() => expect(hash()).toBe('/owner-app/stock'));
  });

  it('the tabs follow the permissions: a manager without the Menu module has no Menu tab', async () => {
    seedStore({ role: 'manager', permissions: ['owner-app', 'reports', 'inventory'] });
    await mount();
    expect(screen.getByTestId('own-tab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('own-tab-reports')).toBeInTheDocument();
    expect(screen.queryByTestId('own-tab-menu')).toBeNull();
  });

  it('a cashier is told the app is for owners and managers; a plan without it says so', async () => {
    seedStore({ role: 'cashier' });
    const first = await mount();
    expect(screen.getByTestId('owner-app-blocked').textContent).toMatch(/for the owner and managers/);
    first.unmount();
    seedStore({ plan: 'starter' });
    await mount();
    expect(screen.getByTestId('owner-app-blocked').textContent).toMatch(/not part of this restaurant’s plan/);
  });

  it('Reports: the week against the week before, and the best sellers', async () => {
    seedStore();
    await mount('/owner-app/reports');
    expect(screen.getByTestId('own-report-total').textContent).toMatch(/16,249/); // 6,250 today + 9,999 yesterday
    expect(within(screen.getByTestId('own-report-top')).getByText('Karahi')).toBeInTheDocument();
  });
});

describe('Owner Management on the desktop uses the same figures', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); access.ids = null; access.all = true; vi.useFakeTimers({ toFake: ['Date'], now: NOW }); });
  afterEach(() => { vi.useRealTimers(); });
  it('the five figures equal the Owner app\'s, and open bills are no longer counted as owed', async () => {
    seedStore();
    const { default: OwnerManagementPage } = await import('@/pages/OwnerManagementPage');
    window.location.hash = '#/owner';
    render(<TooltipProvider><HashRouter><OwnerManagementPage /></HashRouter></TooltipProvider>);
    expect(screen.getByTestId('owner-kpi-revenue').textContent).toMatch(/6,250/);
    expect(screen.getByTestId('owner-kpi-owed').textContent).toMatch(/2,800/);
    expect(screen.getByTestId('owner-kpi-open').textContent).toMatch(/2/);
    expect(screen.getByRole('button', { name: /Phone view/ })).toBeInTheDocument();
  });
});

describe('wiring', () => {
  it('App shows the Owner app at #/owner-app outside the till shell (no KOT printer, no kitchen timer)', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('const OwnerAppPage = lazy(() => import("@/pages/OwnerAppPage"));');
    const branch = app.indexOf(".startsWith('/owner-app')");
    const layout = app.indexOf('<AppLayout userRole={userRole} onLogout={handleLogout}>');
    expect(branch).toBeGreaterThan(0);
    expect(branch).toBeLessThan(layout);
    expect(app).toContain('<Route path="/owner-app/*" element={<OwnerAppPage onLogout={handleLogout} />} />');
  });
  it('it is a page of the permission system and part of the Business plan and up', () => {
    const p = PAGES.find(x => x.key === 'owner-app')!;
    expect(p).toMatchObject({ path: '/owner-app', defaultRoles: ['admin', 'manager'] });
    expect(PLANS.business.features).toContain('owner-app');
    expect(PLANS.premium.features).toContain('owner-app');
    expect(PLANS.starter.features).not.toContain('owner-app');
  });
  it('the DT Owner Android app opens it', () => {
    const cfg = JSON.parse(read('capacitor.owner.config.json'));
    expect(cfg).toMatchObject({ appId: 'com.digitaltarget.dtowner', appName: 'DT Owner', android: { path: 'android/Owner' } });
    // v1.109.0 — the address carries ?app=owner, so a restored WebView cannot land on the full POS (see appEntry.ts).
    expect(cfg.server.url).toBe('https://digitaltarget.digital/?app=owner#/owner-app');
  });
  it('a bill and the sales report become real PDF files to share', async () => {
    const { orderPdf, salesReportPdf } = await import('@/lib/ownerPdf');
    const head = async (b: Blob) => new TextDecoder().decode(new Uint8Array(await b.arrayBuffer()).slice(0, 5));
    const bill = await orderPdf(order({ customer: { id: 'c', name: 'Sara Khan', phone: '0321', address: '' } }), n => `Rs ${n}`);
    expect(await head(bill)).toBe('%PDF-');
    const rep = await salesReportPdf(salesReport(fleet(), 'week', NOW), 'week', n => `Rs ${n}`, 'Main Branch');
    expect(await head(rep)).toBe('%PDF-');
  });
  it('the owner screens are read-only except the menu switch, the price and expenses', () => {
    for (const f of ['src/components/owner/OwnerOverview.tsx', 'src/components/owner/OwnerOrders.tsx', 'src/components/owner/OwnerReports.tsx']) {
      const src = read(f);
      for (const w of ['saveOrder', 'saveEntity', 'deleteEntity', 'saveMenuItem', 'saveTransaction']) expect(src, `${f}: ${w}`).not.toContain(w);
    }
  });
});
