// Persistent archive of orders that survives Day Close.
// Admin-only history for daily / weekly / monthly reporting.
//
// ===== v1.15.1 — "After Day Close the Shift Report shows 0 orders" =====
//
// Root cause of the client's report: Day Close DELETES orders from the live
// store (that is its job), and this archive was the only thing that kept a
// copy — but every report page read `getOrders()` directly, so the moment a
// day was closed the reports went to zero and no previous date could be
// pulled up again. The archive existed and was correct; nothing except the
// Admin Sales History page ever read it.
//
// Two changes here:
//   1. `archiveOrders` is now also called on every settled sale (see
//      store.ts), not only at Day Close. A device that never runs Day Close
//      itself — or that has its orders removed by a Day Close on ANOTHER
//      device via sync — still keeps its own history.
//   2. Writes are quota-safe. This lives in localStorage (~5 MB per origin,
//      shared with the main cache). An unbounded archive would eventually
//      throw QuotaExceededError, and the old catch swallowed it silently —
//      the archive would simply stop growing with nobody any the wiser.
//      We now prune to a retention window and retry, and report failure.
//
// ===== v1.128.1 — "Page Unresponsive" at the busy restaurants =====
//
// The cost of one settled sale was proportional to the WHOLE archive. archiveOrders() read the archive back out of localStorage
// (JSON.parse of everything), sorted it (two Date parses per comparison), re-serialised it and wrote it — on the main thread, for every
// paid bill; and once the archive and the live cache together passed the ~5 MB the browser allows, that write failed, the archive was
// halved, and it did the whole thing AGAIN. The report pages parsed the whole archive on every render too. Measured (4x slower CPU,
// archive of 3,500 orders = 3.9 MB): 160 ms for ONE sale, and it grows with the archive — First Chef settles ~160 bills a day.
//
// Now: the archive is read from storage once and kept in memory; a settled sale only touches the in-memory copy and schedules ONE write
// a few seconds later (pagehide / tab-hidden flush it at once, so nothing waits on a timer when the till is closed); a bulk archive
// (Day Close) still writes straight away; the sort parses each date once; and the archive is held to what the live cache leaves free,
// in one pass, instead of writing until the browser refuses.
import { Order } from './types';
import { getTenantId } from './tenant';

/** How much history to keep on the device. A year covers every report preset. */
export const ARCHIVE_RETENTION_DAYS = 400;

/** Hard ceiling so a very busy year cannot fill the quota on its own. */
const ARCHIVE_MAX_ORDERS = 20000;

/** localStorage allows about 5.2 M characters per origin, for EVERYTHING on it. Stay under, with room for the live cache to grow. */
const STORAGE_BUDGET_CHARS = 4_700_000;
const ARCHIVE_MIN_CHARS = 150_000;
const ARCHIVE_MAX_CHARS = 4_000_000;
const FLUSH_MS = 4000;

function key(): string {
  const tid = getTenantId() || 'local';
  return `dt-pos-order-archive::${tid}`;
}

function orderTime(o: Order): number {
  const raw = (o as any).paidAt || o.createdAt || (o as any)._updatedAt;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function readStored(k: string): { list: Order[]; sig: number } {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return { list: [], sig: -1 };
    const arr = JSON.parse(raw);
    return { list: Array.isArray(arr) ? arr : [], sig: raw.length };
  } catch {
    return { list: [], sig: -1 };
  }
}

// The in-memory copy. `sig` is the length of the string it came from / was written as — a cheap check that storage has not been
// cleared or rewritten behind our back (a different tab also fires a `storage` event, handled below).
let mem: { k: string; byId: Map<string, Order>; sig: number } | null = null;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function memory(): Map<string, Order> {
  const k = key();
  if (mem && mem.k === k) {
    if (dirty) return mem.byId;                           // unsaved changes are the truth until they are written
    let sig = -1;
    try { const raw = localStorage.getItem(k); sig = raw ? raw.length : -1; } catch { /* private mode */ }
    if (sig === mem.sig) return mem.byId;
  }
  const { list, sig } = readStored(k);
  const byId = new Map<string, Order>();
  for (const o of list) byId.set(o.id, o);
  mem = { k, byId, sig };
  dirty = false;
  return byId;
}

export function getArchivedOrders(): Order[] {
  return Array.from(memory().values());
}

/**
 * Newest-first, trimmed to the retention window and the hard ceiling.
 * Exported for tests — the pruning rule is the part that can silently eat
 * history, so it is verified directly rather than through localStorage.
 */
export function pruneArchive(orders: Order[], now = Date.now()): Order[] {
  const cutoff = now - ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  // each date is parsed once, not twice per comparison
  const stamped: Array<[number, Order]> = [];
  for (const o of orders) { const t = orderTime(o); if (t >= cutoff) stamped.push([t, o]); }
  stamped.sort((a, b) => b[0] - a[0]);
  return stamped.slice(0, ARCHIVE_MAX_ORDERS).map(s => s[1]);
}

/** How many characters the archive may take: what the browser allows in total, minus everything else already stored. */
export function archiveBudgetChars(): number {
  let others = 0;
  try {
    const mine = key();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k === mine) continue;
      others += k.length + (localStorage.getItem(k)?.length ?? 0);
    }
  } catch { /* unreadable: assume the middle */ others = 2_000_000; }
  return Math.max(ARCHIVE_MIN_CHARS, Math.min(ARCHIVE_MAX_CHARS, STORAGE_BUDGET_CHARS - others));
}

/** Write the in-memory archive now. Returns false if it could not be saved. */
export function flushArchive(): boolean {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!mem || !dirty) return true;
  try {
    let merged = pruneArchive(Array.from(mem.byId.values()));
    let json = JSON.stringify(merged);
    const budget = archiveBudgetChars();
    if (json.length > budget) {
      // One pass: keep the newest share that fits (a little under, so the next sale does not tip it over again).
      const keep = Math.max(1, Math.floor(merged.length * (budget / json.length) * 0.95));
      merged = merged.slice(0, keep);
      json = JSON.stringify(merged);
      console.warn('[archive] kept the newest', merged.length, 'bills — the rest of the room is the live cache\'s');
    }
    try {
      localStorage.setItem(mem.k, json);
    } catch {
      // The browser still refused (other keys grew meanwhile). Halve once and try again rather than losing it all.
      merged = merged.slice(0, Math.floor(merged.length / 2));
      json = JSON.stringify(merged);
      localStorage.setItem(mem.k, json);
      console.warn('[archive] quota reached — older history trimmed');
    }
    mem.byId = new Map(merged.map(o => [o.id, o]));
    mem.sig = json.length;
    dirty = false;
    return true;
  } catch (e) {
    console.error('archiveOrders failed', e);
    return false;
  }
}

/**
 * Merge the given orders into the archive. Returns false if it could not be saved.
 *
 * One order (a settled sale) only touches memory and schedules a single write; several at once (Day Close, a privacy erase) are
 * written straight away, because the caller is about to remove the live copies and needs to know this one is safe.
 */
export function archiveOrders(orders: Order[], opts: { immediate?: boolean } = {}): boolean {
  if (!orders.length) return true;
  try {
    const byId = memory();
    // Newer copy of the same order wins (a bill edited after archiving).
    for (const o of orders) byId.set(o.id, o);
    dirty = true;
  } catch (e) {
    console.error('archiveOrders failed', e);
    return false;
  }
  if (opts.immediate ?? orders.length > 1) return flushArchive();
  if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; flushArchive(); }, FLUSH_MS);
  return true;
}

export function clearArchivedOrders() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  mem = null; dirty = false;
  try { localStorage.removeItem(key()); } catch { /* ignore */ }
}

/** Merge live + archived, dedup by id (live wins — it is the fresher copy). */
export function getAllHistoricalOrders(liveOrders: Order[]): Order[] {
  const byId = new Map<string, Order>();
  for (const o of getArchivedOrders()) byId.set(o.id, o);
  for (const o of liveOrders) byId.set(o.id, o);
  return Array.from(byId.values());
}

if (typeof window !== 'undefined') {
  // Nothing waits on a timer when the till is closed or the tab is hidden.
  window.addEventListener('pagehide', () => { flushArchive(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushArchive(); });
  // Another tab rewrote it: forget our copy and read again next time.
  window.addEventListener('storage', (e) => { if (e.key === null || e.key === key()) { if (!dirty) mem = null; } });
}
