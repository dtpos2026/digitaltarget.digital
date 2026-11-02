// ============================================================
// SW-02 DASHBOARD — the pure part (v1.85.0)
//
// The design package's dashboard (design-project/02-restaurant-software, screen SW-02): today against the same
// weekday last week, sales for the last 7 (or 30) days, how the bills were settled, what sold, when it sold, and
// what needs someone now. It uses the same "paid sale" rule as every other screen (lib/sales.ts), so the Sales card
// here and the Sales figure in the reports never disagree. Nothing is estimated and nothing is sample data.
// ============================================================
import type { MenuItem, Order } from './types';
import { isCreditOrder, isOpen, isPaidSale } from './sales';
import { orderTime, totalsIn, type Win } from './dashboardOverview';

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (ms: number, n: number) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
const inWin = (t: number, w: Win) => t >= w.start && t < w.end;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const weekdayName = (ms: number) => WEEKDAY_LONG[new Date(ms).getDay()];

// ------------------------------------------------------------------ period and comparison
export interface Compare { cur: Win; prev: Win; vs: string; label: string }

/**
 * The period shown and the one it is compared with.
 *  - Today: midnight → end of today, against the SAME WEEKDAY last week up to the same clock time
 *    (a Tuesday is compared with a Tuesday, and a half day with a half day).
 *  - N days: the last N calendar days including today, against the N days before them.
 * The current window runs to the end of today, so a bill stamped a few seconds ahead by another till's clock still counts.
 */
export function compareWindows(days: number, nowMs: number): Compare {
  const todayStart = startOfDay(nowMs);
  const todayEnd = addDays(todayStart, 1);
  if (days <= 1) {
    const prevStart = addDays(todayStart, -7);
    return {
      cur: { start: todayStart, end: todayEnd },
      prev: { start: prevStart, end: prevStart + (nowMs - todayStart) },
      vs: `last ${WEEKDAY_SHORT[new Date(prevStart).getDay()]}`,
      label: 'today',
    };
  }
  const start = addDays(todayStart, -(days - 1));
  return { cur: { start, end: todayEnd }, prev: { start: addDays(start, -days), end: start }, vs: `the ${days} days before`, label: `last ${days} days` };
}

export interface Kpis { sales: number; orders: number; avg: number }
export const kpisIn = (orders: Order[], w: Win): Kpis => {
  const t = totalsIn(orders, [], w);
  return { sales: t.sales, orders: t.orders, avg: t.avg };
};

// ------------------------------------------------------------------ open bills (live, not period-bound)
const TYPE_WORD: Record<string, string> = { dining: 'dining', takeaway: 'takeaway', delivery: 'delivery', foodpanda: 'Foodpanda' };

/** Bills still running or on hold right now, and how they split by order type (largest first). */
export function openBills(orders: Order[]): { total: number; byType: { key: string; word: string; count: number }[] } {
  const m = new Map<string, number>();
  let total = 0;
  for (const o of orders) {
    if (!isOpen(o)) continue;
    total++;
    const k = (o.orderType as string) || 'dining';
    m.set(k, (m.get(k) || 0) + 1);
  }
  const byType = [...m.entries()].map(([key, count]) => ({ key, word: TYPE_WORD[key] || key, count })).sort((a, b) => b.count - a.count);
  return { total, byType };
}

// ------------------------------------------------------------------ sales by day
export interface DayPoint { key: string; label: string; sales: number; orders: number }

/** One point per calendar day for the last `days` days including today; a quiet day is 0, never skipped. */
export function dailySales(orders: Order[], days: number, nowMs: number): DayPoint[] {
  const today = startOfDay(nowMs);
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const s = addDays(today, -i);
    const d = new Date(s);
    out.push({
      key: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
      label: days <= 7 ? WEEKDAY_SHORT[d.getDay()] : `${d.getDate()} ${MONTHS[d.getMonth()]}`,
      sales: 0,
      orders: 0,
    });
  }
  const first = addDays(today, -(days - 1));
  const end = addDays(today, 1);
  for (const o of orders) {
    if (!isPaidSale(o)) continue;
    const t = orderTime(o);
    if (t < first || t >= end) continue;
    const d = new Date(t);
    const p = out.find(x => x.key === `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
    if (!p) continue;
    p.sales += Number(o.grandTotal || 0);
    p.orders++;
  }
  return out;
}

// ------------------------------------------------------------------ shares that add to exactly 100
/** Whole-number percentages that always add to 100 (largest-remainder rounding); all zeros when the total is 0. */
export function roundShares(values: number[]): number[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map(v => (Math.max(0, v) / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => ({ i, frac: r - floors[i] })).sort((a, b) => b.frac - a.frac);
  for (const o of order) { if (left <= 0) break; floors[o.i]++; left--; }
  return floors;
}

// ------------------------------------------------------------------ payment mix
export interface MixRow { key: string; name: string; amount: number; pct: number }
const METHOD_NAME: Record<string, string> = { cash: 'Cash', card: 'Card', online: 'Online', credit: 'Credit' };
const methodName = (k: string) => METHOD_NAME[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Other');
const NOT_A_SALE = new Set(['void', 'cancelled', 'complimentary', 'rejected', 'running', 'hold', 'pending_approval']);

/**
 * How the period's bills were settled, by amount, largest first.
 *  - A paid bill counts under its payment method; a split bill is divided by its payment entries, scaled so the
 *    bill contributes exactly its total (change handed back is not a sale).
 *  - A bill given on credit counts under "Credit" (it is not in Sales until the money is collected, as everywhere else).
 */
export function paymentMix(orders: Order[], w: Win): { rows: MixRow[]; total: number; credit: number } {
  const m = new Map<string, number>();
  const add = (k: string, v: number) => { if (v > 0) m.set(k, (m.get(k) || 0) + v); };
  for (const o of orders) {
    if (!inWin(orderTime(o), w)) continue;
    const total = Number(o.grandTotal || 0);
    if (total <= 0) continue;
    if (isPaidSale(o)) {
      const entries = (o.payments || []).filter(p => Number(p.amount) > 0);
      const sum = entries.reduce((s, p) => s + Number(p.amount), 0);
      if (entries.length && sum > 0) {
        for (const p of entries) add(String(p.method || 'cash').toLowerCase(), (Number(p.amount) / sum) * total);
      } else {
        add(String(o.paymentMethod || 'cash').toLowerCase(), total);
      }
    } else if (isCreditOrder(o) && !NOT_A_SALE.has(o.status)) {
      add('credit', total);
    }
  }
  const entries = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const pcts = roundShares(entries.map(e => e[1]));
  const rows = entries.map(([key, amount], i) => ({ key, name: methodName(key), amount: Math.round(amount), pct: pcts[i] }));
  return { rows, total: rows.reduce((s, r) => s + r.amount, 0), credit: Math.round(m.get('credit') || 0) };
}

// ------------------------------------------------------------------ top items
export interface TopItem { key: string; name: string; qty: number; sales: number; image?: string }

/** The best sellers of the period by quantity sold (ties: higher sales first), from paid bills only. */
export function topItemsByQty(orders: Order[], menu: MenuItem[], w: Win, n = 5): TopItem[] {
  const images = new Map(menu.map(x => [x.id, x.image] as const));
  const m = new Map<string, TopItem>();
  for (const o of orders) {
    if (!isPaidSale(o) || !inWin(orderTime(o), w)) continue;
    for (const it of o.items || []) {
      const key = it.menuItemId || it.name;
      const e = m.get(key) || { key, name: it.name, qty: 0, sales: 0, image: images.get(it.menuItemId) || undefined };
      e.qty += Number(it.quantity || 0);
      e.sales += Number(it.lineTotal || 0);
      m.set(key, e);
    }
  }
  return [...m.values()].filter(x => x.qty > 0).sort((a, b) => b.qty - a.qty || b.sales - a.sales || a.name.localeCompare(b.name)).slice(0, n);
}

// ------------------------------------------------------------------ orders by hour
export interface HourBar { hour: number; label: string; orders: number }
export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

/**
 * Paid bills per clock hour over the period. Trimmed to the hours that had any (plus `keep`, e.g. the current
 * hour), widened to at least `minWidth` bars so a quiet morning still reads as a chart. Empty when nothing sold.
 */
export function ordersByHour(orders: Order[], w: Win, keep: number[] = [], minWidth = 8): HourBar[] {
  const counts = new Array<number>(24).fill(0);
  for (const o of orders) {
    if (!isPaidSale(o)) continue;
    const t = orderTime(o);
    if (!inWin(t, w)) continue;
    counts[new Date(t).getHours()]++;
  }
  const active = counts.map((c, h) => (c > 0 ? h : -1)).filter(h => h >= 0);
  if (!active.length) return [];
  let lo = Math.min(...active, ...keep.filter(h => h >= 0 && h < 24));
  let hi = Math.max(...active, ...keep.filter(h => h >= 0 && h < 24));
  while (hi - lo + 1 < minWidth && (lo > 0 || hi < 23)) {
    if (hi < 23) hi++;
    if (hi - lo + 1 < minWidth && lo > 0) lo--;
  }
  const out: HourBar[] = [];
  for (let h = lo; h <= hi; h++) out.push({ hour: h, label: String(h), orders: counts[h] });
  return out;
}

/** The hour to emphasise: the current hour on "Today" (when it is on the chart), otherwise the busiest hour. */
export function highlightHour(bars: HourBar[], today: boolean, nowMs: number): { hour: number; why: 'now' | 'busiest' } | null {
  if (!bars.length) return null;
  const nowH = new Date(nowMs).getHours();
  if (today && bars.some(b => b.hour === nowH)) return { hour: nowH, why: 'now' };
  let best = bars[0];
  for (const b of bars) if (b.orders > best.orders) best = b;
  return { hour: best.hour, why: 'busiest' };
}

// ------------------------------------------------------------------ needs attention
export interface Attention { key: string; text: string; tone: 'warning' | 'danger' | 'info'; to: string }
export interface AttentionInput {
  orders: Order[];
  lowStock: { name: string; qty: number; min: number }[];
  outstandingCredit: number;
  /** Start of the current business day: a bill opened before it and still open was left over from an earlier day. */
  dayStartMs: number;
  money: (n: number) => string;
}

/** Only things the system can see and someone can act on now, most urgent first; each opens the page that fixes it. */
export function attentionItems({ orders, lowStock, outstandingCredit, dayStartMs, money }: AttentionInput): Attention[] {
  const out: Attention[] = [];
  const awaiting = orders.filter(o => o.status === 'pending_approval').length;
  if (awaiting > 0) out.push({ key: 'approval', text: `${awaiting} online order${awaiting === 1 ? '' : 's'} await${awaiting === 1 ? 's' : ''} approval`, tone: 'warning', to: '/online-approval' });
  const stale = orders.filter(o => isOpen(o) && orderTime(o) > 0 && orderTime(o) < dayStartMs).length;
  if (stale > 0) out.push({ key: 'stale', text: `${stale} bill${stale === 1 ? '' : 's'} from an earlier day ${stale === 1 ? 'is' : 'are'} still open`, tone: 'warning', to: '/running-bills' });
  for (const l of lowStock.slice(0, 3)) out.push({ key: `low-${l.name}`, text: `${l.name} is below the minimum (${l.qty} left, minimum ${l.min})`, tone: 'danger', to: '/inventory' });
  if (lowStock.length > 3) out.push({ key: 'low-more', text: `${lowStock.length - 3} more item${lowStock.length - 3 === 1 ? '' : 's'} below the minimum`, tone: 'danger', to: '/inventory' });
  if (outstandingCredit > 0) out.push({ key: 'credit', text: `${money(outstandingCredit)} is owed on credit`, tone: 'info', to: '/credits' });
  return out;
}

// ------------------------------------------------------------------ export
export interface ExportInput {
  shop: string;
  periodLabel: string;
  generatedAt: Date;
  kpis: Kpis;
  prev: Kpis;
  vs: string;
  open: number;
  days: DayPoint[];
  mix: MixRow[];
  top: TopItem[];
  hours: HourBar[];
}

/** The dashboard's figures as CSV rows (one section per card), exactly as shown — for a spreadsheet or an accountant. */
export function dashboardCsv(x: ExportInput): (string | number)[][] {
  const rows: (string | number)[][] = [
    ['DT POS dashboard', x.shop],
    ['Period', x.periodLabel],
    ['Generated', x.generatedAt.toLocaleString('en-PK')],
    [],
    ['Figure', 'This period', `Compared with ${x.vs}`],
    ['Sales', Math.round(x.kpis.sales), Math.round(x.prev.sales)],
    ['Orders', x.kpis.orders, x.prev.orders],
    ['Average bill', Math.round(x.kpis.avg), Math.round(x.prev.avg)],
    ['Open bills (now)', x.open, ''],
    [],
    ['Day', 'Sales', 'Orders'],
    ...x.days.map(d => [d.label, Math.round(d.sales), d.orders]),
    [],
    ['Payment method', 'Amount', 'Share %'],
    ...x.mix.map(m => [m.name, m.amount, m.pct]),
    [],
    ['Item', 'Quantity sold', 'Sales'],
    ...x.top.map(t => [t.name, t.qty, Math.round(t.sales)]),
    [],
    ['Hour', 'Orders'],
    ...x.hours.map(h => [hourLabel(h.hour), h.orders]),
  ];
  return rows;
}

const csvCell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsvText = (rows: (string | number)[][]) => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\n');
