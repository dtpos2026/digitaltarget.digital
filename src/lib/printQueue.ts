// ============================================================
// Centralized Print Service / Queue (device-local)
// ------------------------------------------------------------
// Single source of truth for ALL printing (KOT, customer receipt,
// token, rider slip). Jobs are device-local on purpose — a physical
// printer is attached to one device, so jobs must NOT sync across
// devices (that would print the same slip on every terminal).
//
// Flow:  Order event -> enqueuePrint() -> Print Queue ->
//        PrintHost picks ONE job at a time -> renders + prints ->
//        markPrinted()/markFailed() -> next job.
//
// Duplicate protection:
//   - KOT: guarded by order.kotPrinted (a KOT for an order is enqueued once).
//   - Receipt: guarded by order.receiptPrinted unless force=true (reprint).
// ============================================================
import { getOrders, saveOrder, getSettings } from './store';
import { featureActive } from './optionalModules';
import type { Order } from './types';
import { buildKotRevision, nextKotNo, makeEditLog } from './orderHistory';
import { appendPrintLog } from './printLog';

/** Record a skipped/queued KOT decision so Printer Diagnostics shows WHY nothing printed. */
function logKotSkip(order: Order, reason: string) {
  try {
    appendPrintLog({
      printType: 'kitchen',
      stage: 'enqueue',
      status: 'skipped',
      billNumber: String(order.orderNumber ?? order.id ?? ''),
      error: reason,
    });
  } catch {}
}

export type PrintType = 'kot' | 'receipt' | 'token' | 'rider';
export type PrintJobStatus = 'pending' | 'printing' | 'printed' | 'failed';

export interface PrintJob {
  id: string;
  orderId: string;
  orderNumber?: number;
  branchId?: string;
  printerId?: string;        // resolved printer name (station / default)
  station?: string;          // kitchen/station label
  printType: PrintType;
  copies: number;
  status: PrintJobStatus;
  retryCount: number;
  createdAt: string;         // enqueued at
  lastTriedAt?: string;
  // ===== Phase-2 timing instrumentation =====
  renderStartedAt?: string;  // when host began rendering DOM for print
  printCommandAt?: string;   // when print() / electron print fired
  printedAt?: string;        // success
  failedAt?: string;         // last failure
  durationMs?: number;       // enqueue -> done
  error?: string;
  errorReason?: 'no-printer' | 'offline' | 'render-failed' | 'unknown';
  // ===== KOT diff / update support =====
  updateMode?: boolean;
  diffItemIds?: string[];
  diffDeltas?: Record<string, number>;
  /** Items whose qty dropped below printedQty (cancellations/decrease). Value = qty cancelled (positive number). */
  cancelDeltas?: Record<string, number>;
  /** Snapshot of cancelled item names (id -> name) for rendering even after the line is fully removed. */
  cancelNames?: Record<string, string>;
  /** Sequential KOT number this print represents (1, 2, 3 …). */
  kotNo?: number;
  /** v1.2.4: printedQty/kotRevisions were stamped on the order at ENQUEUE
   *  time (not print time). markPrinted must not stamp again. */
  stamped?: boolean;
  /** Operator pressed Reprint/Send — must never be held by Silent KOT Mode. */
  manual?: boolean;
}


const QUEUE_KEY = 'pos-print-queue';
const QUEUE_EVENT = 'dt-pos-print-queue';
const MAX_RETRY = 3;

function genId() {
  return `pj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getPrintQueue(): PrintJob[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveQueue(jobs: PrintJob[]) {
  try {
    // keep last 100 jobs to avoid unbounded growth
    localStorage.setItem(QUEUE_KEY, JSON.stringify(jobs.slice(-100)));
  } catch {}
  notify();
}

function notify() {
  try {
    window.dispatchEvent(new CustomEvent(QUEUE_EVENT));
  } catch {}
}

export function onPrintQueueChange(handler: () => void): () => void {
  window.addEventListener(QUEUE_EVENT, handler);
  return () => window.removeEventListener(QUEUE_EVENT, handler);
}

/** Pending (or failed-with-retry-left) jobs in FIFO order. */
export function getProcessableJobs(): PrintJob[] {
  const stalePrintingBefore = Date.now() - 20000;
  return getPrintQueue().filter(
    j => j.status === 'pending'
      || (j.status === 'failed' && j.retryCount < MAX_RETRY)
      || (j.status === 'printing' && !!j.lastTriedAt && new Date(j.lastTriedAt).getTime() < stalePrintingBefore),
  );
}

export function getFailedJobs(): PrintJob[] {
  return getPrintQueue().filter(j => j.status === 'failed' && j.retryCount >= MAX_RETRY);
}

/** Resolve which printer a job should target based on settings + station. */
function resolvePrinter(printType: PrintType, station?: string, excludePrinter?: string): string | undefined {
  const s = getSettings();
  const pick = (...candidates: (string | undefined)[]) => {
    for (const c of candidates) if (c && c !== excludePrinter) return c;
    return undefined;
  };
  if (printType === 'kot') {
    if (station && s.stationPrinters && s.stationPrinters[station]) {
      return pick(s.stationPrinters[station], s.backupPrinter, s.kotFallbackToReceipt !== false ? s.defaultPrinter : undefined);
    }
    return pick(s.kotPrinter, s.kotFallbackToReceipt !== false ? s.defaultPrinter : undefined, s.backupPrinter);
  }
  if (printType === 'token') return pick(s.tokenPrinter, s.defaultPrinter, s.backupPrinter);
  return pick(s.defaultPrinter, s.backupPrinter);
}

interface EnqueueOpts {
  station?: string;
  copies?: number;
  force?: boolean; // bypass duplicate guard (reprint)
  updateMode?: boolean;
  diffItemIds?: string[];
  diffDeltas?: Record<string, number>;
  cancelDeltas?: Record<string, number>;
  cancelNames?: Record<string, string>;
  kotNo?: number;
}

/**
 * Enqueue a print job. Returns the created job, or null if skipped
 * (duplicate guard / disabled in settings).
 */
export function enqueuePrint(order: Order, printType: PrintType, opts: EnqueueOpts = {}): PrintJob | null {
  const s = getSettings();

  if (printType === 'kot') {
    // A forced (manual) reprint must still print even when auto-KOT is off:
    // the operator explicitly asked for this ticket.
    if (s.kotEnabled === false && !opts.force) { logKotSkip(order, 'KOT printing is disabled in settings (kotEnabled = off)'); return null; }

    // Approval gate — never send pending/rejected orders to the kitchen.
    if (order.status === 'pending_approval' || order.status === 'rejected') { logKotSkip(order, `Order status is ${order.status} — KOT not sent to kitchen`); return null; }
    // updateMode and force both bypass the duplicate guard.
    if (!opts.force && !opts.updateMode && order.kotPrinted) { logKotSkip(order, 'KOT already printed for this order (duplicate guard)'); return null; }
    // ===== Queue-level dedup =====
    // Prevent double-click / race conditions from enqueueing two identical KOTs
    // for the same order before the first one is marked printed.
    if (!opts.force && !opts.updateMode) {
      const pending = getPrintQueue().some(j =>
        j.orderId === order.id
        && j.printType === 'kot'
        && !j.updateMode
        && (j.status === 'pending' || j.status === 'printing')
      );
      if (pending) {
        try { console.log('%c[DT-Print]', 'color:#f59e0b;font-weight:700', 'dedup-skip KOT', { orderId: order.id, no: order.orderNumber }); } catch {}
        logKotSkip(order, 'Another KOT for this order is already in the print queue');
        return null;
      }
    }
  }
  if (printType === 'receipt') {
    if (!opts.force && order.receiptPrinted) return null;
    // Queue-level dedup for receipts too
    if (!opts.force) {
      const pending = getPrintQueue().some(j =>
        j.orderId === order.id
        && j.printType === 'receipt'
        && (j.status === 'pending' || j.status === 'printing')
      );
      if (pending) return null;
    }
  }

  const job: PrintJob = {
    id: genId(),
    orderId: order.id,
    orderNumber: order.orderNumber,
    branchId: order.branchId,
    printType,
    station: opts.station,
    printerId: resolvePrinter(printType, opts.station),
    copies: Math.max(1, opts.copies ?? (printType === 'kot' ? (s.kotCopies || 1) : 1)),
    status: 'pending',
    retryCount: 0,
    createdAt: new Date().toISOString(),
    updateMode: opts.updateMode,
    diffItemIds: opts.diffItemIds,
    diffDeltas: opts.diffDeltas,
    cancelDeltas: opts.cancelDeltas,
    cancelNames: opts.cancelNames,
    kotNo: opts.kotNo,
    manual: opts.force === true,
  };


  const queue = getPrintQueue();
  queue.push(job);
  saveQueue(queue);

  // ===== v1.2.4: stamp printedQty / kotRevisions at ENQUEUE time =====
  // The queue entry is the authoritative record of what the kitchen was told.
  // Doing this here (instead of only after a successful print callback) means
  // cloud prints, manual pending-print retries, and every other path keep the
  // diff baseline correct — the fix for duplicate KOTs on order edit/cancel.
  if (printType === 'kot') {
    try {
      appendPrintLog({
        printType: 'kitchen',
        stage: 'enqueue',
        status: 'success',
        billNumber: String(order.orderNumber ?? order.id ?? ''),
        printerName: job.printerId || '(not configured)',
        error: job.printerId ? undefined : 'No KOT printer resolved — check Printer Settings',
      });
    } catch {}
    job.stamped = true;
    try { updateJob(job.id, { stamped: true }); } catch {}
    stampKotDispatchOnOrder(job, order);
  }
  try {
    console.log('%c[DT-Print]', 'color:#7c3aed;font-weight:700',
      'enqueue', { type: printType, no: order.orderNumber, printer: job.printerId, copies: job.copies, jobId: job.id });
  } catch {}
  return job;
}

function updateJob(id: string, patch: Partial<PrintJob>) {
  const queue = getPrintQueue().map(j => (j.id === id ? { ...j, ...patch } : j));
  saveQueue(queue);
}

export function markPrinting(id: string) {
  const now = new Date().toISOString();
  updateJob(id, { status: 'printing', lastTriedAt: now, renderStartedAt: now });
}

/** Stamp the moment we actually fire the print command (electron/browser). */
export function markPrintCommandSent(id: string) {
  updateJob(id, { printCommandAt: new Date().toISOString() });
}

export function markPrinted(id: string) {
  const job = getPrintQueue().find(j => j.id === id);
  const now = new Date().toISOString();
  const duration = job ? (Date.now() - new Date(job.createdAt).getTime()) : undefined;
  updateJob(id, {
    status: 'printed',
    lastTriedAt: now,
    printedAt: now,
    durationMs: duration,
    error: undefined,
    errorReason: undefined,
  });
  try { console.log('%c[DT-Print]', 'color:#16a34a;font-weight:700', 'printed ✓', { jobId: id, durationMs: duration }); } catch {}
  if (!job) return;
  try {
    // v1.2.4: printedQty / kotRevisions are normally stamped at ENQUEUE time
    // (stampKotDispatchOnOrder). Only stamp here for legacy/cloud jobs that
    // were queued without stamping — never twice.
    if (job.printType === 'kot' && !job.stamped) {
      stampKotDispatchOnOrder(job);
    }
    // Re-read AFTER stamping so we never clobber freshly-stamped items.
    const order = getOrders().find(o => o.id === job.orderId);
    if (order) {
      const patch: Partial<Order> = {
        printStatus: 'printed',
        printCount: (order.printCount || 0) + 1,
        lastPrintedAt: now,
      };
      if (job.printType === 'kot') {
        patch.kotPrinted = true;
        patch.kotLastPrintedAt = now;
        patch.kotPrintCount = (order.kotPrintCount || 0) + 1;
        if (!order.kotFirstPrintedAt) patch.kotFirstPrintedAt = now;

        // ===== AUTO-COOKING =====
        try {
          const settings = getSettings();
          const autoCookingOn = settings?.autoCookingOnKot !== false;
          if (autoCookingOn && !order.cookingStartedAt) {
            patch.cookingStartedAt = now;
            if (!order.kitchenStatus || order.kitchenStatus === 'pending') {
              patch.kitchenStatus = 'preparing';
              patch.kitchenStatusAt = now;
            }
            if (order.orderType === 'delivery') {
              const ds = order.deliveryStatus;
              if (!ds || ds === 'pending' || ds === 'accepted') {
                patch.deliveryStatus = 'cooking';
              }
            }
          }
        } catch {}
      }
      if (job.printType === 'receipt') patch.receiptPrinted = true;
      saveOrder({ ...order, ...patch });
    }
  } catch {}
}

// ============================================================
// v1.2.4 — KOT dispatch stamping (THE duplicate-KOT fix)
// ------------------------------------------------------------
// Root cause of "order change/cancel par poori KOT dobara nikalti hai":
// item.printedQty and order.kotRevisions were only stamped inside
// markPrinted(), i.e. AFTER a successful local print callback. Any path
// that printed without that callback (cloud print server, pending-prints
// manual print, older builds) left printedQty at 0 — so the next "update"
// diff contained EVERY item again and the kitchen cooked duplicates.
//
// Now stamping happens the moment the slip is ENQUEUED: the queue entry
// itself is the record of exactly what the kitchen was told (its own
// diffDeltas travel with the job, so retries reprint the same delta).
// ============================================================
export function stampKotDispatchOnOrder(job: PrintJob, orderFallback?: Order): void {
  try {
    const order = getOrders().find(o => o.id === job.orderId) || orderFallback;
    if (!order) return;
    const now = new Date().toISOString();
    const patch: Partial<Order> = { kotPrinted: true };
    const cancelDeltas = job.cancelDeltas || {};

    // ===== Stamp printedQty on each item line =====
    // Update KOT: positive deltas bump printedQty up; cancel deltas pull it
    // down (never above current qty) so cancelled qty isn't re-diffed later.
    const items = (order.items || []).map(it => {
      if (job.updateMode) {
        const delta = job.diffDeltas?.[it.id];
        let newPrinted = it.printedQty || 0;
        if (typeof delta === 'number' && delta > 0) {
          newPrinted = Math.min(it.quantity, newPrinted + delta);
        }
        const cancelled = cancelDeltas[it.id];
        if (typeof cancelled === 'number' && cancelled > 0) {
          newPrinted = Math.max(0, newPrinted - cancelled);
          newPrinted = Math.min(it.quantity, newPrinted);
        }
        return { ...it, printedQty: newPrinted };
      }
      return { ...it, printedQty: it.quantity };
    });
    patch.items = items;

    // ===== KOT activity log =====
    const logEntry: import('./types').KotLogEntry = {
      at: now,
      action: job.updateMode ? 'updated' : 'created',
      addedItems: job.updateMode
        ? (order.items || [])
            .filter(it => (job.diffDeltas?.[it.id] || 0) > 0)
            .map(it => ({ name: it.name, quantity: job.diffDeltas![it.id], note: it.note }))
        : undefined,
      removedItems: job.updateMode && Object.keys(cancelDeltas).length
        ? Object.entries(cancelDeltas).map(([id, qty]) => ({
            name: job.cancelNames?.[id] || (order.items || []).find(it => it.id === id)?.name || id,
            quantity: qty,
          }))
        : undefined,
    };
    patch.kotLog = [...(order.kotLog || []), logEntry];

    // ===== Permanent KOT Revision ledger =====
    try {
      const positiveDeltas: Record<string, number> = job.updateMode
        ? (job.diffDeltas || {})
        : Object.fromEntries((order.items || []).map(it => [it.id, it.quantity || 0]));
      const combined: Record<string, number> = { ...positiveDeltas };
      for (const [id, qty] of Object.entries(cancelDeltas)) combined[id] = -(qty);
      const rev = buildKotRevision({
        kotNo: nextKotNo(order),
        items: order.items || [],
        deltas: combined,
        isFirst: !job.updateMode,
      });
      rev.lines = rev.lines.map(l => {
        if (l.name && l.name !== l.itemId) return l;
        const nm = job.cancelNames?.[l.itemId];
        return nm ? { ...l, name: nm } : l;
      });
      rev.printedAt = now;
      patch.kotRevisions = [...(order.kotRevisions || []), rev];
      const editEntry = makeEditLog('REPRINT', {
        newValue: `KOT #${rev.kotNo} (${rev.type})`,
      });
      patch.editLogs = [...(order.editLogs || []), editEntry];
      // Expose the sequential KOT number on the job for the printed ticket.
      try { updateJob(job.id, { kotNo: rev.kotNo }); } catch {}
    } catch (e) { console.warn('[kot-revision] failed', e); }

    saveOrder({ ...order, ...patch });
  } catch (e) { console.warn('[kot-stamp] failed', e); }
}

function classifyError(error?: string): PrintJob['errorReason'] {
  if (!error) return 'unknown';
  const e = error.toLowerCase();
  if (e.includes('no printer') || e.includes('not selected') || e.includes('not configured')) return 'no-printer';
  if (e.includes('offline') || e.includes('econnrefused') || e.includes('etimedout') || e.includes('unreachable')) return 'offline';
  if (e.includes('render') || e.includes('dom') || e.includes('iframe')) return 'render-failed';
  return 'unknown';
}

export function markFailed(id: string, error?: string) {
  const job = getPrintQueue().find(j => j.id === id);
  if (!job) return;
  const now = new Date().toISOString();
  const nextRetry = job.retryCount + 1;
  const reason = classifyError(error);
  // Phase-3: when retries exhaust and auto-reprint is enabled, one-shot failover to backup printer.
  const settings = getSettings();
  const autoReprint = settings.autoReprintOnFailure !== false;
  if (autoReprint && nextRetry >= MAX_RETRY && settings.backupPrinter && settings.backupPrinter !== job.printerId) {
    updateJob(id, {
      status: 'pending',
      retryCount: 0,
      lastTriedAt: now,
      failedAt: now,
      error: `${error || 'failed'} — switched to backup printer`,
      errorReason: reason,
      printerId: settings.backupPrinter,
    });
    try { console.warn('%c[DT-Print]', 'color:#f59e0b;font-weight:700', '⇄ failover to backup', { jobId: id, backup: settings.backupPrinter }); } catch {}
    return;
  }
  updateJob(id, {
    status: 'failed',
    retryCount: nextRetry,
    lastTriedAt: now,
    failedAt: now,
    error,
    errorReason: reason,
  });
  try { console.warn('%c[DT-Print]', 'color:#dc2626;font-weight:700', 'FAILED ✗', { jobId: id, error }); } catch {}
}

/** Manually retry a failed job (resets to pending). */
export function retryJob(id: string) {
  updateJob(id, { status: 'pending', error: undefined });
}

export function retryAllFailed() {
  const queue = getPrintQueue().map(j =>
    j.status === 'failed' ? { ...j, status: 'pending' as const, retryCount: 0, error: undefined } : j,
  );
  saveQueue(queue);
}

export function clearPrintedJobs() {
  saveQueue(getPrintQueue().filter(j => j.status !== 'printed'));
}

/** Convenience: KOT for an order, respecting per-item kitchen stations. */
export function enqueueKot(order: Order, opts: EnqueueOpts = {}) {
  return enqueuePrint(order, 'kot', opts);
}
export function enqueueReceipt(order: Order, opts: EnqueueOpts = {}) {
  // ===== v1.2.5: "Paid-only receipts" option =====
  // Admin ON kare to sirf PAID bill ki slip printer par jayegi —
  // running/hold/unpaid slip bilkul nahi niklegi. Default OFF hai, is liye
  // baqi restaurants ka behaviour bilkul waisa hi rehta hai.
  try {
    const st = getSettings();
    if (featureActive(st, 'paidOnlyReceipts')) {
      const s = order.status;
      const isPaidBill = s === 'paid' || s === 'credit_received' || s === 'complimentary';
      if (!isPaidBill) {
        console.log('[DT-Print] paid-only receipts ON — skipped unpaid slip', order.orderNumber, s);
        return null;
      }
    }
  } catch {}
  return enqueuePrint(order, 'receipt', opts);
}

/**
 * Compute the diff between the order's current items and what has already been
 * printed (item.printedQty). Returns both positive deltas (new / increased items)
 * and cancel deltas (items whose qty dropped below printedQty, or fully removed
 * lines that still appear in a prior KOT revision).
 */
export function computeKotDiff(order: Order): {
  hasDiff: boolean;
  diffItemIds: string[];
  diffDeltas: Record<string, number>;
  cancelDeltas: Record<string, number>;
  cancelNames: Record<string, string>;
} {
  const diffDeltas: Record<string, number> = {};
  const cancelDeltas: Record<string, number> = {};
  const cancelNames: Record<string, string> = {};
  const diffItemIds: string[] = [];
  const currentIds = new Set<string>();
  for (const it of order.items || []) {
    currentIds.add(it.id);
    const printed = it.printedQty || 0;
    const delta = (it.quantity || 0) - printed;
    if (delta > 0) {
      diffDeltas[it.id] = delta;
      diffItemIds.push(it.id);
    } else if (delta < 0) {
      cancelDeltas[it.id] = -delta;
      cancelNames[it.id] = it.name;
    }
  }
  // Lines that were on a previous KOT but are now fully removed from the cart
  const printedItemIds = new Set<string>();
  for (const rev of order.kotRevisions || []) {
    for (const l of rev.lines || []) {
      if (l.deltaQty > 0) printedItemIds.add(l.itemId);
      // a previously cancelled line in a revision means already accounted for; skip if also currently absent
    }
  }
  // For absent items, try to determine how much was printed = sum of positive deltas - sum of cancel deltas in prior revisions
  for (const id of printedItemIds) {
    if (currentIds.has(id)) continue;
    let printed = 0;
    let alreadyCancelled = 0;
    let name = '';
    for (const rev of order.kotRevisions || []) {
      for (const l of rev.lines || []) {
        if (l.itemId !== id) continue;
        if (l.deltaQty > 0) printed += l.deltaQty;
        else alreadyCancelled += -l.deltaQty;
        if (l.name) name = l.name;
      }
    }
    const outstanding = printed - alreadyCancelled;
    if (outstanding > 0) {
      cancelDeltas[id] = outstanding;
      cancelNames[id] = name || id;
    }
  }
  const hasDiff = diffItemIds.length > 0 || Object.keys(cancelDeltas).length > 0;
  return { hasDiff, diffItemIds, diffDeltas, cancelDeltas, cancelNames };
}

export function enqueueKotUpdate(order: Order, opts: Omit<EnqueueOpts, 'updateMode' | 'diffItemIds' | 'diffDeltas' | 'cancelDeltas' | 'cancelNames' | 'force'> = {}) {
  const { hasDiff, diffItemIds, diffDeltas, cancelDeltas, cancelNames } = computeKotDiff(order);
  if (!hasDiff) return null;
  return enqueuePrint(order, 'kot', { ...opts, updateMode: true, diffItemIds, diffDeltas, cancelDeltas, cancelNames });
}

/**
 * Cancel KOT — kitchen ko batata hai ke pora order CANCELLED hai aur cooking ruk jaye.
 * Sab items (printed ya cart me mojood) ko CANCELLED dikhata hai. Sirf tab bhejen jab
 * pichla KOT print ho chuka ho (warna kitchen ne dekha hi nahi).
 */
export function enqueueKotCancel(order: Order, opts: Omit<EnqueueOpts, 'updateMode' | 'diffItemIds' | 'diffDeltas' | 'cancelDeltas' | 'cancelNames'> = {}) {
  const cancelDeltas: Record<string, number> = {};
  const cancelNames: Record<string, string> = {};
  for (const it of (order.items || [])) {
    const printed = (it as any).printedQty ?? 0;
    const qty = Math.max(printed, it.quantity || 0);
    if (qty > 0) {
      cancelDeltas[it.id] = qty;
      cancelNames[it.id] = it.name;
    }
  }
  if (Object.keys(cancelDeltas).length === 0) return null;
  return enqueuePrint(order, 'kot', {
    ...opts,
    updateMode: true,
    diffItemIds: [],
    diffDeltas: {},
    cancelDeltas,
    cancelNames,
    force: true,
  });
}

/**
 * Smart KOT enqueue that respects restaurant policy `kotUpdateMode`.
 *  - 'only_changes' (default): print only diff (new items) + separate cancel ticket if needed.
 *  - 'full': reprint entire order.
 *  - 'ask': caller must show a dialog; if this helper is called it defaults to 'only_changes'.
 * Falls back to full KOT when there is no prior KOT revision yet.
 */
export function enqueueKotByPolicy(
  order: Order,
  mode: 'only_changes' | 'full' | 'ask' | undefined,
  opts: EnqueueOpts = {},
) {
  const hasPrior = (order.kotRevisions || []).length > 0;
  const effective = mode || 'only_changes';
  if (!hasPrior || effective === 'full') {
    return enqueuePrint(order, 'kot', { ...opts, force: true });
  }
  const upd = enqueueKotUpdate(order, opts as any);
  if (upd) return upd;
  // no diff detected — fall back to full so user gets some ticket
  return enqueuePrint(order, 'kot', { ...opts, force: true });
}



// ============================================================
// Cloud Print Mirror — push the same job to Firebase printJobs
// so the Windows EXE "Print Server" can print silently when this
// device is just a browser tab (web POS, online order, rider portal).
// Caller passes pre-rendered HTML (already styled for thermal).
// ============================================================
export async function enqueueCloudPrint(args: {
  type: 'kot' | 'receipt' | 'rider' | 'token';
  role: 'counter' | 'kitchen' | 'delivery' | 'display';
  html: string;
  paperSize?: '58mm' | '80mm';
  copies?: number;
  order?: Order;
  source?: 'web' | 'pos' | 'website' | 'rider' | 'kds' | 'system';
  dedupeKey?: string;
}) {
  try {
    const { createCloudPrintJob, isCloudPrintAvailable } = await import('./cloudPrintJobs');
    if (!isCloudPrintAvailable()) return null;
    return await createCloudPrintJob({
      type: args.type,
      role: args.role,
      html: args.html,
      paperSize: args.paperSize || '80mm',
      copies: args.copies,
      orderId: args.order?.id,
      orderNumber: args.order?.orderNumber,
      branchId: args.order?.branchId,
      source: args.source || 'web',
      dedupeKey: args.dedupeKey || (args.order ? `${args.type}-${args.order.id}` : undefined),
    });
  } catch {
    return null;
  }
}
