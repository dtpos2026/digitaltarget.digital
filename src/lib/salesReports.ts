// v1.135.0 — the figures behind the design's Reports screen (SW-26): the daily bars, sales by hour / category / staff, tax, the period presets
// and "▲ 11 %" against the period before. Pure: orders in, rows out. Callers pass the PAID sales (lib/sales.ts decides what a sale is).
import type { Order } from './types';

export type PeriodPreset = 'today' | 'week' | 'month' | 'lastMonth' | 'all' | 'custom';
export const PERIODS: { key: PeriodPreset; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'week', label: 'Last 7 days' }, { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' }, { key: 'all', label: 'All time' }, { key: 'custom', label: 'Custom dates' },
];

const pad = (n: number) => String(n).padStart(2, '0');
/** YYYY-MM-DD in local time (what a date input holds). */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** The from / to (inclusive, YYYY-MM-DD) a preset means today; "all" and "custom" are left to the caller. */
export function presetRange(p: PeriodPreset, now = new Date()): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (p) {
    case 'today': return { from: dayKey(today), to: dayKey(today) };
    case 'week': return { from: dayKey(addDays(today, -6)), to: dayKey(today) };
    case 'month': return { from: dayKey(new Date(today.getFullYear(), today.getMonth(), 1)), to: dayKey(today) };
    case 'lastMonth': return { from: dayKey(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: dayKey(new Date(today.getFullYear(), today.getMonth(), 0)) };
    default: return { from: '', to: '' };
  }
}

/** The stretch of the same length just before this one — what "▲ 11 %" compares with. Null for an open-ended period. */
export function previousRange(from: string, to: string): { from: string; to: string } | null {
  if (!from || !to) return null;
  const a = parseDay(from), b = parseDay(to);
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  if (!(days > 0)) return null;
  return { from: dayKey(addDays(a, -days)), to: dayKey(addDays(a, -1)) };
}

/** Whole-number percent change; null when there is nothing to compare with. */
export function pctChange(cur: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

export const inRange = (o: Pick<Order, 'createdAt'>, from: string, to: string): boolean => {
  const t = new Date(o.createdAt).getTime();
  if (!Number.isFinite(t)) return false;
  if (from && t < parseDay(from).getTime()) return false;
  if (to && t >= addDays(parseDay(to), 1).getTime()) return false;
  return true;
};

export interface Bar { key: string; label: string; total: number; count: number }

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * One bar per day from `from` to `to` (a quiet day is a zero bar, not a gap). Up to 31 days the bars are days (a weekday for a week or two,
 * the date for longer); over that, one bar per month. With no bounds it spans the first to the last sale.
 */
export function dailySales(orders: Order[], from: string, to: string): Bar[] {
  const times = orders.map(o => new Date(o.createdAt).getTime()).filter(Number.isFinite);
  if (!from && !times.length) return [];
  const a = from ? parseDay(from) : new Date(new Date(Math.min(...times)).setHours(0, 0, 0, 0));
  const b = to ? parseDay(to) : new Date(new Date(Math.max(...times)).setHours(0, 0, 0, 0));
  const span = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  if (!(span > 0)) return [];
  const sumBy = new Map<string, { total: number; count: number }>();
  const monthly = span > 31;
  for (const o of orders) {
    const d = new Date(o.createdAt);
    if (!Number.isFinite(d.getTime())) continue;
    const k = monthly ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}` : dayKey(d);
    const cur = sumBy.get(k) || { total: 0, count: 0 };
    cur.total += Number(o.grandTotal) || 0; cur.count += 1;
    sumBy.set(k, cur);
  }
  const out: Bar[] = [];
  if (monthly) {
    for (let d = new Date(a.getFullYear(), a.getMonth(), 1); d <= b; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      out.push({ key: k, label: `${MONTH[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, ...(sumBy.get(k) || { total: 0, count: 0 }) });
    }
    return out;
  }
  for (let i = 0; i < span; i++) {
    const d = addDays(a, i);
    const k = dayKey(d);
    out.push({ key: k, label: span <= 14 ? WEEKDAY[d.getDay()] : String(d.getDate()), ...(sumBy.get(k) || { total: 0, count: 0 }) });
  }
  return out;
}

/** Sales by hour of the day, 0–23, quiet hours included as zero. */
export function salesByHour(orders: Order[]): Array<{ hour: number; label: string; count: number; total: number }> {
  const rows = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${pad(h)}:00`, count: 0, total: 0 }));
  for (const o of orders) {
    const d = new Date(o.createdAt);
    if (!Number.isFinite(d.getTime())) continue;
    rows[d.getHours()].count += 1; rows[d.getHours()].total += Number(o.grandTotal) || 0;
  }
  return rows;
}

/** Sales by category, from the lines of the bills. `categoryOf` maps a line to its category's name. */
export function salesByCategory(orders: Order[], categoryOf: (menuItemId: string | undefined, name: string) => string): Array<{ name: string; qty: number; total: number }> {
  const map = new Map<string, { name: string; qty: number; total: number }>();
  for (const o of orders) for (const it of o.items || []) {
    const name = categoryOf(it.menuItemId, it.name) || 'Uncategorised';
    const cur = map.get(name) || { name, qty: 0, total: 0 };
    cur.qty += Number(it.quantity) || 0; cur.total += Number(it.lineTotal) || 0;
    map.set(name, cur);
  }
  return [...map.values()].sort((x, y) => y.total - x.total);
}

/** Sales by the person who took the bill. */
export function staffSales(orders: Order[]): Array<{ name: string; count: number; total: number; average: number }> {
  const map = new Map<string, { name: string; count: number; total: number }>();
  for (const o of orders) {
    const name = (o.cashierName || (o as { createdByName?: string }).createdByName || '').trim() || 'Not recorded';
    const cur = map.get(name) || { name, count: 0, total: 0 };
    cur.count += 1; cur.total += Number(o.grandTotal) || 0;
    map.set(name, cur);
  }
  return [...map.values()].map(r => ({ ...r, average: r.count ? Math.round(r.total / r.count) : 0 })).sort((x, y) => y.total - x.total);
}

/** Tax and service charge, day by day, with the totals. */
export function taxByDay(orders: Order[]): { rows: Array<{ day: string; bills: number; tax: number; serviceCharge: number; total: number }>; tax: number; serviceCharge: number } {
  const map = new Map<string, { day: string; bills: number; tax: number; serviceCharge: number; total: number }>();
  let tax = 0, serviceCharge = 0;
  for (const o of orders) {
    const d = new Date(o.createdAt);
    if (!Number.isFinite(d.getTime())) continue;
    const k = dayKey(d);
    const cur = map.get(k) || { day: k, bills: 0, tax: 0, serviceCharge: 0, total: 0 };
    const t = Number(o.tax) || 0, s = Number(o.serviceCharge) || 0;
    cur.bills += 1; cur.tax += t; cur.serviceCharge += s; cur.total += Number(o.grandTotal) || 0;
    tax += t; serviceCharge += s;
    map.set(k, cur);
  }
  return { rows: [...map.values()].sort((a, b) => (a.day < b.day ? 1 : -1)), tax, serviceCharge };
}

/** "1 – 30 Oct 2026" / "21 Nov 2026" / "All time". */
export function periodLabel(from: string, to: string): string {
  if (!from && !to) return 'All time';
  const f = from ? parseDay(from) : null, t = to ? parseDay(to) : null;
  const fmt = (d: Date, withMonth = true, withYear = true) => `${d.getDate()}${withMonth ? ` ${MONTH[d.getMonth()]}` : ''}${withYear ? ` ${d.getFullYear()}` : ''}`;
  if (f && t) {
    if (dayKey(f) === dayKey(t)) return fmt(f);
    if (f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth()) return `${f.getDate()} – ${fmt(t)}`;
    return `${fmt(f)} – ${fmt(t)}`;
  }
  return f ? `From ${fmt(f)}` : `Until ${fmt(t!)}`;
}
