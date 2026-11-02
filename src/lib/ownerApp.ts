// ============================================================
// OWNER APP — the pure part (v1.86.0)
//
// The design package's owner screens (design-project/06-owner-app): Overview (OWN-04), Branch detail (OWN-05),
// Orders (OWN-06), Order detail (OWN-07), Sales report (OWN-11), Menu (OWN-13), Low stock (OWN-14), Expenses (OWN-15).
//
// "Same arithmetic as Owner Management": money taken is what the till took (paid bills plus part-payments, via
// lib/sales.ts), dated by the same revenue timestamp as the reports (lib/salesReport.ts). Owner Management on the
// desktop uses these functions too, so the phone and the desktop always agree.
// ============================================================
import type { AccountCategory, InventoryItem, MenuItem, Category, Order, Party, ReceivingEntry, Transaction } from './types';
import { balanceDue, isCreditOrder, isOpen, isPaidSale, isPartialSale, isVoidish, paidRevenue } from './sales';
import { presetRange, revenueTimestamp, type RangePreset } from './salesReport';

export type { RangePreset };
export const PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
];
export const presetLabel = (p: RangePreset) => PRESETS.find(x => x.id === p)?.label || p;

export interface Range { from: Date; to: Date }
export const rangeOf = (preset: RangePreset, now = new Date()): Range => presetRange(preset, now);

const DAY = 86400000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/**
 * The period a figure is compared with, always of the same length and never in the future:
 *  - Today → yesterday up to the same clock time;   Yesterday → the day before;
 *  - Last 7 days → the 7 days before;               This month → the same days of last month;
 *  - This year → last year up to the same date.
 */
export function previousRange(preset: RangePreset, now = new Date()): Range {
  const cur = presetRange(preset, now);
  if (preset === 'today') {
    const from = new Date(cur.from.getTime() - DAY);
    return { from, to: new Date(from.getTime() + (now.getTime() - cur.from.getTime())) };
  }
  if (preset === 'yesterday') return { from: new Date(cur.from.getTime() - DAY), to: new Date(cur.to.getTime() - DAY) };
  if (preset === 'week') return { from: new Date(cur.from.getTime() - 7 * DAY), to: new Date(cur.from.getTime() - 1) };
  if (preset === 'month') {
    const from = new Date(cur.from); from.setMonth(from.getMonth() - 1);
    const lastDayPrev = new Date(cur.from.getTime() - 1).getDate();
    const to = new Date(from); to.setDate(Math.min(now.getDate(), lastDayPrev)); to.setHours(23, 59, 59, 999);
    return { from, to };
  }
  const from = new Date(cur.from); from.setFullYear(from.getFullYear() - 1);
  const to = new Date(now); to.setFullYear(to.getFullYear() - 1); to.setHours(23, 59, 59, 999);
  return { from, to };
}

const timeOf = (o: Order) => { const t = Date.parse(revenueTimestamp(o)); return Number.isFinite(t) ? t : NaN; };
export const inRange = (o: Order, r: Range) => { const t = timeOf(o); return t >= r.from.getTime() && t <= r.to.getTime(); };

// ------------------------------------------------------------------ money taken, still owed
/** A bill whose money counts as taken: paid, or part-paid (only the part received counts). */
export const isTakenBill = (o: Order) => isPaidSale(o) || isPartialSale(o);
/** Money actually taken on a bill (lib/sales.ts paidRevenue). */
export const takenOn = (o: Order) => (isTakenBill(o) ? paidRevenue(o) : 0);

/**
 * What is still owed on a bill: the unpaid part of a part-paid bill, or a credit bill not yet collected.
 * A bill still open on the floor is "open", not owed; a paid bill owes nothing even when an older till never wrote the
 * amount received.
 */
export function owedOn(o: Order): number {
  if (!o || isVoidish(o)) return 0;
  if (isPartialSale(o)) return balanceDue(o);
  if (isCreditOrder(o) && (o.status === 'credit_pending' || o.status === 'paid')) return balanceDue(o);
  return 0;
}

// ------------------------------------------------------------------ overview (OWN-04)
export const UNASSIGNED = '__unassigned__';
export interface BranchFigures {
  id: string;
  name: string;
  unassigned: boolean;
  /** Money taken in the period. */
  revenue: number;
  /** Bills that produced it. */
  bills: number;
  /** Still owed on part-paid and credit bills of the period. */
  owed: number;
  /** Bills open on the floor right now (not limited to the period). */
  openNow: number;
  /** Void, complimentary and cancelled bills in the period. */
  voided: number;
  avgBill: number;
  /** Share of the business's money taken, whole percent; the shares add to 100. */
  share: number;
}
export interface OwnerTotals { revenue: number; bills: number; owed: number; openNow: number; voided: number }

/** Whole-number percentages that add to exactly 100 (largest remainder); all zero when nothing was taken. */
export function shares(values: number[]): number[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map(v => (Math.max(0, v) / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((s, x) => s + x, 0);
  raw.map((r, i) => ({ i, f: r - out[i] })).sort((a, b) => b.f - a.f).forEach(x => { if (left > 0) { out[x.i]++; left--; } });
  return out;
}

export interface Visibility {
  /** May this user see this branch's figures? (branch-limited managers see only theirs) */
  allowed?: (branchId: string) => boolean;
  /** Show bills that carry no branch under "No branch recorded" (owners with all branches). */
  showUnassigned?: boolean;
}

/**
 * Every branch side by side for a period. A branch that took nothing still gets a card (an empty branch is
 * information); bills with no branch are shown under "No branch recorded", never added to one branch; bills of a
 * branch that no longer exists appear as "Unknown branch".
 */
export function branchFigures(orders: Order[], branches: { id: string; name: string }[], range: Range, vis: Visibility = {}): { rows: BranchFigures[]; totals: OwnerTotals } {
  const allowed = vis.allowed || (() => true);
  const buckets = new Map<string, BranchFigures>();
  const blank = (id: string, name: string): BranchFigures => ({ id, name, unassigned: id === UNASSIGNED, revenue: 0, bills: 0, owed: 0, openNow: 0, voided: 0, avgBill: 0, share: 0 });
  for (const b of branches) if (allowed(b.id)) buckets.set(b.id, blank(b.id, b.name));
  for (const o of orders) {
    const id = o.branchId ? String(o.branchId) : UNASSIGNED;
    if (id === UNASSIGNED ? !vis.showUnassigned : !allowed(id)) continue;
    if (!buckets.has(id)) buckets.set(id, blank(id, id === UNASSIGNED ? 'No branch recorded' : 'Unknown branch'));
    const b = buckets.get(id)!;
    // "Open right now" is a floor question, not a date-range one.
    if (isOpen(o)) b.openNow += 1;
    if (!inRange(o, range)) continue;
    if (isVoidish(o)) { b.voided += 1; continue; }
    if (isTakenBill(o)) { b.revenue += takenOn(o); b.bills += 1; }
    b.owed += owedOn(o);
  }
  const rows = [...buckets.values()].sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
  const pct = shares(rows.map(r => r.revenue));
  rows.forEach((r, i) => { r.avgBill = r.bills ? Math.round(r.revenue / r.bills) : 0; r.share = pct[i]; });
  const totals = rows.reduce<OwnerTotals>((t, r) => ({
    revenue: t.revenue + r.revenue, bills: t.bills + r.bills, owed: t.owed + r.owed, openNow: t.openNow + r.openNow, voided: t.voided + r.voided,
  }), { revenue: 0, bills: 0, owed: 0, openNow: 0, voided: 0 });
  return { rows, totals };
}

/** The bills of one branch ("all" = every bill the user may see). */
export const ofBranch = (orders: Order[], branchId: string) =>
  branchId === 'all' ? orders : orders.filter(o => (o.branchId ? String(o.branchId) : UNASSIGNED) === branchId);

// ------------------------------------------------------------------ branch detail (OWN-05)
export interface Point { key: string; label: string; value: number }
export interface Split { key: string; name: string; amount: number; pct: number }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

/**
 * Money taken over the period, in the buckets that read best: by hour for a single day (trimmed to the hours that
 * had sales, at least 8 wide), by day up to a month, by month for a year. Quiet buckets are 0, never skipped.
 * Days are labelled by weekday for the rolling week and by date otherwise (pass the preset; without it, a span of
 * up to 7 days reads as weekdays).
 */
export function moneySeries(orders: Order[], range: Range, preset?: RangePreset): Point[] {
  const span = range.to.getTime() - range.from.getTime();
  const taken = orders.filter(o => isTakenBill(o) && inRange(o, range));
  if (span <= DAY) {
    const h = new Array<number>(24).fill(0);
    for (const o of taken) h[new Date(timeOf(o)).getHours()] += takenOn(o);
    const active = h.map((v, i) => (v > 0 ? i : -1)).filter(i => i >= 0);
    if (!active.length) return [];
    let lo = Math.min(...active), hi = Math.max(...active);
    while (hi - lo + 1 < 8 && (lo > 0 || hi < 23)) { if (hi < 23) hi++; if (hi - lo + 1 < 8 && lo > 0) lo--; }
    const out: Point[] = [];
    for (let i = lo; i <= hi; i++) out.push({ key: `h${i}`, label: String(i), value: h[i] });
    return out;
  }
  if (span <= 32 * DAY) {
    const out: Point[] = [];
    const days = preset ? preset === 'week' : span <= 7 * DAY + 1000;
    for (let d = startOfDay(range.from); d.getTime() <= range.to.getTime(); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      out.push({ key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, label: days ? WEEKDAYS[d.getDay()] : String(d.getDate()), value: 0 });
    }
    for (const o of taken) {
      const d = new Date(timeOf(o));
      const p = out.find(x => x.key === `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
      if (p) p.value += takenOn(o);
    }
    return out;
  }
  const out: Point[] = [];
  for (let m = new Date(range.from.getFullYear(), range.from.getMonth(), 1); m.getTime() <= range.to.getTime(); m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    out.push({ key: `${m.getFullYear()}-${m.getMonth()}`, label: MONTHS[m.getMonth()], value: 0 });
  }
  for (const o of taken) {
    const d = new Date(timeOf(o));
    const p = out.find(x => x.key === `${d.getFullYear()}-${d.getMonth()}`);
    if (p) p.value += takenOn(o);
  }
  return out;
}

const METHOD: Record<string, string> = { cash: 'Cash', card: 'Card', online: 'Online', credit: 'Credit' };
const methodName = (k: string) => METHOD[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Other');

/** How the money taken came in. A split bill is divided by its payments, scaled to what the bill counts as taken. */
export function paymentSplit(orders: Order[], range: Range): Split[] {
  const m = new Map<string, number>();
  const add = (k: string, v: number) => { if (v > 0) m.set(k, (m.get(k) || 0) + v); };
  for (const o of orders) {
    if (!isTakenBill(o) || !inRange(o, range)) continue;
    const taken = takenOn(o);
    const entries = (o.payments || []).filter(p => Number(p.amount) > 0);
    const sum = entries.reduce((s, p) => s + Number(p.amount), 0);
    if (entries.length && sum > 0) for (const p of entries) add(String(p.method || 'cash').toLowerCase(), (Number(p.amount) / sum) * taken);
    else add(String(o.paymentMethod || 'cash').toLowerCase(), taken);
  }
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const pct = shares(rows.map(r => r[1]));
  return rows.map(([key, amount], i) => ({ key, name: methodName(key), amount: Math.round(amount), pct: pct[i] }));
}

const TYPE: Record<string, string> = { dining: 'Dining', takeaway: 'Takeaway', delivery: 'Delivery', foodpanda: 'Foodpanda' };
export const typeName = (k?: string) => TYPE[k || 'dining'] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Dining');

/** Money taken by order type. */
export function typeSplit(orders: Order[], range: Range): Split[] {
  const m = new Map<string, number>();
  for (const o of orders) {
    if (!isTakenBill(o) || !inRange(o, range)) continue;
    const k = (o.orderType as string) || 'dining';
    m.set(k, (m.get(k) || 0) + takenOn(o));
  }
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const pct = shares(rows.map(r => r[1]));
  return rows.map(([key, amount], i) => ({ key, name: typeName(key), amount: Math.round(amount), pct: pct[i] }));
}

/** Bills open right now, newest first. */
export const openNowList = (orders: Order[]) => orders.filter(isOpen).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

// ------------------------------------------------------------------ orders (OWN-06)
export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'accent';
export interface Badge { label: string; tone: Tone }

/** One word for where a bill is, as the floor would say it. */
export function orderBadge(o: Order): Badge {
  switch (o.status) {
    case 'pending_approval': return { label: 'Needs approval', tone: 'warning' };
    case 'rejected': return { label: 'Rejected', tone: 'danger' };
    case 'void': return { label: 'Void', tone: 'danger' };
    case 'cancelled': return { label: 'Cancelled', tone: 'danger' };
    case 'complimentary': return { label: 'Complimentary', tone: 'neutral' };
    case 'partial': return { label: 'Partial', tone: 'warning' };
    case 'credit_pending': return { label: 'On credit', tone: 'warning' };
    case 'credit_received': return { label: 'Credit received', tone: 'success' };
    case 'paid': return isCreditOrder(o) ? { label: 'On credit', tone: 'warning' } : { label: 'Paid', tone: 'success' };
    case 'hold': return { label: 'On hold', tone: 'warning' };
    default: break;
  }
  // running: say what the food is doing
  const d = o.deliveryStatus;
  if (d === 'onway' || d === 'rider_picked') return { label: 'On the way', tone: 'accent' };
  if (d === 'rider_reached') return { label: 'Rider reached', tone: 'accent' };
  if (d === 'delivered') return { label: 'Delivered', tone: 'success' };
  if (o.kitchenStatus === 'ready') return { label: 'Ready', tone: 'success' };
  if (o.kitchenStatus === 'preparing' || o.kitchenStatus === 'accepted' || o.cookingStartedAt) return { label: 'Cooking', tone: 'info' };
  if (o.status === 'running' && isPartialSale(o)) return { label: 'Partial', tone: 'warning' };
  return { label: 'Running', tone: 'info' };
}

export const tableOf = (o: Order) => o.tableName || o.tableLabel || '';
/** "#1042 · Dining · T-07" */
export const orderTitle = (o: Order) => [`#${o.orderNumber}`, typeName(o.orderType as string), tableOf(o)].filter(Boolean).join(' · ');
const hhmm = (iso?: string) => { const t = iso ? Date.parse(iso) : NaN; if (!Number.isFinite(t)) return ''; const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
/** "Ahmed Raza · 12:41" */
export const orderSubtitle = (o: Order) => [o.customer?.name?.trim() || (o.orderType === 'dining' ? o.waiterName : '') || 'Walk-in', hhmm(o.createdAt)].filter(Boolean).join(' · ');

export type OrderChip = 'all' | 'running' | 'paid' | 'delivery' | 'credit' | 'void';
export const ORDER_CHIPS: { id: OrderChip; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'running', label: 'Running' }, { id: 'paid', label: 'Paid' },
  { id: 'delivery', label: 'Delivery' }, { id: 'credit', label: 'Credit' }, { id: 'void', label: 'Void' },
];
export interface OrderFilter { chip: OrderChip; query?: string; branchId?: string; range: Range }

/**
 * The bills for the Orders tab, newest first. "Running" is the floor right now (any date); every other chip is
 * limited to the period. The search matches the bill number, customer, phone, table, waiter or an item.
 */
export function filterOrders(orders: Order[], f: OrderFilter): Order[] {
  const q = (f.query || '').trim().toLowerCase().replace(/^#/, '');
  const rows = ofBranch(orders, f.branchId || 'all').filter(o => {
    if (f.chip === 'running') { if (!isOpen(o)) return false; }
    else {
      if (!inRange(o, f.range) && !(f.chip === 'all' && isOpen(o))) return false;
      if (f.chip === 'paid' && !(isPaidSale(o) || o.status === 'credit_received')) return false;
      if (f.chip === 'delivery' && o.orderType !== 'delivery') return false;
      if (f.chip === 'credit' && !(isCreditOrder(o) || isPartialSale(o))) return false;
      if (f.chip === 'void' && !(isVoidish(o) || o.status === 'rejected')) return false;
    }
    if (!q) return true;
    const hay = [String(o.orderNumber), o.customer?.name, o.customer?.phone, tableOf(o), o.waiterName, ...(o.items || []).map(i => i.name)]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
  return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || Number(b.orderNumber) - Number(a.orderNumber));
}

// ------------------------------------------------------------------ order detail (OWN-07)
export interface TimelineEvent { at: string; label: string; who?: string }

/** What happened to a bill and who did it, oldest first — only from stamps the bill really carries. */
export function orderTimeline(o: Order): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  const push = (at: string | undefined, label: string, who?: string) => { if (at && Number.isFinite(Date.parse(at))) ev.push({ at, label, who: who || undefined }); };
  const extra = o as Order & { paidBy?: string; closedAt?: string; closedBy?: string };
  const online = o.source === 'website' || o.source === 'qr' || o.source === 'whatsapp';
  push(o.createdAt, online ? (o.source === 'qr' ? 'Placed by table QR' : o.source === 'whatsapp' ? 'Placed on WhatsApp' : 'Placed online')
    : o.source === 'order_taker' ? 'Taken by the order taker' : 'Bill opened', o.cashierName || o.waiterName);
  push(o.approvedAt, 'Approved', o.approvedByName);
  push(o.rejectedAt, 'Rejected', o.rejectedByName);
  push(o.kotFirstPrintedAt || o.cookingStartedAt, 'Sent to kitchen');
  push(o.readyAt, 'Ready');
  push(o.delivery?.riderAssignedAt, 'Rider assigned', o.riderName);
  push(o.dispatchedAt || o.delivery?.onTheWayAt, 'On the way', o.riderName);
  push(o.deliveredAt || o.delivery?.completedAt, 'Delivered', o.riderName);
  const pays = (o.payments || []).filter(p => Number(p.amount) > 0);
  for (const p of pays) push(p.at, `Paid ${Math.round(Number(p.amount)).toLocaleString('en-PK')} · ${methodName(String(p.method || '').toLowerCase())}`, p.by);
  if (!pays.length && (isPaidSale(o) || o.status === 'credit_received')) push(o.paidAt, `Paid · ${methodName(String(o.paymentMethod || 'cash').toLowerCase())}`, extra.paidBy || o.cashierName);
  if (isCreditOrder(o) && o.status === 'credit_pending') push(o.paidAt || extra.closedAt, 'Given on credit', extra.closedBy);
  push(o.voidedAt, `Voided${o.voidReason ? ` — ${o.voidReason}` : ''}`, o.voidBy);
  push(o.cancelledAt, `Cancelled${o.cancelReason ? ` — ${o.cancelReason}` : ''}`, o.cancelledBy);
  push(o.complimentaryAt, `Complimentary${o.complimentaryReason ? ` — ${o.complimentaryReason}` : ''}`, o.complimentaryBy);
  const seen = new Set<string>();
  return ev
    .filter(e => { const k = `${e.label}|${e.at}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** The bill's lines that are not items: only the ones that apply. */
export function orderCharges(o: Order): { label: string; amount: number }[] {
  const out: { label: string; amount: number }[] = [];
  if (Number(o.discount) > 0) out.push({ label: o.discountTitle || 'Discount', amount: -Number(o.discount) });
  if (Number(o.serviceCharge) > 0) out.push({ label: 'Service charge', amount: Number(o.serviceCharge) });
  if (Number(o.tax) > 0) out.push({ label: o.taxLabel || 'Tax', amount: Number(o.tax) });
  if (Number(o.deliveryChargeAmount) > 0) out.push({ label: 'Delivery fee', amount: Number(o.deliveryChargeAmount) });
  if (Number(o.roundingAdjust)) out.push({ label: 'Rounding', amount: Number(o.roundingAdjust) });
  return out;
}

// ------------------------------------------------------------------ sales report (OWN-11)
export interface TopItem { key: string; name: string; qty: number; amount: number; image?: string; menuItemId?: string }
export interface SalesReport { range: Range; total: number; bills: number; prevTotal: number; pct: number | null; bars: Point[]; top: TopItem[] }

/** Percent change, one decimal; null when there is nothing to compare with. */
export function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

/** Best sellers of the period by quantity (ties: amount), from the bills whose money counts as taken. */
export function topItems(orders: Order[], range: Range, menu: MenuItem[] = [], n = 5): TopItem[] {
  const img = new Map(menu.map(m => [m.id, m.image] as const));
  const m = new Map<string, TopItem>();
  for (const o of orders) {
    if (!isTakenBill(o) || !inRange(o, range)) continue;
    for (const it of o.items || []) {
      const key = it.menuItemId || it.name;
      const e = m.get(key) || { key, name: it.name, qty: 0, amount: 0, image: img.get(it.menuItemId) || undefined, menuItemId: it.menuItemId };
      e.qty += Number(it.quantity || 0);
      e.amount += Number(it.lineTotal || 0);
      m.set(key, e);
    }
  }
  return [...m.values()].filter(x => x.qty > 0).sort((a, b) => b.qty - a.qty || b.amount - a.amount || a.name.localeCompare(b.name)).slice(0, n);
}

export function salesReport(orders: Order[], preset: RangePreset, now = new Date(), menu: MenuItem[] = []): SalesReport {
  const range = rangeOf(preset, now);
  const prev = previousRange(preset, now);
  let total = 0, bills = 0, prevTotal = 0;
  for (const o of orders) {
    if (!isTakenBill(o)) continue;
    if (inRange(o, range)) { total += takenOn(o); bills++; } else if (inRange(o, prev)) prevTotal += takenOn(o);
  }
  return { range, total, bills, prevTotal, pct: pctChange(total, prevTotal), bars: moneySeries(orders, range, preset), top: topItems(orders, range, menu, 10) };
}

// ------------------------------------------------------------------ menu (OWN-13)
export interface MenuRow { id: string; name: string; price: number; isActive: boolean; categoryId: string; categoryName: string; image?: string; fixedPrice: boolean }

/** Items for the Menu tab: search by name, filter by category, in the menu's own category order then by name. */
export function menuRows(items: MenuItem[], categories: Category[], f: { query?: string; categoryId?: string } = {}): MenuRow[] {
  const cats = new Map(categories.filter(c => !c.deleted).map(c => [c.id, c] as const));
  const q = (f.query || '').trim().toLowerCase();
  return items
    .filter(i => !(i as MenuItem & { deleted?: boolean }).deleted)
    .filter(i => !f.categoryId || f.categoryId === 'all' || i.categoryId === f.categoryId)
    .filter(i => !q || i.name.toLowerCase().includes(q))
    .map(i => ({
      id: i.id, name: i.name, price: Number(i.price || 0), isActive: i.isActive !== false, categoryId: i.categoryId,
      categoryName: cats.get(i.categoryId)?.name || '', image: i.image,
      fixedPrice: !i.pricingType || i.pricingType === 'fixed',
    }))
    .sort((a, b) => (cats.get(a.categoryId)?.sortOrder ?? 9999) - (cats.get(b.categoryId)?.sortOrder ?? 9999) || a.name.localeCompare(b.name));
}

/** A price typed on a phone: a whole positive number of rupees, nothing else. */
export function parsePrice(text: string): number | null {
  const t = String(text).replace(/[,\s]/g, '').replace(/^rs\.?/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n < 10_000_000 ? n : null;
}

// ------------------------------------------------------------------ low stock (OWN-14)
export interface StockRow { id: string; name: string; unit: string; qty: number; min: number; level: number; supplier?: { name: string; phone?: string } }
const norm = (s?: string) => (s || '').trim().toLowerCase();

/**
 * Items at or below their reorder level (the same rule as the dashboard), lowest first, each with the supplier who
 * last delivered it (receiving history) and that supplier's phone from the parties list, when recorded.
 */
export function lowStockRows(inventory: InventoryItem[], receiving: ReceivingEntry[] = [], parties: Party[] = []): StockRow[] {
  const phones = new Map(parties.filter(p => p.type === 'supplier').map(p => [norm(p.name), p.phone || undefined] as const));
  const latest = [...receiving].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return inventory
    .filter(i => i.isActive !== false && Number(i.quantity) <= Number(i.lowStockThreshold || 0))
    .map(i => {
      const r = latest.find(e => (e.inventoryItemId && e.inventoryItemId === i.id) || (!e.inventoryItemId && norm(e.itemName) === norm(i.name)));
      const min = Number(i.lowStockThreshold || 0);
      return {
        id: i.id, name: i.name, unit: i.baseUnit || i.unit || '', qty: Number(i.quantity || 0), min,
        level: min > 0 ? Math.max(0, Math.min(1, Number(i.quantity || 0) / min)) : 0,
        supplier: r?.supplierName ? { name: r.supplierName, phone: phones.get(norm(r.supplierName)) } : undefined,
      };
    })
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ expenses (OWN-15)
/** The device's local calendar date as YYYY-MM-DD (not the UTC date, which is yesterday before 5 am in Pakistan). */
export const localYmd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOf = (t: Transaction) => (t.date || '').slice(0, 10);

export interface ExpenseDay { key: string; label: string; total: number; rows: Transaction[] }

/** This month's expenses (by the row's own date), newest day first, with the month total. */
export function monthExpenses(transactions: Transaction[], now = new Date(), branchId = 'all'): { month: string; total: number; days: ExpenseDay[] } {
  const prefix = localYmd(now).slice(0, 7);
  const rows = transactions.filter(t => t.type === 'expense' && dayOf(t).startsWith(prefix)
    && (branchId === 'all' || (t.branchId ? String(t.branchId) : UNASSIGNED) === branchId));
  const by = new Map<string, Transaction[]>();
  for (const t of rows) by.set(dayOf(t), [...(by.get(dayOf(t)) || []), t]);
  const days = [...by.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, list]) => {
    const [y, m, d] = key.split('-').map(Number);
    return { key, label: `${d} ${MONTHS[(m || 1) - 1]}${y !== now.getFullYear() ? ` ${y}` : ''}`, total: list.reduce((s, t) => s + Number(t.amount || 0), 0), rows: list };
  });
  return { month: `${MONTHS[now.getMonth()]} ${now.getFullYear()}`, total: rows.reduce((s, t) => s + Number(t.amount || 0), 0), days };
}

export interface ExpenseInput { amount: string; categoryId: string; note: string; date: string; paymentMethod?: string }

/**
 * Checks an expense typed on the phone and builds the same record Accounts → Expense saves; returns the problem in
 * words when something is missing (the sheet keeps the values and shows it).
 */
export function buildExpense(input: ExpenseInput, categories: AccountCategory[], ctx: { id: string; createdBy?: string; today?: string }): { ok: true; txn: Transaction } | { ok: false; error: string } {
  const amount = parsePrice(input.amount);
  if (amount === null) return { ok: false, error: 'Enter the amount, e.g. 1500' };
  const cat = categories.find(c => c.id === input.categoryId && c.type === 'expense');
  if (!cat) return { ok: false, error: 'Choose a category' };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : '';
  if (!date) return { ok: false, error: 'Choose the date' };
  if (ctx.today && date > ctx.today) return { ok: false, error: 'The date cannot be in the future' };
  return {
    ok: true,
    txn: {
      id: ctx.id, date, type: 'expense', categoryId: cat.id, categoryName: cat.name, amount,
      paymentMethod: (input.paymentMethod || 'cash') as Transaction['paymentMethod'], description: input.note.trim(),
      reference: '', partyId: '', partyName: '', createdBy: ctx.createdBy,
    },
  };
}

// ------------------------------------------------------------------ compare branches (v1.87.0)
export type CompareMeasure = 'revenue' | 'bills' | 'avgBill' | 'owed' | 'voided';
export const COMPARE_MEASURES: { id: CompareMeasure; label: string; money: boolean; lowerIsBetter?: boolean }[] = [
  { id: 'revenue', label: 'Money taken', money: true },
  { id: 'bills', label: 'Bills', money: false },
  { id: 'avgBill', label: 'Average bill', money: true },
  { id: 'owed', label: 'Still owed', money: true, lowerIsBetter: true },
  { id: 'voided', label: 'Void / cancelled', money: false, lowerIsBetter: true },
];

/** Branches ranked by a measure, best first ("still owed" and voids: lowest first). Bills without a branch are not a branch. */
export function rankBranches(rows: BranchFigures[], measure: CompareMeasure): BranchFigures[] {
  const m = COMPARE_MEASURES.find(x => x.id === measure)!;
  return rows.filter(r => !r.unassigned && r.name !== 'Unknown branch')
    .sort((a, b) => (m.lowerIsBetter ? a[measure] - b[measure] : b[measure] - a[measure]) || a.name.localeCompare(b.name));
}
