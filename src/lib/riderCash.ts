// Cash a rider has collected at the door and not yet handed to the restaurant (v1.115.0).
//
// When a rider marks an order delivered, the server (portal_order_delivery) books the full amount still due as a payment made "by the rider"
// (method cash on delivery, with the rider's id). That booking IS the record of what the rider took, so no new table is needed: this reads
// it. The cashier settles with the rider in Riders (Receive cash), which stamps each of those orders with cashHandedOverAt — the rider's
// app and the software then both show the same "to hand over" figure, and it falls to zero the moment the cash is received.
import type { Order } from './types';

export interface CashLine { orderId: string; orderNumber: number | string; amount: number; at: string; handedOverAt?: string }
export interface CashSummary { due: number; dueCount: number; handedOver: number; collectedToday: number; lines: CashLine[] }

const amountOf = (n: unknown): number => { const v = Number(n); return Number.isFinite(v) && v > 0 ? v : 0; };

/** What this rider collected in cash on the orders they delivered, one line per order (a rider may have taken several payments on one). */
export function riderCashLines(orders: Order[], riderId: string): CashLine[] {
  const out: CashLine[] = [];
  for (const o of orders || []) {
    if (!o || (o as { deleted?: boolean }).deleted || o.riderId !== riderId) continue;
    let sum = 0, at = '';
    for (const p of o.payments || []) {
      const by = p as { riderId?: string; method?: string; amount?: number; at?: string };
      if (by.riderId !== riderId || String(by.method || '').toLowerCase() !== 'cash') continue;
      sum += amountOf(by.amount);
      if (!at || (by.at && by.at > at)) at = by.at || at;
    }
    if (sum > 0) out.push({ orderId: o.id, orderNumber: o.orderNumber, amount: sum, at: at || o.deliveredAt || '', handedOverAt: o.cashHandedOverAt });
  }
  return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

export function riderCashSummary(orders: Order[], riderId: string, now: Date = new Date()): CashSummary {
  const lines = riderCashLines(orders, riderId);
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let due = 0, dueCount = 0, handedOver = 0, collectedToday = 0;
  for (const l of lines) {
    if (l.handedOverAt) handedOver += l.amount; else { due += l.amount; dueCount++; }
    if (l.at && Date.parse(l.at) >= t0) collectedToday += l.amount;
  }
  return { due, dueCount, handedOver, collectedToday, lines };
}

/** The orders to save when the cashier receives the rider's cash: copies, each stamped once; an order already settled is left alone. */
export function settleRiderCash(orders: Order[], riderId: string, by: string, atIso: string = new Date().toISOString()): Order[] {
  const open = new Set(riderCashLines(orders, riderId).filter(l => !l.handedOverAt).map(l => l.orderId));
  return (orders || []).filter(o => open.has(o.id)).map(o => ({ ...o, cashHandedOverAt: atIso, cashHandedOverBy: by }));
}
