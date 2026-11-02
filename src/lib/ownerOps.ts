// ============================================================
// OWNER APP — operations on the phone (v1.90.0): online approvals (OWN-08), kitchen (OWN-09), delivery and riders
// (OWN-10), customers and credit (OWN-17), staff (OWN-16). Pure functions over the store's rows; the screens are in
// src/components/owner/OwnerOps.tsx.
// ============================================================
import type { Attendance, CreditPayment, CustomerProfile, Employee, Order, Rider, RestaurantSettings } from './types';
import { balanceDue, isCreditOrder, isVoidish } from './sales';
import { makeEditLog } from './orderHistory';

const mins = (from: string | undefined, now: number) => {
  const t = from ? Date.parse(from) : NaN;
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / 60000));
};

// ------------------------------------------------------------------ OWN-08 online approvals
/** Website, QR and order-taker orders held for approval: the longest waiting first. */
export function pendingApprovals(orders: Order[]): Order[] {
  return orders
    .filter(o => o.status === 'pending_approval')
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/**
 * Approve an order from a phone that has no printer.
 *
 * The till's approval (lib/onlineApproval.approveOrder) queues the kitchen ticket on the device that approves and
 * stamps the order as sent to the kitchen. On the owner's phone that ticket would sit in the phone's own queue and
 * never print — yet the order would say it had. So this approval flips the order to running WITHOUT a ticket, and
 * marks it `kotFromTill`: the till's new-order watcher (components/NewOrderNotifier.tsx) prints it through the same
 * auto-KOT rule it uses for website orders, and the stamp it writes when it prints stops a second print.
 */
export function approveFromPhone(o: Order, by: { userId?: string; userName?: string }, now = new Date()): Order {
  return {
    ...o,
    status: 'running',
    approvalRequired: false,
    approvedBy: by.userId,
    approvedByName: by.userName,
    approvedAt: now.toISOString(),
    kotFromTill: true,
    editLogs: [...(o.editLogs || []), makeEditLog('STATUS', { oldValue: 'pending_approval', newValue: 'running', reason: `Approved by ${by.userName || 'owner'} (Owner app)` })],
  };
}

/** A phone approval older than this is not printed by a till that opens later: the kitchen has long moved on. */
export const TILL_KOT_WINDOW_MS = 12 * 3600_000;

/** Should this till print the ticket for an order approved on a phone? Only once, only when nothing printed it. */
export function needsTillKot(o: Order, now = Date.now()): boolean {
  if (!o.kotFromTill || o.status !== 'running' || o.kotPrinted) return false;
  const at = Date.parse(o.approvedAt || '');
  return !Number.isNaN(at) && now - at <= TILL_KOT_WINDOW_MS;
}

// ------------------------------------------------------------------ OWN-09 kitchen
export type TicketState = 'new' | 'cooking' | 'ready';
export interface KitchenTicket {
  id: string; orderNumber: number; label: string; items: number; age: number; state: TicketState; late: boolean; type: Order['orderType'];
}
export interface KitchenBoard { counts: Record<TicketState | 'late', number>; tickets: KitchenTicket[]; lateAfter: number }

/** The same tickets the kitchen screen shows (KitchenDisplayPage), oldest first; late = past the warning time. */
export function kitchenBoard(orders: Order[], settings: Pick<RestaurantSettings, 'kitchenWarningMinutes'> | null | undefined, now = Date.now()): KitchenBoard {
  const lateAfter = Math.max(1, Number(settings?.kitchenWarningMinutes) || 10);
  const live = orders.filter(o => {
    if (o.status !== 'running' && o.status !== 'hold' && o.status !== 'partial') return false;
    const ds = o.deliveryStatus;
    if (ds === 'rider_picked' || ds === 'onway' || ds === 'rider_reached' || ds === 'delivered') return false;
    return o.kitchenStatus !== 'served' && o.kitchenStatus !== 'delivered';
  });
  const tickets = live.map<KitchenTicket>(o => {
    const state: TicketState = o.kitchenStatus === 'ready' ? 'ready' : o.kitchenStatus === 'preparing' ? 'cooking' : 'new';
    const age = mins(o.createdAt, now);
    return {
      id: o.id, orderNumber: o.orderNumber, type: o.orderType,
      label: o.tableName ? `Table ${o.tableName}` : o.orderType === 'delivery' ? 'Delivery' : o.orderType === 'takeaway' ? 'Takeaway' : 'Order',
      items: (o.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0),
      age, state, late: state !== 'ready' && age >= lateAfter,
    };
  }).sort((a, b) => b.age - a.age);
  const counts = { new: 0, cooking: 0, ready: 0, late: 0 };
  for (const t of tickets) { counts[t.state] += 1; if (t.late) counts.late += 1; }
  return { counts, tickets, lateAfter };
}

// ------------------------------------------------------------------ OWN-10 delivery and riders
export type DeliveryPhase = 'waiting' | 'onway' | 'delivered';
export function deliveryPhase(o: Order): DeliveryPhase | null {
  const ds = o.deliveryStatus;
  if (o.orderType !== 'delivery' || ds === 'cancelled' || isVoidish(o) || o.status === 'rejected' || o.status === 'pending_approval') return null;
  if (ds === 'delivered') return 'delivered';
  if (ds === 'rider_picked' || ds === 'onway' || ds === 'rider_reached') return 'onway';
  // A delivery bill settled at the counter that never used the rider stages is finished, not waiting.
  if (!ds && o.status !== 'running' && o.status !== 'hold' && o.status !== 'partial') return null;
  return 'waiting';
}

/** "45 min", "2 h 5 min". */
export function minutesText(m: number): string {
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** The board is about today's service: a delivery older than this is history, not something still on the road. */
export const DELIVERY_WINDOW_MS = 24 * 3600_000;

export interface RiderRow { id: string; name: string; phone: string; live: boolean; lastSeen?: string; current: Order[] }
export interface DeliveryBoard {
  counts: Record<DeliveryPhase, number>;
  /** Ready with no rider, or out longer than it should be. */
  stuck: { order: Order; why: string }[];
  unassigned: Order[];
  riders: RiderRow[];
}

/** A rider is Live when their app reported in the last 3 minutes (the heartbeat is every minute, pings every 15 s). */
export const RIDER_LIVE_MS = 3 * 60_000;

export function deliveryBoard(orders: Order[], riders: Rider[], now = Date.now()): DeliveryBoard {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const counts = { waiting: 0, onway: 0, delivered: 0 };
  const stuck: DeliveryBoard['stuck'] = [];
  const unassigned: Order[] = [];
  const active: Order[] = [];
  for (const o of orders) {
    const phase = deliveryPhase(o);
    if (!phase) continue;
    if (phase === 'delivered') {
      if (o.deliveredAt && Date.parse(o.deliveredAt) >= today.getTime()) counts.delivered += 1;
      continue;
    }
    if (now - Date.parse(o.createdAt) > DELIVERY_WINDOW_MS) continue;
    counts[phase] += 1;
    active.push(o);
    if (!o.riderId) unassigned.push(o);
    const age = mins(o.createdAt, now);
    if (phase === 'waiting' && !o.riderId && (o.deliveryStatus === 'ready' || o.kitchenStatus === 'ready')) {
      stuck.push({ order: o, why: 'Ready, no rider yet' });
    } else if (phase === 'onway' && mins(o.dispatchedAt || o.createdAt, now) >= 45) {
      stuck.push({ order: o, why: `Out for ${minutesText(mins(o.dispatchedAt || o.createdAt, now))}` });
    } else if (phase === 'waiting' && age >= 60) {
      stuck.push({ order: o, why: `Waiting ${minutesText(age)}` });
    }
  }
  const lastPing = new Map<string, number>();
  for (const o of active) {
    if (!o.riderId) continue;
    const t = Date.parse(o.riderPingedAt || '');
    if (!Number.isNaN(t)) lastPing.set(o.riderId, Math.max(lastPing.get(o.riderId) || 0, t));
  }
  const rows = riders.filter(r => r.isActive !== false).map<RiderRow>(r => {
    const seen = Math.max(Date.parse(r.lastSeenAt || '') || 0, lastPing.get(r.id) || 0);
    return {
      id: r.id, name: r.name, phone: r.phone || '',
      live: seen > 0 && now - seen <= RIDER_LIVE_MS,
      lastSeen: seen > 0 ? new Date(seen).toISOString() : undefined,
      current: active.filter(o => o.riderId === r.id),
    };
  }).sort((a, b) => Number(b.live) - Number(a.live) || b.current.length - a.current.length || a.name.localeCompare(b.name));
  unassigned.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return { counts, stuck, unassigned, riders: rows };
}

// ------------------------------------------------------------------ OWN-17 customers and credit
export function customerRows(customers: CustomerProfile[], query = ''): CustomerProfile[] {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  return customers
    .filter(c => !q || c.name?.toLowerCase().includes(q) || (digits.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(digits)))
    .sort((a, b) => (Number(b.totalSpent) || 0) - (Number(a.totalSpent) || 0) || a.name.localeCompare(b.name));
}

export interface CreditRow { key: string; name: string; phone: string; owed: number; bills: number; oldest: string }

/**
 * Who still owes money on credit (udhaar) bills: the bill's balance after what was received against it — the same
 * balance the Credits page and the Owner overview's "still owed" use.
 */
export function creditRows(orders: Order[], payments: CreditPayment[] = []): CreditRow[] {
  const received = new Map<string, number>();
  for (const p of payments) received.set(p.orderId, (received.get(p.orderId) || 0) + (Number(p.amount) || 0));
  const by = new Map<string, CreditRow>();
  for (const o of orders) {
    if (!isCreditOrder(o) || isVoidish(o) || o.status === 'credit_received') continue;
    // The bill's own amountPaid already counts payments recorded on it; the payment rows cover the older records.
    const owed = Math.max(0, Math.min(balanceDue(o), Number(o.grandTotal || 0) - (received.get(o.id) || 0)));
    if (owed <= 0) continue;
    const phone = o.customer?.phone || '';
    const named = o.customer?.name?.trim() || '';
    // The phone is who it is; a bill with neither phone nor name is listed as such, never merged into a "Customer".
    const key = phone.replace(/\D/g, '').slice(-10) || named.toLowerCase() || '__none__';
    const row = by.get(key) || { key, name: named || (key === '__none__' ? 'No customer on the bill' : 'Customer'), phone, owed: 0, bills: 0, oldest: o.createdAt };
    if (named && (row.name === 'Customer' || row.name === 'No customer on the bill')) row.name = named;
    row.owed += owed;
    row.bills += 1;
    if (Date.parse(o.createdAt) < Date.parse(row.oldest)) row.oldest = o.createdAt;
    by.set(key, row);
  }
  return [...by.values()].sort((a, b) => b.owed - a.owed);
}

// ------------------------------------------------------------------ OWN-16 staff
export interface StaffMember { id: string; name: string; role: string; branchId?: string | null; active: boolean }
export const ROLE_LABEL: Record<string, string> = { admin: 'Owner / admin', manager: 'Manager', cashier: 'Cashier', order_taker: 'Order taker', rider: 'Rider' };

export function staffList(staff: StaffMember[], role: string | 'all' = 'all'): StaffMember[] {
  return staff
    .filter(s => role === 'all' || s.role === role)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

/** HR attendance: who is marked present today and has not clocked out. Empty when attendance is not kept. */
export function onDutyToday(employees: Employee[], attendance: Attendance[], todayYmd: string): Employee[] {
  const inNow = new Set(attendance.filter(a => a.date === todayYmd && (a.status === 'present' || a.status === 'half-day') && !a.outTime).map(a => a.employeeId));
  return employees.filter(e => inNow.has(e.id));
}
