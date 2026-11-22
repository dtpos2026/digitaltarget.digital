// v1.135.0 — the figures behind the Reports screen (SW-26).
import { describe, it, expect } from 'vitest';
import { dailySales, inRange, pctChange, periodLabel, presetRange, previousRange, salesByCategory, salesByHour, staffSales, taxByDay } from '@/lib/salesReports';
import type { Order } from '@/lib/types';

let n = 0;
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0).toISOString();
const order = (createdAt: string, over: Partial<Order> = {}): Order => ({
  id: `o${++n}`, orderNumber: n, orderType: 'dining', status: 'paid', items: [], subtotal: 1000, discount: 0, tax: 0, serviceCharge: 0, grandTotal: 1000, createdAt, payments: [], ...over,
} as Order);

describe('periods', () => {
  const now = new Date(2026, 10, 21, 15, 0);                       // 21 Nov 2026
  it('the presets mean what they say', () => {
    expect(presetRange('today', now)).toEqual({ from: '2026-11-21', to: '2026-11-21' });
    expect(presetRange('week', now)).toEqual({ from: '2026-11-15', to: '2026-11-21' });
    expect(presetRange('month', now)).toEqual({ from: '2026-11-01', to: '2026-11-21' });
    expect(presetRange('lastMonth', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('all', now)).toEqual({ from: '', to: '' });
  });
  it('the period before is the same length, ending the day before; an open period has none', () => {
    expect(previousRange('2026-10-01', '2026-10-31')).toEqual({ from: '2026-08-31', to: '2026-09-30' });
    expect(previousRange('2026-11-15', '2026-11-21')).toEqual({ from: '2026-11-08', to: '2026-11-14' });
    expect(previousRange('', '2026-11-21')).toBeNull();
  });
  it('percent change is whole, signed, and absent without a base', () => {
    expect(pctChange(111, 100)).toBe(11);
    expect(pctChange(80, 100)).toBe(-20);
    expect(pctChange(50, 0)).toBeNull();
  });
  it('a bill is in range from the first moment of the first day to the last of the last', () => {
    expect(inRange({ createdAt: at(2026, 10, 1, 0) }, '2026-10-01', '2026-10-31')).toBe(true);
    expect(inRange({ createdAt: new Date(2026, 9, 31, 23, 59).toISOString() }, '2026-10-01', '2026-10-31')).toBe(true);
    expect(inRange({ createdAt: at(2026, 11, 1, 0) }, '2026-10-01', '2026-10-31')).toBe(false);
    expect(inRange({ createdAt: at(2026, 9, 30) }, '2026-10-01', '2026-10-31')).toBe(false);
    expect(inRange({ createdAt: at(2026, 1, 1) }, '', '')).toBe(true);
  });
  it('labels the period for the page header', () => {
    expect(periodLabel('2026-10-01', '2026-10-30')).toBe('1 – 30 Oct 2026');
    expect(periodLabel('2026-11-21', '2026-11-21')).toBe('21 Nov 2026');
    expect(periodLabel('2026-10-28', '2026-11-03')).toBe('28 Oct 2026 – 3 Nov 2026');
    expect(periodLabel('', '')).toBe('All time');
  });
});

describe('the daily bars', () => {
  it('one bar per day with quiet days as zero, weekday names for a short period', () => {
    const bars = dailySales([order(at(2026, 11, 16), { grandTotal: 500 }), order(at(2026, 11, 16), { grandTotal: 250 }), order(at(2026, 11, 18), { grandTotal: 900 })], '2026-11-15', '2026-11-19');
    expect(bars.map(b => b.label)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
    expect(bars.map(b => b.total)).toEqual([0, 750, 0, 900, 0]);
    expect(bars.map(b => b.count)).toEqual([0, 2, 0, 1, 0]);
  });
  it('a longer period is labelled by date; over a month it becomes one bar per month', () => {
    const days = dailySales([], '2026-10-01', '2026-10-30');
    expect(days).toHaveLength(30); expect(days[0].label).toBe('1'); expect(days[29].label).toBe('30');
    const months = dailySales([order(at(2026, 9, 10), { grandTotal: 100 }), order(at(2026, 11, 2), { grandTotal: 300 })], '2026-09-01', '2026-11-30');
    expect(months.map(m => m.label)).toEqual(['Sep 26', 'Oct 26', 'Nov 26']);
    expect(months.map(m => m.total)).toEqual([100, 0, 300]);
  });
  it('with no bounds it spans the first to the last sale; with no sales and no bounds, nothing', () => {
    expect(dailySales([order(at(2026, 11, 1)), order(at(2026, 11, 3))], '', '').map(b => b.key)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(dailySales([], '', '')).toEqual([]);
  });
});

describe('the other cuts', () => {
  it('by hour: 24 rows, the sale lands in its own hour', () => {
    const rows = salesByHour([order(at(2026, 11, 1, 13), { grandTotal: 400 }), order(at(2026, 11, 2, 13), { grandTotal: 100 }), order(at(2026, 11, 2, 21), { grandTotal: 50 })]);
    expect(rows).toHaveLength(24);
    expect(rows[13]).toMatchObject({ label: '13:00', count: 2, total: 500 });
    expect(rows[21].total).toBe(50);
    expect(rows[3].count).toBe(0);
  });
  it('by category: lines are summed under their category, biggest first, unknown ones named', () => {
    const o = order(at(2026, 11, 1), { items: [
      { id: 'a', menuItemId: 'm1', name: 'Zinger', quantity: 2, lineTotal: 1300 } as any,
      { id: 'b', menuItemId: 'm2', name: 'Cola', quantity: 3, lineTotal: 450 } as any,
      { id: 'c', menuItemId: 'zz', name: 'Mystery', quantity: 1, lineTotal: 99 } as any,
    ] });
    const rows = salesByCategory([o], id => ({ m1: 'Burgers', m2: 'Drinks' } as Record<string, string>)[id || ''] || '');
    expect(rows).toEqual([{ name: 'Burgers', qty: 2, total: 1300 }, { name: 'Drinks', qty: 3, total: 450 }, { name: 'Uncategorised', qty: 1, total: 99 }]);
  });
  it('by staff: bills, total and average per person; a bill with nobody recorded is its own row', () => {
    const rows = staffSales([order(at(2026, 11, 1), { cashierName: 'Bilal', grandTotal: 1000 }), order(at(2026, 11, 1), { cashierName: 'Bilal', grandTotal: 500 }), order(at(2026, 11, 1), { grandTotal: 200 })]);
    expect(rows[0]).toEqual({ name: 'Bilal', count: 2, total: 1500, average: 750 });
    expect(rows[1].name).toBe('Not recorded');
  });
  it('tax: per day, newest first, with the totals', () => {
    const t = taxByDay([order(at(2026, 11, 1), { tax: 160, serviceCharge: 50 }), order(at(2026, 11, 1), { tax: 80 }), order(at(2026, 11, 3), { tax: 32, serviceCharge: 10 })]);
    expect(t.rows.map(r => r.day)).toEqual(['2026-11-03', '2026-11-01']);
    expect(t.rows[1]).toMatchObject({ bills: 2, tax: 240, serviceCharge: 50 });
    expect(t.tax).toBe(272); expect(t.serviceCharge).toBe(60);
  });
});
