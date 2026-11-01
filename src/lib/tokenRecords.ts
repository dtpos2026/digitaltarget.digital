// ============================================================
// TOKEN RECORDS — the business record behind every token issued.
//
// These live in the application database (AppData.tokenRecords), beside
// orders, because they carry payment state and drive the token counts.
// The old localStorage ledger is still written for backward compatibility,
// but it is no longer the source of truth.
//
// The rule that matters most
// --------------------------
// Issuing a token creates a record. REPRINTING one never does — it bumps
// `reprintCount` on the original. So printing Order #1107 / Token #006 again
// from Retrieve shows "REPRINT" on the paper and leaves the token count,
// and any token sale, exactly where it was.
// ============================================================
import type {
  CartItem,
  MenuItem,
  Order,
  PaymentMethod,
  RestaurantSettings,
  TokenRecord,
  TokenRecordItem,
} from './types';
import { getMenuItems, getCategories, getTokenRecords, saveTokenRecord } from './store';
import { getTokenLines, resolveTokenRules, itemMatchesTokenRules, categoryLookup } from './tokenRules';

/** YYYY-MM-DD in local time — the key every day filter and day-close uses. */
export function tokenDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Is the shop tracking token payment separately? */
export function isTokenPaymentMode(settings: RestaurantSettings | any): boolean {
  return !!settings?.tokenPaymentMode;
}

/**
 * Next token number for the day.
 *
 * Numbering restarts daily, which is what a counter expects ("token 6" means
 * the sixth today, not the six-thousandth ever). Derived from the stored
 * records so it survives a restart and cannot drift from what was printed.
 */
export function nextTokenNumber(dateKey = tokenDateKey()): number {
  const today = getTokenRecords().filter(t => t.dateKey === dateKey);
  return today.reduce((max, t) => Math.max(max, Number(t.tokenNumber) || 0), 0) + 1;
}

/** The token already issued for an order, if there is one. */
export function findTokenForOrder(orderId: string | undefined): TokenRecord | undefined {
  if (!orderId) return undefined;
  return getTokenRecords().find(t => t.orderId === orderId && !t.voided);
}

export function getTokenRecord(id: string): TokenRecord | undefined {
  return getTokenRecords().find(t => t.id === id);
}

/** Build the token's lines, tagged with the department each one belongs to. */
export function buildTokenItems(
  lines: Pick<CartItem, 'menuItemId' | 'name' | 'quantity' | 'lineTotal'>[],
  menu: MenuItem[] = getMenuItems(),
): TokenRecordItem[] {
  const categoryOf = categoryLookup(menu);
  const categoryNames = new Map(getCategories().map(c => [c.id, c.name]));
  return lines.map(l => {
    const departmentId = l.menuItemId ? categoryOf(l.menuItemId) : undefined;
    return {
      menuItemId: l.menuItemId,
      name: l.name,
      qty: l.quantity,
      departmentId,
      departmentName: departmentId ? categoryNames.get(departmentId) : undefined,
      amount: Number(l.lineTotal) || 0,
    };
  });
}

export interface IssueTokenArgs {
  order?: Order;
  /** Lines to put on the token. Defaults to the order's token-rule matches. */
  lines?: Pick<CartItem, 'menuItemId' | 'name' | 'quantity' | 'lineTotal'>[];
  settings: RestaurantSettings | any;
  source?: 'auto' | 'manual';
  cashierId?: string;
  cashierName?: string;
  /** Pre-assigned token number (a manual counter token without an order). */
  tokenNumber?: number;
}

export interface IssueTokenResult {
  record: TokenRecord;
  /** True when this call returned the EXISTING token instead of a new one. */
  isReprint: boolean;
}

/**
 * Get the token for this order, creating it only if it does not exist.
 *
 * This is the single entry point for both "print token" and "print it
 * again": an order that already has a token gets that same record back with
 * `isReprint` true, so no caller can accidentally mint a second one.
 */
export function issueToken(args: IssueTokenArgs): IssueTokenResult | null {
  const { order, settings } = args;

  // Reprint: the order already has a token. Never create another.
  const existing = findTokenForOrder(order?.id);
  if (existing) {
    const updated: TokenRecord = {
      ...existing,
      reprintCount: (existing.reprintCount || 0) + 1,
      lastReprintAt: new Date().toISOString(),
    };
    saveTokenRecord(updated);
    return { record: updated, isReprint: true };
  }

  const menu = getMenuItems();
  const sourceLines = args.lines
    ?? (order
      ? (order.items || []).filter(it => {
          const rules = resolveTokenRules(settings);
          return (it.quantity || 0) > 0 && itemMatchesTokenRules(it, rules, categoryLookup(menu));
        })
      : []);
  if (!sourceLines.length) return null;

  const items = buildTokenItems(sourceLines, menu);
  const now = new Date();
  const paymentMode = isTokenPaymentMode(settings);
  const amount = items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

  const record: TokenRecord = {
    id: `tok_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    tokenNumber: args.tokenNumber ?? nextTokenNumber(tokenDateKey(now)),
    orderId: order?.id,
    orderNumber: order?.orderNumber,
    branchId: order?.branchId,
    dateKey: tokenDateKey(now),
    createdAt: now.toISOString(),
    orderType: order?.orderType,
    tableName: order?.tableName || order?.tableLabel,
    customerName: order?.customer?.name,
    customerPhone: order?.customer?.phone,
    items,
    totalPieces: items.reduce((sum, i) => sum + (Number(i.qty) || 0), 0),
    amount,
    // With payment mode off a token is a kitchen instruction, not something
    // paid for on its own, so it is not counted as unpaid money.
    paymentStatus: paymentMode
      ? (order?.status === 'paid' ? 'paid' : 'unpaid')
      : 'not_applicable',
    paidAt: paymentMode && order?.status === 'paid' ? (order.paidAt || now.toISOString()) : undefined,
    paymentMethod: paymentMode && order?.status === 'paid' ? order.paymentMethod : undefined,
    cashierId: args.cashierId,
    cashierName: args.cashierName || order?.cashierName,
    source: args.source || 'auto',
    printedAt: now.toISOString(),
    reprintCount: 0,
    departmentIds: Array.from(new Set(items.map(i => i.departmentId).filter(Boolean) as string[])),
  };

  saveTokenRecord(record);
  return { record, isReprint: false };
}

/** Mark a token paid / unpaid. Only meaningful under Token Payment Mode. */
export function setTokenPaid(id: string, paid: boolean, opts: {
  paymentMethod?: PaymentMethod;
  cashierId?: string;
  cashierName?: string;
} = {}): TokenRecord | undefined {
  const record = getTokenRecord(id);
  if (!record) return undefined;
  // A token the shop does not charge for separately has no paid state to set.
  if (record.paymentStatus === 'not_applicable') return record;
  const updated: TokenRecord = {
    ...record,
    paymentStatus: paid ? 'paid' : 'unpaid',
    paidAt: paid ? new Date().toISOString() : undefined,
    paymentMethod: paid ? (opts.paymentMethod ?? record.paymentMethod) : undefined,
    cashierId: opts.cashierId ?? record.cashierId,
    cashierName: opts.cashierName ?? record.cashierName,
  };
  saveTokenRecord(updated);
  return updated;
}

/** Void a token without deleting it — history stays auditable. */
export function voidTokenRecord(id: string, reason?: string): TokenRecord | undefined {
  const record = getTokenRecord(id);
  if (!record) return undefined;
  const updated: TokenRecord = { ...record, voided: true, voidReason: reason };
  saveTokenRecord(updated);
  return updated;
}

// ------------------------------------------------------------
// Reporting
// ------------------------------------------------------------
export interface TokenFilters {
  dateKey?: string;
  fromDate?: string;
  toDate?: string;
  tokenNumber?: number | string;
  orderNumber?: number | string;
  paymentStatus?: 'paid' | 'unpaid' | 'all';
  departmentId?: string;
  cashierName?: string;
  /** Only tokens that have been printed more than once. */
  reprintedOnly?: boolean;
  includeVoided?: boolean;
}

export function filterTokenRecords(filters: TokenFilters = {}): TokenRecord[] {
  const text = (v: unknown) => String(v ?? '').toLowerCase().trim();
  return getTokenRecords()
    .filter(t => {
      if (!filters.includeVoided && t.voided) return false;
      if (filters.dateKey && t.dateKey !== filters.dateKey) return false;
      if (filters.fromDate && t.dateKey < filters.fromDate) return false;
      if (filters.toDate && t.dateKey > filters.toDate) return false;
      if (filters.tokenNumber != null && text(filters.tokenNumber) !== ''
        && !text(t.tokenNumber).includes(text(filters.tokenNumber))) return false;
      if (filters.orderNumber != null && text(filters.orderNumber) !== ''
        && !text(t.orderNumber).includes(text(filters.orderNumber))) return false;
      if (filters.paymentStatus && filters.paymentStatus !== 'all'
        && t.paymentStatus !== filters.paymentStatus) return false;
      if (filters.departmentId && !(t.departmentIds || []).includes(filters.departmentId)) return false;
      if (filters.cashierName && !text(t.cashierName).includes(text(filters.cashierName))) return false;
      if (filters.reprintedOnly && !(t.reprintCount > 0)) return false;
      return true;
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export interface TokenSummary {
  total: number;
  paid: number;
  unpaid: number;
  reprinted: number;
  totalPieces: number;
  paidAmount: number;
  unpaidAmount: number;
  totalAmount: number;
  /** Pieces issued per department — the figure a physical count is checked against. */
  perDepartment: { departmentId: string; departmentName: string; qty: number; tokens: number }[];
}

export function summariseTokens(records: TokenRecord[]): TokenSummary {
  const perDept = new Map<string, { name: string; qty: number; tokens: Set<string> }>();
  let paid = 0, unpaid = 0, paidAmount = 0, unpaidAmount = 0, totalPieces = 0, reprinted = 0;

  for (const t of records) {
    totalPieces += t.totalPieces || 0;
    if (t.reprintCount > 0) reprinted++;
    if (t.paymentStatus === 'paid') { paid++; paidAmount += t.amount || 0; }
    else if (t.paymentStatus === 'unpaid') { unpaid++; unpaidAmount += t.amount || 0; }
    for (const item of t.items || []) {
      const id = item.departmentId || 'unassigned';
      const row = perDept.get(id) || { name: item.departmentName || 'Unassigned', qty: 0, tokens: new Set<string>() };
      row.qty += item.qty || 0;
      row.tokens.add(t.id);
      perDept.set(id, row);
    }
  }

  return {
    total: records.length,
    paid,
    unpaid,
    reprinted,
    totalPieces,
    paidAmount,
    unpaidAmount,
    totalAmount: paidAmount + unpaidAmount,
    perDepartment: Array.from(perDept.entries())
      .map(([departmentId, r]) => ({ departmentId, departmentName: r.name, qty: r.qty, tokens: r.tokens.size }))
      .sort((a, b) => b.qty - a.qty),
  };
}

/** Convenience: today's counts for a dashboard tile. */
export function todayTokenSummary(): TokenSummary {
  return summariseTokens(filterTokenRecords({ dateKey: tokenDateKey() }));
}

/** Lines of a token grouped by department, for detachable printing. */
export function groupByDepartment(record: TokenRecord): {
  departmentId: string;
  departmentName: string;
  items: TokenRecordItem[];
  qty: number;
}[] {
  const groups = new Map<string, { name: string; items: TokenRecordItem[]; qty: number }>();
  for (const item of record.items || []) {
    const id = item.departmentId || 'unassigned';
    const row = groups.get(id) || { name: item.departmentName || 'Other', items: [], qty: 0 };
    row.items.push(item);
    row.qty += item.qty || 0;
    groups.set(id, row);
  }
  return Array.from(groups.entries()).map(([departmentId, r]) => ({
    departmentId,
    departmentName: r.name,
    items: r.items,
    qty: r.qty,
  }));
}

/** Re-export so callers do not need two imports for the common case. */
export { getTokenLines };
