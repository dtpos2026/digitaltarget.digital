// ============================================================
// Restricted action policy
// ------------------------------------------------------------
// Order Takers may ONLY create/edit an order and send it to the
// kitchen. Money-touching actions (payment, discount, void, refund,
// free table, bill close) are restricted and need a Manager PIN.
// ============================================================
import type { AuditAction } from './staffAudit';

export type GuardedAction =
  | 'payment'
  | 'make-payment'
  | 'free-table'
  | 'discount'
  | 'void'
  | 'refund'
  | 'bill-close';

export const GUARDED_ACTION_TITLES: Record<GuardedAction, string> = {
  'payment': 'Take Payment',
  'make-payment': 'Make Payment',
  'free-table': 'Free Table',
  'discount': 'Apply Discount',
  'void': 'Void Bill',
  'refund': 'Refund',
  'bill-close': 'Close Bill',
};

/** Audit action recorded when a guarded action finally runs. */
export const GUARDED_AUDIT: Record<GuardedAction, AuditAction> = {
  'payment': 'PAYMENT',
  'make-payment': 'PAYMENT',
  'free-table': 'FREE_TABLE',
  'discount': 'DISCOUNT',
  'void': 'VOID',
  'refund': 'REFUND',
  'bill-close': 'BILL_CLOSE',
};

/** Roles that can perform every guarded action without approval. */
const FULL_ROLES = ['admin', 'owner', 'manager'];

/** Roles that always need a manager approval for guarded actions. */
const RESTRICTED_ROLES = ['order_taker', 'rider'];

export function currentPosRole(): string {
  try { return (localStorage.getItem('pos-user-role') || '').toLowerCase(); } catch { return ''; }
}

/** True when the current staff role may run the action directly. */
export function canRunDirectly(action: GuardedAction, role = currentPosRole()): boolean {
  if (FULL_ROLES.includes(role)) return true;
  if (RESTRICTED_ROLES.includes(role)) return false;
  // Cashier: money handling is part of the job, but void/refund still needs a manager.
  if (role === 'cashier') return !['void', 'refund'].includes(action);
  return false;
}

/** True when the role is limited to order create / edit / send-to-kitchen. */
export function isOrderOnlyRole(role = currentPosRole()): boolean {
  return RESTRICTED_ROLES.includes(role);
}
