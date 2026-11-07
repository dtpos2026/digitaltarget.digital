// ============================================================================
// DT Rider — the rules behind the redesigned screens (design-project/05-rider-app, v1.88.0).
//
// Pure functions only: what the rider's next step is, what to collect at the door, what the record says for a
// period. The page (src/pages/RiderAppPage.tsx) keeps every server call — sign-in, the poll, the claim, the stage
// change — exactly as before; these decide only what the screens show.
// ============================================================================
import type { DeliveryStatus, Order } from './types';
import { balanceDue, isCreditOrder, isPartialSale } from './sales';

// ------------------------------------------------------------------ the delivery, step by step (RID-09 … RID-13)
export const RIDER_STEPS: { stage: DeliveryStatus; label: string }[] = [
  { stage: 'rider_picked', label: 'Picked up' },
  { stage: 'onway', label: 'On the way' },
  { stage: 'rider_reached', label: 'Reached' },
  { stage: 'delivered', label: 'Delivered' },
];

/** How far along the four rider steps an order is: -1 before pickup, 0 … 3 after. */
export function stepIndex(stage?: DeliveryStatus): number {
  return RIDER_STEPS.findIndex(s => s.stage === stage);
}

export type RiderPhase = 'pickup' | 'picked' | 'enroute' | 'arrived' | 'done';

/** Which screen an order of the rider's opens on. */
export function riderPhase(o: Pick<Order, 'deliveryStatus'>): RiderPhase {
  switch (o.deliveryStatus) {
    case 'rider_picked': return 'picked';
    case 'onway': return 'enroute';
    case 'rider_reached': return 'arrived';
    case 'delivered':
    case 'cancelled': return 'done';
    default: return 'pickup';
  }
}

export interface NextAction {
  /** The stage the big button moves the order to. */
  stage: DeliveryStatus;
  label: string;
  /** Pickup and delivery ask first: the bag checklist (RID-10), the money at the door (RID-13). */
  confirm?: 'pickup' | 'deliver';
}

/** The one big button at the bottom of an order — always the next step, never a choice of four. */
export function nextAction(o: Pick<Order, 'deliveryStatus'>): NextAction | null {
  switch (riderPhase(o)) {
    case 'pickup': return { stage: 'rider_picked', label: 'I have picked up the order', confirm: 'pickup' };
    case 'picked': return { stage: 'onway', label: 'Start the ride' };
    case 'enroute': return { stage: 'rider_reached', label: 'I have reached' };
    case 'arrived': return { stage: 'delivered', label: 'Hand over the order', confirm: 'deliver' };
    default: return null;
  }
}

/** The screen title for each step, as the design names them. */
export function phaseTitle(o: Pick<Order, 'deliveryStatus' | 'orderNumber'>): string {
  const n = `#${o.orderNumber}`;
  switch (riderPhase(o)) {
    case 'pickup': return `Pickup · ${n}`;
    case 'picked': return `Picked up · ${n}`;
    case 'enroute': return `On the way · ${n}`;
    case 'arrived': return `Reached · ${n}`;
    default: return `Order ${n}`;
  }
}

/** The rider's words for a stage (the board's labels say "Rider Picked"; the rider is the one doing it). */
export const RIDER_STAGE_LABEL: Partial<Record<DeliveryStatus, string>> = {
  pending: 'Waiting', accepted: 'Accepted', cooking: 'Cooking', ready: 'Ready', rider_assigned: 'Assigned to you',
  rider_picked: 'Picked up', onway: 'On the way', rider_reached: 'Reached', delivered: 'Delivered', cancelled: 'Cancelled',
};

export type StageTone = 'accent' | 'warn' | 'ok' | 'info' | 'neutral' | 'bad';
export function stageTone(stage?: DeliveryStatus): StageTone {
  switch (stage) {
    case 'ready': return 'ok';
    case 'rider_assigned': return 'warn';
    case 'rider_picked': case 'onway': return 'accent';
    case 'rider_reached': return 'info';
    case 'delivered': return 'ok';
    case 'cancelled': return 'bad';
    default: return 'neutral';
  }
}

// ------------------------------------------------------------------ money at the door (RID-07, RID-13)
export interface Collect {
  /** What the rider takes from the customer. 0 = nothing to take. */
  amount: number;
  /** How the bill is settled, in the rider's words. */
  label: string;
  /** True when the rider has to take money and should tick "I collected the full amount" first. */
  mustConfirm: boolean;
}

const METHOD_LABEL: Record<string, string> = { cash: 'Cash on delivery', card: 'Card on delivery', online: 'Online transfer', credit: 'On account' };

/**
 * What to collect. A bill already paid is "Paid already" (nothing to take); a credit bill is the customer's account,
 * not the rider's to collect; a bill with an advance leaves its balance; everything else is the full total, by the
 * method the bill was taken with (cash on delivery when none was chosen).
 *
 * The server records the delivery and marks the bill paid (portal_order_delivery); it does not record how much the
 * rider took. This only tells the rider what to ask for.
 */
export function collectFor(o: Order): Collect {
  const total = Math.max(0, Number(o.grandTotal) || 0);
  if (isCreditOrder(o)) return { amount: 0, label: 'On account (credit)', mustConfirm: false };
  if (o.status === 'paid' && !o.deliveredAt) return { amount: 0, label: 'Paid already', mustConfirm: false };
  if (o.status === 'complimentary') return { amount: 0, label: 'Complimentary', mustConfirm: false };
  if (isPartialSale(o)) {
    const due = balanceDue(o);
    return { amount: due, label: 'Balance after advance', mustConfirm: due > 0 };
  }
  const method = String(o.paymentMethod || 'cash');
  const label = o.paymentAccountName && method !== 'cash'
    ? `${METHOD_LABEL[method] || method} · ${o.paymentAccountName}`
    : METHOD_LABEL[method] || method;
  return { amount: total, label, mustConfirm: total > 0 };
}

/**
 * v1.112.0 — what the rider is going to take from customers on the orders still in their hands (the sum of "collect" on every
 * active order). Orders that are paid, on account, complimentary, delivered or cancelled add nothing.
 */
export function cashToCollect(orders: Order[]): { amount: number; count: number } {
  let amount = 0, count = 0;
  for (const o of orders) {
    if (o.deliveryStatus === 'delivered' || o.deliveryStatus === 'cancelled') continue;
    const a = collectFor(o).amount;
    if (a > 0) { amount += a; count++; }
  }
  return { amount, count };
}

// ------------------------------------------------------------------ the bag (RID-10)
/** One line per item to tick off before leaving the kitchen: "2 × Zinger Burger (Large)", with its note. */
export function bagChecklist(o: Pick<Order, 'items'>): { key: string; text: string; note?: string; lineTotal: number }[] {
  return (o.items || [])
    .filter(i => (Number(i.quantity) || 0) > 0)
    .map((i, n) => ({
      key: `${i.id || 'i'}:${n}`,
      text: `${formatQty(i.quantity)} × ${i.name}${i.variantName ? ` (${i.variantName})` : ''}`,
      note: i.note?.trim() || undefined,
      lineTotal: Number(i.lineTotal) || 0,
    }));
}
function formatQty(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// ------------------------------------------------------------------ the rider's record (RID-16, RID-17)
export interface DeliveryRecord {
  id: string;
  orderNumber: string;
  customerName: string;
  address: string;
  /** The bill's total — what the server's "earnings" adds up (portal_my_history). */
  total: number;
  deliveredAt: string;
}

/** The server's rows (portal_my_history), made safe to show: no row without an id or a delivery time. */
export function historyRows(raw: Array<Record<string, unknown>> | undefined | null): DeliveryRecord[] {
  return (raw || [])
    .map(r => ({
      id: String(r.id ?? ''),
      orderNumber: r.orderNumber == null ? '' : String(r.orderNumber),
      customerName: String(r.customerName ?? '').trim() || 'Customer',
      address: String(r.address ?? '').trim(),
      total: Number(r.grandTotal) || 0,
      deliveredAt: String(r.deliveredAt ?? ''),
    }))
    .filter(r => r.id && r.deliveredAt && !Number.isNaN(Date.parse(r.deliveredAt)))
    .sort((a, b) => Date.parse(b.deliveredAt) - Date.parse(a.deliveredAt));
}

/** A rider on the staff route has no portal session: their record comes from the orders on this device. */
export function localHistory(orders: Order[], riderId: string): DeliveryRecord[] {
  return historyRows(
    orders
      .filter(o => o.riderId === riderId && o.deliveredAt && o.deliveryStatus === 'delivered')
      .map(o => ({
        id: o.id, orderNumber: o.orderNumber, customerName: o.customer?.name, address: o.customer?.address,
        grandTotal: o.grandTotal, deliveredAt: o.deliveredAt,
      })),
  );
}

export type RiderPeriod = 'today' | 'week' | 'month';
export const RIDER_PERIODS: { id: RiderPeriod; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
];

/** Where a period starts, on the phone's clock. A week starts on Monday. */
export function periodStart(period: RiderPeriod, now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (period === 'month') d.setDate(1);
  return d;
}

export interface PeriodSummary {
  count: number;
  total: number;
  rows: DeliveryRecord[];
  /** One bar per hour (today) or per day (week, month), oldest first. */
  bars: { label: string; total: number; count: number }[];
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function periodSummary(rows: DeliveryRecord[], period: RiderPeriod, now: Date): PeriodSummary {
  const start = periodStart(period, now).getTime();
  const end = now.getTime();
  const inside = rows.filter(r => { const t = Date.parse(r.deliveredAt); return t >= start && t <= end; });

  let bars: PeriodSummary['bars'];
  if (period === 'today') {
    // Hour by hour up to now, from whichever is earliest: 10:00, the first delivery's hour, or five hours ago.
    const hours = inside.map(r => new Date(r.deliveredAt).getHours());
    const last = now.getHours();
    const first = Math.min(Math.max(0, last - 5), ...hours, 10);
    bars = [];
    for (let h = first; h <= last; h++) bars.push({ label: hourLabel(h), total: 0, count: 0 });
    for (const r of inside) {
      const b = bars[new Date(r.deliveredAt).getHours() - first];
      if (b) { b.total += r.total; b.count += 1; }
    }
  } else {
    const days = period === 'week' ? 7 : new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const first = new Date(start);
    bars = Array.from({ length: days }, (_, i) => {
      const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
      return { label: period === 'week' ? DAY[d.getDay()] : String(d.getDate()), total: 0, count: 0 };
    });
    for (const r of inside) {
      const d = new Date(r.deliveredAt);
      const i = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - start) / 86_400_000);
      if (bars[i]) { bars[i].total += r.total; bars[i].count += 1; }
    }
  }
  return { count: inside.length, total: inside.reduce((s, r) => s + r.total, 0), rows: inside, bars };
}

function hourLabel(h: number): string {
  const s = h % 12 === 0 ? 12 : h % 12;
  return `${s}${h < 12 ? 'a' : 'p'}`;
}

/** "12:41" today ("Today 12:41" in a list that spans days), "31 Oct" before. */
export function whenDelivered(iso: string, now: Date, sayToday = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === now.toDateString();
  if (!sameDay) return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return sayToday ? `Today ${t}` : t;
}

/** The letters on an avatar: "Hamza Ali" → "HA". */
export function initials(name: string | undefined): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'R';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// ------------------------------------------------------------------ navigation
/** Google Maps directions to a point, or a search for an address the order has no pin for. */
export function directionsUrl(dest: { lat: number; lng: number } | null, address?: string): string | null {
  if (dest) return `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}`;
  if (address?.trim()) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
  return null;
}

// ------------------------------------------------------------------ help (RID-19)
export const RIDER_PROBLEMS = [
  'Customer is not answering',
  'Address is wrong or unclear',
  'Order is damaged or missing items',
  'I had an accident or a breakdown',
] as const;

/** The message the restaurant receives: the order and the problem, nothing to type on a bike. */
export function problemMessage(problem: string, o?: Pick<Order, 'orderNumber' | 'customer'> | null, riderName?: string): string {
  const lines = [o ? `Order #${o.orderNumber}: ${problem}` : problem];
  if (o?.customer?.name) lines.push(`Customer: ${o.customer.name}${o.customer.phone ? ` · ${o.customer.phone}` : ''}`);
  if (o?.customer?.address) lines.push(`Address: ${o.customer.address}`);
  if (riderName) lines.push(`— ${riderName} (DT Rider)`);
  return lines.join('\n');
}
