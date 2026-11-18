// ============================================================================
// Warm the screens a shift uses (v1.119.0) — so they open at once, and still open if the network drops mid-shift.
//
// Every screen except the till is its own file, fetched the first time it is opened. That keeps the first load small, but it means a
// screen nobody has opened yet cannot be opened once the connection is gone (the till keeps working — its data is on the device — but
// the "Day Close" button would show a blank). After sign-in, when the browser is idle, the day-to-day screens are fetched one at a time,
// so they are already on the device. The browser's cache keeps them (the build fingerprints every file), and a screen already warmed costs nothing.
// It is skipped on a data-saver or a slow link, when offline, in the Owner / Rider / Order Taker apps and on the public website.
// The PDF and image makers are included, so a report can still be printed to PDF or JPG with no signal.
// ============================================================================
type Loader = () => Promise<unknown>;

export const CORE_SCREENS: Record<string, Loader> = {
  tables: () => import('@/pages/TablesPage'),
  'running-bills': () => import('@/pages/RunningBillsPage'),
  kitchen: () => import('@/pages/KitchenDisplayPage'),
  dashboard: () => import('@/pages/DashboardPage'),
  'day-close': () => import('@/pages/DayClosePage'),
  inventory: () => import('@/pages/InventoryPage'),
  receiving: () => import('@/pages/ReceivingPage'),
  reports: () => import('@/pages/ReportsPage'),
  'bill-reprint': () => import('@/pages/BillReprintPage'),
  refund: () => import('@/pages/RefundPage'),
  shift: () => import('@/pages/ShiftPage'),
  'pending-payments': () => import('@/pages/PendingPaymentsPage'),
  customers: () => import('@/pages/CustomersPage'),
  wastage: () => import('@/pages/WastagePage'),
  production: () => import('@/pages/ProductionPlanPage'),
  'stock-count': () => import('@/pages/StockCountPage'),
  expiry: () => import('@/pages/ExpiryPage'),
  'cake-orders': () => import('@/pages/CakeOrdersPage'),
};

/** The PDF and image makers every report button uses — fetched on demand otherwise. */
export const EXPORT_LIBS: Record<string, Loader> = {
  pdf: () => import('jspdf'),
  'pdf-table': () => import('jspdf-autotable'),
  image: () => import('html2canvas'),
};

export interface WarmOptions {
  loaders?: Record<string, Loader>;
  /** run `fn` when the browser is idle */
  idle?: (fn: () => void) => void;
  online?: boolean;
  saveData?: boolean;
  /** 'slow-2g' | '2g' | '3g' | '4g' */
  effectiveType?: string;
  /** pause between two files, so warming never competes with what the person is doing */
  gapMs?: number;
}

let started = false;
export const _resetWarm = () => { started = false; };

const ric = (fn: () => void) => {
  const w = globalThis as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: 8000 });
  else setTimeout(fn, 3000);
};

/** Why warming is skipped right now (null = go). */
export function skipReason(o: Pick<WarmOptions, 'online' | 'saveData' | 'effectiveType'>): string | null {
  if (o.online === false) return 'offline';
  if (o.saveData) return 'data saver';
  if (o.effectiveType === 'slow-2g' || o.effectiveType === '2g' || o.effectiveType === '3g') return 'slow connection';
  return null;
}

/** Fetches the day-to-day screens and the export libraries once per session, one at a time, when idle. Returns the keys it will try. */
export function warmCoreScreens(opts: WarmOptions = {}): string[] {
  if (started) return [];
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }) | undefined;
  const reason = skipReason({ online: opts.online ?? nav?.onLine, saveData: opts.saveData ?? nav?.connection?.saveData, effectiveType: opts.effectiveType ?? nav?.connection?.effectiveType });
  if (reason) return [];
  started = true;
  const all = { ...(opts.loaders ?? CORE_SCREENS), ...(opts.loaders ? {} : EXPORT_LIBS) };
  const keys = Object.keys(all);
  const idle = opts.idle ?? ric;
  const gap = opts.gapMs ?? 250;
  let i = 0;
  const next = () => {
    if (i >= keys.length) return;
    const key = keys[i++];
    if ((typeof navigator !== 'undefined' && navigator.onLine === false)) return;      // the signal went: stop, the rest cannot be fetched
    all[key]().catch(() => { /* a file that cannot be fetched now is fetched when the screen is opened */ }).finally(() => { setTimeout(() => idle(next), gap); });
  };
  idle(next);
  return keys;
}
