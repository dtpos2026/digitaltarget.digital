// ============================================================
// Online Order Approval — mode resolution + approve / reject helpers.
// Source-aware: each incoming order (website / QR / order_taker / delivery)
// can be auto-processed or held for cashier review.
// ============================================================
import { getSettings, saveOrder, getOrders } from './store';
import { enqueueKot } from './printQueue';
import { makeEditLog } from './orderHistory';
import type { Order, OnlineSourceKey, ApprovalMode } from './types';

/** Map an Order's `source` (and order type) to our 5 approval buckets. */
export function sourceKeyForOrder(o: Order): OnlineSourceKey | null {
  const src = (o.source || '') as string;
  if (src === 'order_taker') return 'order_taker';
  if (src === 'website') {
    // Website orders that are delivery type fall under "delivery" bucket
    if (o.orderType === 'delivery') return 'delivery';
    return 'website';
  }
  if (src === 'qr') {
    return o.tableId || o.tableName ? 'qr' : 'takeaway_qr';
  }
  return null; // POS / WhatsApp / phone — not part of approval workflow
}

/** Resolve effective mode for an order's source. */
export function resolveApprovalMode(o: Order): ApprovalMode {
  const key = sourceKeyForOrder(o);
  if (!key) return 'auto';
  const s = getSettings();
  const override = s.sourceApprovalMode?.[key];
  if (override === 'auto' || override === 'manual') return override;
  return s.onlineOrderApprovalMode || 'auto';
}

/** Should a freshly-arrived online order be auto-processed? */
export function shouldAutoApprove(o: Order): boolean {
  return resolveApprovalMode(o) === 'auto';
}

/** Mark an order as awaiting cashier approval. Blocks KOT/KDS/sales counting. */
export function holdForApproval(o: Order, reason?: string): Order {
  const next: Order = {
    ...o,
    status: 'pending_approval',
    approvalRequired: true,
    editLogs: [...(o.editLogs || []), makeEditLog('STATUS', { oldValue: o.status, newValue: 'pending_approval', reason: reason || 'Awaiting approval' })],
  };
  saveOrder(next);
  return next;
}

/** Approve a pending order — flip status to running and enqueue KOT. */
export function approveOrder(orderId: string, opts: { userId?: string; userName?: string } = {}): Order | null {
  const order = getOrders().find(o => o.id === orderId);
  if (!order) return null;
  const now = new Date().toISOString();
  const next: Order = {
    ...order,
    status: 'running',
    approvalRequired: false,
    approvedBy: opts.userId,
    approvedByName: opts.userName,
    approvedAt: now,
    editLogs: [...(order.editLogs || []), makeEditLog('STATUS', { oldValue: 'pending_approval', newValue: 'running', reason: `Approved by ${opts.userName || 'user'}` })],
  };
  saveOrder(next);
  try { enqueueKot(next); } catch {}
  return next;
}

/** Reject a pending order with a reason — kept in history, never deleted. */
export function rejectOrder(orderId: string, reason: string, opts: { userId?: string; userName?: string } = {}): Order | null {
  const order = getOrders().find(o => o.id === orderId);
  if (!order) return null;
  const now = new Date().toISOString();
  const next: Order = {
    ...order,
    status: 'rejected',
    approvalRequired: false,
    rejectedBy: opts.userId,
    rejectedByName: opts.userName,
    rejectedAt: now,
    rejectedReason: reason,
    editLogs: [...(order.editLogs || []), makeEditLog('CANCEL_ORDER', { oldValue: 'pending_approval', newValue: 'rejected', reason })],
  };
  saveOrder(next);
  return next;
}

export const REJECT_REASONS = [
  'Fake Order',
  'Customer Not Responding',
  'Wrong Address',
  'Duplicate Order',
  'Out Of Delivery Area',
  'Restaurant Closed',
  'Other',
] as const;

export const SOURCE_LABELS: Record<OnlineSourceKey, string> = {
  website: 'Customer Website',
  qr: 'Table QR / Dine-In QR',
  takeaway_qr: 'Takeaway QR',
  order_taker: 'Order Taker',
  delivery: 'Delivery Portal',
};
