// v1.139.0 — the Pickup board as the design draws it (SW-09): three lanes — Preparing · Ready to hand over · Collected today — of cards with a
// large order number, the customer, how many items, an age pill and ONE button (Mark ready · Handed over). Pure: orders in, groups and words out.
import type { Order } from './types';

export type PickupLane = 'preparing' | 'ready' | 'collected';
export const PICKUP_LANES: { key: PickupLane; label: string }[] = [
  { key: 'preparing', label: 'Preparing' }, { key: 'ready', label: 'Ready to hand over' }, { key: 'collected', label: 'Collected today' },
];
/** A ready order that has waited this long at the counter turns amber. */
export const READY_WARN_MIN = 10;

/** A pickup order is a Self-Pickup / takeaway order placed from the website, the Order Taker or the till. */
export function isPickupOrder(o: Order): boolean {
  if (o.status === 'void' || o.status === 'cancelled') return false;
  if (o.pickupRequested) return true;
  return (o.orderType as string) === 'takeaway';
}

export const isCollected = (o: Pick<Order, 'status'>): boolean => o.status === 'paid' || o.status === 'credit_received';

/** When the customer was told to come ("30 min" after the order, or a clock time), as a timestamp. */
export function pickupDueAt(o: Pick<Order, 'pickupTime' | 'createdAt'>): number | null {
  if (!o.pickupTime) return null;
  const m = String(o.pickupTime).match(/(\d+)\s*min/i);
  if (m) return new Date(o.createdAt).getTime() + parseInt(m[1], 10) * 60_000;
  const t = Date.parse(o.pickupTime);
  return Number.isNaN(t) ? null : t;
}

/** The kitchen has finished it (ready, or already taken out of the kitchen). */
const kitchenDone = (o: Pick<Order, 'kitchenStatus'>): boolean => o.kitchenStatus === 'ready' || o.kitchenStatus === 'served' || o.kitchenStatus === 'delivered';

export function pickupLane(o: Pick<Order, 'status' | 'kitchenStatus'>): PickupLane {
  if (isCollected(o)) return 'collected';
  return kitchenDone(o) ? 'ready' : 'preparing';
}

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const collectedAt = (o: Pick<Order, 'paidAt' | 'createdAt'>): number => { const t = new Date(o.paidAt || o.createdAt).getTime(); return Number.isFinite(t) ? t : 0; };
export const collectedToday = (o: Pick<Order, 'paidAt' | 'createdAt'>, now = Date.now()): boolean => startOfDay(collectedAt(o)) === startOfDay(now);

const mins = (iso: string | undefined, now: number) => { const t = new Date(iso || '').getTime(); return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60000)) : 0; };

export type PillTone = 'info' | 'ok' | 'warn' | 'bad' | 'neutral';

/** The pill on a card: how long it has been cooking (or "overdue" past the time the customer was given), how long it has waited ready, or when it left. */
export function pickupPill(o: Pick<Order, 'status' | 'kitchenStatus' | 'kitchenStatusAt' | 'createdAt' | 'pickupTime' | 'paidAt'>, now = Date.now()): { label: string; tone: PillTone } {
  const lane = pickupLane(o);
  if (lane === 'collected') {
    const d = new Date(collectedAt(o));
    return { label: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, tone: 'neutral' };
  }
  if (lane === 'ready') {
    const waited = mins(o.kitchenStatusAt || o.createdAt, now);
    return { label: `waiting ${waited} min`, tone: waited >= READY_WARN_MIN ? 'warn' : 'ok' };
  }
  const due = pickupDueAt(o as Pick<Order, 'pickupTime' | 'createdAt'>);
  if (due != null && now > due) return { label: `overdue ${Math.max(1, Math.floor((now - due) / 60000))} min`, tone: 'bad' };
  return { label: `${mins(o.createdAt, now)} min`, tone: 'info' };
}

/** "4 items" — the pieces on the order, not the lines. */
export function itemsLabel(o: Pick<Order, 'items'>): string {
  const n = (o.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}

export const pickupName = (o: Pick<Order, 'customer'>): string => (o.customer?.name || '').trim() || 'Walk-in';

export function pickupMatches(o: Order, q: string): boolean {
  const s = q.trim().toLowerCase().replace(/^#/, '');
  if (!s) return true;
  return String(o.orderNumber).includes(s) || (o.customer?.name || '').toLowerCase().includes(s) || (o.customer?.phone || '').includes(s);
}

export interface PickupGroups { preparing: Order[]; ready: Order[]; collected: Order[]; earlier: Order[] }

/**
 * The three lanes. Preparing: the one due soonest first (else the one placed first). Ready: the one that has waited longest at the counter first.
 * Collected: today's, newest first;
 * `earlier` is the rest of the recent history (up to 50) that the old page's Collected tab showed.
 */
export function groupPickups(orders: Order[], q = '', now = Date.now()): PickupGroups {
  const mine = orders.filter(isPickupOrder).filter(o => pickupMatches(o, q));
  const dueOrPlaced = (o: Order) => pickupDueAt(o) ?? new Date(o.createdAt).getTime();
  const readySince = (o: Order) => { const t = new Date(o.kitchenStatusAt || o.createdAt).getTime(); return Number.isFinite(t) ? t : 0; };
  const open = (lane: PickupLane) => mine.filter(o => pickupLane(o) === lane).sort((a, b) => lane === 'ready' ? readySince(a) - readySince(b) : dueOrPlaced(a) - dueOrPlaced(b));
  const done = mine.filter(isCollected).sort((a, b) => collectedAt(b) - collectedAt(a));
  return {
    preparing: open('preparing'), ready: open('ready'),
    collected: done.filter(o => collectedToday(o, now)),
    earlier: done.filter(o => !collectedToday(o, now)).slice(0, 50),
  };
}
