// v1.146.0 — Foodpanda orders as the design draws it (SW-38): lanes New · Preparing · Ready · Picked, a reference chip and the amount on a card, and one button
// ("Next →"). Cancelled orders are history behind a toggle. Pure: orders in, lanes and words out.
import type { FoodpandaStatus, Order } from './types';

export const FP_LANES: { key: FoodpandaStatus; label: string }[] = [
  { key: 'new', label: 'New' }, { key: 'preparing', label: 'Preparing' }, { key: 'ready', label: 'Ready' }, { key: 'picked', label: 'Picked' }, { key: 'cancelled', label: 'Cancelled' },
];
export const FP_ACTIVE: FoodpandaStatus[] = ['new', 'preparing', 'ready', 'picked'];

export const FP_NEXT: Record<FoodpandaStatus, FoodpandaStatus | null> = { new: 'preparing', preparing: 'ready', ready: 'picked', picked: null, cancelled: null };

export const isFoodpanda = (o: Pick<Order, 'orderType'>): boolean => o.orderType === 'foodpanda';
export const fpStatus = (o: Pick<Order, 'foodpandaStatus'>): FoodpandaStatus => o.foodpandaStatus || 'new';

/** The chip on the card: the rider app's reference, else our own bill number. */
export const fpRef = (o: Pick<Order, 'foodpandaRef' | 'orderNumber'>): string => (o.foodpandaRef || '').trim() || `#${o.orderNumber}`;

/** The one button's words, "Next →" — and what it does, for the tooltip. */
export const nextWord = (s: FoodpandaStatus): string => { const n = FP_NEXT[s]; return n ? `Mark ${n}` : ''; };

export function matchesFoodpanda(o: Order, q: string): boolean {
  const s = q.trim().toLowerCase().replace(/^#/, '');
  return !s || String(o.orderNumber).includes(s) || (o.foodpandaRef || '').toLowerCase().includes(s) || (o.customer?.name || '').toLowerCase().includes(s);
}

/** Orders by lane, oldest first within a lane (the one that has waited longest is on top). */
export function fpLanes(orders: Order[], q = ''): Record<FoodpandaStatus, Order[]> {
  const out: Record<FoodpandaStatus, Order[]> = { new: [], preparing: [], ready: [], picked: [], cancelled: [] };
  const t = (o: Order) => { const x = new Date(o.createdAt).getTime(); return Number.isFinite(x) ? x : 0; };
  for (const o of orders.filter(isFoodpanda).filter(o => matchesFoodpanda(o, q)).sort((a, b) => t(a) - t(b))) out[fpStatus(o)].push(o);
  return out;
}

export const fpSubtitle = 'Entered at the counter';
