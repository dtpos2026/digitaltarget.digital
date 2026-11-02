// Which orders the auto-ready kitchen timer (components/AutoReadyTimer.tsx) may still mark ready — v1.85.0.
import type { Order } from './types';

/** Never in the kitchen, or finished with it. */
const NOT_COOKING = new Set<string>(['void', 'cancelled', 'rejected', 'pending_approval', 'credit_received']);
/** Settled bills: still cooking only when the kitchen says so (a pay-first takeaway on the KDS). */
const SETTLED = new Set<string>(['paid', 'complimentary', 'credit_pending']);
const KITCHEN_FLOW = new Set<string>(['pending', 'accepted', 'preparing']);
/** Never sweep history: an order older than this that is still not ready is stale data, not food on the pass. */
export const AUTO_READY_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * v1.85.0 — only food that is really on its way. Before, every bill that was not void/cancelled and had no
 * "ready"/"served" kitchen status counted: a paid bill settled outside the POS (which stamps "served"), an online
 * order still awaiting approval, a bill from last week. On start-up the timer then re-saved and announced "READY" —
 * a beep and a toast each — for every one of them, which froze a till holding a long order history.
 */
export function isStillActiveCooking(order: Order, now = Date.now()): boolean {
  if (!order || NOT_COOKING.has(order.status as string)) return false;
  // already ready / past ready?
  if (order.kitchenStatus === 'ready' || order.kitchenStatus === 'served' || order.kitchenStatus === 'delivered') return false;
  if (order.deliveryStatus && ['ready', 'rider_assigned', 'rider_picked', 'onway', 'rider_reached', 'delivered', 'cancelled'].includes(order.deliveryStatus)) return false;
  if (SETTLED.has(order.status as string) && !KITCHEN_FLOW.has(order.kitchenStatus || '')) return false;
  const started = new Date(order.cookingStartedAt || order.createdAt || 0).getTime();
  if (!Number.isFinite(started) || started <= 0 || now - started > AUTO_READY_MAX_AGE_MS) return false;
  return true;
}
