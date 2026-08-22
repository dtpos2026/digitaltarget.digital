// ============================================================
// v1.3.0 — TOKEN PRINTING MODULE (core library)
//
// DESIGN RULE: a token sale is a NORMAL order. It lives in the same
// `orders` collection, uses the same order number, the same inventory
// deduction, the same reports and the same offline/cloud sync. The only
// difference is a set of token stamps (isTokenSale, tokenNumber,
// tokenStatus). There is deliberately NO parallel sales system — that
// would fragment reporting and break database integrity.
//
// Token counter is stored locally per business day (tokens are a
// counter-queue concept, not an accounting document), while the order
// itself syncs to the cloud like any other sale.
// ============================================================
import type { Order, MenuItem, CartItem, RestaurantSettings } from './types';
import { getOrders, saveOrder, getSettings, getNextOrderNumberAsync, getCurrentUser, getCurrentBranchId, genId } from './store';
import { getTenantId } from './tenant';
import { featureActive } from './optionalModules';

// ---------- Token number counter ----------

const counterKey = () => `dt-pos-token-counter::${getTenantId() || 'local'}`;

interface TokenCounterState { day: string; value: number; }

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCounter(): TokenCounterState {
  try {
    const raw = localStorage.getItem(counterKey());
    if (raw) {
      const parsed = JSON.parse(raw) as TokenCounterState;
      if (parsed && typeof parsed.value === 'number') return parsed;
    }
  } catch {}
  return { day: todayKey(), value: 0 };
}

function writeCounter(state: TokenCounterState) {
  try { localStorage.setItem(counterKey(), JSON.stringify(state)); } catch {}
}

/** Next token number, resetting daily when configured (default: reset). */
export function nextTokenNumber(settings?: RestaurantSettings): number {
  const s = settings || safeSettings();
  const state = readCounter();
  const today = todayKey();
  const dailyReset = s?.tokenCounterDailyReset !== false;
  if (dailyReset && state.day !== today) {
    const fresh = { day: today, value: 1 };
    writeCounter(fresh);
    return 1;
  }
  const next = { day: today, value: (state.value || 0) + 1 };
  writeCounter(next);
  return next.value;
}

/** Peek without consuming — for previews/dashboards. */
export function peekTokenNumber(settings?: RestaurantSettings): number {
  const s = settings || safeSettings();
  const state = readCounter();
  if (s?.tokenCounterDailyReset !== false && state.day !== todayKey()) return 1;
  return (state.value || 0) + 1;
}

export function formatTokenLabel(n: number, settings?: RestaurantSettings): string {
  const s = settings || safeSettings();
  const prefix = (s?.tokenPrefix || '').trim();
  const padded = String(n).padStart(3, '0');
  return prefix ? `${prefix}-${padded}` : padded;
}

function safeSettings(): RestaurantSettings {
  try { return getSettings(); } catch { return {} as RestaurantSettings; }
}

// ---------- Creating a token sale ----------

export interface TokenSaleLine {
  item: MenuItem;
  quantity: number;
  unitPrice: number;
}

/**
 * Create + persist a token sale. Returns the saved order, ready to print.
 *
 * The order is created as a fully PAID sale so it flows into revenue,
 * inventory and analytics exactly like a counter sale — which is the
 * whole point of the token workflow (no second confirmation step).
 */
export async function createTokenSale(lines: TokenSaleLine[]): Promise<Order> {
  if (!lines.length) throw new Error('Token sale needs at least one item');
  const settings = safeSettings();
  const now = new Date().toISOString();
  const user = (() => { try { return getCurrentUser(); } catch { return null; } })();

  const items: CartItem[] = lines.map((l, idx) => {
    const qty = Math.max(1, Math.round(l.quantity || 1));
    const price = Number(l.unitPrice ?? l.item.price ?? 0);
    return {
      id: `tok-${Date.now()}-${idx}`,
      menuItemId: l.item.id,
      name: l.item.name,
      price,
      quantity: qty,
      lineTotal: price * qty,
      // Token slips are printed directly — nothing pending for the kitchen.
      printedQty: qty,
    } as CartItem;
  });

  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const tokenNumber = nextTokenNumber(settings);

  const order: Order = {
    // FIX: uuid column on Postgres orders.id — see OnlineOrderPage.tsx fix.
    id: genId(),
    // v1.17.1 — transactional, like the POS. The local counter gave two
    // devices the same token order number on a busy counter.
    orderNumber: await getNextOrderNumberAsync(),
    orderType: 'takeaway',
    status: 'paid',
    source: 'pos',
    items,
    subtotal,
    discount: 0,
    tax: 0,
    grandTotal: subtotal,
    amountPaid: subtotal,
    paymentMethod: 'cash',
    createdAt: now,
    paidAt: now,
    // Token stamps
    isTokenSale: true,
    tokenNumber,
    tokenLabel: formatTokenLabel(tokenNumber, settings),
    tokenStatus: 'pending',
    tokenReprintCount: 0,
    // Attribution — reports/filters need these
    cashierId: user?.id,
    cashierName: user?.name,
    branchId: (() => { try { return getCurrentBranchId() || undefined; } catch { return undefined; } })(),
  } as unknown as Order;

  saveOrder(order);
  return order;
}

// ---------- Status transitions ----------

export function completeToken(orderId: string): Order | null {
  const o = getOrders().find(x => x.id === orderId);
  if (!o || !o.isTokenSale) return null;
  const updated: Order = { ...o, tokenStatus: 'completed', tokenCompletedAt: new Date().toISOString() };
  saveOrder(updated);
  return updated;
}

/**
 * Cancel a token. The sale is voided too, so revenue and inventory stay
 * correct — a cancelled token must never keep counting as income.
 */
export function cancelToken(orderId: string, reason?: string): Order | null {
  const o = getOrders().find(x => x.id === orderId);
  if (!o || !o.isTokenSale) return null;
  const updated: Order = {
    ...o,
    tokenStatus: 'cancelled',
    status: 'cancelled',
    cancelReason: reason || 'Token cancelled',
  } as Order;
  saveOrder(updated);
  return updated;
}

export function markTokenReprinted(orderId: string): void {
  const o = getOrders().find(x => x.id === orderId);
  if (!o || !o.isTokenSale) return;
  saveOrder({ ...o, tokenReprintCount: (o.tokenReprintCount || 0) + 1 });
}

// ---------- Queries & stats ----------

export function getTokenOrders(): Order[] {
  return getOrders().filter(o => o.isTokenSale);
}

export function isSameDay(iso: string | undefined, day: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === day.getFullYear()
    && d.getMonth() === day.getMonth()
    && d.getDate() === day.getDate();
}

export interface TokenStats {
  total: number;
  pending: number;
  completed: number;
  cancelled: number;
  revenue: number;
  quantity: number;
  avgMinutes: number | null;
  topItem: { name: string; qty: number } | null;
  lastToken: number;
}

export function computeTokenStats(orders: Order[], day: Date = new Date()): TokenStats {
  const todays = orders.filter(o => o.isTokenSale && isSameDay(o.createdAt, day));
  let pending = 0, completed = 0, cancelled = 0, revenue = 0, quantity = 0;
  let durationSum = 0, durationCount = 0, lastToken = 0;
  const itemQty = new Map<string, number>();

  for (const o of todays) {
    const st = o.tokenStatus || 'pending';
    if (st === 'pending') pending++;
    else if (st === 'completed') completed++;
    else if (st === 'cancelled') cancelled++;

    // Cancelled tokens contribute neither revenue nor quantity.
    if (st !== 'cancelled') {
      revenue += Number(o.grandTotal || 0);
      for (const it of o.items || []) {
        quantity += it.quantity || 0;
        itemQty.set(it.name, (itemQty.get(it.name) || 0) + (it.quantity || 0));
      }
    }
    if (o.tokenCompletedAt && o.createdAt) {
      const ms = new Date(o.tokenCompletedAt).getTime() - new Date(o.createdAt).getTime();
      if (ms > 0) { durationSum += ms; durationCount++; }
    }
    if ((o.tokenNumber || 0) > lastToken) lastToken = o.tokenNumber || 0;
  }

  let topItem: { name: string; qty: number } | null = null;
  for (const [name, qty] of itemQty) {
    if (!topItem || qty > topItem.qty) topItem = { name, qty };
  }

  return {
    total: todays.length,
    pending, completed, cancelled,
    revenue, quantity,
    avgMinutes: durationCount ? Math.round(durationSum / durationCount / 60000) : null,
    topItem,
    lastToken,
  };
}

/** Should token prices be visible? Driven by the reports setting. */
export function tokenRevenueVisible(settings?: RestaurantSettings): boolean {
  return featureActive(settings || safeSettings(), 'tokenIncludeRevenueInReports');
}

export function tokenModuleEnabled(settings?: RestaurantSettings): boolean {
  return featureActive(settings || safeSettings(), 'tokenModuleEnabled');
}
