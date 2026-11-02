// Day Close configuration + pending-request workflow.
// Admin controls *what* gets cleared via checkboxes. Cashier (with permission)
// can only *request* a day close — actual deletion happens when admin confirms.
import { getTenantId } from './tenant';

export interface DayCloseConfig {
  clearPaidOrders: boolean;       // paid / closed bills
  clearRunningHoldBills: boolean; // running + hold (unpaid)
  clearVoidComp: boolean;         // void / complimentary / cancelled
  clearCreditOrders: boolean;     // credit_pending / credit_received (udhaar)
  resetTables: boolean;           // mark all tables free
  resetOrderNumber: boolean;      // reset daily order counter
  autoBackup: boolean;            // download JSON before clearing
  /** Per-module reset switches — ticked once, remembered forever. */
  modules: Record<string, boolean>;
}

/**
 * Every module that can be reset to 00 at Day Close.
 * `col` is the AppData collection name cleared locally + in the cloud.
 */
export const DAY_CLOSE_MODULES: { col: string; label: string }[] = [
  { col: 'transactions',     label: 'Accounts — Transactions (income / expense)' },
  { col: 'ledger',           label: 'Accounts — Ledger entries' },
  { col: 'creditPayments',   label: 'Accounts — Credit / Udhaar payments' },
  { col: 'dailyCashCloses',  label: 'Accounts — Daily cash closes' },
  { col: 'refunds',          label: 'Refunds' },
  { col: 'stockLogs',        label: 'Inventory — Stock movement logs' },
  { col: 'wastages',         label: 'Inventory — Wastage entries' },
  { col: 'receivingEntries', label: 'Inventory — Receiving / purchase entries' },
  { col: 'attendance',       label: 'HR — Attendance records' },
  { col: 'leaves',           label: 'HR — Leave records' },
  { col: 'advances',         label: 'HR — Salary advances' },
  { col: 'payslips',         label: 'HR — Payslips' },
  { col: 'shifts',           label: 'Shifts / Cash drawer sessions' },
];

export interface PendingDayCloseRequest {
  id: string;
  by: string;        // user id
  byName: string;
  at: string;        // ISO timestamp
  note?: string;
}

const DEFAULT_CONFIG: DayCloseConfig = {
  clearPaidOrders: true,
  clearRunningHoldBills: true,
  clearVoidComp: false,
  clearCreditOrders: false,
  resetTables: true,
  resetOrderNumber: true,
  autoBackup: true,
  modules: {},
};


const cfgKey = () => `dt-pos-dayclose-config::${getTenantId()}`;
const reqKey = () => `dt-pos-dayclose-pending::${getTenantId()}`;

export function getDayCloseConfig(): DayCloseConfig {
  try {
    const raw = localStorage.getItem(cfgKey());
    if (!raw) return { ...DEFAULT_CONFIG, modules: {} };
    const parsed = JSON.parse(raw) || {};
    return { ...DEFAULT_CONFIG, ...parsed, modules: { ...(parsed.modules || {}) } };
  } catch { return { ...DEFAULT_CONFIG, modules: {} }; }
}


export function saveDayCloseConfig(cfg: DayCloseConfig) {
  try { localStorage.setItem(cfgKey(), JSON.stringify(cfg)); } catch {}
}

export function getPendingDayCloseRequests(): PendingDayCloseRequest[] {
  try {
    const raw = localStorage.getItem(reqKey());
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function addPendingDayCloseRequest(req: Omit<PendingDayCloseRequest, 'id' | 'at'> & { at?: string }) {
  const list = getPendingDayCloseRequests();
  list.push({
    id: Math.random().toString(36).slice(2, 10),
    at: req.at || new Date().toISOString(),
    by: req.by,
    byName: req.byName,
    note: req.note,
  });
  try { localStorage.setItem(reqKey(), JSON.stringify(list)); } catch {}
}

export function clearPendingDayCloseRequests() {
  try { localStorage.removeItem(reqKey()); } catch {}
}

// ============================================================
// v1.96.0 — what a Day Close will do to the bills, worked out in one place.
//
// The classification used to be written inline in the Settings page's handler, so the screen could not tell the
// operator what was about to happen. The Day Close page shows these counts before the button is pressed and uses the
// same function to do the work, so what is shown is what is done. The rules are unchanged (v1.2.4): a credit (udhaar)
// bill — status credit_*, or paid by credit and not void/cancelled — is classified FIRST and is cleared only by the
// "Credit orders" box, never by the paid / running boxes.
// ============================================================
export type DayCloseGroup = 'paid' | 'runningHold' | 'voidComp' | 'credit' | 'other';

export interface DayCloseOrderLike { id: string; status: string; paymentMethod?: string }

export function dayCloseGroupOf(o: Pick<DayCloseOrderLike, 'status' | 'paymentMethod'>): DayCloseGroup {
  const s = o.status;
  const isCredit = s === 'credit_pending' || s === 'credit_received'
    || (o.paymentMethod === 'credit' && s !== 'void' && s !== 'cancelled');
  if (isCredit) return 'credit';
  if (s === 'paid') return 'paid';
  if (s === 'running' || s === 'hold' || s === 'partial') return 'runningHold';
  if (s === 'void' || s === 'complimentary' || s === 'cancelled') return 'voidComp';
  return 'other';
}

export interface DayClosePlan {
  /** Ids that leave the live lists (they are archived, never deleted). */
  toClear: string[];
  cleared: { paid: number; runningHold: number; voidComp: number; credit: number };
  /** Bills that stay in the live lists. */
  kept: number;
  total: number;
  /** Cleared bills that are still unpaid — the ones an operator would regret clearing by accident. */
  unpaidCleared: number;
  heldCleared: number;
}

const CLEAR_FLAG: Record<Exclude<DayCloseGroup, 'other'>, keyof DayCloseConfig> = {
  paid: 'clearPaidOrders', runningHold: 'clearRunningHoldBills', voidComp: 'clearVoidComp', credit: 'clearCreditOrders',
};

export function planDayClose(
  orders: Array<DayCloseOrderLike>,
  cfg: Pick<DayCloseConfig, 'clearPaidOrders' | 'clearRunningHoldBills' | 'clearVoidComp' | 'clearCreditOrders'>,
): DayClosePlan {
  const cleared = { paid: 0, runningHold: 0, voidComp: 0, credit: 0 };
  const toClear: string[] = [];
  let unpaidCleared = 0, heldCleared = 0;
  for (const o of orders) {
    const g = dayCloseGroupOf(o);
    if (g === 'other' || !cfg[CLEAR_FLAG[g] as 'clearPaidOrders']) continue;
    cleared[g]++;
    toClear.push(o.id);
    if (g === 'runningHold') { unpaidCleared++; if (o.status === 'hold') heldCleared++; }
  }
  return { toClear, cleared, kept: orders.length - toClear.length, total: orders.length, unpaidCleared, heldCleared };
}
