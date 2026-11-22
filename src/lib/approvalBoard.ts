// v1.140.0 — the "Awaiting approval" screen as the design draws it (SW-07): "3 orders · auto-refreshing", All · Website · QR · Order taker, and a card per
// order — what it is ("Delivery · Sara Khan · Gulberg · 2.4 km"), how long it has waited, the items, the total, Reject · Accept. Pure: orders in, words out.
import type { OnlineSourceKey, Order } from './types';
import { sourceKeyForOrder } from './onlineApproval';
import { placeLabel } from './deliveryBoard';

export type ApprovalFilter = 'all' | 'website' | 'qr' | 'order_taker';
export const APPROVAL_FILTERS: { key: ApprovalFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'website', label: 'Website' }, { key: 'qr', label: 'QR' }, { key: 'order_taker', label: 'Order taker' },
];

/** The design's four groups over the software's five source keys: a website delivery is still a website order; both QRs are "QR". */
export function filterOf(key: OnlineSourceKey): Exclude<ApprovalFilter, 'all'> {
  if (key === 'website' || key === 'delivery') return 'website';
  if (key === 'qr' || key === 'takeaway_qr') return 'qr';
  return 'order_taker';
}

/** The badge on a card. */
export function sourceBadge(o: Order): string {
  switch (sourceKeyForOrder(o)) {
    case 'qr': return 'QR table';
    case 'takeaway_qr': return 'QR takeaway';
    case 'order_taker': return 'Order taker';
    default: return 'Website';
  }
}

/** Amber once an order has waited long enough that the customer is wondering, red when it is plainly forgotten. */
export const APPROVAL_WARN_MIN = 4;
export const APPROVAL_LATE_MIN = 8;

export type AgeTone = 'normal' | 'warn' | 'bad';

export function approvalAge(createdAt: string | undefined, now = Date.now()): { label: string; tone: AgeTone; minutes: number } {
  const t = new Date(createdAt || '').getTime();
  const minutes = Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60000)) : 0;
  const tone: AgeTone = minutes >= APPROVAL_LATE_MIN ? 'bad' : minutes >= APPROVAL_WARN_MIN ? 'warn' : 'normal';
  if (minutes < 1) return { label: 'just now', tone, minutes };
  if (minutes < 60) return { label: `${minutes} min ago`, tone, minutes };
  const h = Math.floor(minutes / 60);
  return { label: h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`, tone, minutes };
}

const TYPE_WORD: Record<string, string> = { dining: 'Dining', takeaway: 'Takeaway', delivery: 'Delivery', foodpanda: 'Foodpanda' };

/** "Delivery · Sara Khan · Gulberg · 2.4 km" · "Dining · T-05 · Guest" · "Dining · T-09 · Waiter: Imran". */
export function approvalLine(o: Order): string {
  const parts: string[] = [TYPE_WORD[String(o.orderType)] || String(o.orderType || '')];
  if (o.orderType === 'dining' && (o.tableName || o.tableLabel)) parts.push(String(o.tableName || o.tableLabel));
  const name = (o.customer?.name || '').trim();
  if (o.source === 'order_taker' && o.waiterName) { parts.push(`Waiter: ${o.waiterName}`); }
  else parts.push(name || 'Guest');
  if (o.orderType === 'delivery') { const place = placeLabel(o); if (place) parts.push(place); }
  return parts.filter(Boolean).join(' · ');
}

export interface ApprovalGroups { pending: Order[]; history: Order[] }

/** Waiting orders (longest wait first) and the ones already decided (latest decision first), each in the filter chosen. */
export function groupApprovals(orders: Order[], filter: ApprovalFilter = 'all'): ApprovalGroups {
  const pending: Order[] = []; const history: Order[] = [];
  const at = (iso?: string) => { const t = new Date(iso || '').getTime(); return Number.isFinite(t) ? t : 0; };
  for (const o of orders) {
    const key = sourceKeyForOrder(o);
    if (!key) continue;
    if (filter !== 'all' && filterOf(key) !== filter) continue;
    if (o.status === 'pending_approval') pending.push(o);
    else if (o.status === 'rejected' || o.approvedAt) history.push(o);
  }
  pending.sort((a, b) => at(a.createdAt) - at(b.createdAt));
  history.sort((a, b) => at(b.rejectedAt || b.approvedAt) - at(a.rejectedAt || a.approvedAt));
  return { pending, history };
}

/** How many orders wait in each filter (for the badge on the tab). */
export function waitingCounts(orders: Order[]): Record<ApprovalFilter, number> {
  const out: Record<ApprovalFilter, number> = { all: 0, website: 0, qr: 0, order_taker: 0 };
  for (const o of orders) {
    const key = sourceKeyForOrder(o);
    if (!key || o.status !== 'pending_approval') continue;
    out.all += 1; out[filterOf(key)] += 1;
  }
  return out;
}

export const approvalSubtitle = (count: number, history = false): string =>
  history ? `${count} ${count === 1 ? 'order' : 'orders'} decided` : `${count} ${count === 1 ? 'order' : 'orders'} · auto-refreshing`;
