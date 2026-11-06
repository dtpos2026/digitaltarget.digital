// ============================================================
// PRIVACY (v1.109.0) — "show me my data" and "forget me", the GDPR-style requests every international customer has the
// right to make. PURE: no store, no network — Settings → Privacy hands it the rows and writes back what it returns, so the
// rules here are tested without a browser.
//
// What the rules are (and are not):
//   • EXPORT  — one file with everything the software holds about ONE person: the profile and every order that names them.
//   • ERASE   — the profile is deleted; on every order the person's name, phone, address, e-mail and map position are
//               removed. The sale itself (items, totals, tax, payment) is KEPT: the restaurant must keep its books,
//               and a sale with no name on it is not personal data any more.
//   • The software stores no card number (payment is cash / wallet / the provider's own page), so there is none to export.
// ============================================================
import type { CustomerProfile, Order } from '@/lib/types';
import { normalizePhone } from '@/lib/whatsapp';

export const ERASED_NAME = 'Erased customer';

/** The one key a person is found by: their phone number, as the profile stores it. */
export function phoneKey(phone?: string | null): string {
  if (!phone) return '';
  return normalizePhone(phone) || phone.replace(/[^\d]/g, '');
}

const digits = (s?: string | null) => (s || '').replace(/[^\d]/g, '');

/** Does this order name the person? (delivery customer, credit customer or a website/app customer record) */
export function orderBelongsTo(o: Order, key: string): boolean {
  if (!key) return false;
  const phones = [o.customer?.phone, o.creditCustomerPhone];
  return phones.some(p => !!p && (phoneKey(p) === key || digits(p) === digits(key)));
}

/** The order with the person's details removed. Money, items, tax and payment are untouched. */
export function redactOrderPii(o: Order): Order {
  const next: Order = { ...o };
  if (next.customer) {
    next.customer = { id: 'erased', name: ERASED_NAME, phone: '', address: '' };
  }
  if (next.creditCustomerName !== undefined) next.creditCustomerName = ERASED_NAME;
  if (next.creditCustomerPhone !== undefined) next.creditCustomerPhone = '';
  if (next.creditCustomerAddress !== undefined) next.creditCustomerAddress = '';
  if (next.delivery) {
    const { customerLat, customerLng, customerIp, customerUserAgent, customerCity, ...rest } = next.delivery;
    void customerLat; void customerLng; void customerIp; void customerUserAgent; void customerCity;
    next.delivery = rest as Order['delivery'];
  }
  return next;
}

export interface CustomerExport {
  generatedAt: string;
  subject: { phone: string };
  profile: CustomerProfile | null;
  orders: Pick<Order, 'id' | 'orderNumber' | 'createdAt' | 'status' | 'orderType' | 'grandTotal' | 'items' | 'paymentMethod'>[] & Order[];
  note: string;
}

/** Everything held about one person, as one JSON-ready object. */
export function buildCustomerExport(args: {
  phone: string; profile: CustomerProfile | null | undefined; orders: Order[]; now?: Date;
}): CustomerExport {
  const key = phoneKey(args.phone);
  const mine = args.orders.filter(o => orderBelongsTo(o, key));
  const seen = new Set<string>();
  const unique = mine.filter(o => (seen.has(o.id) ? false : (seen.add(o.id), true)));
  return {
    generatedAt: (args.now ?? new Date()).toISOString(),
    subject: { phone: args.phone },
    profile: args.profile ?? null,
    orders: unique as CustomerExport['orders'],
    note: 'No card number is stored by this software. This file lists the profile and every order that names this person.',
  };
}

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Orders as a spreadsheet-friendly CSV (the JSON file keeps the full detail). */
export function customerExportCsv(exp: CustomerExport): string {
  const head = ['order_number', 'date', 'status', 'type', 'items', 'total'];
  const rows = exp.orders.map(o => [
    o.orderNumber, o.createdAt, o.status, (o as Order).orderType ?? '',
    (o.items || []).map(i => `${i.quantity} x ${i.name}`).join('; '), (o as Order).grandTotal ?? '',
  ]);
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}

/** What an erase would touch — shown to the owner BEFORE they confirm. */
export function erasurePlan(args: { phone: string; profile: CustomerProfile | null | undefined; orders: Order[] }) {
  const key = phoneKey(args.phone);
  const orders = args.orders.filter(o => orderBelongsTo(o, key));
  return { key, hasProfile: !!args.profile, orders: orders.length, orderIds: orders.map(o => o.id) };
}

/** Is a typed confirmation good enough to erase? The owner must retype the phone number. */
export function erasureConfirmed(typed: string, phone: string): boolean {
  const a = digits(typed); const b = digits(phone);
  return a.length >= 5 && a === b;
}
