// v1.142.0 — the Tokens screen as the design draws it (SW-36): the active tokens as large numbers with their state (Ready · Cooking · New), and a history
// table (Token · Bill · Time · Status · Reprints). Pure: orders in, groups and words out. "Active" is a token nobody has collected yet; its state is the kitchen's.
import type { Order } from './types';
import { columnOf, type KdsColumn } from './kitchenBoard';
import { isSameDay } from './tokens';

export type TokenState = KdsColumn;   // new · cooking · ready
export const TOKEN_STATE_LABEL: Record<TokenState, string> = { new: 'New', cooking: 'Cooking', ready: 'Ready' };

export const tokenStatusOf = (o: Pick<Order, 'tokenStatus'>): 'pending' | 'completed' | 'cancelled' => o.tokenStatus || 'pending';

/** A token still on the counter: not collected, not cancelled. */
export const isActiveToken = (o: Pick<Order, 'tokenStatus'>): boolean => tokenStatusOf(o) === 'pending';

/** What the tile says: the kitchen's word for it. */
export function tokenState(o: Pick<Order, 'kitchenStatus'>): TokenState {
  return columnOf(o);
}

const num = (o: Pick<Order, 'tokenNumber'>) => Number(o.tokenNumber) || 0;

/** The tiles: waiting tokens, the lowest number (the one that has waited longest) first. */
export function activeTokens(orders: Order[]): Order[] {
  return orders.filter(isActiveToken).sort((a, b) => num(a) - num(b));
}

export type HistoryRange = 'today' | 'all';
export interface HistoryFilter { range: HistoryRange; q: string; from: string; to: string; cashier: string }

/** The history: collected and cancelled tokens, newest first, by the day, the search, the dates and the cashier. */
export function historyTokens(orders: Order[], f: HistoryFilter, now = new Date()): Order[] {
  const q = f.q.trim().toLowerCase();
  const list = orders.filter(o => !isActiveToken(o)).filter(o => {
    if (f.range === 'today' && !isSameDay(o.createdAt, now)) return false;
    if (f.from && new Date(o.createdAt) < new Date(`${f.from}T00:00:00`)) return false;
    if (f.to && new Date(o.createdAt) > new Date(`${f.to}T23:59:59`)) return false;
    if (f.cashier && o.cashierName !== f.cashier) return false;
    if (q && !(String(o.tokenLabel || '').toLowerCase().includes(q) || String(o.tokenNumber || '').includes(q) || String(o.orderNumber).includes(q) || (o.items || []).some(i => i.name.toLowerCase().includes(q)))) return false;
    return true;
  });
  return list.sort((a, b) => num(b) - num(a) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export const statusWord = (o: Pick<Order, 'tokenStatus'>): string => ({ pending: 'Waiting', completed: 'Collected', cancelled: 'Cancelled' }[tokenStatusOf(o)]);

/** "Counter service · 12 today · 3 waiting · avg 4 m" (+ the day's takings when revenue reporting is on). */
export function tokenSubtitle(s: { total: number; pending: number; avgMinutes: number | null; revenue: number }, showMoney: boolean, fmt: (n: number) => string): string {
  return ['Counter service', `${s.total} today`, `${s.pending} waiting`, s.avgMinutes != null ? `avg ${s.avgMinutes} m` : '', showMoney ? fmt(s.revenue) : ''].filter(Boolean).join(' · ');
}
