// ============================================================
// Branch Performance — the pure part (v1.82.0)
//
// One row per branch plus a group total, for a period and the period before it. Every figure uses the same
// rules as the rest of the app (lib/sales.ts "paid sale", the dashboard's profit = sales − expenses), so this
// page and the Dashboard / Reports never disagree about the same money.
//
// Rows that carry no branch (they predate branch stamping, or were written by an all-branch owner login) are
// shown under their own heading instead of being dropped or silently added to one branch — the rule Owner
// Management already follows.
//
// Not estimated: where a record has no branch (employees and payroll are not branch-stamped), staff are counted
// from sign-in users, who are, and payroll is not split.
// ============================================================
import type { InventoryItem, Order, Transaction, User, Wastage } from './types';
import { balanceDue, isOpen, isPaidSale, isPartialSale, isVoidish } from './sales';
import { orderTime, pctChange, periodWindows, type Win } from './dashboardOverview';

export const UNASSIGNED = '__none__';

export interface BranchRef { id: string; name: string }

export interface BranchInput {
  orders: Order[];
  transactions: Transaction[];
  wastages: Wastage[];
  inventory: InventoryItem[];
  users: User[];
  branches: BranchRef[];
}

export interface BranchMetrics {
  sales: number;
  orders: number;
  avg: number;
  expenses: number;
  /** Sales minus expenses — the same "profit" the Dashboard shows. */
  profit: number;
  wastage: number;
  /** Discounts as a share of what the bills were worth before discount, 0–100. */
  discountPct: number;
  /** Voided, complimentary and cancelled bills as a share of all bills raised, 0–100. */
  voidPct: number;
  /** Share of sales taken as cash, 0–100. */
  cashPct: number;
  customers: number;
}

export interface BranchRow {
  id: string;
  name: string;
  unassigned: boolean;
  cur: BranchMetrics;
  prev: BranchMetrics;
  /** Bills open right now and the balance still owed on part-paid bills (not period-bound: it is the state today). */
  openBills: number;
  amountDue: number;
  inventoryValue: number;
  lowStock: number;
  staff: number;
  topItems: { name: string; sales: number; qty: number }[];
  /** Share of the group's sales in the period, 0–100. */
  sharePct: number;
  /** 1 = highest sales; ties share a rank. */
  rank: number;
  salesChangePct: number | null;
  profitChangePct: number | null;
}

export interface BranchReport {
  rows: BranchRow[];
  group: BranchRow;
  /** True when at least one branch row exists besides the "no branch recorded" one. */
  multi: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const blank = (): BranchMetrics => ({ sales: 0, orders: 0, avg: 0, expenses: 0, profit: 0, wastage: 0, discountPct: 0, voidPct: 0, cashPct: 0, customers: 0 });

const branchOf = (x: { branchId?: string | null }): string => (x.branchId ? String(x.branchId) : UNASSIGNED);
const inWin = (t: number, w: Win) => t >= w.start && t < w.end;
const phoneKey = (o: Order) => String(o.customer?.phone || '').replace(/\D/g, '') || String(o.customer?.name || '').trim().toLowerCase();

interface Acc {
  sales: number; orders: number; gross: number; discount: number; cash: number;
  raised: number; voided: number; expenses: number; wastage: number; customers: Set<string>;
  items: Map<string, { name: string; sales: number; qty: number }>;
}
const newAcc = (): Acc => ({ sales: 0, orders: 0, gross: 0, discount: 0, cash: 0, raised: 0, voided: 0, expenses: 0, wastage: 0, customers: new Set(), items: new Map() });

function finish(a: Acc): BranchMetrics {
  return {
    sales: a.sales,
    orders: a.orders,
    avg: a.orders ? Math.round(a.sales / a.orders) : 0,
    expenses: a.expenses,
    profit: a.sales - a.expenses,
    wastage: a.wastage,
    discountPct: a.gross > 0 ? r1((a.discount / a.gross) * 100) : 0,
    voidPct: a.raised > 0 ? r1((a.voided / a.raised) * 100) : 0,
    cashPct: a.sales > 0 ? r1((a.cash / a.sales) * 100) : 0,
    customers: a.customers.size,
  };
}

/** Accumulate one window for every branch in a single pass over each collection. */
function accumulate(input: BranchInput, w: Win, withItems: boolean): Map<string, Acc> {
  const by = new Map<string, Acc>();
  const get = (k: string) => { let a = by.get(k); if (!a) { a = newAcc(); by.set(k, a); } return a; };
  for (const o of input.orders) {
    const t = orderTime(o);
    if (!inWin(t, w)) continue;
    const a = get(branchOf(o));
    a.raised++;
    if (isVoidish(o)) { a.voided++; continue; }
    if (!isPaidSale(o)) continue;
    const total = Number(o.grandTotal || 0);
    a.sales += total;
    a.orders++;
    a.discount += Number(o.discount || 0);
    a.gross += total + Number(o.discount || 0);
    if ((o.paymentMethod || 'cash') === 'cash') a.cash += total;
    const k = phoneKey(o);
    if (k) a.customers.add(k);
    if (withItems) {
      for (const it of o.items || []) {
        const e = a.items.get(it.name) || { name: it.name, sales: 0, qty: 0 };
        e.sales += Number(it.lineTotal || 0);
        e.qty += Number(it.quantity || 0);
        a.items.set(it.name, e);
      }
    }
  }
  for (const t of input.transactions) {
    if (t.type !== 'expense') continue;
    const ms = new Date(t.date).getTime();
    if (!Number.isFinite(ms) || !inWin(ms, w)) continue;
    get(branchOf(t)).expenses += Number(t.amount || 0);
  }
  for (const x of input.wastages) {
    const ms = new Date(x.date).getTime();
    if (!Number.isFinite(ms) || !inWin(ms, w)) continue;
    get(branchOf(x)).wastage += Number(x.costValue || 0);
  }
  return by;
}

function rankRows(rows: BranchRow[]): void {
  const sorted = rows.slice().sort((a, b) => b.cur.sales - a.cur.sales);
  let rank = 0, last = Number.NaN;
  sorted.forEach((r, i) => { if (r.cur.sales !== last) { rank = i + 1; last = r.cur.sales; } r.rank = rank; });
}

/**
 * Compare branches. `includeUnassigned` keeps the "no branch recorded" row (owners see it; a user limited to some
 * branches does not). The group row always totals every row that is shown.
 */
export function compareBranches(input: BranchInput, win: { cur: Win; prev: Win }, opts: { includeUnassigned?: boolean } = {}): BranchReport {
  const cur = accumulate(input, win.cur, true);
  const prev = accumulate(input, win.prev, false);

  const ids = input.branches.map(b => b.id);
  const known = new Set(ids);
  const present = new Set<string>([...cur.keys(), ...prev.keys()]);
  for (const o of input.orders) present.add(branchOf(o));
  const orphan = [...present].filter(k => k !== UNASSIGNED && !known.has(k));
  const order = [...ids, ...orphan];
  const wantUn = opts.includeUnassigned !== false && present.has(UNASSIGNED);
  if (wantUn) order.push(UNASSIGNED);

  const nameOf = (id: string) => id === UNASSIGNED ? 'No branch recorded' : input.branches.find(b => b.id === id)?.name || 'Unknown branch';

  const openBy = new Map<string, { n: number; due: number }>();
  for (const o of input.orders) {
    const k = branchOf(o);
    if (isOpen(o)) { const e = openBy.get(k) || { n: 0, due: 0 }; e.n++; openBy.set(k, e); }
    // Only bills that were part-paid owe a balance here. (Credit / udhaar is netted against its payments elsewhere,
    // so it is not guessed at on this page.)
    if (isPartialSale(o)) { const e = openBy.get(k) || { n: 0, due: 0 }; e.due += balanceDue(o); openBy.set(k, e); }
  }
  const invBy = new Map<string, { value: number; low: number }>();
  for (const i of input.inventory) {
    if (i.isActive === false) continue;
    const e = invBy.get(branchOf(i)) || { value: 0, low: 0 };
    e.value += Math.max(0, Number(i.quantity || 0)) * Number(i.avgCostPrice ?? i.costPrice ?? 0);
    if (Number(i.quantity || 0) <= Number(i.lowStockThreshold || 0) && Number(i.lowStockThreshold || 0) > 0) e.low++;
    invBy.set(branchOf(i), e);
  }
  const staffBy = new Map<string, number>();
  for (const u of input.users) if (u.isActive !== false) staffBy.set(branchOf(u), (staffBy.get(branchOf(u)) || 0) + 1);

  const rows: BranchRow[] = order.map(id => {
    const c = finish(cur.get(id) || newAcc());
    const p = finish(prev.get(id) || newAcc());
    const items = [...(cur.get(id)?.items.values() || [])].sort((a, b) => b.sales - a.sales).slice(0, 3);
    return {
      id, name: nameOf(id), unassigned: id === UNASSIGNED, cur: c, prev: p,
      openBills: openBy.get(id)?.n || 0, amountDue: Math.round(openBy.get(id)?.due || 0),
      inventoryValue: Math.round(invBy.get(id)?.value || 0), lowStock: invBy.get(id)?.low || 0,
      staff: staffBy.get(id) || 0, topItems: items,
      sharePct: 0, rank: 0, salesChangePct: pctChange(c.sales, p.sales), profitChangePct: pctChange(c.profit, p.profit),
    };
  });

  // group = the sum of the rows that are shown (customers are de-duplicated across branches)
  const groupAcc = newAcc();
  const merged = new Map<string, { name: string; sales: number; qty: number }>();
  const sumAcc = (m: Map<string, Acc>, into: Acc, ids2: string[]) => {
    for (const id of ids2) {
      const a = m.get(id); if (!a) continue;
      into.sales += a.sales; into.orders += a.orders; into.gross += a.gross; into.discount += a.discount; into.cash += a.cash;
      into.raised += a.raised; into.voided += a.voided; into.expenses += a.expenses; into.wastage += a.wastage;
      a.customers.forEach(c => into.customers.add(c));
      a.items.forEach(it => { const e = merged.get(it.name) || { name: it.name, sales: 0, qty: 0 }; e.sales += it.sales; e.qty += it.qty; merged.set(it.name, e); });
    }
  };
  const prevAcc = newAcc();
  sumAcc(cur, groupAcc, order);
  sumAcc(prev, prevAcc, order);

  const total = groupAcc.sales;
  rows.forEach(r => { r.sharePct = total > 0 ? r1((r.cur.sales / total) * 100) : 0; });
  rankRows(rows);

  const gc = finish(groupAcc), gp = finish(prevAcc);
  const group: BranchRow = {
    id: '__group__', name: 'All branches', unassigned: false, cur: gc, prev: gp,
    openBills: rows.reduce((s, r) => s + r.openBills, 0), amountDue: rows.reduce((s, r) => s + r.amountDue, 0),
    inventoryValue: rows.reduce((s, r) => s + r.inventoryValue, 0), lowStock: rows.reduce((s, r) => s + r.lowStock, 0),
    staff: rows.reduce((s, r) => s + r.staff, 0),
    topItems: [...merged.values()].sort((a, b) => b.sales - a.sales).slice(0, 3),
    sharePct: total > 0 ? 100 : 0, rank: 0, salesChangePct: pctChange(gc.sales, gp.sales), profitChangePct: pctChange(gc.profit, gp.profit),
  };
  return { rows, group, multi: rows.filter(r => !r.unassigned).length > 1 };
}

// ------------------------------------------------------------------ periods
export type BranchPeriod = 'today' | '7d' | '30d' | 'month';

/** Today / 7 days / 30 days use the dashboard's windows; "this month" runs from the 1st to now, against the same span last month. */
export function branchWindows(period: BranchPeriod, nowMs: number): { cur: Win; prev: Win } {
  if (period === 'month') {
    const d = new Date(nowMs);
    const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const prevStart = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
    const span = nowMs - start;
    const prevEnd = Math.min(start, prevStart + span);
    return { cur: { start, end: nowMs }, prev: { start: prevStart, end: prevEnd } };
  }
  const w = periodWindows(period === 'today' ? 1 : period === '7d' ? 7 : 30, nowMs);
  return { cur: w.cur, prev: w.prev };
}

// ------------------------------------------------------------------ what to highlight
export type Metric = 'sales' | 'orders' | 'avg' | 'profit' | 'expenses' | 'discountPct' | 'voidPct';
/** Metrics where a lower number is the better one. */
export const LOWER_IS_BETTER: Metric[] = ['expenses', 'discountPct', 'voidPct'];

/** Best and weakest branch for a metric, ignoring the unassigned row and branches with no activity. */
export function extremes(rows: BranchRow[], metric: Metric): { best: string | null; weakest: string | null } {
  const live = rows.filter(r => !r.unassigned && (r.cur.sales > 0 || r.cur.orders > 0 || r.cur.expenses > 0));
  if (live.length < 2) return { best: null, weakest: null };
  const lower = LOWER_IS_BETTER.includes(metric);
  const sorted = live.slice().sort((a, b) => (lower ? a.cur[metric] - b.cur[metric] : b.cur[metric] - a.cur[metric]));
  if (sorted[0].cur[metric] === sorted[sorted.length - 1].cur[metric]) return { best: null, weakest: null };
  return { best: sorted[0].id, weakest: sorted[sorted.length - 1].id };
}

export function toCsv(report: BranchReport, label: string): string[][] {
  const head = ['Branch', 'Sales', 'Orders', 'Average bill', 'Expenses', 'Profit (sales − expenses)', 'Wastage', 'Discount %', 'Void %', 'Cash %', 'Customers', 'Share %', 'Change in sales %', 'Open bills', 'Amount due', 'Inventory value', 'Low stock', 'Staff'];
  const row = (r: BranchRow) => [r.name, r.cur.sales, r.cur.orders, r.cur.avg, r.cur.expenses, r.cur.profit, r.cur.wastage, r.cur.discountPct, r.cur.voidPct, r.cur.cashPct, r.cur.customers, r.sharePct, r.salesChangePct ?? '', r.openBills, r.amountDue, r.inventoryValue, r.lowStock, r.staff].map(String);
  return [[`Branch performance — ${label}`], head, ...report.rows.map(row), row(report.group)];
}
