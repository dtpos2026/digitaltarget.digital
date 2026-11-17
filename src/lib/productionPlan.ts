// ============================================================================
// Production Plan (v1.115.0) — for a bakery / café / restaurant chain: "how much do we make tomorrow, and for which branch?"
//
// A bakery bakes before it sells, so the question is asked the evening before. The answer used by chains everywhere is the
// same-weekday history: what each item sold on the last few Tuesdays (if tomorrow is a Tuesday), averaged, plus a small buffer.
// Pure functions over the orders the software already holds — no new table, no clock of their own.
//
//   • Only sold items count: paid, running, partial, credit and complimentary bills (a free cake was still baked); void, cancelled, held and rejected bills never do.
//   • A day the branch did not trade at all (a closed Tuesday, a holiday) is skipped, not averaged in as zero — otherwise one
//     closed day would shrink the next plan.
//   • Weighed items (by the kilo) are left out: a bakery plan counts pieces.
//   • Dates are the restaurant's local dates (the same ones the day close uses), never UTC.
// ============================================================================
import type { Order } from '@/lib/types';

const COUNTED = new Set(['paid', 'running', 'partial', 'credit_received', 'credit_pending', 'complimentary']);

/** YYYY-MM-DD in local time. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The same weekday, `weeks` times going back from `target` (the target itself is not included). */
export function sameWeekdays(target: Date, weeks: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= weeks; i++) { const d = new Date(target.getFullYear(), target.getMonth(), target.getDate() - 7 * i); out.push(localDay(d)); }
  return out;
}

export interface PlanItemInput { id: string; name: string; categoryId?: string; pricingType?: string; isActive?: boolean }

export interface PlanRow {
  itemId: string;
  name: string;
  categoryId?: string;
  /** pieces sold on each of the history days that traded (oldest last), per branch key */
  history: Record<string, number[]>;
  /** average of the trading days, per branch key */
  average: Record<string, number>;
  /** the suggested number to make, per branch key (average + buffer, rounded up to the batch) */
  forecast: Record<string, number>;
  tradingDays: number;
}

export interface PlanOptions {
  orders: Order[];
  items: PlanItemInput[];
  target: Date;
  weeks?: number;
  /** extra on top of the average, in percent (default 10) */
  bufferPct?: number;
  /** round every figure up to a multiple of this (a tray of 6, a dozen) */
  batch?: number;
  /** restrict to these branches; each becomes a column. Without it, all orders count as one column called 'all'. */
  branchIds?: string[];
  categoryIds?: string[];
}

const toNum = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

export function roundUpTo(n: number, batch: number): number {
  const b = Math.max(1, Math.floor(batch) || 1);
  return n <= 0 ? 0 : Math.ceil(n / b) * b;
}

/** The plan for `target`: one row per item that sold on at least one of the history days, with a column per branch. */
export function buildPlan(o: PlanOptions): { rows: PlanRow[]; columns: string[]; days: string[] } {
  const weeks = Math.min(12, Math.max(1, Math.floor(o.weeks ?? 4)));
  const buffer = Math.max(0, Number.isFinite(o.bufferPct) ? (o.bufferPct as number) : 10);
  const days = sameWeekdays(o.target, weeks);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const columns = o.branchIds && o.branchIds.length ? o.branchIds : ['all'];
  const allowed = o.categoryIds ? new Set(o.categoryIds) : null;
  const itemMap = new Map(o.items.map(i => [i.id, i]));

  // per branch column: which history days traded, and pieces sold per item per day
  const traded: Record<string, boolean[]> = {};
  const sold: Record<string, Map<string, number[]>> = {};
  for (const c of columns) { traded[c] = days.map(() => false); sold[c] = new Map(); }

  for (const order of o.orders) {
    if (!COUNTED.has(order.status)) continue;
    const created = order.createdAt ? new Date(order.createdAt) : null;
    if (!created || Number.isNaN(created.getTime())) continue;
    const di = dayIndex.get(localDay(created));
    if (di === undefined) continue;
    const col = columns.length === 1 && columns[0] === 'all' ? 'all' : (order.branchId && columns.includes(order.branchId) ? order.branchId : null);
    if (!col) continue;
    traded[col][di] = true;
    for (const line of order.items || []) {
      const it = itemMap.get(line.menuItemId);
      if (!it || it.pricingType === 'weight' || (allowed && !(it.categoryId && allowed.has(it.categoryId)))) continue;
      const qty = toNum(line.quantity);
      if (!qty) continue;
      let arr = sold[col].get(it.id);
      if (!arr) { arr = days.map(() => 0); sold[col].set(it.id, arr); }
      arr[di] += qty;
    }
  }

  const ids = new Set<string>();
  for (const c of columns) for (const id of sold[c].keys()) ids.add(id);

  const rows: PlanRow[] = [];
  for (const id of ids) {
    const it = itemMap.get(id)!;
    if (it.isActive === false) continue;
    const history: Record<string, number[]> = {}, average: Record<string, number> = {}, forecast: Record<string, number> = {};
    let tradingDays = 0;
    for (const c of columns) {
      const arr = sold[c].get(id) ?? days.map(() => 0);
      const used = arr.filter((_, i) => traded[c][i]);          // a day the branch did not trade is not a zero
      history[c] = arr;
      const avg = used.length ? used.reduce((s, n) => s + n, 0) / used.length : 0;
      average[c] = Math.round(avg * 10) / 10;
      forecast[c] = roundUpTo(Math.ceil(avg * (1 + buffer / 100) - 1e-9), o.batch ?? 1);
      tradingDays = Math.max(tradingDays, used.length);
    }
    rows.push({ itemId: id, name: it.name, categoryId: it.categoryId, history, average, forecast, tradingDays });
  }
  rows.sort((a, b) => {
    const ta = Object.values(a.forecast).reduce((s, n) => s + n, 0), tb = Object.values(b.forecast).reduce((s, n) => s + n, 0);
    return tb - ta || a.name.localeCompare(b.name);
  });
  return { rows, columns, days };
}

/** One line of text per item, ready to send to the bakery on WhatsApp: "Croissant — 48 (Main 20 · DHA 12 · Gulberg 16)". */
export function planAsText(title: string, rows: { name: string; perColumn: { label: string; qty: number }[]; total: number }[]): string {
  const lines = rows.filter(r => r.total > 0).map(r => {
    const split = r.perColumn.length > 1 ? ` (${r.perColumn.filter(c => c.qty > 0).map(c => `${c.label} ${c.qty}`).join(' · ')})` : '';
    return `${r.name} — ${r.total}${split}`;
  });
  return [title, '', ...lines].join('\n');
}

/** CSV of the same, one column per branch. Quotes and commas inside names are escaped. */
export function planAsCsv(columnLabels: string[], rows: { name: string; perColumn: number[]; total: number }[]): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = ['Item', ...columnLabels, ...(columnLabels.length > 1 ? ['Total'] : [])].map(q).join(',');
  return [head, ...rows.map(r => [q(r.name), ...r.perColumn, ...(columnLabels.length > 1 ? [r.total] : [])].join(','))].join('\n');
}

/**
 * Pieces sold of each item on one local day (the day sheet's "Sold" column): the same bills the plan counts, optionally one branch.
 * Weighed items are left out, as in the plan.
 */
export function soldOn(orders: Order[], items: PlanItemInput[], day: string, branchId?: string): Map<string, number> {
  const itemMap = new Map(items.map(i => [i.id, i]));
  const out = new Map<string, number>();
  for (const order of orders) {
    if (!COUNTED.has(order.status)) continue;
    if (branchId && order.branchId !== branchId) continue;
    const created = order.createdAt ? new Date(order.createdAt) : null;
    if (!created || Number.isNaN(created.getTime()) || localDay(created) !== day) continue;
    for (const line of order.items || []) {
      const it = itemMap.get(line.menuItemId);
      const qty = toNum(line.quantity);
      if (!it || it.pricingType === 'weight' || !qty) continue;
      out.set(it.id, (out.get(it.id) ?? 0) + qty);
    }
  }
  return out;
}
