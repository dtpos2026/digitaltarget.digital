// Per-cashier data scoping helper.
//
// Admin / Manager  -> see ALL data (no filtering, can choose a "cashier filter" dropdown).
// Cashier / Order Taker -> see only THEIR OWN orders (created by their user id).
//
// Goal: closing time pe har cashier ka apna hisaab clean aur alag rahe — mix na ho.

import type { Order, User } from './types';
import { getUsers, getCurrentUser, getCurrentBranchId } from './store';

export interface CashierScope {
  userId: string;
  name: string;
  role: string;
  /** true => UI must restrict views to this user's own orders. */
  restrict: boolean;
  /**
   * v1.63.0 — the branch this till is working in, when it is bound to one.
   *
   * REQUESTED: "her branch ka alg alg pos, mukmle software, mamlat alg ho, taky
   * data mix na ho."
   *
   * Null means "every branch", which is correct for an owner or admin and for
   * a single-branch restaurant. It is NOT a fallback for "we could not tell":
   * see branchScopeOf() for why that distinction matters.
   */
  branchId: string | null;
  /** true => this user may see every branch (owner / admin / all_branches). */
  allBranches: boolean;
}

/**
 * v1.63.0 — who may see which branch.
 *
 * Mirrors auth_branch_ids() on the server deliberately: owner and admin see
 * every branch, everyone else sees the branch they are pinned to. Client and
 * server disagreeing about this is how a screen shows rows the database would
 * refuse, or hides rows it would serve.
 */
function branchScopeOf(u: ReturnType<typeof getCurrentUser>, role: string): {
  branchId: string | null; allBranches: boolean;
} {
  const allBranches = role === 'owner' || role === 'admin' || !!(u as any)?.allBranches;
  if (allBranches) return { branchId: null, allBranches: true };
  // The user's own branch first; the till's selected branch only as a fallback,
  // because a staff member pinned to Burewala must not become a Multan user by
  // someone switching the branch picker.
  const bid = (u as any)?.branchId || getCurrentBranchId() || null;
  return { branchId: bid, allBranches: false };
}

export function getCurrentScope(): CashierScope {
  const u = getCurrentUser();
  const role = (u?.role || localStorage.getItem('pos-user-role') || '').toLowerCase();
  const userId = u?.id || localStorage.getItem('pos-user-id') || '';
  const name = u?.name || localStorage.getItem('pos-user-name') || '—';
  const restrict = role === 'cashier' || role === 'order_taker' || role === 'rider';
  const { branchId, allBranches } = branchScopeOf(u, role);
  return { userId, name, role, restrict, branchId, allBranches };
}

/** Match an order against a target user id (covers cashierId + createdBy fallbacks). */
export function orderBelongsTo(o: Order, userId: string): boolean {
  if (!userId) return false;
  const oid = (o as any).cashierId || (o as any).createdBy || (o as any).createdByUid;
  return oid === userId;
}

/**
 * Auto-scope a list of orders for the currently logged-in user.
 *
 * TWO scopes, and until v1.63.0 only one of them existed.
 *
 *   BY USER   a cashier sees their own bills, so closing time is clean.
 *   BY BRANCH a till in Burewala sees Burewala.
 *
 * The second was missing entirely: this helper filtered by user id and never
 * looked at a branch, and sbLoadCollection() downloads every branch's rows
 * because it filters on tenant_id alone. So an admin at one branch was shown
 * every branch's bills in one list, with nothing to say which was which —
 * "data mix ho raha hai", exactly.
 *
 * Owner and admin still see everything, because they are the people who
 * legitimately need to. That is also what auth_branch_ids() grants them
 * server-side, so the two halves agree.
 *
 * An order with NO branch stamped is kept rather than hidden. Older rows
 * predate branch stamping, and hiding a real bill is far worse than showing
 * one that cannot be placed.
 */
export function scopeOrders(orders: Order[]): Order[] {
  const s = getCurrentScope();
  let out = orders;
  if (s.restrict && s.userId) {
    out = out.filter(o => orderBelongsTo(o, s.userId));
  }
  if (!s.allBranches && s.branchId) {
    out = out.filter(o => {
      const b = (o as any).branchId;
      return !b || b === s.branchId;
    });
  }
  return out;
}

/** The same branch rule, for any row that carries a branchId. */
export function scopeToBranch<T extends { branchId?: string | null }>(rows: T[]): T[] {
  const s = getCurrentScope();
  if (s.allBranches || !s.branchId) return rows;
  return rows.filter(r => !r.branchId || r.branchId === s.branchId);
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
