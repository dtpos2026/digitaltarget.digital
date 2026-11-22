// v1.149.0 — "Accounts & expenses" as the design draws it (SW-25): the month under the title, three figure cards (Expenses this month "▲ 4% vs Sept" ·
// Cash on hand · Bank), a search with the categories as chips, and a table Date · Category · Account · Note · Amount. Pure: rows in, words and sums out.
// "Cash" and "bank" follow the rule the Cash Close tab already uses — a paid order or a transaction is cash when its payment method is cash; card and online
// go to the bank — and cash is counted from the last day close (what was counted then, plus what moved since), because a running total from the first
// sale of the business would drift with every handover the software never saw.
import type { AccountCategory, DailyCashClose, Order, PaymentAccount, Transaction, TxnType } from './types';

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ymd = (iso?: string) => String(iso || '').slice(0, 10);
const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "October 2026". */
export const monthLabel = (now: Date = new Date()): string => `${MONTH_LONG[now.getMonth()]} ${now.getFullYear()}`;

const monthOf = (now: Date, back = 0) => { const d = new Date(now.getFullYear(), now.getMonth() - back, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/** "Sept" for the month before — the design's "vs Sept" (Sep is written out the way the design writes it). */
export const previousMonthShort = (now: Date = new Date()): string => {
  const m = new Date(now.getFullYear(), now.getMonth() - 1, 1).getMonth();
  return m === 8 ? 'Sept' : MONTH_SHORT[m];
};

/** "30 Oct" from a YYYY-MM-DD (or ISO) date; "—" when there is none. */
export function dayLabel(iso?: string): string {
  const m = ymd(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || !(+m[2] >= 1 && +m[2] <= 12) || !+m[3]) return '—';
  return `${String(+m[3]).padStart(2, '0')} ${MONTH_SHORT[+m[2] - 1]}`;
}

/** What the money moved through, in the Account column. */
export function accountWord(method?: string): string {
  switch (String(method || '').toLowerCase()) {
    case 'cash': return 'Cash';
    case 'card': return 'Card';
    case 'online': return 'Online';
    case 'credit': return 'On credit';
    default: return method ? String(method) : '—';
  }
}

export interface MonthFigure { total: number; previous: number; /** whole percent against last month; null when last month had nothing to compare to */ deltaPct: number | null }

/** The sum of one kind of transaction this month, and against the month before. */
export function monthFigure(txns: Pick<Transaction, 'type' | 'date' | 'amount'>[], type: TxnType, now: Date = new Date()): MonthFigure {
  const cur = monthOf(now), prev = monthOf(now, 1);
  let total = 0, previous = 0;
  for (const t of txns) {
    if (t.type !== type) continue;
    const m = ymd(t.date).slice(0, 7);
    if (m === cur) total += num(t.amount); else if (m === prev) previous += num(t.amount);
  }
  total = round2(total); previous = round2(previous);
  return { total, previous, deltaPct: previous > 0 ? Math.round(((total - previous) / previous) * 100) : null };
}

/** "▲ 4% vs Sept" · "▼ 12% vs Sept" · "Same as Sept" — and no line at all when last month has nothing to compare to. */
export function deltaCaption(pct: number | null, now: Date = new Date()): string {
  if (pct == null) return '';
  const vs = previousMonthShort(now);
  if (pct === 0) return `Same as ${vs}`;
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs ${vs}`;
}

/** More spending is bad, more income is good. */
export const deltaTone = (pct: number | null, type: TxnType): 'ok' | 'bad' | undefined => (pct == null || pct === 0 ? undefined : (pct > 0) === (type === 'income') ? 'ok' : 'bad');

/** Paid sales of the month (what the till took; credit that was never collected is not in it). */
export function salesThisMonth(orders: Pick<Order, 'status' | 'paidAt' | 'grandTotal'>[], now: Date = new Date()): number {
  const cur = monthOf(now);
  return round2(orders.filter(o => o.status === 'paid' && ymd(o.paidAt).slice(0, 7) === cur).reduce((s, o) => s + num(o.grandTotal), 0));
}

type PaidOrder = Pick<Order, 'status' | 'paidAt' | 'paymentMethod' | 'grandTotal'>;
type Txn = Pick<Transaction, 'type' | 'date' | 'amount' | 'paymentMethod'>;

const movement = (orders: PaidOrder[], txns: Txn[], isMethod: (m: string) => boolean, after: string) => {
  let sum = 0;
  for (const o of orders) if (o.status === 'paid' && isMethod(String(o.paymentMethod || '')) && ymd(o.paidAt) > after) sum += num(o.grandTotal);
  for (const t of txns) if (isMethod(String(t.paymentMethod || '')) && ymd(t.date) > after) sum += t.type === 'income' ? num(t.amount) : -num(t.amount);
  return sum;
};

/** What the drawer should hold: what was counted at the last day close plus the cash that moved after it (before any close: the cash drawers' opening balances plus everything since). */
export function cashOnHand(orders: PaidOrder[], txns: Txn[], closes: Pick<DailyCashClose, 'date' | 'countedCash'>[], accounts: Pick<PaymentAccount, 'type' | 'isActive' | 'openingBalance'>[]): number {
  const last = [...closes].sort((a, b) => ymd(b.date).localeCompare(ymd(a.date)))[0];
  const base = last ? num(last.countedCash) : accounts.filter(a => a.isActive && a.type === 'cash').reduce((s, a) => s + num(a.openingBalance), 0);
  return round2(base + movement(orders, txns, m => m === 'cash', last ? ymd(last.date) : ''));
}

/** What the bank, JazzCash, Easypaisa and wallet accounts should hold: their opening balances plus card and online takings and transactions, less card and online spending. */
export function bankBalance(orders: PaidOrder[], txns: Txn[], accounts: Pick<PaymentAccount, 'type' | 'isActive' | 'openingBalance'>[]): number {
  const base = accounts.filter(a => a.isActive && a.type !== 'cash').reduce((s, a) => s + num(a.openingBalance), 0);
  return round2(base + movement(orders, txns, m => m === 'card' || m === 'online', ''));
}

export interface CategoryChip { key: string; label: string }

/** "All" and the categories of this kind of entry, in the order they were made. */
export function categoryChips(cats: Pick<AccountCategory, 'id' | 'name' | 'type'>[], type: TxnType): CategoryChip[] {
  return [{ key: 'all', label: 'All' }, ...cats.filter(c => c.type === type).map(c => ({ key: c.id, label: c.name }))];
}

/** The search reads category, note, party, reference and the amount as typed. */
export function matchesTxn(t: Pick<Transaction, 'categoryName' | 'description' | 'partyName' | 'reference' | 'amount' | 'paymentMethod'>, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [t.categoryName, t.description, t.partyName, t.reference, accountWord(t.paymentMethod), String(t.amount)].some(v => String(v || '').toLowerCase().includes(s));
}

/** One kind of entry, newest first, in the category and search chosen. */
export function txnRows<T extends Transaction>(txns: T[], type: TxnType, category = 'all', q = ''): T[] {
  return txns
    .filter(t => t.type === type && (category === 'all' || t.categoryId === category) && matchesTxn(t, q))
    .sort((a, b) => ymd(b.date).localeCompare(ymd(a.date)));
}
