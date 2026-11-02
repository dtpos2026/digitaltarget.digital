// ============================================================
// Super Admin dashboard — the pure part (v1.84.0)
//
// The numbers behind the dashboard's cards and lists, from the rows the console already loads (restaurants, devices) and
// the invoices and payments tables. Nothing is estimated: a figure the console cannot know (for example the sales
// every restaurant rang up today — that lives in each restaurant's own data) is not on the dashboard at all.
//
// On Supabase a restaurant exists once it is provisioned, and "approved" means `tenants.is_active`; there is no separate
// "suspended" state, so the dashboard shows one "Waiting for approval / switched off" count rather than two.
// ============================================================

export interface TenantRow { id: string; name: string; email?: string; approved: boolean; createdAt?: unknown; planExpiryAt?: unknown; plan?: string }
export interface DeviceInfo { tenantId: string; approved: boolean; blocked: boolean; lastSeenMs: number | null }
export interface InvoiceInfo { tenantId?: string | null; total: number; paidTotal: number; status: string }
export interface PaymentInfo { amount: number; receivedAt: string }

export interface AdminOverviewInput { tenants: TenantRow[]; devices: DeviceInfo[]; invoices: InvoiceInfo[]; payments: PaymentInfo[]; nowMs: number }

export interface AdminKpis {
  restaurants: number;
  waiting: number;
  newDeviceRequests: number;
  active: number;
  paymentPending: number;
  expired: number;
  expiring7: number;
  blockedDevices: number;
  devicesOnline: number;
  collectedThisMonth: number;
  outstanding: number;
}

const DAY = 86400000;
/** A device counts as online when it reported in the last 5 minutes. */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

/** Epoch ms from an ISO string, a Date, a Firestore-like Timestamp, or a number; null when there is none. */
export function toMs(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) { const t = v.getTime(); return Number.isFinite(t) ? t : null; }
  if (typeof v === 'string') { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : null; }
  const o = v as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
  if (typeof o.toMillis === 'function') { const t = o.toMillis(); return Number.isFinite(t) ? t : null; }
  if (typeof o.toDate === 'function') { const t = o.toDate().getTime(); return Number.isFinite(t) ? t : null; }
  if (typeof o.seconds === 'number') return o.seconds * 1000;
  return null;
}

/** Whole days from now to the expiry (negative once it has passed); null when no expiry is set. */
export function daysToExpiry(expiry: unknown, nowMs: number): number | null {
  const t = toMs(expiry);
  if (t === null) return null;
  return Math.ceil((t - nowMs) / DAY);
}

const open = (i: InvoiceInfo) => (i.status === 'unpaid' || i.status === 'partial');
const owed = (i: InvoiceInfo) => Math.max(0, Number(i.total || 0) - Number(i.paidTotal || 0));

export function buildKpis(input: AdminOverviewInput): AdminKpis {
  const { tenants, devices, invoices, payments, nowMs } = input;
  const monthStart = new Date(new Date(nowMs).getFullYear(), new Date(nowMs).getMonth(), 1).getTime();
  const nextMonth = new Date(new Date(nowMs).getFullYear(), new Date(nowMs).getMonth() + 1, 1).getTime();
  let expired = 0, expiring7 = 0, active = 0;
  for (const t of tenants) {
    const d = daysToExpiry(t.planExpiryAt, nowMs);
    const isExpired = d !== null && d <= 0 && (toMs(t.planExpiryAt) as number) < nowMs;
    if (isExpired) expired++;
    else if (d !== null && d <= 7) expiring7++;
    if (t.approved && !isExpired) active++;
  }
  const owing = new Set<string>();
  let outstanding = 0;
  for (const i of invoices) {
    if (!open(i)) continue;
    const o = owed(i);
    if (o <= 0) continue;
    outstanding += o;
    owing.add(i.tenantId || `?${i.total}`);
  }
  let collected = 0;
  for (const p of payments) {
    const t = toMs(p.receivedAt);
    if (t !== null && t >= monthStart && t < nextMonth) collected += Number(p.amount || 0);
  }
  return {
    restaurants: tenants.length,
    waiting: tenants.filter(t => !t.approved).length,
    newDeviceRequests: devices.filter(d => !d.approved && !d.blocked).length,
    active,
    paymentPending: owing.size,
    expired,
    expiring7,
    blockedDevices: devices.filter(d => d.blocked).length,
    devicesOnline: devices.filter(d => d.approved && !d.blocked && d.lastSeenMs !== null && nowMs - d.lastSeenMs <= ONLINE_WINDOW_MS && nowMs - d.lastSeenMs >= -60000).length,
    collectedThisMonth: Math.round(collected),
    outstanding: Math.round(outstanding),
  };
}

export type RenewalBadge = 'expired' | 'soon' | 'active';
export interface RenewalRow { id: string; name: string; plan?: string; days: number; expiresAt: number; badge: RenewalBadge }

/** Restaurants whose plan has ended or ends within `horizonDays`, soonest (most overdue) first. */
export function renewalsDue(tenants: TenantRow[], nowMs: number, horizonDays = 14, limit = 8): { rows: RenewalRow[]; total: number } {
  const all: RenewalRow[] = [];
  for (const t of tenants) {
    const exp = toMs(t.planExpiryAt);
    if (exp === null) continue;
    const days = Math.ceil((exp - nowMs) / DAY);
    if (days > horizonDays) continue;
    all.push({ id: t.id, name: t.name, plan: t.plan, days, expiresAt: exp, badge: exp < nowMs ? 'expired' : days <= 7 ? 'soon' : 'active' });
  }
  all.sort((a, b) => a.expiresAt - b.expiresAt);
  return { rows: all.slice(0, limit), total: all.length };
}

export interface WaitingRow { id: string; name: string; email?: string; createdMs: number | null }
/** Restaurants waiting for approval, oldest first (the one that has waited longest is on top). */
export function waitingForApproval(tenants: TenantRow[], limit = 8): { rows: WaitingRow[]; total: number } {
  const all = tenants.filter(t => !t.approved).map(t => ({ id: t.id, name: t.name, email: t.email, createdMs: toMs(t.createdAt) }));
  all.sort((a, b) => (a.createdMs ?? Infinity) - (b.createdMs ?? Infinity));
  return { rows: all.slice(0, limit), total: all.length };
}

export const ADMIN_TAB_KEY = 'dtpos-superadmin-tab';
