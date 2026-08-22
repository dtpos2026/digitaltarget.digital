// ============================================================
// v1.7.0 — DEFERRED CLOUD SYNC (offline-first, IndexedDB-backed)
//
// PURPOSE
// Billing must NEVER wait for Firebase. Every save is local-first; the
// cloud write is enqueued and flushed in the background. This is the
// canonical sync path (the legacy `syncWorker.ts` was disconnected in
// this release — no code was producing its queue items).
//
// v1.7.0 CHANGES over v1.5.4
// 1. **Storage moved from localStorage → IndexedDB / Electron JSON**
//    (via the shared localDb layer). The old queue lived in localStorage,
//    which caps at ~5MB per origin — during a Singapore rush hour with a
//    long outage, 500+ pending items plus the main cache blob could
//    silently blow the quota and lose the queue. IndexedDB / disk-JSON
//    has no such cap.
//
// 2. **In-memory queue with async persistence** — the enqueue path stays
//    synchronous for the caller (billing must not await disk I/O), and a
//    coalesced writer flushes to storage. This matches Redux/Redis-persist
//    patterns.
//
// 3. **Migration from v1.5.4 keys** — any queue found in localStorage on
//    first boot is imported to the durable store, then the localStorage
//    key is removed. No live restaurant loses pending work.
//
// 4. **Timer/listener lifecycle** — install() is now idempotent and pairs
//    with stop() for tenant switches. Previously the setInterval leaked
//    across every login/logout cycle.
//
// 5. **Audit-ready op records** — each op stamps { at, deviceId, attempts,
//    lastError, firstEnqueuedAt } so failed syncs can be diagnosed and the
//    financial audit trail is complete.
//
// SYNC MODES (per device)
//   'auto'   (default) — online: seedha write. offline: queue, net aane
//                        par khud flush har 20s.
//   'manual'           — har write queue; sirf "Sync Now" par flush.
// ============================================================

import { getTenantId, getDeviceId } from './tenant';
import { localDb } from './localDb';

export type SyncMode = 'auto' | 'manual';

export interface DeferredOp {
  /** Deterministic per (col,id) — coalescing key AND storage id. */
  id: string;
  col: string;
  entityId: string;
  op: 'set' | 'delete';
  /** Wall clock of the LATEST update; used for ordering + telemetry. */
  at: number;
  /** When this entity FIRST entered the queue — audit / SLA metric. */
  firstEnqueuedAt: number;
  /** Device that produced the op — needed for multi-device audit trails. */
  deviceId: string;
  attempts: number;
  lastError?: string;
}

const MODE_KEY = 'dtpos-sync-mode';
const LEGACY_KEY_PREFIX = 'dtpos-deferred-ops::'; // v1.5.4 localStorage keys

/**
 * v1.8.0 — Exponential-backoff schedule for retrying a failed op.
 * A repeatedly-failing document must NOT hammer Firestore on every 20s
 * tick, and it must NOT block healthy items behind it. After MAX_ATTEMPTS
 * the op is dead-lettered.
 */
const RETRY_DELAY_MS = [0, 2_000, 6_000, 15_000, 30_000, 120_000, 300_000] as const;
const MAX_ATTEMPTS = 6;

function nextRetryAt(op: { attempts: number; at: number }): number {
  const idx = Math.min(op.attempts, RETRY_DELAY_MS.length - 1);
  return op.at + RETRY_DELAY_MS[idx];
}

// ---------- sync mode (still localStorage — tiny scalar) ----------
export function getSyncMode(): SyncMode {
  try { return localStorage.getItem(MODE_KEY) === 'manual' ? 'manual' : 'auto'; }
  catch { return 'auto'; }
}
export function setSyncMode(m: SyncMode): void {
  try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
  emit();
}

/** Billing hot path — must be sync and instant. */
export function shouldDeferCloudWrite(): boolean {
  if (getSyncMode() === 'manual') return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return false;
}

// ---------- in-memory queue (source of truth at runtime) ----------
// The queue lives in RAM for zero-latency enqueue; a debounced writer
// persists it to durable storage. Boot rehydrates from durable storage.
let mem: Map<string, DeferredOp> = new Map();
let memReady = false;
let persistTimer: any = null;
let persistInFlight: Promise<void> | null = null;

function opKey(col: string, entityId: string): string { return `${col}::${entityId}`; }

/**
 * v1.26.0 — CRASH SAFETY.
 * Money/stock collections must reach durable storage immediately. The 150ms
 * debounce is fine for menu edits, but a power cut in that window used to
 * drop a just-billed order from the queue. These write through at once
 * (still without blocking the caller — the promise is not awaited).
 */
const CRITICAL_COLS = new Set([
  'orders', 'orderItems', 'orderPayments', 'refunds',
  'inventory', 'stockLogs', 'shifts', 'dayCloses',
]);

/**
 * ===== v1.26.0 — the queue used to erase itself to save itself =====
 *
 * This was `clear()` followed by one `putRow()` per op. Two problems, and the
 * first is the one that matters:
 *
 *  1. Between the clear and the last put, the durable copy of the queue is
 *     EMPTY or partial. A refresh, a crash or a power cut in that window — on
 *     a till, during a rush, which is exactly when the queue is longest —
 *     took every pending order with it. The queue exists to survive precisely
 *     that event.
 *
 *  2. localDb.putRow() is a read-modify-write of the WHOLE collection array,
 *     so persisting n ops cost n array reads and n array writes: O(n²) work on
 *     the hot path, growing with the length of the outage.
 *
 * The whole queue is one array, so write it as one array. `writeAll` replaces
 * the durable copy in a single storage operation — there is no interval in
 * which the stored queue is shorter than the real one.
 */
async function persistNow(): Promise<void> {
  try {
    await localDb.writeAll('deferredOps', Array.from(mem.values()));
  } catch (e) {
    console.warn('[deferredSync] durable persist failed (will retry)', e);
  }
}

/** Debounced persistence — batches rapid enqueues into one disk write. */
function schedulePersist(critical = false): void {
  if (critical) {
    // Serialize behind any in-flight write so the file never interleaves.
    const prev = persistInFlight ?? Promise.resolve();
    persistInFlight = prev.then(persistNow).finally(() => { persistInFlight = null; });
    return;
  }
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    persistInFlight = persistNow();
    await persistInFlight;
    persistInFlight = null;
  }, 150);
}

/** Await any outstanding durable write — used by tests and by shutdown hooks. */
export async function waitForQueuePersist(): Promise<void> {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; persistInFlight = persistNow(); }
  if (persistInFlight) await persistInFlight;
}


/** One-time boot: rehydrate from disk + migrate v1.5.4 localStorage queue. */
async function ensureLoaded(): Promise<void> {
  if (memReady) return;
  memReady = true;
  try {
    // 1) Migrate ANY v1.5.4 localStorage queues we find (all tenants — a
    //    single browser could have multiple restaurants' queues stuck).
    const migrated: DeferredOp[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(LEGACY_KEY_PREFIX)) continue;
        try {
          const arr = JSON.parse(localStorage.getItem(k) || '[]');
          if (!Array.isArray(arr)) continue;
          for (const x of arr) {
            if (!x?.col || !x?.id || !x?.op) continue;
            // Old shape had {col, id, op, at} where `id` was entityId.
            migrated.push({
              id: opKey(x.col, x.id),
              col: x.col,
              entityId: x.id,
              op: x.op,
              at: x.at || Date.now(),
              firstEnqueuedAt: x.at || Date.now(),
              deviceId: getDeviceId() || 'legacy',
              attempts: 0,
            });
          }
        } catch { /* ignore this key */ }
      }
      // 2) Clear old keys AFTER we've captured them into memory.
      if (migrated.length) {
        const toRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith(LEGACY_KEY_PREFIX)) toRemove.push(k);
        }
        for (const k of toRemove) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
        console.log(`[deferredSync] migrated ${migrated.length} legacy op(s) from localStorage → IndexedDB`);
      }
    } catch { /* localStorage inaccessible in some contexts */ }

    // 3) Load durable rows (only fires if tenant is set).
    let rows: DeferredOp[] = [];
    if (getTenantId()) {
      try { rows = await localDb.getRows<DeferredOp>('deferredOps'); }
      catch { rows = []; }
    }

    for (const r of rows) mem.set(r.id, r);
    for (const m of migrated) if (!mem.has(m.id)) mem.set(m.id, m);
    if (migrated.length) schedulePersist();
  } catch (e) {
    console.warn('[deferredSync] boot rehydrate failed', e);
  }
  emit();
}

/**
 * Enqueue an op. SYNCHRONOUS on purpose — billing cannot await disk I/O.
 * Coalescing: multiple edits of the same entity collapse to the latest.
 */
export function enqueueDeferredOp(col: string, entityId: string, op: 'set' | 'delete'): void {
  if (!memReady) void ensureLoaded(); // async prime; enqueue itself is instant
  const key = opKey(col, entityId);
  const now = Date.now();
  const prev = mem.get(key);
  mem.set(key, {
    id: key,
    col,
    entityId,
    op,
    at: now,
    firstEnqueuedAt: prev?.firstEnqueuedAt || now,
    deviceId: getDeviceId() || 'unknown',
    attempts: prev?.attempts || 0,
    lastError: prev?.lastError,
  });
  schedulePersist(CRITICAL_COLS.has(col));

  emit();
}

export function deferredPendingCount(): number {
  return mem.size;
}

/**
 * Wait until the durable queue has actually been read off disk.
 *
 * ===== v1.25.21 — why this exists =====
 * `mem` starts EMPTY and is filled by ensureLoaded(), which is async and only
 * primed lazily. So getDeferredOps() called during boot returns [] — not
 * "nothing is pending", but "I have not looked yet".
 *
 * store.ts uses the queue to decide whether a local row missing from the cloud
 * is a deletion (drop it) or an unsynced write (keep it). Treating "not loaded
 * yet" as "nothing pending" makes it drop every unsynced row — which destroys
 * exactly the data the queue exists to protect.
 *
 * Callers whose decision can lose data MUST await this first, and must keep
 * the local rows if it resolves false.
 */
export async function whenDeferredQueueReady(): Promise<boolean> {
  try { await ensureLoaded(); return true; }
  catch { return false; }
}

/** Diagnostic — used by the audit-trail panel and support flows. */
export function getDeferredOps(): DeferredOp[] {
  return Array.from(mem.values()).sort((a, b) => a.firstEnqueuedAt - b.firstEnqueuedAt);
}

/** v1.8.0 — dead-letter API for audit and manual recovery. */
export async function getDeadLetterOps(): Promise<DeferredOp[]> {
  try { return await localDb.getRows<DeferredOp>('deferredOpsDeadLetter'); }
  catch { return []; }
}

/** Move a dead-lettered op back into the live queue with reset attempts. */
export async function requeueDeadLetter(opId: string): Promise<boolean> {
  try {
    const rows = await localDb.getRows<DeferredOp>('deferredOpsDeadLetter');
    const row = rows.find(r => r.id === opId);
    if (!row) return false;
    await localDb.deleteRow('deferredOpsDeadLetter', opId);
    await ensureLoaded();
    mem.set(row.id, { ...row, attempts: 0, lastError: undefined, at: Date.now() });
    schedulePersist();
    emit();
    return true;
  } catch { return false; }
}

/** Permanently discard a dead-lettered op (operator explicitly abandons it). */
export async function discardDeadLetter(opId: string): Promise<boolean> {
  try { await localDb.deleteRow('deferredOpsDeadLetter', opId); return true; }
  catch { return false; }
}

// ---------- flush ----------
type Flusher = (col: string, id: string, op: 'set' | 'delete') => Promise<void>;
let _flusher: Flusher | null = null;
let _flushing = false;

export function registerDeferredFlusher(fn: Flusher): void { _flusher = fn; }

export async function flushDeferredOps(): Promise<{
  flushed: number; remaining: number; skipped: boolean; error?: string; deadLettered?: number;
}> {
  await ensureLoaded();
  if (_flushing || !_flusher) return { flushed: 0, remaining: deferredPendingCount(), skipped: true };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { flushed: 0, remaining: deferredPendingCount(), skipped: true };
  }
  _flushing = true;
  emit();
  let flushed = 0;
  let deadLettered = 0;
  let firstError: string | undefined;
  const now = Date.now();
  try {
    // v1.8.0 — process oldest-first, but skip anything still within its
    // exponential-backoff window; retrying immediately on every 20s tick
    // hammered Firestore during outages and made the "Syncing" spinner
    // a constant fixture. Backoff schedule (per op):
    //   attempt 1 → +2s   4 → +30s
    //   attempt 2 → +6s   5 → +2m
    //   attempt 3 → +15s  6 → +5m
    // After MAX_ATTEMPTS the op is moved to the dead-letter queue so it
    // stops blocking the healthy backlog. The audit panel exposes it for
    // manual review (nothing is silently lost).
    // ===== v1.25.23 — PARENTS BEFORE CHILDREN =====
    // Ordering by enqueue time alone pushed menu items before the categories
    // and kitchens they point at. Every one of those hit a foreign-key
    // rejection: 447 on kitchen_id, 353 on category_id, 134 on inventory
    // category — the three biggest error sources in the whole project.
    //
    // The database now backfills a placeholder parent rather than rejecting
    // the row, so nothing is lost either way. But a placeholder named
    // "Uncategorised" is a repair, not an outcome: pushing the real parent
    // first means the child links to the real record on its first attempt.
    //
    // Within a tier, oldest-first still applies.
    const SYNC_TIER: Record<string, number> = {
      branches: 0,                                   // everything references a branch
      floors: 1, kitchens: 1, categories: 1,
      inventoryCategories: 1, accountCategories: 1,
      inventory: 2,                                  // needs inventoryCategories
      menuItems: 3,                                  // needs categories + kitchens + inventory
      tables: 3,                                     // needs floors
      recipes: 4,                                    // needs inventory + menuItems
      orders: 5,                                     // needs almost everything
    };
    const tierOf = (col: string) => SYNC_TIER[col] ?? 2;

    const batch = Array.from(mem.values())
      .filter(op => nextRetryAt(op) <= now)
      .sort((a, b) =>
        tierOf(a.col) - tierOf(b.col) ||
        a.firstEnqueuedAt - b.firstEnqueuedAt);
    for (const item of batch) {
      try {
        await _flusher(item.col, item.entityId, item.op);
        const cur = mem.get(item.id);
        if (cur && cur.at === item.at) mem.delete(item.id);
        flushed++;
      } catch (e: any) {
        const err = e?.message || String(e);
        if (!firstError) firstError = err;
        const cur = mem.get(item.id);
        if (cur) {
          cur.attempts = (cur.attempts || 0) + 1;
          cur.lastError = err;
          if (cur.attempts >= MAX_ATTEMPTS) {
            // Dead-letter — preserved on disk for later inspection.
            try { await localDb.putRow('deferredOpsDeadLetter' as any, { ...cur, deadLetteredAt: Date.now() }); } catch { /* ignore */ }
            mem.delete(item.id);
            deadLettered++;
          }
        }
      }
    }
    // ===== v1.26.0 — this awaited a write it had not started =====
    // schedulePersist() only ARMS a 150ms timer, so persistInFlight was still
    // null here and the await was a no-op. flushDeferredOps() therefore
    // returned with the durable queue still listing ops that had already been
    // uploaded — and a reload inside that window replayed them. Force the
    // pending write out and wait for it, so a completed flush is a fact on
    // disk before the caller is told it finished.
    await waitForQueuePersist();
  } finally {
    _flushing = false;
    emit();
  }
  return { flushed, remaining: deferredPendingCount(), skipped: false, error: firstError, deadLettered };
}

export function isFlushing(): boolean { return _flushing; }

// ---------- listeners (UI badge/button) ----------
type Listener = () => void;
const listeners = new Set<Listener>();
function emit(): void { listeners.forEach(l => { try { l(); } catch { /* ignore */ } }); }
export function onDeferredSyncChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ---------- lifecycle: install / stop / restart on tenant switch ----------
let _installed = false;
let _autoInterval: any = null;
let _onlineHandler: (() => void) | null = null;

export function installDeferredSyncTriggers(): void {
  if (_installed || typeof window === 'undefined') return;
  _installed = true;
  _onlineHandler = () => { if (getSyncMode() === 'auto') void flushDeferredOps(); };
  window.addEventListener('online', _onlineHandler);
  _autoInterval = setInterval(() => {
    if (getSyncMode() === 'auto' && deferredPendingCount() > 0) void flushDeferredOps();
  }, 20000);
  void ensureLoaded();
}

/** Called from initStore on tenant switch — prevents leaked timers. */
export function stopDeferredSyncTriggers(): void {
  if (_autoInterval) { clearInterval(_autoInterval); _autoInterval = null; }
  if (_onlineHandler && typeof window !== 'undefined') {
    window.removeEventListener('online', _onlineHandler);
    _onlineHandler = null;
  }
  _installed = false;
  // ===== v1.26.0 — do not drop unpersisted work on the way out =====
  // This is called on tenant switch and on logout. Non-critical ops sit in a
  // 150ms debounce window before reaching disk, so an operator who edited the
  // menu and immediately logged out lost those ops: `mem` was replaced before
  // the pending write ran. Force the write out first. It is fire-and-forget —
  // the caller must not block — but it is issued against the OLD queue, which
  // is captured by persistNow() synchronously enough to be correct here.
  if (mem.size) void waitForQueuePersist();
  // Reset memory — new tenant will rehydrate from its own IndexedDB rows.
  mem = new Map();
  memReady = false;
  emit();
}
