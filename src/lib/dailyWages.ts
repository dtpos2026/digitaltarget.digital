// ============================================================
// Daily Wages / Labor Payment Management
// localStorage-backed module with Accounts (Transaction) integration.
// Pattern mirrors src/lib/blocklist.ts.
// ============================================================
import { getCurrentUser } from './store';
import { saveTransaction, getAccountCategories, saveAccountCategory } from './store';
import type { Transaction, AccountCategory, PaymentMethod } from './types';
import { mirrorList } from './cloudDocs';

// ---------------- Types ----------------
export type WorkerCategory =
  | 'labor' | 'helper' | 'cleaner' | 'loader'
  | 'kitchen_helper' | 'rider' | 'event_worker' | 'other';

export const WORKER_CATEGORIES: { value: WorkerCategory; label: string }[] = [
  { value: 'labor', label: 'Labor' },
  { value: 'helper', label: 'Helper' },
  { value: 'cleaner', label: 'Cleaner' },
  { value: 'loader', label: 'Loader' },
  { value: 'kitchen_helper', label: 'Kitchen Helper' },
  { value: 'rider', label: 'Rider' },
  { value: 'event_worker', label: 'Event Worker' },
  { value: 'other', label: 'Other' },
];

export interface Worker {
  id: string;
  name: string;
  mobile: string;
  cnic?: string;
  address?: string;
  designation?: string;
  category: WorkerCategory;
  defaultDailyWage: number;
  active: boolean;
  createdAt: string;
}

export interface WageEntry {
  id: string;
  date: string;             // YYYY-MM-DD
  workerId: string;
  workerName: string;
  category: WorkerCategory;
  workDescription: string;
  branchId?: string;
  branchName?: string;
  department?: string;
  project?: string;
  dailyRate: number;
  days: number;             // qty / days
  overtime: number;
  bonus: number;
  deduction: number;
  netAmount: number;
  remarks?: string;
  createdAt: string;
  createdBy?: string;
  transactionId?: string;   // linked Accounts expense txn
}

export type WagePaymentStatus = 'unpaid' | 'partial' | 'paid';

export interface WagePayment {
  id: string;
  workerId: string;
  workerName: string;
  amount: number;
  method: PaymentMethod;    // cash | online | card | credit
  date: string;             // YYYY-MM-DD
  note?: string;
  createdAt: string;
  createdBy?: string;
  isAdvance?: boolean;      // true => advance (not against specific entry)
  transactionId?: string;
}

export type AuditAction =
  | 'worker_added' | 'worker_updated' | 'worker_deleted'
  | 'entry_created' | 'entry_updated' | 'entry_deleted'
  | 'payment_added' | 'payment_edited' | 'payment_deleted'
  | 'advance_added' | 'advance_settled';

export interface WageAuditLog {
  id: string;
  at: string;
  action: AuditAction;
  by?: string;
  byName?: string;
  subjectId?: string;
  subjectName?: string;
  oldValue?: any;
  newValue?: any;
  note?: string;
}

// ---------------- Storage ----------------
const K_WORKERS = 'dt-wage-workers';
const K_ENTRIES = 'dt-wage-entries';
const K_PAYMENTS = 'dt-wage-payments';
const K_AUDIT = 'dt-wage-audit';
const EVT = 'dt-wages-changed';

function read<T>(k: string): T[] {
  try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; }
}
function write<T>(k: string, arr: T[]) {
  try { localStorage.setItem(k, JSON.stringify(arr)); } catch {}
  try { mirrorList(k, arr as any[]); } catch {}
  try { window.dispatchEvent(new CustomEvent(EVT)); } catch {}
}
export function onWagesChange(handler: () => void): () => void {
  window.addEventListener(EVT, handler);
  return () => window.removeEventListener(EVT, handler);
}

function uid(prefix = 'w'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function currentUserInfo() {
  const u = getCurrentUser();
  return { id: u?.id, name: u?.name };
}

function pushAudit(entry: Omit<WageAuditLog, 'id' | 'at' | 'by' | 'byName'>) {
  const u = currentUserInfo();
  const all = read<WageAuditLog>(K_AUDIT);
  all.unshift({
    id: uid('aud'),
    at: new Date().toISOString(),
    by: u.id,
    byName: u.name,
    ...entry,
  });
  // cap at 5000
  if (all.length > 5000) all.length = 5000;
  write(K_AUDIT, all);
}

export function getWageAuditLog(): WageAuditLog[] { return read<WageAuditLog>(K_AUDIT); }

// ---------------- Workers ----------------
export function getWorkers(): Worker[] { return read<Worker>(K_WORKERS); }
export function getActiveWorkers(): Worker[] { return getWorkers().filter(w => w.active); }
export function getWorker(id: string): Worker | null {
  return getWorkers().find(w => w.id === id) || null;
}

export function saveWorker(input: Omit<Worker, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Worker {
  const all = getWorkers();
  if (input.id) {
    const idx = all.findIndex(w => w.id === input.id);
    if (idx >= 0) {
      const old = all[idx];
      const updated: Worker = { ...old, ...input } as Worker;
      all[idx] = updated;
      write(K_WORKERS, all);
      pushAudit({ action: 'worker_updated', subjectId: updated.id, subjectName: updated.name, oldValue: old, newValue: updated });
      return updated;
    }
  }
  const created: Worker = {
    id: uid('wrk'),
    createdAt: new Date().toISOString(),
    ...input,
  } as Worker;
  all.push(created);
  write(K_WORKERS, all);
  pushAudit({ action: 'worker_added', subjectId: created.id, subjectName: created.name, newValue: created });
  return created;
}

export function deleteWorker(id: string) {
  const all = getWorkers();
  const w = all.find(x => x.id === id);
  write(K_WORKERS, all.filter(x => x.id !== id));
  if (w) pushAudit({ action: 'worker_deleted', subjectId: id, subjectName: w.name, oldValue: w });
}

// ---------------- Accounts Integration ----------------
function ensureLaborCategory(): AccountCategory {
  const all = getAccountCategories();
  const found = all.find(c => c.type === 'expense' && /daily\s*wage|labor/i.test(c.name));
  if (found) return found;
  const created: AccountCategory = {
    id: uid('cat'),
    name: 'Daily Wages / Labor',
    type: 'expense',
  };
  saveAccountCategory(created);
  return created;
}

function createExpenseTxn(opts: {
  date: string;
  amount: number;
  paymentMethod: PaymentMethod;
  description: string;
  reference?: string;
  partyName?: string;
}): string {
  const cat = ensureLaborCategory();
  const u = currentUserInfo();
  const t: Transaction = {
    id: uid('txn'),
    date: opts.date,
    type: 'expense',
    categoryId: cat.id,
    categoryName: cat.name,
    amount: Math.max(0, Math.round(opts.amount || 0)),
    paymentMethod: opts.paymentMethod,
    description: opts.description,
    reference: opts.reference,
    partyName: opts.partyName,
    createdBy: u.name,
  };
  saveTransaction(t);
  return t.id;
}

// ---------------- Wage Entries ----------------
export function getWageEntries(): WageEntry[] { return read<WageEntry>(K_ENTRIES); }

export function computeNetAmount(e: Pick<WageEntry, 'dailyRate' | 'days' | 'overtime' | 'bonus' | 'deduction'>): number {
  const base = (e.dailyRate || 0) * (e.days || 0);
  return Math.max(0, base + (e.overtime || 0) + (e.bonus || 0) - (e.deduction || 0));
}

export function saveWageEntry(input: Omit<WageEntry, 'id' | 'createdAt' | 'createdBy' | 'netAmount' | 'transactionId'> & {
  id?: string;
  createdAt?: string;
}): WageEntry {
  const all = getWageEntries();
  const netAmount = computeNetAmount(input);
  const u = currentUserInfo();
  if (input.id) {
    const idx = all.findIndex(e => e.id === input.id);
    if (idx >= 0) {
      const old = all[idx];
      const updated: WageEntry = {
        ...old,
        ...input,
        netAmount,
      } as WageEntry;
      all[idx] = updated;
      write(K_ENTRIES, all);
      pushAudit({
        action: 'entry_updated',
        subjectId: updated.id,
        subjectName: updated.workerName,
        oldValue: old,
        newValue: updated,
      });
      return updated;
    }
  }
  // create + accounts expense entry
  const txnId = createExpenseTxn({
    date: input.date,
    amount: netAmount,
    paymentMethod: 'cash', // booked as expense — actual cash outflow occurs on payment
    description: `Daily Wage — ${input.workerName}${input.workDescription ? ' — ' + input.workDescription : ''}`,
    reference: input.branchName,
    partyName: input.workerName,
  });
  const created: WageEntry = {
    id: uid('we'),
    createdAt: new Date().toISOString(),
    createdBy: u.name,
    netAmount,
    transactionId: txnId,
    ...input,
  } as WageEntry;
  all.push(created);
  write(K_ENTRIES, all);
  pushAudit({
    action: 'entry_created',
    subjectId: created.id,
    subjectName: created.workerName,
    newValue: created,
  });
  return created;
}

export function deleteWageEntry(id: string) {
  const all = getWageEntries();
  const e = all.find(x => x.id === id);
  write(K_ENTRIES, all.filter(x => x.id !== id));
  if (e) pushAudit({ action: 'entry_deleted', subjectId: id, subjectName: e.workerName, oldValue: e });
}

// ---------------- Payments / Advances ----------------
export function getWagePayments(): WagePayment[] { return read<WagePayment>(K_PAYMENTS); }

export function saveWagePayment(input: Omit<WagePayment, 'id' | 'createdAt' | 'createdBy' | 'transactionId'> & {
  id?: string;
  createdAt?: string;
}): WagePayment {
  const all = getWagePayments();
  const u = currentUserInfo();
  if (input.id) {
    const idx = all.findIndex(p => p.id === input.id);
    if (idx >= 0) {
      const old = all[idx];
      const updated: WagePayment = { ...old, ...input } as WagePayment;
      all[idx] = updated;
      write(K_PAYMENTS, all);
      pushAudit({
        action: 'payment_edited',
        subjectId: updated.id,
        subjectName: updated.workerName,
        oldValue: old,
        newValue: updated,
      });
      return updated;
    }
  }
  // record a cash outflow (advance OR wage payment); we book it as expense category as well
  // so cash drawer / accounts reflect the disbursement.
  const txnId = createExpenseTxn({
    date: input.date,
    amount: input.amount,
    paymentMethod: input.method,
    description: `${input.isAdvance ? 'Advance to' : 'Wage payment to'} ${input.workerName}${input.note ? ' — ' + input.note : ''}`,
    partyName: input.workerName,
  });
  const created: WagePayment = {
    id: uid('wp'),
    createdAt: new Date().toISOString(),
    createdBy: u.name,
    transactionId: txnId,
    ...input,
  } as WagePayment;
  all.push(created);
  write(K_PAYMENTS, all);
  pushAudit({
    action: input.isAdvance ? 'advance_added' : 'payment_added',
    subjectId: created.id,
    subjectName: created.workerName,
    newValue: created,
  });
  return created;
}

export function deleteWagePayment(id: string) {
  const all = getWagePayments();
  const p = all.find(x => x.id === id);
  write(K_PAYMENTS, all.filter(x => x.id !== id));
  if (p) pushAudit({ action: 'payment_deleted', subjectId: id, subjectName: p.workerName, oldValue: p });
}

// ---------------- Ledger / Balance ----------------
export interface LedgerRow {
  date: string;
  description: string;
  debit: number;    // wages earned (worker is owed)
  credit: number;   // payments / advances (worker is paid)
  balance: number;  // running: positive => we owe worker
  ref: 'entry' | 'payment' | 'advance';
  refId: string;
}

export function getWorkerLedger(workerId: string): LedgerRow[] {
  const entries = getWageEntries()
    .filter(e => e.workerId === workerId)
    .map(e => ({
      date: e.date,
      description: `Daily Wage${e.workDescription ? ' — ' + e.workDescription : ''}${e.days > 1 ? ' (' + e.days + ' days)' : ''}`,
      debit: e.netAmount,
      credit: 0,
      ref: 'entry' as const,
      refId: e.id,
      createdAt: e.createdAt,
    }));
  const payments = getWagePayments()
    .filter(p => p.workerId === workerId)
    .map(p => ({
      date: p.date,
      description: p.isAdvance ? `Advance Payment${p.note ? ' — ' + p.note : ''}` : `Payment${p.note ? ' — ' + p.note : ''} (${p.method})`,
      debit: 0,
      credit: p.amount,
      ref: p.isAdvance ? ('advance' as const) : ('payment' as const),
      refId: p.id,
      createdAt: p.createdAt,
    }));
  const rows = [...entries, ...payments].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
  let bal = 0;
  return rows.map(r => {
    bal += r.debit - r.credit;
    return {
      date: r.date, description: r.description, debit: r.debit, credit: r.credit,
      balance: bal, ref: r.ref, refId: r.refId,
    };
  });
}

export function getWorkerBalance(workerId: string): number {
  const earned = getWageEntries().filter(e => e.workerId === workerId).reduce((s, e) => s + e.netAmount, 0);
  const paid = getWagePayments().filter(p => p.workerId === workerId).reduce((s, p) => s + p.amount, 0);
  return earned - paid;
}

export function getWorkerAdvanceBalance(workerId: string): number {
  // negative balance (overpaid) = advance still outstanding
  const bal = getWorkerBalance(workerId);
  return bal < 0 ? -bal : 0;
}

export function getWorkerPaymentStatus(workerId: string): WagePaymentStatus {
  const earned = getWageEntries().filter(e => e.workerId === workerId).reduce((s, e) => s + e.netAmount, 0);
  if (earned <= 0) return 'unpaid';
  const paid = getWagePayments().filter(p => p.workerId === workerId).reduce((s, p) => s + p.amount, 0);
  if (paid <= 0) return 'unpaid';
  if (paid >= earned) return 'paid';
  return 'partial';
}
