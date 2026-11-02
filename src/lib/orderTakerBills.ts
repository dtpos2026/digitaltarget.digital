// ============================================================
// DT ORDER TAKER — the bills screen's rules (OTK-08 Running bills, OTK-09 Bill detail), v1.92.0.
// Pure functions over the same orders the cashier's Running Bills page lists (the caller scopes them with
// lib/cashierScope.scopeOrders: an order taker sees their own).
// ============================================================
import type { Order } from './types';

const OPEN: Order['status'][] = ['running', 'hold', 'partial', 'pending_approval', 'credit_pending'];

export type BillState = 'new' | 'cooking' | 'ready' | 'served' | 'waiting' | 'hold';
export interface BillRow {
  id: string; orderNumber: number; label: string; items: number; total: number; age: number; state: BillState; stateLabel: string; order: Order;
}

export function billState(o: Order): { state: BillState; label: string } {
  if (o.status === 'pending_approval') return { state: 'waiting', label: 'Waiting for approval' };
  if (o.status === 'hold') return { state: 'hold', label: 'On hold' };
  switch (o.kitchenStatus) {
    case 'ready': return { state: 'ready', label: 'Ready' };
    case 'preparing': return { state: 'cooking', label: 'Cooking' };
    case 'served': case 'delivered': return { state: 'served', label: 'Served' };
    case 'accepted': return { state: 'cooking', label: 'Accepted' };
    default: {
      if (!o.kotPrinted) return { state: 'new', label: 'Not sent yet' };
      // sent once, but lines were added since: the kitchen does not have those
      const unsent = (o.items || []).some(i => (Number(i.quantity) || 0) > 0 && (Number(i.printedQty) || 0) < (Number(i.quantity) || 0));
      return { state: 'new', label: unsent ? 'Update not sent' : 'Sent to kitchen' };
    }
  }
}

export function openBills(orders: Order[], query = '', now = Date.now()): BillRow[] {
  const q = query.trim().toLowerCase();
  return orders
    .filter(o => OPEN.includes(o.status))
    .map<BillRow>(o => {
      const st = billState(o);
      return {
        id: o.id, orderNumber: o.orderNumber, order: o,
        label: o.tableName ? `Table ${o.tableName}` : o.orderType === 'delivery' ? 'Delivery' : o.orderType === 'takeaway' ? 'Takeaway' : o.tokenLabel || 'Order',
        items: (o.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0),
        total: Number(o.grandTotal) || 0,
        age: Math.max(0, Math.floor((now - Date.parse(o.createdAt)) / 60000)) || 0,
        state: st.state, stateLabel: st.label,
      };
    })
    .filter(r => !q || String(r.orderNumber).includes(q) || r.label.toLowerCase().includes(q) || (r.order.customer?.name || '').toLowerCase().includes(q))
    .sort((a, b) => b.age - a.age);
}

/** "12 min", "1 h 5 min". */
export function ageText(m: number): string {
  return m < 1 ? 'just now' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** One line of a bill with whether the kitchen has been told: lines beyond what was printed are "not sent". */
export function billLines(o: Order): { key: string; text: string; note?: string; total: number; sent: boolean }[] {
  return (o.items || []).filter(i => (Number(i.quantity) || 0) > 0).map((i, n) => ({
    key: `${i.id}:${n}`,
    text: `${i.quantity} × ${i.name}${i.variantName ? ` (${i.variantName})` : ''}`,
    note: i.note?.trim() || undefined,
    total: Number(i.lineTotal) || 0,
    sent: (Number(i.printedQty) || 0) >= (Number(i.quantity) || 0),
  }));
}

/** Where to reach the cashier: the restaurant's own number from Settings, in the form a tel: link wants. */
export function cashierPhone(s: { phone1?: string; phone2?: string } | null | undefined): string | null {
  const p = (s?.phone1 || s?.phone2 || '').replace(/[^\d+]/g, '');
  return p.length >= 6 ? p : null;
}
