// v1.137.0 — the Kitchen display as the design draws it (SW-11): three columns, New · Cooking · Ready; a ticket whose header says the
// order, the type and the table on the left and the age on the right, coloured purple → amber → red as it waits; the items as
// "1 × Zinger Burger" with the cook's note under; ONE button — Start cooking · Bump → Ready · Recall.
// Pure: orders in, words and colours out. The page does the saving.
import type { CartItem, Order } from './types';

export type KdsColumn = 'new' | 'cooking' | 'ready';
export type AgeTone = 'normal' | 'warn' | 'bad';

export const KDS_COLUMNS: { key: KdsColumn; label: string }[] = [
  { key: 'new', label: 'New' }, { key: 'cooking', label: 'Cooking' }, { key: 'ready', label: 'Ready' },
];

/** Where a ticket stands. "Accepted" is the old half-step between New and Cooking: still waiting for a cook, so still New. */
export function columnOf(o: Pick<Order, 'kitchenStatus'>): KdsColumn {
  if (o.kitchenStatus === 'ready') return 'ready';
  if (o.kitchenStatus === 'preparing') return 'cooking';
  return 'new';
}

const TYPE_WORD: Record<string, string> = { dining: 'Dining', takeaway: 'Takeaway', delivery: 'Delivery', foodpanda: 'Foodpanda' };

/** "#1043 · Dining T-07" — the order, how it leaves, and where it sits. */
export function ticketTitle(o: Pick<Order, 'orderNumber' | 'orderType' | 'tableName'> & { tableLabel?: string }): string {
  const type = TYPE_WORD[String(o.orderType)] || String(o.orderType || '');
  const table = o.orderType === 'dining' ? (o.tableName || o.tableLabel || '') : '';
  return `#${o.orderNumber} · ${[type, table].filter(Boolean).join(' ')}`.replace(/ · $/, '');
}

/** Whole minutes between two instants (never negative). */
export function minutesSince(iso: string | undefined, now = Date.now()): number {
  const t = new Date(iso || '').getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 60000));
}

/** How long the ticket has waited to be worked: from the order for New and Cooking, from the moment it was bumped for Ready. */
export function waitedMinutes(o: Pick<Order, 'createdAt' | 'kitchenStatus' | 'kitchenStatusAt'>, now = Date.now()): number {
  return minutesSince(columnOf(o) === 'ready' ? (o.kitchenStatusAt || o.createdAt) : o.createdAt, now);
}

/** "1 min" · "9 min" · "waiting 2 min" (a Ready ticket is waiting for someone to take it). */
export function ageLabel(col: KdsColumn, mins: number): string {
  return col === 'ready' ? `waiting ${mins} min` : `${mins} min`;
}

/** Purple until the cook should have started caring, amber while it is slipping, red once it is late (the restaurant's own two limits). */
export function ageTone(mins: number, prepMinutes: number, warnMinutes: number): AgeTone {
  const prep = Math.max(1, prepMinutes || 5);
  const warn = Math.max(prep + 1, warnMinutes || 10);
  if (mins >= warn) return 'bad';
  if (mins >= prep) return 'warn';
  return 'normal';
}

/** "1 × Chicken Tikka Pizza (L)" — the size and the add-ons are part of what the cook makes. */
export function itemLine(it: Pick<CartItem, 'quantity' | 'name' | 'variantName' | 'addOns'>): string {
  const extra = [it.variantName, ...(it.addOns || []).map(a => `+ ${a.name}`)].filter(Boolean).join(', ');
  return `${it.quantity} × ${it.name}${extra ? ` (${extra})` : ''}`;
}

export interface KdsAction { label: string; to: 'preparing' | 'ready' | 'recall' }

/** The one button on a ticket. */
export function actionFor(col: KdsColumn): KdsAction {
  if (col === 'new') return { label: 'Start cooking', to: 'preparing' };
  if (col === 'cooking') return { label: 'Bump → Ready', to: 'ready' };
  return { label: 'Recall', to: 'recall' };
}

/** "Main Branch" in "Kitchen · Main Branch"; a single-branch restaurant just gets its own name. */
export function boardTitle(branchName?: string | null, restaurantName?: string | null): string {
  const where = (branchName || '').trim() || (restaurantName || '').trim();
  return where ? `Kitchen · ${where}` : 'Kitchen';
}
