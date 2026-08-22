// Per-cashier data scoping helper.
//
// Admin / Manager  -> see ALL data (no filtering, can choose a "cashier filter" dropdown).
// Cashier / Order Taker -> see only THEIR OWN orders (created by their user id).
//
// Goal: closing time pe har cashier ka apna hisaab clean aur alag rahe — mix na ho.

import type { Order, User } from './types';
import { getUsers, getCurrentUser } from './store';

export interface CashierScope {
  userId: string;
  name: string;
  role: string;
  /** true => UI must restrict views to this user's own orders. */
  restrict: boolean;
}

export function getCurrentScope(): CashierScope {
  const u = getCurrentUser();
  const role = (u?.role || localStorage.getItem('pos-user-role') || '').toLowerCase();
  const userId = u?.id || localStorage.getItem('pos-user-id') || '';
  const name = u?.name || localStorage.getItem('pos-user-name') || '—';
  const restrict = role === 'cashier' || role === 'order_taker' || role === 'rider';
  return { userId, name, role, restrict };
}

/** Match an order against a target user id (covers cashierId + createdBy fallbacks). */
export function orderBelongsTo(o: Order, userId: string): boolean {
  if (!userId) return false;
  const oid = (o as any).cashierId || (o as any).createdBy || (o as any).createdByUid;
  return oid === userId;
}

/**
 * Auto-scope a list of orders for the currently logged-in user.
 * Admin/Manager get the list unchanged. Cashier/OrderTaker get filtered.
 */
export function scopeOrders(orders: Order[]): Order[] {
  const s = getCurrentScope();
  if (!s.restrict || !s.userId) return orders;
  return orders.filter(o => orderBelongsTo(o, s.userId));
}

/**
 * Admin helper — list of cashier-like users for the "Cashier" filter dropdown
 * shown on Dashboard / Reports.
 */
export function listCashierUsers(): User[] {
  return getUsers().filter(u =>
    u.isActive && ['cashier', 'order_taker', 'manager'].includes(u.role)
  );
}

/** Shift start timestamp (ISO) — per user, persisted in localStorage. */
const SHIFT_KEY = (uid: string) => `pos-shift-start-${uid}`;

export function getShiftStart(): string {
  const s = getCurrentScope();
  if (!s.userId) return new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  let v = localStorage.getItem(SHIFT_KEY(s.userId));
  if (!v) {
    v = new Date().toISOString();
    try { localStorage.setItem(SHIFT_KEY(s.userId), v); } catch {}
  }
  return v;
}

export function resetShift(): void {
  const s = getCurrentScope();
  if (!s.userId) return;
  try { localStorage.setItem(SHIFT_KEY(s.userId), new Date().toISOString()); } catch {}
}

/** Filter orders to current shift window (>= shift start). */
export function filterCurrentShift(orders: Order[]): Order[] {
  const start = new Date(getShiftStart()).getTime();
  return orders.filter(o => {
    const t = new Date(o.paidAt || o.createdAt).getTime();
    return t >= start;
  });
}
