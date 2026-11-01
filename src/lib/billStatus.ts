// ============================================================
// BILL STATUS — one vocabulary for every screen that lists bills.
//
// The order's stored `status` is unchanged (running / hold / partial / paid /
// cancelled / void / …); this only decides how a bill is LABELLED, so a
// cashier can tell at a glance:
//
//   UNPAID          open bill, nothing received yet
//   HOLD — UNPAID   finished (e.g. the dining guest has eaten) but not paid —
//                   still an active financial transaction, NOT cancelled
//   PARTIALLY PAID  some money received, a balance is due
//   PAID            settled
//   CANCELLED/VOID  closed under the existing cancel/void rules
//
// It also decides whether paying a bill prints the receipt, so the payment
// itself never depends on the printer.
// ============================================================
import type { Order, RestaurantSettings } from './types';

export type BillStatusKey =
  | 'unpaid' | 'hold' | 'partial' | 'paid' | 'cancelled' | 'void' | 'complimentary'
  | 'credit' | 'credit_paid' | 'pending_approval' | 'rejected';

export interface BillStatusView {
  key: BillStatusKey;
  label: string;
  /** Tailwind classes for a badge in the existing design tokens. */
  className: string;
  /** Money is still owed on this bill. */
  awaitingPayment: boolean;
}

const TONE = {
  alert: 'bg-status-warning text-status-warning-foreground border-status-warning font-extrabold',
  danger: 'bg-destructive/10 text-destructive border-destructive/40 font-bold',
  success: 'bg-status-success/15 text-status-success border-status-success/40 font-bold',
  muted: 'bg-muted text-muted-foreground border-border font-bold',
  info: 'bg-status-info/15 text-status-info border-status-info/40 font-bold',
};

export function billStatus(o: Pick<Order, 'status' | 'amountPaid' | 'grandTotal'>): BillStatusView {
  switch (o.status) {
    case 'hold':
      return { key: 'hold', label: 'HOLD — UNPAID', className: TONE.alert, awaitingPayment: true };
    case 'running':
      return (o.amountPaid || 0) > 0
        ? { key: 'partial', label: 'PARTIALLY PAID', className: TONE.danger, awaitingPayment: true }
        : { key: 'unpaid', label: 'UNPAID', className: TONE.danger, awaitingPayment: true };
    case 'partial':
      return { key: 'partial', label: 'PARTIALLY PAID', className: TONE.danger, awaitingPayment: true };
    case 'paid':
      return { key: 'paid', label: 'PAID', className: TONE.success, awaitingPayment: false };
    case 'cancelled':
      return { key: 'cancelled', label: 'CANCELLED', className: TONE.muted, awaitingPayment: false };
    case 'void':
      return { key: 'void', label: 'VOID', className: TONE.muted, awaitingPayment: false };
    case 'complimentary':
      return { key: 'complimentary', label: 'COMPLIMENTARY', className: TONE.info, awaitingPayment: false };
    case 'credit_pending':
      return { key: 'credit', label: 'CREDIT — UNPAID', className: TONE.alert, awaitingPayment: true };
    case 'credit_received':
      return { key: 'credit_paid', label: 'CREDIT — PAID', className: TONE.success, awaitingPayment: false };
    case 'pending_approval':
      return { key: 'pending_approval', label: 'AWAITING APPROVAL', className: TONE.info, awaitingPayment: true };
    case 'rejected':
      return { key: 'rejected', label: 'REJECTED', className: TONE.muted, awaitingPayment: false };
    default:
      return { key: 'unpaid', label: String(o.status || 'UNPAID').toUpperCase(), className: TONE.muted, awaitingPayment: true };
  }
}

/**
 * What paying this bill should do with the customer receipt.
 *  - 'print'        queue the paid receipt (the long-standing default)
 *  - 'skip-dining'  "Print Receipt Automatically on Dining Payment" is OFF
 *  - 'skip-all'     "No receipt on pay" is ON for every order type
 */
export type ReceiptOnPay = 'print' | 'skip-dining' | 'skip-all';

export function receiptOnPay(order: Pick<Order, 'orderType'>, settings: Pick<RestaurantSettings, 'noReceiptOnPay' | 'diningReceiptOnPay'>): ReceiptOnPay {
  if (settings.noReceiptOnPay) return 'skip-all';
  if (order.orderType === 'dining' && settings.diningReceiptOnPay === false) return 'skip-dining';
  return 'print';
}

/**
 * The cashier's message after a payment. The payment is reported on its own
 * terms — a printer that is off, missing or out of paper never turns a paid
 * bill into an error, and "printing" is only said when a job was queued.
 */
export function paidMessage(orderNumber: number | string, decision: ReceiptOnPay, queued: boolean): string {
  const head = `Bill #${orderNumber} paid`;
  if (decision === 'skip-dining') return `${head} — receipt not printed (automatic dining receipt is off; reprint from Retrieve if needed)`;
  if (decision === 'skip-all') return head;
  return queued ? `${head} — receipt sent to the printer` : `${head} — the receipt was not queued; reprint it from Retrieve`;
}
