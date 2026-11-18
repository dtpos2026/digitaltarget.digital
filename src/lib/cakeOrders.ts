// ============================================================================
// Cake orders (v1.117.2) — a custom cake taken with an advance, baked for a date, handed over when the balance is paid.
//
// A bakery's custom work is not a till sale: the customer orders days ahead, leaves a part payment (the advance), and collects on
// the day. The order holds everything the baker and the counter need — who, what, the message on the cake, the day and time, the
// total, every payment and refund — and refuses what would lose money: a hand-over with a balance still owing, a payment bigger
// than the balance, a refund bigger than what was paid. Pure functions; the store posts the payments to Accounts.
//
//   new → baking → ready → delivered      (new → ready is allowed for a small order; any open order can be cancelled)
//   balance = total − (advances + balances) + refunds       the customer owes this
// ============================================================================
import type { ReportDoc } from '@/lib/reportExport';

export type CakeStatus = 'new' | 'baking' | 'ready' | 'delivered' | 'cancelled';
export type PaymentKind = 'advance' | 'balance' | 'refund';

export interface CakePayment { id: string; kind: PaymentKind; amount: number; method: string; at: string; by?: string; note?: string; txnId?: string }

export interface CakeOrder {
  id: string;
  /** CK-0001 … counted per restaurant */
  number: string;
  createdAt: string;
  createdBy?: string;
  branchId?: string;
  customerName: string;
  phone?: string;
  /** the menu item it is based on (so its recipe feeds stock and cost); none for a fully custom cake */
  menuItemId?: string;
  itemName?: string;
  /** flavour, size, tiers, design */
  description: string;
  /** the text written on the cake */
  message?: string;
  quantity: number;
  weightKg?: number;
  /** YYYY-MM-DD */
  dueDate: string;
  /** HH:MM */
  dueTime?: string;
  handover: 'pickup' | 'delivery';
  address?: string;
  total: number;
  payments: CakePayment[];
  status: CakeStatus;
  notes?: string;
  /** stock was taken for it (the recipe of the linked item) and what the ingredients cost */
  stockPosted?: boolean;
  ingredientCost?: number;
  updatedAt: string;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;

export const OPEN: CakeStatus[] = ['new', 'baking', 'ready'];
export const isOpen = (o: Pick<CakeOrder, 'status'>) => OPEN.includes(o.status);

/** What the customer has paid so far (advances and balances, less refunds). */
export const paidOf = (o: Pick<CakeOrder, 'payments'>): number => r2(o.payments.reduce((s, p) => s + (p.kind === 'refund' ? -num(p.amount) : num(p.amount)), 0));
/** What the customer still owes. Never negative; a cancelled order owes nothing. */
export const balanceOf = (o: Pick<CakeOrder, 'total' | 'payments' | 'status'>): number => (o.status === 'cancelled' ? 0 : Math.max(0, r2(num(o.total) - paidOf(o))));

export function nextNumber(existing: { number: string }[]): string {
  const top = existing.reduce((m, o) => { const n = /^CK-(\d+)$/.exec(o.number || ''); return n ? Math.max(m, Number(n[1])) : m; }, 0);
  return `CK-${String(top + 1).padStart(4, '0')}`;
}

/** Half of the total, rounded up to the next 100 — the usual advance a bakery asks for. */
export const suggestedAdvance = (total: number): number => (num(total) > 0 ? Math.ceil(num(total) / 2 / 100) * 100 : 0);

export interface CakeDraft { customerName: string; phone?: string; description: string; quantity: number; dueDate: string; dueTime?: string; handover: 'pickup' | 'delivery'; address?: string; total: number; advance: number }

/** Why a new order cannot be saved yet (empty = fine). `today` is YYYY-MM-DD. */
export function draftIssues(d: CakeDraft, today: string): string[] {
  const out: string[] = [];
  if (!d.customerName.trim()) out.push('Who is it for? Add the customer’s name');
  if (!(d.phone ?? '').replace(/\D/g, '').length) out.push('Add a phone number so the bakery can reach the customer');
  if (!d.description.trim()) out.push('Describe the cake (flavour, size, design)');
  if (!(num(d.quantity) > 0)) out.push('How many cakes?');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dueDate)) out.push('Pick the day it is needed');
  else if (d.dueDate < today) out.push('The day it is needed is already past');
  if (!(num(d.total) > 0)) out.push('Give the total price');
  if (num(d.advance) < 0) out.push('The advance cannot be negative');
  if (num(d.advance) > num(d.total)) out.push('The advance is more than the total');
  if (d.handover === 'delivery' && !(d.address ?? '').trim()) out.push('Delivery needs an address');
  return out;
}

const NEXT: Record<CakeStatus, CakeStatus[]> = { new: ['baking', 'ready', 'cancelled'], baking: ['ready', 'cancelled'], ready: ['delivered', 'cancelled'], delivered: [], cancelled: [] };

/** May the order move to `to`? A hand-over needs the balance paid first. */
export function canMove(o: CakeOrder, to: CakeStatus): { ok: boolean; reason?: string } {
  if (!NEXT[o.status].includes(to)) return { ok: false, reason: `A ${o.status} order cannot become ${to}` };
  if (to === 'delivered' && balanceOf(o) > 0) return { ok: false, reason: `Collect the balance of ${balanceOf(o)} first` };
  return { ok: true };
}

export interface PayInput { id: string; amount: number; method: string; at: string; by?: string; note?: string; kind?: PaymentKind }

/** Adds a payment (an advance, or the balance) — refused when it is not a positive amount or is more than the balance. */
export function addPayment(o: CakeOrder, p: PayInput): { ok: true; order: CakeOrder; payment: CakePayment } | { ok: false; reason: string } {
  const amount = r2(num(p.amount));
  if (!isOpen(o)) return { ok: false, reason: 'This order is closed' };
  if (!(amount > 0)) return { ok: false, reason: 'Enter an amount' };
  if (amount > balanceOf(o) + 1e-9) return { ok: false, reason: `The balance is only ${balanceOf(o)}` };
  const kind: PaymentKind = p.kind ?? (o.payments.some(x => x.kind !== 'refund') ? 'balance' : 'advance');
  const payment: CakePayment = { id: p.id, kind, amount, method: p.method || 'cash', at: p.at, by: p.by, note: p.note?.trim() || undefined };
  return { ok: true, order: { ...o, payments: [...o.payments, payment], updatedAt: p.at }, payment };
}

/** Cancels an open order; the advance is refunded (a refund payment is added) or kept, as the owner decides. */
export function cancelOrder(o: CakeOrder, refund: boolean, at: string, by: string | undefined, refundId: string): { ok: true; order: CakeOrder; refund?: CakePayment } | { ok: false; reason: string } {
  if (!isOpen(o)) return { ok: false, reason: 'This order is already closed' };
  const paid = paidOf(o);
  const refundPay: CakePayment | undefined = refund && paid > 0 ? { id: refundId, kind: 'refund', amount: paid, method: o.payments[o.payments.length - 1]?.method || 'cash', at, by, note: 'Order cancelled' } : undefined;
  return { ok: true, order: { ...o, status: 'cancelled', payments: refundPay ? [...o.payments, refundPay] : o.payments, notes: o.notes, updatedAt: at }, refund: refundPay };
}

export type DueState = 'overdue' | 'today' | 'tomorrow' | 'later' | 'done';
const utc = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1); };
export function dueState(o: Pick<CakeOrder, 'status' | 'dueDate'>, today: string): DueState {
  if (!isOpen(o)) return 'done';
  const days = Math.round((utc(o.dueDate) - utc(today)) / 86_400_000);
  return days < 0 ? 'overdue' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'later';
}

export interface CakeSummary { open: number; dueToday: number; overdue: number; balanceOwed: number; advanceHeld: number }
export function summarize(orders: CakeOrder[], today: string): CakeSummary {
  const s: CakeSummary = { open: 0, dueToday: 0, overdue: 0, balanceOwed: 0, advanceHeld: 0 };
  for (const o of orders) {
    if (!isOpen(o)) continue;
    s.open++; s.balanceOwed = r2(s.balanceOwed + balanceOf(o)); s.advanceHeld = r2(s.advanceHeld + paidOf(o));
    const d = dueState(o, today);
    if (d === 'today') s.dueToday++; else if (d === 'overdue') s.overdue++;
  }
  return s;
}

/** The order list: open orders by the day and time they are needed, then the closed ones, newest first. */
export function sortOrders(orders: CakeOrder[]): CakeOrder[] {
  return [...orders].sort((a, b) => {
    const oa = isOpen(a), ob = isOpen(b);
    if (oa !== ob) return oa ? -1 : 1;
    if (oa) return `${a.dueDate} ${a.dueTime || '99:99'}`.localeCompare(`${b.dueDate} ${b.dueTime || '99:99'}`);
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/** The order as a slip for Print / PDF / POS / JPG: the baker's instruction and the customer's receipt in one. */
export function slipDoc(o: CakeOrder, money: (n: number) => string): ReportDoc {
  const row = (k: string, v: string | number | undefined) => (v === undefined || v === '' ? null : { detail: k, value: v });
  const rows = [
    row('Customer', o.customerName), row('Phone', o.phone),
    row('Cake', o.itemName || 'Custom cake'), row('Details', o.description), row('Message on the cake', o.message),
    row('Quantity', o.quantity), row('Weight', o.weightKg ? `${o.weightKg} kg` : undefined),
    row('Needed', `${o.dueDate}${o.dueTime ? ` at ${o.dueTime}` : ''}`), row('Handover', o.handover === 'delivery' ? `Delivery — ${o.address ?? ''}` : 'Pick-up'),
    row('Total', money(o.total)), ...o.payments.map(p => row(`${p.kind === 'refund' ? 'Refund' : p.kind === 'advance' ? 'Advance' : 'Payment'} ${p.at.slice(0, 10)}`, `${p.kind === 'refund' ? '−' : ''}${money(p.amount)}`)),
    row('Balance to pay', money(balanceOf(o))), row('Notes', o.notes),
  ].filter(Boolean) as { detail: string; value: string | number }[];
  return { title: `Cake order ${o.number}`, subtitle: o.status === 'cancelled' ? 'Cancelled' : `Status: ${o.status}`, columns: [{ key: 'detail', label: 'Detail' }, { key: 'value', label: 'Value', align: 'right' }], rows, filename: `cake-order-${o.number}` };
}
