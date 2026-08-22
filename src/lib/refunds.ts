// ============================================================
// v1.15.0 — REFUNDS
//
// Until now the POS had no way to return money. Reports inferred
// "refunds" from voided orders, which is the wrong accounting model and
// is why the client's Shift Report showed 0 refunded products even when
// money had been handed back.
//
// VOID vs REFUND — they are different events and must stay different:
//
//   VOID    the sale never completed. Nothing was kept, nothing is
//           returned. It leaves the sales figures entirely.
//   REFUND  the sale DID complete and was counted. Money is handed back
//           afterwards. The original sale stays in the books and the
//           refund appears as its own negative event.
//
// Collapsing the two would misstate takings on any day with both.
//
// This module is pure so the money rules can be proved by test:
//   • never refund more than was actually paid
//   • never refund more units than were sold
//   • limits are CUMULATIVE across several partial refunds
//   • tax is returned in the same proportion it was charged
// ============================================================

import { round2 } from './taxEngine';
import type { Order, CartItem } from './types';

export interface RefundLine {
  /** Cart-line id on the original order. */
  lineId: string;
  menuItemId: string;
  name: string;
  /** Units being returned in THIS refund. */
  quantity: number;
  /** Per-unit value, excluding tax, after any bill discount. */
  unitAmount: number;
  /** quantity × unitAmount. */
  amount: number;
}

export interface RefundPayment {
  method: string;
  amount: number;
}

export interface Refund {
  id: string;
  orderId: string;
  orderNumber: number;
  at: string;
  by: string;
  reason: string;
  kind: 'full' | 'partial';
  lines: RefundLine[];
  /** How the money went back (cash / card / NETS …). */
  payments: RefundPayment[];
  /** Goods value returned, excluding tax. */
  subtotal: number;
  /** Tax returned, proportional to the goods value. */
  tax: number;
  /** What the customer actually receives. */
  total: number;
  /** Whether the returned units were put back into stock. */
  restocked: boolean;
  deviceId: string;
}

// ---------- limits ----------

/** Units already refunded for one line, across every earlier refund. */
export function refundedQtyForLine(lineId: string, priorRefunds: Refund[]): number {
  let n = 0;
  for (const r of priorRefunds || []) {
    for (const l of r.lines || []) {
      if (l.lineId === lineId) n += Number(l.quantity) || 0;
    }
  }
  return n;
}

/** Units still returnable on a line — sold minus already refunded. */
export function refundableQty(line: CartItem, priorRefunds: Refund[]): number {
  const sold = Number(line.quantity) || 0;
  return Math.max(0, sold - refundedQtyForLine(line.id, priorRefunds));
}

/** Money already returned on an order, across every earlier refund. */
export function refundedTotalForOrder(priorRefunds: Refund[]): number {
  return round2((priorRefunds || []).reduce((s, r) => s + (Number(r.total) || 0), 0));
}

/**
 * The most that can still be returned on this order.
 *
 * Anchored to what the customer actually PAID, not the bill total: a
 * partially-paid bill must never refund more cash than it took, and a
 * bill settled with loyalty points cannot return more than the money part.
 */
export function maxRefundable(order: Order, priorRefunds: Refund[]): number {
  const paid = Number(order.amountPaid ?? order.grandTotal) || 0;
  return Math.max(0, round2(paid - refundedTotalForOrder(priorRefunds)));
}

// ---------- building a refund ----------

export interface RefundRequest {
  /** lineId -> units to return. Omit or 0 to skip a line. */
  quantities: Record<string, number>;
  reason: string;
  by: string;
  /** How the money is being returned. Must sum to the refund total. */
  payments: RefundPayment[];
  restock: boolean;
}

export interface RefundValidation {
  ok: boolean;
  errors: string[];
  /** Computed preview — safe to show before committing. */
  preview?: Omit<Refund, 'id' | 'at' | 'deviceId' | 'orderId' | 'orderNumber'>;
}

/**
 * Per-unit value of a line AFTER the bill discount, excluding tax.
 *
 * A bill-level discount reduces what the customer paid, so a refund must
 * return the discounted value — otherwise refunding every line hands back
 * more than was ever collected.
 */
export function netUnitValue(line: CartItem, order: Order): number {
  const qty = Number(line.quantity) || 0;
  if (qty <= 0) return 0;
  const lineTotal = Number(line.lineTotal) || 0;
  const itemsSubtotal = (order.items || []).reduce((s, l) => s + (Number(l.lineTotal) || 0), 0);
  const discount = Number(order.discount) || 0;
  const share = itemsSubtotal > 0 ? lineTotal / itemsSubtotal : 0;
  const netLine = round2(lineTotal - discount * share);
  return round2(netLine / qty);
}

/** Effective tax rate actually charged on this bill. */
export function effectiveTaxRate(order: Order): number {
  const tax = Number(order.tax) || 0;
  if (tax <= 0) return 0;
  const itemsSubtotal = (order.items || []).reduce((s, l) => s + (Number(l.lineTotal) || 0), 0);
  const base = itemsSubtotal - (Number(order.discount) || 0) + (Number(order.serviceCharge) || 0);
  return base > 0 ? tax / base : 0;
}

export function buildRefund(
  order: Order,
  priorRefunds: Refund[],
  req: RefundRequest,
): RefundValidation {
  const errors: string[] = [];
  const lines: RefundLine[] = [];

  if (!order?.id) return { ok: false, errors: ['Order not found'] };

  const status = String(order.status || '').toLowerCase();
  if (status === 'void' || status === 'cancelled') {
    return { ok: false, errors: ['A void or cancelled bill cannot be refunded — no money was taken for it'] };
  }
  const paid = Number(order.amountPaid ?? 0);
  if (paid <= 0 && status !== 'paid') {
    return { ok: false, errors: ['No money was taken on this bill — there is nothing to refund'] };
  }

  for (const line of order.items || []) {
    const want = Math.max(0, Number(req.quantities?.[line.id]) || 0);
    if (want <= 0) continue;
    const available = refundableQty(line, priorRefunds);
    if (want > available) {
      errors.push(`${line.name}: ${want} requested, only ${available} can be refunded`);
      continue;
    }
    const unitAmount = netUnitValue(line, order);
    lines.push({
      lineId: line.id,
      menuItemId: line.menuItemId,
      name: line.name,
      quantity: want,
      unitAmount,
      amount: round2(unitAmount * want),
    });
  }

  if (lines.length === 0 && errors.length === 0) {
    errors.push('No item selected');
  }
  if (!req.reason?.trim()) {
    // A refund without a reason is unauditable; a manager reviewing the
    // day should never have to guess why money left the drawer.
    errors.push('A reason for the refund is required');
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const tax = round2(subtotal * effectiveTaxRate(order));
  const total = round2(subtotal + tax);

  const cap = maxRefundable(order, priorRefunds);
  if (total > cap + 0.01) {
    errors.push(`Refund comes to ${total.toFixed(2)}, but the maximum allowed is ${cap.toFixed(2)}`);
  }

  const paidBack = round2((req.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
  if (Math.abs(paidBack - total) > 0.01) {
    errors.push(`The ${paidBack.toFixed(2)} returned does not match the refund total of ${total.toFixed(2)}`);
  }

  const soldUnits = (order.items || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const refundedUnits = lines.reduce((s, l) => s + l.quantity, 0);
  const priorUnits = (priorRefunds || []).reduce(
    (s, r) => s + (r.lines || []).reduce((n, l) => n + l.quantity, 0), 0,
  );
  const kind: 'full' | 'partial' = refundedUnits + priorUnits >= soldUnits ? 'full' : 'partial';

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    preview: {
      by: req.by || 'staff',
      reason: req.reason.trim(),
      kind,
      lines,
      payments: (req.payments || []).map(p => ({ method: p.method, amount: round2(p.amount) })),
      subtotal,
      tax,
      total,
      restocked: !!req.restock,
    },
  };
}

/** Cash actually taken out of the drawer by a refund. */
export function cashOutOfDrawer(refund: Refund): number {
  return round2(
    (refund.payments || [])
      .filter(p => String(p.method || '').toLowerCase() === 'cash')
      .reduce((s, p) => s + (Number(p.amount) || 0), 0),
  );
}

/** Total units returned — the sample's "Refunded products" figure. */
export function refundedProductCount(refunds: Refund[]): number {
  return (refunds || []).reduce(
    (s, r) => s + (r.lines || []).reduce((n, l) => n + (Number(l.quantity) || 0), 0), 0,
  );
}
