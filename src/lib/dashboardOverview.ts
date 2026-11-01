// ============================================================
// Owner Overview dashboard — the pure part (v1.80.0)
//
// A different arrangement of numbers the dashboard already computes (same "paid sale" rule, same
// calendar days), plus the comparison with the period before and the series behind the small charts.
// Nothing here is estimated: every figure comes from orders, transactions and menu items on this device.
// ============================================================
import type { MenuItem, Order, OrderStatus, Transaction } from './types';
import { isPaidSale } from './sales';

export const orderTime = (o: Pick<Order, 'paidAt' | 'createdAt'>): number => {
  const t = new Date(o.paidAt || o.createdAt).getTime();
  return Number.isFinite(t) ? t : 0;
};

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (ms: number, n: number) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };

export interface Win { start: number; end: number }
export interface Windows { cur: Win; prev: Win; bucket: 'hour' | 'day' }

/**
 * The period shown and the one it is compared with.
 *  - Today (days = 1): midnight → now, against yesterday midnight → the same clock time (a fair comparison).
 *  - N days: the last N calendar days including today, against the N days before them.
 */
export function periodWindows(days: number, nowMs: number): Windows {
  const todayStart = startOfDay(nowMs);
  if (days <= 1) {
    const yStart = addDays(todayStart, -1);
    return { cur: { start: todayStart, end: nowMs }, prev: { start: yStart, end: yStart + (nowMs - todayStart) }, bucket: 'hour' };
  }
  const start = addDays(todayStart, -(days - 1));
  const prevStart = addDays(start, -days);
  return { cur: { start, end: nowMs }, prev: { start: prevStart, end: start }, bucket: 'day' };
}

const inWin = (t: number, w: Win) => t >= w.start && t < w.end;

/** Percent change from `prev` to `cur`. Null when there is nothing to compare against. */
export function pctChange(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (prev === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

export interface Totals { sales: number; orders: number; avg: number; expenses: number; profit: number }

export function totalsIn(orders: Order[], transactions: Transaction[], w: Win): Totals {
  let sales = 0, count = 0;
  for (const o of orders) {
    if (!isPaidSale(o)) continue;
    if (!inWin(orderTime(o), w)) continue;
    sales += Number(o.grandTotal || 0);
    count++;
  }
  let expenses = 0;
  for (const t of transactions) {
    if (t.type !== 'expense') continue;
    const ms = new Date(t.date).getTime();
    if (Number.isFinite(ms) && inWin(ms, w)) expenses += Number(t.amount || 0);
  }
  return { sales, orders: count, avg: count ? Math.round(sales / count) : 0, expenses, profit: sales - expenses };
}

export type Metric = 'sales' | 'orders' | 'avg' | 'profit';

/** One value per bucket across `w`: hours for a single day, days otherwise. Empty buckets are 0, never skipped. */
export function sparkSeries(orders: Order[], transactions: Transaction[], w: Win, bucket: 'hour' | 'day', metric: Metric): number[] {
  const step = bucket === 'hour' ? 3600000 : 86400000;
  const n = Math.max(1, Math.ceil((w.end - w.start) / step));
  const sales = new Array<number>(n).fill(0);
  const count = new Array<number>(n).fill(0);
  const spend = new Array<number>(n).fill(0);
  const idx = (t: number) => Math.min(n - 1, Math.floor((t - w.start) / step));
  for (const o of orders) {
    if (!isPaidSale(o)) continue;
    const t = orderTime(o);
    if (!inWin(t, w)) continue;
    sales[idx(t)] += Number(o.grandTotal || 0);
    count[idx(t)]++;
  }
  if (metric === 'profit') {
    for (const t of transactions) {
      if (t.type !== 'expense') continue;
      const ms = new Date(t.date).getTime();
      if (Number.isFinite(ms) && inWin(ms, w)) spend[idx(ms)] += Number(t.amount || 0);
    }
  }
  return sales.map((s, i) => {
    switch (metric) {
      case 'sales': return s;
      case 'orders': return count[i];
      case 'avg': return count[i] ? Math.round(s / count[i]) : 0;
      case 'profit': return s - spend[i];
    }
  });
}

// ------------------------------------------------------------------ order rate
export type RateMode = 'weekly' | 'monthly' | 'yearly';
export interface RateBucket { key: string; label: string; start: number; end: number; orders: number; sales: number }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Orders and sales per bucket: the last 7 days, the last 12 months, or the last 5 years — always ending now,
 * so the newest bucket is on the right. Empty buckets stay in (a quiet day is information).
 */
export function rateBuckets(orders: Order[], mode: RateMode, nowMs: number): RateBucket[] {
  const now = new Date(nowMs);
  const out: RateBucket[] = [];
  if (mode === 'weekly') {
    const today = startOfDay(nowMs);
    for (let i = 6; i >= 0; i--) {
      const s = addDays(today, -i);
      out.push({ key: new Date(s).toDateString(), label: DAYS[new Date(s).getDay()], start: s, end: addDays(s, 1), orders: 0, sales: 0 });
    }
  } else if (mode === 'monthly') {
    for (let i = 11; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth() - i, 1).getTime();
      const e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1).getTime();
      const d = new Date(s);
      out.push({ key: `${d.getFullYear()}-${d.getMonth() + 1}`, label: MONTHS[d.getMonth()], start: s, end: e, orders: 0, sales: 0 });
    }
  } else {
    for (let i = 4; i >= 0; i--) {
      const y = now.getFullYear() - i;
      out.push({ key: String(y), label: String(y), start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime(), orders: 0, sales: 0 });
    }
  }
  for (const o of orders) {
    if (!isPaidSale(o)) continue;
    const t = orderTime(o);
    const b = out.find(x => t >= x.start && t < x.end);
    if (!b) continue;
    b.orders++;
    b.sales += Number(o.grandTotal || 0);
  }
  return out;
}

/** The busiest bucket (most orders). Ties go to the most recent. Null when there are no orders at all. */
export function peakBucket(buckets: RateBucket[]): RateBucket | null {
  let best: RateBucket | null = null;
  for (const b of buckets) if (b.orders > 0 && (!best || b.orders >= best.orders)) best = b;
  return best;
}

// ------------------------------------------------------------------ order types
export interface TypeShare { key: string; name: string; sales: number; orders: number; pct: number }
const TYPE_NAME: Record<string, string> = { dining: 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery', foodpanda: 'Foodpanda' };

/** Share of sales by order type, largest first; the percentages add to exactly 100. */
export function typeShares(orders: Order[], w: Win): TypeShare[] {
  const m = new Map<string, { sales: number; orders: number }>();
  for (const o of orders) {
    if (!isPaidSale(o) || !inWin(orderTime(o), w)) continue;
    const k = (o.orderType as string) || 'dining';
    const e = m.get(k) || { sales: 0, orders: 0 };
    e.sales += Number(o.grandTotal || 0);
    e.orders++;
    m.set(k, e);
  }
  const total = [...m.values()].reduce((s, x) => s + x.sales, 0);
  const rows = [...m.entries()].map(([key, v]) => ({ key, name: TYPE_NAME[key] || key, sales: v.sales, orders: v.orders, pct: total ? (v.sales / total) * 100 : 0 }))
    .sort((a, b) => b.sales - a.sales);
  // largest-remainder rounding so the legend never reads 99 % or 101 %
  const floors = rows.map(r => Math.floor(r.pct));
  let left = total ? 100 - floors.reduce((s, x) => s + x, 0) : 0;
  const order = rows.map((r, i) => ({ i, frac: r.pct - floors[i] })).sort((a, b) => b.frac - a.frac);
  for (const o of order) { if (left <= 0) break; floors[o.i]++; left--; }
  return rows.map((r, i) => ({ ...r, pct: floors[i] }));
}

// ------------------------------------------------------------------ recent orders
export type PillTone = 'success' | 'warning' | 'info' | 'danger' | 'neutral';
export function statusPill(status: OrderStatus | string): { label: string; tone: PillTone } {
  switch (status) {
    case 'paid': case 'credit_received': return { label: 'Completed', tone: 'success' };
    case 'running': return { label: 'Running', tone: 'info' };
    case 'hold': return { label: 'On hold', tone: 'warning' };
    case 'partial': return { label: 'Part paid', tone: 'warning' };
    case 'credit_pending': return { label: 'On credit', tone: 'warning' };
    case 'pending_approval': return { label: 'Needs approval', tone: 'warning' };
    case 'complimentary': return { label: 'Complimentary', tone: 'neutral' };
    case 'void': case 'cancelled': case 'rejected': return { label: status === 'void' ? 'Voided' : status === 'cancelled' ? 'Cancelled' : 'Rejected', tone: 'danger' };
    default: return { label: String(status || '—'), tone: 'neutral' };
  }
}

export interface RecentRow {
  id: string;
  code: string;
  item: string;
  extra: number;
  image?: string;
  customer: string;
  total: number;
  when: number;
  status: ReturnType<typeof statusPill>;
}

/** Newest first. `query` matches bill number, customer, table or item name. */
export function recentRows(orders: Order[], menu: MenuItem[], limit: number, query = ''): RecentRow[] {
  const byId = new Map(menu.map(m => [m.id, m] as const));
  const q = query.trim().toLowerCase();
  const rows: RecentRow[] = [];
  for (const o of orders.slice().sort((a, b) => orderTime(b) - orderTime(a) || Number(b.orderNumber || 0) - Number(a.orderNumber || 0))) {
    const first = o.items?.[0];
    const customer = o.customer?.name || (o as any).tableName || (o.orderType === 'dining' ? 'Dine-in' : o.orderType === 'takeaway' ? 'Takeaway' : o.orderType === 'delivery' ? 'Delivery' : '—');
    const row: RecentRow = {
      id: o.id,
      code: `#${o.orderNumber}`,
      item: first?.name || '—',
      extra: Math.max(0, (o.items?.length || 0) - 1),
      image: first ? (byId.get(first.menuItemId)?.image || undefined) : undefined,
      customer,
      total: Number(o.grandTotal || 0),
      when: orderTime(o),
      status: statusPill(o.status),
    };
    if (q) {
      const hay = [row.code, row.item, customer, o.customer?.phone || '', ...(o.items || []).map(i => i.name)].join(' ').toLowerCase();
      if (!hay.includes(q)) continue;
    }
    rows.push(row);
    if (rows.length >= limit) break;
  }
  return rows;
}

// ------------------------------------------------------------------ service area
export interface DropPoint { lat: number; lng: number }
/** Delivery drop-off points (customer GPS pins) of paid delivery orders in the window. */
export function deliveryPoints(orders: Order[], w: Win): DropPoint[] {
  const out: DropPoint[] = [];
  for (const o of orders) {
    if (o.orderType !== 'delivery' || !isPaidSale(o) || !inWin(orderTime(o), w)) continue;
    const lat = Number(o.customer?.lat), lng = Number(o.customer?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) out.push({ lat, lng });
  }
  return out;
}

// ------------------------------------------------------------------ layout preference
export const DASHBOARD_LAYOUT_KEY = 'dtpos-dashboard-layout';
export type DashboardLayout = 'overview' | 'standard';

/** The owner's choice; when none was made, management sees the Overview and a cashier keeps the standard page. */
export function resolveDashboardLayout(restricted: boolean): DashboardLayout {
  try {
    const v = localStorage.getItem(DASHBOARD_LAYOUT_KEY);
    if (v === 'overview' || v === 'standard') return v;
  } catch { /* private mode */ }
  return restricted ? 'standard' : 'overview';
}
export function setDashboardLayout(v: DashboardLayout): void {
  try { localStorage.setItem(DASHBOARD_LAYOUT_KEY, v); } catch { /* private mode */ }
}
