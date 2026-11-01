// v1.80.0 — the numbers behind the Owner Overview dashboard.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  periodWindows, pctChange, totalsIn, sparkSeries, rateBuckets, peakBucket, typeShares, statusPill, recentRows, deliveryPoints,
  resolveDashboardLayout, setDashboardLayout, DASHBOARD_LAYOUT_KEY, orderTime,
} from '@/lib/dashboardOverview';
import type { MenuItem, Order, Transaction } from '@/lib/types';

// Wednesday 4 Nov 2026, 15:30 local
const NOW = new Date(2026, 10, 4, 15, 30, 0).getTime();
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

const order = (o: Partial<Order> = {}): Order => ({
  id: Math.random().toString(36).slice(2), orderNumber: 1, orderType: 'dining', status: 'paid', paymentMethod: 'cash',
  items: [{ id: 'i', menuItemId: 'm1', name: 'Karahi', quantity: 1, lineTotal: 1000 } as any],
  subtotal: 1000, discount: 0, tax: 0, serviceCharge: 0, grandTotal: 1000, createdAt: at(2026, 11, 4, 12), paidAt: at(2026, 11, 4, 12), ...o,
} as Order);
const expense = (amount: number, date: string): Transaction => ({ id: date + amount, date, type: 'expense', categoryId: 'c', categoryName: 'Gas', amount, paymentMethod: 'cash', description: '' } as Transaction);

describe('periods', () => {
  it('Today compares midnight→now with yesterday midnight→the same clock time', () => {
    const w = periodWindows(1, NOW);
    expect(w.bucket).toBe('hour');
    expect(new Date(w.cur.start).getHours()).toBe(0);
    expect(w.cur.end).toBe(NOW);
    expect(w.prev.end - w.prev.start).toBe(w.cur.end - w.cur.start);
    expect(new Date(w.prev.start).getDate()).toBe(3);
  });
  it('7 days is the last 7 calendar days including today, against the 7 before', () => {
    const w = periodWindows(7, NOW);
    expect(w.bucket).toBe('day');
    expect(new Date(w.cur.start).getDate()).toBe(29); // 29 Oct … 4 Nov
    expect(w.prev.end).toBe(w.cur.start);
    expect(new Date(w.prev.start).getDate()).toBe(22);
  });
  it('30 days is the same shape', () => {
    const w = periodWindows(30, NOW);
    expect(w.prev.end).toBe(w.cur.start);
    expect(Math.round((w.cur.start - w.prev.start) / 86400000)).toBe(30);
  });
});

describe('change against the period before', () => {
  it('percent, one decimal', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(80, 100)).toBe(-20);
    expect(pctChange(103, 100)).toBe(3);
    expect(pctChange(1, 3)).toBe(-66.7);
  });
  it('nothing before is "no comparison", not infinity', () => {
    expect(pctChange(500, 0)).toBeNull();
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(NaN, 1)).toBeNull();
  });
  it('a fall from a negative base is measured against its size', () => {
    expect(pctChange(-50, -100)).toBe(50);
  });
});

describe('totals', () => {
  const orders = [
    order({ grandTotal: 1000, paidAt: at(2026, 11, 4, 9) }),
    order({ grandTotal: 2000, paidAt: at(2026, 11, 4, 11) }),
    order({ grandTotal: 500, paidAt: at(2026, 11, 3, 10) }),                 // yesterday morning
    order({ grandTotal: 9999, status: 'void' as any, paidAt: at(2026, 11, 4, 10) }),
    order({ grandTotal: 7777, status: 'running' as any, paidAt: undefined, createdAt: at(2026, 11, 4, 10) }),
    order({ grandTotal: 4444, paymentMethod: 'credit', paidAt: at(2026, 11, 4, 10) }), // credit: not a paid sale
  ];
  const tx = [expense(300, at(2026, 11, 4, 8)), expense(100, at(2026, 11, 3, 8)), { ...expense(999, at(2026, 11, 4, 8)), type: 'income' } as Transaction];

  it('counts only paid sales and expenses in the window', () => {
    const w = periodWindows(1, NOW);
    expect(totalsIn(orders, tx, w.cur)).toEqual({ sales: 3000, orders: 2, avg: 1500, expenses: 300, profit: 2700 });
    expect(totalsIn(orders, tx, w.prev)).toEqual({ sales: 500, orders: 1, avg: 500, expenses: 100, profit: 400 });
  });
  it('the sparkline adds back up to the total', () => {
    const w = periodWindows(7, NOW);
    const o = [order({ grandTotal: 100, paidAt: at(2026, 11, 4, 10) }), order({ grandTotal: 300, paidAt: at(2026, 11, 1, 10) })];
    const s = sparkSeries(o, [], w.cur, 'day', 'sales');
    expect(s).toHaveLength(7);
    expect(s.reduce((a, b) => a + b, 0)).toBe(400);
    expect(s[s.length - 1]).toBe(100);
    expect(sparkSeries(o, [], w.cur, 'day', 'orders').reduce((a, b) => a + b, 0)).toBe(2);
  });
  it('Today is drawn hour by hour', () => {
    const w = periodWindows(1, NOW);
    const s = sparkSeries([order({ grandTotal: 700, paidAt: at(2026, 11, 4, 9, 20) })], [], w.cur, 'hour', 'sales');
    expect(s).toHaveLength(16); // 00:00 … 15:30
    expect(s[9]).toBe(700);
  });
  it('profit per bucket is sales minus that bucket\'s expenses', () => {
    const w = periodWindows(7, NOW);
    const s = sparkSeries([order({ grandTotal: 1000, paidAt: at(2026, 11, 4, 10) })], [expense(250, at(2026, 11, 4, 9))], w.cur, 'day', 'profit');
    expect(s[s.length - 1]).toBe(750);
  });
  it('average per bucket is zero on a quiet day, never NaN', () => {
    const w = periodWindows(7, NOW);
    const s = sparkSeries([], [], w.cur, 'day', 'avg');
    expect(s.every(v => v === 0)).toBe(true);
  });
});

describe('order rate', () => {
  const orders = [
    order({ paidAt: at(2026, 11, 4, 10) }), order({ paidAt: at(2026, 11, 4, 13) }), order({ paidAt: at(2026, 11, 2, 10) }),
    order({ paidAt: at(2026, 9, 10, 10) }), order({ paidAt: at(2025, 12, 20, 10) }), order({ paidAt: at(2024, 6, 1, 10) }),
    order({ paidAt: at(2020, 1, 1, 10) }),                              // too old for any view
    order({ paidAt: at(2026, 11, 4, 10), status: 'void' as any }),
  ];
  it('weekly: seven days ending today, the newest on the right', () => {
    const b = rateBuckets(orders, 'weekly', NOW);
    expect(b).toHaveLength(7);
    expect(b[6].orders).toBe(2);
    expect(b[4].orders).toBe(1); // 2 Nov
    expect(b.map(x => x.label)).toEqual(['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']);
  });
  it('monthly: twelve months ending this month, empty months kept', () => {
    const b = rateBuckets(orders, 'monthly', NOW);
    expect(b).toHaveLength(12);
    expect(b[11].label).toBe('Nov');
    expect(b[11].orders).toBe(3);
    expect(b[9].label).toBe('Sep');
    expect(b[9].orders).toBe(1);
    expect(b.find(x => x.label === 'Dec')!.orders).toBe(1);   // Dec 2025
    expect(b.filter(x => x.orders === 0).length).toBeGreaterThan(5);
  });
  it('yearly: five years ending this year', () => {
    const b = rateBuckets(orders, 'yearly', NOW);
    expect(b.map(x => x.label)).toEqual(['2022', '2023', '2024', '2025', '2026']);
    expect(b.map(x => x.orders)).toEqual([0, 0, 1, 1, 4]);
  });
  it('sales are summed with the orders', () => {
    const b = rateBuckets([order({ grandTotal: 250, paidAt: at(2026, 11, 4, 10) }), order({ grandTotal: 750, paidAt: at(2026, 11, 4, 11) })], 'weekly', NOW);
    expect(b[6]).toMatchObject({ orders: 2, sales: 1000 });
  });
  it('the peak is the busiest bucket, the latest on a tie, and none when nothing sold', () => {
    const b = rateBuckets(orders, 'monthly', NOW);
    expect(peakBucket(b)!.label).toBe('Nov');
    const tie = rateBuckets([order({ paidAt: at(2026, 10, 5, 10) }), order({ paidAt: at(2026, 11, 5, 10) })], 'monthly', NOW);
    expect(peakBucket(tie)!.label).toBe('Nov');
    expect(peakBucket(rateBuckets([], 'weekly', NOW))).toBeNull();
  });
});

describe('order types', () => {
  const w = periodWindows(7, NOW).cur;
  it('shares of sales, largest first, adding to exactly 100', () => {
    const o = [
      order({ orderType: 'dining', grandTotal: 3333 }), order({ orderType: 'delivery', grandTotal: 3333 }), order({ orderType: 'takeaway', grandTotal: 3334 }),
    ];
    const s = typeShares(o, w);
    expect(s.reduce((a, b) => a + b.pct, 0)).toBe(100);
    expect(s[0].name).toBe('Takeaway');
    expect(s.map(x => x.pct).sort()).toEqual([33, 33, 34]);
  });
  it('ignores bills outside the window and bills that are not paid sales', () => {
    const s = typeShares([order({ orderType: 'delivery', paidAt: at(2026, 8, 1) }), order({ orderType: 'dining', status: 'void' as any })], w);
    expect(s).toEqual([]);
  });
  it('a single type is 100 %', () => {
    expect(typeShares([order({ orderType: 'dining' })], w)).toMatchObject([{ name: 'Dine-in', pct: 100, orders: 1 }]);
  });
});

describe('recent orders', () => {
  const menu = [{ id: 'm1', name: 'Karahi', image: 'https://x/k.jpg' } as MenuItem];
  const orders = [
    order({ id: 'a', orderNumber: 7, paidAt: at(2026, 11, 4, 9), customer: { name: 'Bilal', phone: '0300111' } as any }),
    order({ id: 'b', orderNumber: 8, paidAt: at(2026, 11, 4, 11), status: 'running' as any, items: [{ id: 'x', menuItemId: 'zz', name: 'Naan', quantity: 2, lineTotal: 80 } as any, { id: 'y', menuItemId: 'm1', name: 'Karahi', quantity: 1, lineTotal: 1 } as any] }),
    order({ id: 'c', orderNumber: 9, paidAt: at(2026, 11, 3, 11), status: 'void' as any }),
  ];
  it('newest first, with the first item, the others counted, and the thumbnail from the menu', () => {
    const r = recentRows(orders, menu, 10);
    expect(r.map(x => x.id)).toEqual(['b', 'a', 'c']);
    expect(r[0]).toMatchObject({ code: '#8', item: 'Naan', extra: 1, image: undefined });
    expect(r[1]).toMatchObject({ item: 'Karahi', image: 'https://x/k.jpg', customer: 'Bilal' });
  });
  it('is limited', () => { expect(recentRows(orders, menu, 2)).toHaveLength(2); });
  it('searches the bill number, the customer, the phone and every item name', () => {
    expect(recentRows(orders, menu, 10, 'bilal').map(x => x.id)).toEqual(['a']);
    expect(recentRows(orders, menu, 10, '0300').map(x => x.id)).toEqual(['a']);
    expect(recentRows(orders, menu, 10, 'naan').map(x => x.id)).toEqual(['b']);
    expect(recentRows(orders, menu, 10, '#9').map(x => x.id)).toEqual(['c']);
    expect(recentRows(orders, menu, 10, 'zzz')).toEqual([]);
  });
  it('a bill with no customer is labelled by how it was served', () => {
    expect(recentRows([order({ orderType: 'takeaway' })], menu, 1)[0].customer).toBe('Takeaway');
  });
  it('status wording', () => {
    expect(statusPill('paid')).toEqual({ label: 'Completed', tone: 'success' });
    expect(statusPill('running').tone).toBe('info');
    expect(statusPill('void')).toEqual({ label: 'Voided', tone: 'danger' });
    expect(statusPill('credit_pending').label).toBe('On credit');
    expect(statusPill('something-new').tone).toBe('neutral');
  });
  it('orderTime survives a bad date', () => { expect(orderTime({ createdAt: 'nope' } as any)).toBe(0); });
});

describe('service area', () => {
  const w = periodWindows(7, NOW).cur;
  it('keeps only delivery bills with a real GPS pin', () => {
    const pts = deliveryPoints([
      order({ orderType: 'delivery', customer: { name: 'a', phone: '1', lat: 31.1, lng: 72.2 } as any }),
      order({ orderType: 'delivery', customer: { name: 'b', phone: '2' } as any }),
      order({ orderType: 'delivery', customer: { name: 'c', phone: '3', lat: 0, lng: 0 } as any }),
      order({ orderType: 'delivery', customer: { name: 'd', phone: '4', lat: 999, lng: 1 } as any }),
      order({ orderType: 'dining', customer: { name: 'e', phone: '5', lat: 31.2, lng: 72.3 } as any }),
      order({ orderType: 'delivery', status: 'void' as any, customer: { name: 'f', phone: '6', lat: 31.3, lng: 72.4 } as any }),
    ], w);
    expect(pts).toEqual([{ lat: 31.1, lng: 72.2 }]);
  });
});

describe('layout preference', () => {
  beforeEach(() => localStorage.clear());
  it('management gets the Overview and a cashier keeps the standard page until they choose', () => {
    expect(resolveDashboardLayout(false)).toBe('overview');
    expect(resolveDashboardLayout(true)).toBe('standard');
  });
  it('the choice is remembered, for everyone', () => {
    setDashboardLayout('standard');
    expect(resolveDashboardLayout(false)).toBe('standard');
    setDashboardLayout('overview');
    expect(resolveDashboardLayout(true)).toBe('overview');
  });
  it('a junk stored value is ignored', () => {
    localStorage.setItem(DASHBOARD_LAYOUT_KEY, 'weird');
    expect(resolveDashboardLayout(false)).toBe('overview');
  });
});
