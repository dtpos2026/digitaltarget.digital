// v1.141.0 — Credits (Udhaar) as the design draws it (SW-33): the customers who owe, biggest first, with how long their oldest unpaid bill has waited,
// and a ledger for the one selected — "Bill #1002 — credit  + Rs 18,000", "Payment — cash  − Rs 5,000". The software keeps credit per BILL (a credit order and
// the payments recorded against it); this groups those by customer and works the other way round too: a payment typed for a customer is spread over
// their bills, oldest first. Pure: orders and payments in, rows out.
import type { CreditPayment, Order } from './types';

export interface CreditBill { order: Order; total: number; paid: number; balance: number; status: 'unpaid' | 'partial' | 'paid' }

export interface CreditCustomer {
  key: string;
  name: string;
  phone: string;
  address: string;
  /** Everything still owed. */
  owes: number;
  billed: number;
  paid: number;
  /** Whole days since the oldest bill that still has a balance; null when nothing is owed. */
  oldestDays: number | null;
  /** Oldest first. */
  bills: CreditBill[];
}

export type CreditFilter = 'all' | 'over30' | 'over60' | 'settled';
export const CREDIT_FILTERS: { key: CreditFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'over30', label: 'Over 30 days' }, { key: 'over60', label: 'Over 60 days' }, { key: 'settled', label: 'Settled' },
];

const digits = (s?: string) => String(s || '').replace(/\D/g, '');
const at = (iso?: string) => { const t = new Date(iso || '').getTime(); return Number.isFinite(t) ? t : 0; };

/** One customer = one phone number (the last ten digits, so 0300… and +92300… are the same person), else one name. */
export function creditKey(o: Pick<Order, 'creditCustomerName' | 'creditCustomerPhone' | 'customer'>): string {
  const phone = digits(o.creditCustomerPhone || o.customer?.phone);
  if (phone.length >= 7) return `p:${phone.slice(-10)}`;
  const name = String(o.creditCustomerName || o.customer?.name || '').trim().toLowerCase();
  return name ? `n:${name}` : 'walk-in';
}

export function creditName(o: Pick<Order, 'creditCustomerName' | 'customer'>): string {
  return String(o.creditCustomerName || o.customer?.name || '').trim() || 'Walk-in';
}

export const daysSince = (iso: string | undefined, now = Date.now()): number => Math.max(0, Math.floor((now - at(iso)) / 86_400_000));

/** The words in the "Oldest bill" column. */
export function oldestLabel(days: number | null): string {
  if (days == null) return '—';
  if (days < 1) return 'today';
  return days === 1 ? '1 day' : `${days} days`;
}

/** Customers with the bills and payments behind them. Biggest debt first; settled customers last. */
export function creditCustomers(orders: Order[], payments: Pick<CreditPayment, 'orderId' | 'amount'>[], now = Date.now()): CreditCustomer[] {
  const paidOn = new Map<string, number>();
  for (const p of payments) paidOn.set(p.orderId, (paidOn.get(p.orderId) || 0) + (Number(p.amount) || 0));
  const map = new Map<string, CreditCustomer>();
  for (const o of orders) {
    const total = Number(o.grandTotal) || 0;
    const paid = paidOn.get(o.id) || 0;
    const balance = Math.max(0, total - paid);
    const bill: CreditBill = { order: o, total, paid, balance, status: paid <= 0 ? 'unpaid' : balance <= 0 ? 'paid' : 'partial' };
    const key = creditKey(o);
    const cur = map.get(key) || { key, name: creditName(o), phone: '', address: '', owes: 0, billed: 0, paid: 0, oldestDays: null, bills: [] };
    cur.bills.push(bill);
    cur.owes += balance; cur.billed += total; cur.paid += paid;
    cur.phone = cur.phone || String(o.creditCustomerPhone || o.customer?.phone || '');
    cur.address = cur.address || String(o.creditCustomerAddress || o.customer?.address || '');
    map.set(key, cur);
  }
  const out = [...map.values()];
  for (const c of out) {
    c.bills.sort((a, b) => at(a.order.createdAt) - at(b.order.createdAt));
    const oldest = c.bills.find(b => b.balance > 0);
    c.oldestDays = oldest ? daysSince(oldest.order.createdAt, now) : null;
    c.owes = Math.round(c.owes * 100) / 100;
  }
  return out.sort((a, b) => Number(b.owes > 0) - Number(a.owes > 0) || b.owes - a.owes || a.name.localeCompare(b.name));
}

export function matchesFilter(c: CreditCustomer, f: CreditFilter): boolean {
  if (f === 'settled') return c.owes <= 0;
  if (c.owes <= 0) return false;
  if (f === 'over30') return (c.oldestDays ?? 0) > 30;
  if (f === 'over60') return (c.oldestDays ?? 0) > 60;
  return true;
}

export function matchesSearch(c: CreditCustomer, q: string): boolean {
  const s = q.trim().toLowerCase().replace(/^#/, '');
  if (!s) return true;
  return c.name.toLowerCase().includes(s) || digits(c.phone).includes(digits(s) || '\u0000') || c.phone.includes(s) || c.bills.some(b => String(b.order.orderNumber).includes(s));
}

/** "Rs 148,600 outstanding · 11 customers" — the customers who actually owe. */
export function creditSubtitle(all: CreditCustomer[], fmt: (n: number) => string): string {
  const owing = all.filter(c => c.owes > 0);
  const sum = owing.reduce((s, c) => s + c.owes, 0);
  return `${fmt(sum)} outstanding · ${owing.length} ${owing.length === 1 ? 'customer' : 'customers'}`;
}

export interface LedgerEntry {
  id: string;
  kind: 'bill' | 'payment';
  at: number;
  label: string;
  /** Plus for a bill (it adds to what is owed), minus for a payment. */
  amount: number;
  orderId: string;
  orderNumber: number;
  paymentId?: string;
  note: string;
}

const METHOD: Record<string, string> = { cash: 'cash', card: 'card', online: 'online' };

/** "Bill #1002 — credit  + Rs 18,000", "Payment — cash  − Rs 5,000" — newest first. */
export function creditLedger(c: CreditCustomer, payments: CreditPayment[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  const numberOf = new Map(c.bills.map(b => [b.order.id, b.order.orderNumber] as const));
  for (const b of c.bills) {
    out.push({ id: `b:${b.order.id}`, kind: 'bill', at: at(b.order.createdAt), label: `Bill #${b.order.orderNumber} — credit`, amount: b.total, orderId: b.order.id, orderNumber: b.order.orderNumber, note: b.balance > 0 && b.paid > 0 ? 'partly paid' : '' });
  }
  for (const p of payments) {
    if (!numberOf.has(p.orderId)) continue;
    const no = numberOf.get(p.orderId)!;
    out.push({
      id: `p:${p.id}`, kind: 'payment', at: at(p.date), label: `Payment — ${METHOD[p.method] || p.method}`, amount: -(Number(p.amount) || 0), orderId: p.orderId, orderNumber: no, paymentId: p.id,
      note: [`on #${no}`, p.receivedBy ? `by ${p.receivedBy}` : '', p.note || ''].filter(Boolean).join(' · '),
    });
  }
  return out.sort((a, b) => b.at - a.at || (a.kind === 'bill' ? 1 : -1));
}

/**
 * A payment typed for a customer, spread over their bills oldest first, never over a bill's balance.
 * `left` is what could not be placed (more than the customer owes).
 */
export function allocatePayment(bills: CreditBill[], amount: number): { parts: { orderId: string; orderNumber: number; amount: number }[]; left: number } {
  let rest = Math.round((Number(amount) || 0) * 100) / 100;
  const parts: { orderId: string; orderNumber: number; amount: number }[] = [];
  for (const b of bills.filter(x => x.balance > 0).sort((x, y) => at(x.order.createdAt) - at(y.order.createdAt))) {
    if (rest <= 0) break;
    const take = Math.min(rest, b.balance);
    parts.push({ orderId: b.order.id, orderNumber: b.order.orderNumber, amount: Math.round(take * 100) / 100 });
    rest = Math.round((rest - take) * 100) / 100;
  }
  return { parts, left: Math.max(0, rest) };
}
