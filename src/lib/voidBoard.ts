// v1.143.0 — Void / comp / cancel as the design draws it (SW-40): one table of the bills that left the sale on purpose — Bill · Status · Amount · Reason · By · When —
// with All · Void · Complimentary · Cancelled over it. They are recorded with a reason and a name and never count as paid sales. Pure: orders in, rows out.
import type { Order } from './types';

export type VoidKind = 'void' | 'comp' | 'cancel';
export type VoidFilter = 'all' | VoidKind;
export const VOID_FILTERS: { key: VoidFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'void', label: 'Void' }, { key: 'comp', label: 'Complimentary' }, { key: 'cancel', label: 'Cancelled' },
];
export const KIND_LABEL: Record<VoidKind, string> = { void: 'Void', comp: 'Complimentary', cancel: 'Cancelled' };

export function kindOf(o: Pick<Order, 'status'>): VoidKind | null {
  if (o.status === 'void') return 'void';
  if (o.status === 'complimentary') return 'comp';
  if (o.status === 'cancelled') return 'cancel';
  return null;
}

export interface ExitRow { order: Order; kind: VoidKind; reason: string; by: string; at: string }

/** What the bill's exit says: why, who, and when (the moment it left the sale, else when it was made). */
export function exitRow(o: Order): ExitRow | null {
  const kind = kindOf(o);
  if (!kind) return null;
  const reason = kind === 'void' ? o.voidReason : kind === 'comp' ? o.complimentaryReason : o.cancelReason;
  const by = kind === 'void' ? o.voidBy : kind === 'comp' ? o.complimentaryBy : o.cancelledBy;
  const at = (kind === 'void' ? o.voidedAt : kind === 'comp' ? o.complimentaryAt : o.cancelledAt) || o.createdAt;
  return { order: o, kind, reason: String(reason || '').trim(), by: String(by || '').trim(), at };
}

const ts = (iso: string) => { const t = new Date(iso).getTime(); return Number.isFinite(t) ? t : 0; };

export function matchesQuery(r: ExitRow, q: string): boolean {
  const s = q.trim().toLowerCase().replace(/^#/, '');
  if (!s) return true;
  const o = r.order;
  return String(o.orderNumber).includes(s) || (o.creditCustomerName || o.customer?.name || '').toLowerCase().includes(s)
    || (o.creditCustomerPhone || o.customer?.phone || '').includes(s) || r.reason.toLowerCase().includes(s) || r.by.toLowerCase().includes(s);
}

/** The table: the chosen kind, narrowed by the search, newest exit first. */
export function exitRows(orders: Order[], filter: VoidFilter, q = ''): ExitRow[] {
  return orders.map(exitRow).filter((r): r is ExitRow => !!r)
    .filter(r => (filter === 'all' || r.kind === filter) && matchesQuery(r, q))
    .sort((a, b) => ts(b.at) - ts(a.at) || (b.order.orderNumber || 0) - (a.order.orderNumber || 0));
}

export function exitTotals(rows: ExitRow[]): Record<VoidKind, { count: number; amount: number }> {
  const out = { void: { count: 0, amount: 0 }, comp: { count: 0, amount: 0 }, cancel: { count: 0, amount: 0 } };
  for (const r of rows) { out[r.kind].count += 1; out[r.kind].amount += Number(r.order.grandTotal) || 0; }
  return out;
}

/** "12:20" today, "20 Nov 12:20" any other day. */
export function whenLabel(iso: string, now = Date.now()): string {
  const t = ts(iso);
  if (!t) return '—';
  const d = new Date(t), n = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const same = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return same ? hm : `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })} ${hm}`;
}

/** "Dining · Sara Khan · 3 items" under the bill number. */
export function billSub(o: Order): string {
  const who = (o.creditCustomerName || o.customer?.name || '').trim();
  const n = (o.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  return [o.orderType ? o.orderType[0].toUpperCase() + o.orderType.slice(1) : '', who, `${n} ${n === 1 ? 'item' : 'items'}`].filter(Boolean).join(' · ');
}

export const voidTotalsLine = (rows: ExitRow[], fmt: (n: number) => string): string => {
  const t = exitTotals(rows);
  return `${rows.length} ${rows.length === 1 ? 'bill' : 'bills'} · Void ${fmt(t.void.amount)} · Complimentary ${fmt(t.comp.amount)} · Cancelled ${fmt(t.cancel.amount)}`;
};
