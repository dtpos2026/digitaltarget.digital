// ============================================================
// v1.9.0 — PRA EIMS submission queue + audit log
//
// COMPLIANCE POSTURE
// A restaurant facing a Rs. 1,000,000 penalty cannot afford an invoice
// that silently never reached PRA. So this queue is deliberately
// conservative:
//
//   • Durable  — IndexedDB (web) / JSON on disk (Electron) via localDb,
//                so a power cut or app crash loses nothing.
//   • Resumed  — the queue is rehydrated and re-driven on every boot.
//   • Retried  — exponential backoff; a failing invoice never blocks a
//                healthy one behind it.
//   • Audited  — every request and response is logged verbatim, capped
//                at a rolling window, exportable for an audit.
//   • Never dropped silently — after max attempts an entry moves to a
//                Failed state that stays visible in the UI. Nothing is
//                deleted without a human deciding to.
//
// Billing is NEVER blocked by any of this: submission is fire-and-forget
// from the sale path, exactly like the existing deferredSync design.
// ============================================================

import { localDb } from './localDb';
import { getTenantId, getDeviceId } from './tenant';
import type { Order } from './types';
import {
  type PraConfig, type PraSubmitResult,
  buildPraInvoice, validatePraInvoice, praConfigReady,
} from './praEims';
import { submitPraInvoice } from './praTransport';

export type PraStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface PraQueueEntry {
  /** Stable id = orderId, so re-queueing the same sale coalesces. */
  id: string;
  orderId: string;
  /** Our own invoice number (USIN) — for humans reading the log. */
  usin: string;
  status: PraStatus;
  attempts: number;
  firstQueuedAt: number;
  lastAttemptAt?: number;
  nextRetryAt?: number;
  deviceId: string;
  /** Populated once PRA accepts the invoice. */
  praInvoiceNumber?: string;
  lastError?: string;
  /** Frozen payload — what we actually sent (audit evidence). */
  payload?: unknown;
}

export interface PraLogRecord {
  id: string;
  at: number;
  orderId: string;
  usin: string;
  direction: 'request' | 'response';
  endpoint?: string;
  ok?: boolean;
  /** Verbatim body. Buyer PII is minimal by design (name/phone only). */
  data: unknown;
}

const MAX_ATTEMPTS = 8;
const RETRY_DELAYS_MS = [0, 5_000, 15_000, 60_000, 300_000, 900_000, 1_800_000, 3_600_000] as const;
const LOG_CAP = 500;

// ---------- in-memory mirror (queue is small; disk is the truth) ----------
let mem = new Map<string, PraQueueEntry>();
let memReady = false;
let persistTimer: any = null;
let persistInFlight: Promise<void> | null = null;
let draining = false;

// Injected so this module never imports store.ts (avoids a cycle and
// keeps the queue testable without the whole app).
type ConfigProvider = () => PraConfig | null;
type OrderProvider = (orderId: string) => Order | null;
type StatusSink = (orderId: string, patch: {
  praStatus: PraStatus; praInvoiceNumber?: string; praError?: string; praSubmittedAt?: string;
}) => void;

let getConfig: ConfigProvider = () => null;
let getOrder: OrderProvider = () => null;
let writeStatus: StatusSink = () => {};

export function configurePraQueue(opts: {
  config: ConfigProvider; order: OrderProvider; onStatus: StatusSink;
}): void {
  getConfig = opts.config;
  getOrder = opts.order;
  writeStatus = opts.onStatus;
}

function nextRetryAt(e: PraQueueEntry): number {
  const idx = Math.min(e.attempts, RETRY_DELAYS_MS.length - 1);
  return (e.lastAttemptAt || e.firstQueuedAt) + RETRY_DELAYS_MS[idx];
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    persistInFlight = (async () => {
      try {
        if (!getTenantId()) return;
        await localDb.clear('praQueue');
        for (const e of mem.values()) await localDb.putRow('praQueue', e as any);
      } catch (err) {
        console.warn('[pra] queue persist failed (will retry)', err);
      }
    })();
    await persistInFlight;
    persistInFlight = null;
  }, 150);
}

async function ensureLoaded(): Promise<void> {
  if (memReady) return;
  memReady = true;
  try {
    if (!getTenantId()) return;
    const rows = await localDb.getRows<PraQueueEntry>('praQueue');
    for (const r of rows) mem.set(r.id, r);
    if (rows.length) console.log(`[pra] ${rows.length} pending invoice(s) restored after restart`);
  } catch (e) {
    console.warn('[pra] queue rehydrate failed', e);
  }
  emit();
}

// ---------- audit log ----------

export async function appendPraLog(rec: Omit<PraLogRecord, 'id' | 'at'>): Promise<void> {
  try {
    if (!getTenantId()) return;
    const row: PraLogRecord = { ...rec, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now() };
    await localDb.putRow('praLogs', row as any);
    // Rolling cap so a busy restaurant does not grow the log without bound.
    const all = await localDb.getRows<PraLogRecord>('praLogs');
    if (all.length > LOG_CAP) {
      const sorted = all.sort((a, b) => a.at - b.at);
      for (const old of sorted.slice(0, all.length - LOG_CAP)) {
        await localDb.deleteRow('praLogs', old.id);
      }
    }
  } catch (e) {
    console.warn('[pra] log append failed', e);
  }
}

export async function getPraLogs(limit = 100): Promise<PraLogRecord[]> {
  try {
    const all = await localDb.getRows<PraLogRecord>('praLogs');
    return all.sort((a, b) => b.at - a.at).slice(0, limit);
  } catch { return []; }
}

export async function clearPraLogs(): Promise<void> {
  try { await localDb.clear('praLogs'); } catch { /* ignore */ }
}

/** Full audit export — hand this to PRA or an auditor on request. */
export async function exportPraAudit(): Promise<string> {
  const [logs, queue] = await Promise.all([getPraLogs(LOG_CAP), getPraQueue()]);
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    tenantId: getTenantId(),
    deviceId: getDeviceId(),
    queue,
    logs,
  }, null, 2);
}

// ---------- queue API ----------

export async function getPraQueue(): Promise<PraQueueEntry[]> {
  await ensureLoaded();
  return Array.from(mem.values()).sort((a, b) => a.firstQueuedAt - b.firstQueuedAt);
}

export function praPendingCount(): number {
  let n = 0;
  for (const e of mem.values()) if (e.status === 'pending') n++;
  return n;
}

export function praFailedCount(): number {
  let n = 0;
  for (const e of mem.values()) if (e.status === 'failed') n++;
  return n;
}

/**
 * Queue a completed sale for fiscalisation.
 *
 * SYNCHRONOUS and non-throwing on purpose — it is called from the sale
 * path and must never slow down or break billing. Everything after the
 * enqueue happens in the background.
 */
export function enqueuePraInvoice(order: Order): void {
  try {
    const cfg = getConfig();
    const ready = praConfigReady(cfg);
    if (!ready.ok || !cfg) return;                 // integration off / not set up
    if (!order?.id) return;

    // Only real sales are fiscalised; drafts and holds are not invoices yet.
    const status = String(order.status || '').toLowerCase();
    const FISCALISABLE = ['paid', 'partial', 'credit_pending', 'credit_received', 'void', 'cancelled'];
    if (!FISCALISABLE.includes(status)) return;

    const invoice = buildPraInvoice(order, cfg);
    const check = validatePraInvoice(invoice);
    if (!check.ok) {
      // A payload we know PRA will reject is recorded as failed rather
      // than retried pointlessly — the operator must see and fix it.
      const bad: PraQueueEntry = {
        id: order.id, orderId: order.id, usin: invoice.USIN,
        status: 'failed', attempts: 0, firstQueuedAt: Date.now(),
        deviceId: getDeviceId() || 'unknown',
        lastError: `Validation: ${check.errors.join('; ')}`,
        payload: invoice,
      };
      mem.set(bad.id, bad);
      schedulePersist();
      writeStatus(order.id, { praStatus: 'failed', praError: bad.lastError });
      void appendPraLog({ orderId: order.id, usin: invoice.USIN, direction: 'request', ok: false, data: { validationErrors: check.errors, invoice } });
      emit();
      return;
    }

    const prev = mem.get(order.id);
    // Already accepted by PRA — never submit the same sale twice.
    if (prev?.status === 'sent' && prev.praInvoiceNumber) return;

    mem.set(order.id, {
      id: order.id,
      orderId: order.id,
      usin: invoice.USIN,
      status: 'pending',
      attempts: prev?.attempts || 0,
      firstQueuedAt: prev?.firstQueuedAt || Date.now(),
      deviceId: getDeviceId() || 'unknown',
      payload: invoice,
    });
    schedulePersist();
    writeStatus(order.id, { praStatus: 'pending' });
    emit();
    void drainPraQueue();
  } catch (e) {
    // Billing must survive any failure in this module.
    console.warn('[pra] enqueue failed (billing unaffected)', e);
  }
}

/** Attempt every due entry. Safe to call often; self-serialising. */
export async function drainPraQueue(): Promise<{ sent: number; failed: number; skipped: boolean }> {
  await ensureLoaded();
  if (draining) return { sent: 0, failed: 0, skipped: true };

  const cfg = getConfig();
  if (!praConfigReady(cfg).ok || !cfg) return { sent: 0, failed: 0, skipped: true };
  // Local fiscal device is on this machine, so it works without internet;
  // cloud transport genuinely needs the network.
  if (cfg.transport === 'cloud' && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { sent: 0, failed: 0, skipped: true };
  }

  draining = true;
  emit();
  let sent = 0;
  let failed = 0;
  const now = Date.now();

  try {
    const due = Array.from(mem.values())
      .filter(e => e.status === 'pending' && nextRetryAt(e) <= now)
      .sort((a, b) => a.firstQueuedAt - b.firstQueuedAt);

    for (const entry of due) {
      // Re-read the order so a bill edited after queueing is sent as it
      // now stands (PRA must receive what the customer was charged).
      const order = getOrder(entry.orderId);
      const invoice = order ? buildPraInvoice(order, cfg) : (entry.payload as any);
      if (!invoice) continue;

      entry.attempts += 1;
      entry.lastAttemptAt = Date.now();
      entry.payload = invoice;

      await appendPraLog({
        orderId: entry.orderId, usin: entry.usin, direction: 'request',
        endpoint: cfg.transport, data: invoice,
      });

      let result: PraSubmitResult;
      try {
        result = await submitPraInvoice(invoice, cfg);
      } catch (e: any) {
        result = { success: false, error: e?.message || String(e), retryable: true };
      }

      await appendPraLog({
        orderId: entry.orderId, usin: entry.usin, direction: 'response',
        endpoint: cfg.transport, ok: result.success,
        data: result.raw ?? { error: result.error, code: result.code },
      });

      if (result.success && result.invoiceNumber) {
        entry.status = 'sent';
        entry.praInvoiceNumber = result.invoiceNumber;
        entry.lastError = undefined;
        entry.nextRetryAt = undefined;
        sent++;
        writeStatus(entry.orderId, {
          praStatus: 'sent',
          praInvoiceNumber: result.invoiceNumber,
          praSubmittedAt: new Date().toISOString(),
        });
      } else {
        entry.lastError = result.error || 'Unknown PRA error';
        const permanent = result.retryable === false;
        if (permanent || entry.attempts >= MAX_ATTEMPTS) {
          entry.status = 'failed';
          failed++;
          writeStatus(entry.orderId, { praStatus: 'failed', praError: entry.lastError });
        } else {
          entry.status = 'pending';
          entry.nextRetryAt = nextRetryAt(entry);
          writeStatus(entry.orderId, { praStatus: 'pending', praError: entry.lastError });
        }
      }
      mem.set(entry.id, entry);
    }
    schedulePersist();
    if (persistInFlight) await persistInFlight;
  } finally {
    draining = false;
    emit();
  }
  return { sent, failed, skipped: false };
}

/** Operator action: push a failed invoice back into the retry cycle. */
export async function retryPraEntry(id: string): Promise<boolean> {
  await ensureLoaded();
  const e = mem.get(id);
  if (!e) return false;
  e.status = 'pending';
  e.attempts = 0;
  e.lastError = undefined;
  e.lastAttemptAt = undefined;
  mem.set(id, e);
  schedulePersist();
  writeStatus(e.orderId, { praStatus: 'pending' });
  emit();
  void drainPraQueue();
  return true;
}

export function isPraDraining(): boolean { return draining; }

// ---------- change notification ----------
type Listener = () => void;
const listeners = new Set<Listener>();
function emit(): void { listeners.forEach(l => { try { l(); } catch { /* ignore */ } }); }
export function onPraQueueChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ---------- lifecycle ----------
let installed = false;
let timer: any = null;
let onlineHandler: (() => void) | null = null;

/** Boot the background driver. Idempotent; paired with stopPraQueue(). */
export function startPraQueue(intervalMs = 30_000): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  void ensureLoaded().then(() => drainPraQueue());
  onlineHandler = () => { void drainPraQueue(); };
  window.addEventListener('online', onlineHandler);
  timer = setInterval(() => {
    if (praPendingCount() > 0) void drainPraQueue();
  }, intervalMs);
}

/** Called on tenant switch — prevents cross-restaurant leakage + timer leaks. */
export function stopPraQueue(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (onlineHandler && typeof window !== 'undefined') {
    window.removeEventListener('online', onlineHandler);
    onlineHandler = null;
  }
  installed = false;
  mem = new Map();
  memReady = false;
  emit();
}
