// Centralized "order ready" event bus + de-duplication.
// Both the auto-ready timer and manual ready actions (DeliveryBoard /
// Kitchen page / RiderApp) call notifyReady(order). Subscribers (rider
// portal, takeaway side panel, dine-in toaster) listen for the
// "dt-order-ready" CustomEvent and react.
import type { Order } from './types';

// P7 fix: persist across reloads with a TTL so refreshing the page doesn't
// re-fire beeps for orders that were already announced. Old `sessionStorage`
// behavior cleared on every reload and caused false alarms.
const SEEN_KEY = 'dt-ready-seen-v2'; // localStorage — { [orderId]: timestamp }
const SEEN_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface ReadyEvent {
  orderId: string;
  orderNumber: number;
  orderType: 'dine-in' | 'takeaway' | 'delivery';
  customerName?: string;
  customerPhone?: string;
  table?: string;       // human-friendly table name/number (NOT raw id)
  tableId?: string;
  total: number;
  at: string; // ISO
}


function seenMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    // prune expired
    for (const k of Object.keys(obj)) {
      if (now - (obj[k] || 0) > SEEN_TTL_MS) delete obj[k];
    }
    return obj;
  } catch {
    return {};
  }
}
function saveSeen(m: Record<string, number>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(m));
  } catch {}
}

/** Mark this orderId as already-notified so we never duplicate (per device, 6h). */
export function markReadyNotified(orderId: string) {
  const m = seenMap();
  m[orderId] = Date.now();
  saveSeen(m);
}

export function wasReadyNotified(orderId: string): boolean {
  return !!seenMap()[orderId];
}

export function notifyReady(order: Order) {
  if (typeof window === 'undefined') return;
  if (wasReadyNotified(order.id)) return;
  // Prefer human-friendly table name. Fall back to tableLabel (QR), then nothing.
  // Never expose raw tableId (e.g. "mqbzee9hl50snt") in user notifications.
  const tableName = (order as any).tableName || (order as any).tableLabel || undefined;
  const ev: ReadyEvent = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    orderType: (order.orderType as any) || 'dine-in',
    customerName: order.customer?.name,
    customerPhone: order.customer?.phone,
    table: tableName,
    tableId: (order as any).tableId,
    total: order.grandTotal || 0,
    at: new Date().toISOString(),
  };
  markReadyNotified(order.id);
  try {
    window.dispatchEvent(new CustomEvent<ReadyEvent>('dt-order-ready', { detail: ev }));
  } catch {}
}


export function onReady(cb: (ev: ReadyEvent) => void): () => void {
  const handler = (e: Event) => {
    try { cb((e as CustomEvent<ReadyEvent>).detail); } catch {}
  };
  window.addEventListener('dt-order-ready', handler);
  return () => window.removeEventListener('dt-order-ready', handler);
}
