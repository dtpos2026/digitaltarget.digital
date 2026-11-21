// v1.131.0 — the Orders screen (design SW-06): one table of the day's bills with status pills, Today / All types, and a panel for the
// selected bill. The rules for what a row says live here — pure, no React, no storage — so the screen and its tests share them.
import type { Order } from './types';

export type StatusFilter = 'all' | 'running' | 'hold' | 'paid' | 'partial' | 'void' | 'credit';
export type RangeKey = 'today' | 'yesterday' | 'week' | 'month' | 'all';
export type PillTone = 'info' | 'accent' | 'warn' | 'ok' | 'bad' | 'neutral';

export const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'running', label: 'Running' }, { key: 'hold', label: 'Hold' }, { key: 'paid', label: 'Paid' },
  { key: 'partial', label: 'Partial' }, { key: 'void', label: 'Void' }, { key: 'credit', label: 'Credit' },
];
export const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'yesterday', label: 'Yesterday' }, { key: 'week', label: 'Last 7 days' }, { key: 'month', label: 'This month' }, { key: 'all', label: 'All time' },
];

/** A bill that is still open: it can be edited, sent to the kitchen, held, paid or cancelled. */
export function isOpenBill(o: Pick<Order, 'status'>): boolean {
  return o.status === 'running' || o.status === 'hold' || o.status === 'partial' || o.status === 'pending_approval' || o.status === 'credit_pending';
}

/** Which status pill a bill belongs to. Bills no pill names (waiting for approval, complimentary) show under All only. */
export function statusGroup(o: Pick<Order, 'status'>): Exclude<StatusFilter, 'all'> | 'other' {
  switch (o.status) {
    case 'running': return 'running';
    case 'hold': return 'hold';
    case 'paid': case 'credit_received': return 'paid';
    case 'partial': return 'partial';
    case 'void': case 'cancelled': case 'rejected': return 'void';
    case 'credit_pending': return 'credit';
    default: return 'other';
  }
}

/** The word and colour on a row. A running bill says what is happening to it: cooking, on the way, or just running. */
export function statusPill(o: Pick<Order, 'status' | 'orderType' | 'deliveryStatus' | 'kitchenStatus'>): { label: string; tone: PillTone } {
  switch (o.status) {
    case 'running': {
      const ds = o.deliveryStatus;
      if (o.orderType === 'delivery' && (ds === 'onway' || ds === 'rider_picked' || ds === 'rider_reached')) return { label: 'On the way', tone: 'accent' };
      if (o.kitchenStatus === 'preparing' || ds === 'cooking') return { label: 'Cooking', tone: 'info' };
      return { label: 'Running', tone: 'info' };
    }
    case 'hold': return { label: 'Hold', tone: 'warn' };
    case 'paid': case 'credit_received': return { label: 'Paid', tone: 'ok' };
    case 'partial': return { label: 'Partial', tone: 'warn' };
    case 'void': case 'cancelled': return { label: 'Void', tone: 'bad' };
    case 'rejected': return { label: 'Rejected', tone: 'bad' };
    case 'credit_pending': return { label: 'Credit', tone: 'accent' };
    case 'pending_approval': return { label: 'Waiting', tone: 'accent' };
    case 'complimentary': return { label: 'Comp', tone: 'neutral' };
    default: return { label: String(o.status), tone: 'neutral' };
  }
}

const DAY = 86_400_000;
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** [from, to) in ms. */
export function rangeBounds(range: RangeKey, now = Date.now()): [number, number] {
  const today = startOfDay(now);
  switch (range) {
    case 'today': return [today, today + DAY];
    case 'yesterday': return [today - DAY, today];
    case 'week': return [today - 6 * DAY, today + DAY];
    case 'month': { const d = new Date(now); return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), today + DAY]; }
    default: return [0, Infinity];
  }
}

const whenOf = (o: Order): number => {
  const t = new Date(o.createdAt).getTime();
  return Number.isFinite(t) ? t : 0;
};

export function tableOf(o: Order): string {
  return o.tableName || o.tableLabel || '';
}
export function customerOf(o: Order): string {
  return (o.customer?.name || '').trim() || (o.customer?.phone || '').trim() || 'Walk-in';
}

export interface OrdersFilter { range: RangeKey; type: string; status: StatusFilter; q: string }

/** Newest first. A search matches the bill number, the customer's name or phone, and the table. */
export function filterOrders(orders: Order[], f: OrdersFilter, now = Date.now()): Order[] {
  const [from, to] = rangeBounds(f.range, now);
  const q = f.q.trim().toLowerCase().replace(/^#/, '');
  const out = orders.filter(o => {
    const t = whenOf(o);
    if (t < from || t >= to) return false;
    if (f.type !== 'all' && o.orderType !== f.type) return false;
    if (f.status !== 'all' && statusGroup(o) !== f.status) return false;
    if (q) {
      const hay = [String(o.orderNumber), customerOf(o), o.customer?.phone || '', tableOf(o)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return out.sort((a, b) => whenOf(b) - whenOf(a) || (b.orderNumber || 0) - (a.orderNumber || 0));
}

/** "12:41" for today's bills, "20 Nov 12:41" for any other day. */
export function timeLabel(o: Order, now = Date.now()): string {
  const t = whenOf(o);
  if (!t) return '—';
  const d = new Date(t);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (startOfDay(t) === startOfDay(now)) return hm;
  return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })} ${hm}`;
}

const csvCell = (v: string | number) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The table as a CSV — the columns, in the order, the screen shows (the total is the plain number, so a spreadsheet can add it up). */
export function ordersCsv(orders: Order[], now = Date.now()): string {
  const rows: Array<Array<string | number>> = [['Bill', 'Type', 'Table', 'Customer', 'Total', 'Status', 'Time']];
  for (const o of orders) {
    rows.push([o.orderNumber, o.orderType, tableOf(o), customerOf(o), Math.round(Number(o.grandTotal) || 0), statusPill(o).label, timeLabel(o, now)]);
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}
