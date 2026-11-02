// ============================================================
// LIVE BILL — what the customer sees on the Customer Display while the
// cashier rings up their order.
//
// The POS publishes a SMALL, customer-facing copy of the bill: item names,
// quantities, amounts and the totals. Nothing internal is ever put in it —
// no cashier, waiter or rider, no table notes or kitchen instructions, no
// customer phone or address, no payment account. The type below is the
// whole contract, and toLiveBill() builds it field by field from an
// allow-list, so a new field on an order can never leak by accident.
//
// Transport: the Customer Display is a separate window. A localStorage write
// reaches every other window as a `storage` event; a BroadcastChannel makes
// it instant where available. Clearing the cart (or paying) removes it.
//
// Presentation only: nothing here reads or writes orders, the database or
// printers. It only runs when Settings → Display → "Enable Display Screen"
// is on.
// ============================================================

import { variantNote } from './billLabels';

export const LIVE_BILL_KEY = 'dtpos-live-bill';
const CHANNEL = 'dtpos-live-bill';
/** A bill older than this is treated as left over from a crash, not shown. */
export const LIVE_BILL_MAX_AGE_MS = 45 * 60 * 1000;

export interface LiveBillLine {
  name: string;
  qty: number;
  amount: number;
}

export interface LiveBill {
  v: 1;
  /** When it was published (ms). */
  at: number;
  orderType: 'dining' | 'takeaway' | 'delivery' | 'other';
  lines: LiveBillLine[];
  itemCount: number;
  subtotal: number;
  /** Total discount, with the words the receipt uses ("Discount (10%)"). */
  discount: number;
  discountLabel?: string;
  serviceCharge: number;
  serviceChargeLabel?: string;
  tax: number;
  delivery: number;
  total: number;
  /** Cash handed over and the change, once the cashier types them. */
  received?: number;
  change?: number;
}

export interface LiveBillSource {
  orderType?: string;
  lines: Array<{ name?: string; variantName?: string; quantity?: number; lineTotal?: number }>;
  subtotal?: number;
  discount?: number;
  discountLabel?: string;
  serviceCharge?: number;
  serviceChargeLabel?: string;
  tax?: number;
  delivery?: number;
  total?: number;
  received?: number;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const text = (v: unknown, max = 60) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const MAX_LINES = 80;

/** Builds the customer-facing copy from the POS state. Only the fields listed here can ever reach the screen. */
export function toLiveBill(src: LiveBillSource, now = Date.now()): LiveBill | null {
  const lines = (src.lines || [])
    .map(l => ({
      name: text(`${l.name || ''}${variantNote(l) ? ` (${variantNote(l)})` : ''}`) || 'Item',
      qty: num(l.quantity),
      amount: num(l.lineTotal),
    }))
    .filter(l => l.qty !== 0 || l.amount !== 0)
    .slice(0, MAX_LINES);
  if (!lines.length) return null;
  const type = src.orderType === 'dining' || src.orderType === 'takeaway' || src.orderType === 'delivery' ? src.orderType : 'other';
  const total = num(src.total);
  const received = num(src.received);
  return {
    v: 1,
    at: now,
    orderType: type,
    lines,
    itemCount: lines.reduce((s, l) => s + l.qty, 0),
    subtotal: num(src.subtotal),
    discount: num(src.discount),
    discountLabel: num(src.discount) > 0 ? text(src.discountLabel, 40) || 'Discount' : undefined,
    serviceCharge: num(src.serviceCharge),
    serviceChargeLabel: num(src.serviceCharge) > 0 ? text(src.serviceChargeLabel, 40) || 'Service Charge' : undefined,
    tax: num(src.tax),
    delivery: num(src.delivery),
    total,
    received: received > 0 ? received : undefined,
    change: received > 0 ? num(Math.max(0, received - total)) : undefined,
  };
}

/** Reads and checks a published bill. Anything malformed or stale reads as "no bill". */
export function parseLiveBill(raw: string | null | undefined, now = Date.now()): LiveBill | null {
  if (!raw) return null;
  try {
    const b = JSON.parse(raw);
    if (!b || b.v !== 1 || !Array.isArray(b.lines) || !b.lines.length) return null;
    if (typeof b.at !== 'number' || now - b.at > LIVE_BILL_MAX_AGE_MS || b.at - now > 60_000) return null;
    // Re-run the allow-list on the way in too: the display never trusts what it reads.
    return toLiveBill({
      orderType: b.orderType,
      lines: b.lines.map((l: any) => ({ name: l?.name, quantity: l?.qty, lineTotal: l?.amount })),
      subtotal: b.subtotal, discount: b.discount, discountLabel: b.discountLabel,
      serviceCharge: b.serviceCharge, serviceChargeLabel: b.serviceChargeLabel,
      tax: b.tax, delivery: b.delivery, total: b.total, received: b.received,
    }, b.at);
  } catch { return null; }
}

let channel: BroadcastChannel | null | undefined;
function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try { channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null; } catch { channel = null; }
  return channel;
}

let lastSent = '';
/** Puts the bill on the Customer Display, or takes it off (null). Repeats of the same bill are not re-sent. */
export function publishLiveBill(bill: LiveBill | null): void {
  const payload = bill ? JSON.stringify(bill) : '';
  // Compare without the timestamp so an unchanged cart does not chatter.
  const sig = bill ? JSON.stringify({ ...bill, at: 0 }) : '';
  if (sig === lastSent) return;
  lastSent = sig;
  try {
    if (bill) localStorage.setItem(LIVE_BILL_KEY, payload);
    else localStorage.removeItem(LIVE_BILL_KEY);
  } catch { /* storage full or blocked: the channel below may still carry it */ }
  try { getChannel()?.postMessage(payload); } catch { /* closed channel */ }
}

/** Calls back with the current bill (or null) now and whenever the POS changes it. Returns an unsubscribe. */
export function subscribeLiveBill(cb: (bill: LiveBill | null) => void): () => void {
  const readNow = () => { try { cb(parseLiveBill(localStorage.getItem(LIVE_BILL_KEY))); } catch { cb(null); } };
  const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === LIVE_BILL_KEY) readNow(); };
  const ch = getChannel();
  const onMessage = (e: MessageEvent) => { cb(typeof e.data === 'string' && e.data ? parseLiveBill(e.data) : null); };
  window.addEventListener('storage', onStorage);
  ch?.addEventListener('message', onMessage);
  // A bill that goes stale while nobody touches the POS disappears on its own.
  const tick = window.setInterval(readNow, 30_000);
  readNow();
  return () => {
    window.removeEventListener('storage', onStorage);
    ch?.removeEventListener('message', onMessage);
    window.clearInterval(tick);
  };
}

/** For tests: forget what was last sent. */
export function __resetLiveBillForTests(): void { lastSent = ''; }
