import {
  AppData, Category, MenuItem, Order, DiningTable, Floor, Kitchen, Waiter, Rider, User,
  RestaurantSettings, InventoryItem, StockLog,
  Employee, Attendance, Leave, Payslip, Advance,
  AccountCategory, Transaction, Party, LedgerEntry, DailyCashClose, LedgerType,
  Recipe, Wastage, CustomerProfile, Branch, CreditPayment, PaymentMethod, PromoCode,
  PaymentAccount, Deal, CartItem,
} from './types';

import { seedData } from './seed-data';
import { OPTIONAL_FEATURES } from './optionalModules';
import { diffItemEdits, diffOrderMeta, makeEditLog } from './orderHistory';
import { isElectron, dbRead, dbWrite } from './electron';
import { getWhatsAppTemplates } from './whatsapp';
import { isFirebaseConfigured, fbDb } from './firebase';
import { getTenantId, getDeviceId } from './tenant';
import { setActiveCurrency, DEFAULT_CURRENCY } from './currency';
import { localDb } from './localDb';
import type { Shift } from './shifts';
import { buildRefund, type Refund, type RefundRequest } from './refunds';
import { normalizeForDisplay, dedupeById } from './dataIntegrity';
import { mergeCollection } from './syncMerge';
import { onDeadLetter } from './deferredSync';
import { shouldDeferCloudWrite, enqueueDeferredOp, registerDeferredFlusher, registerDeferredBatchFlusher, installDeferredSyncTriggers, stopDeferredSyncTriggers, deferredPendingCount, onDeferredSyncChange } from './deferredSync';
import { onOrderRenumbered } from './orderNumbers';
import {
  movementIdFor, isDuplicateMovement, planMovement, type MovementRef,
} from './stockLedger';


import { enqueuePraInvoice, configurePraQueue, startPraQueue, stopPraQueue } from './praQueue';
import { PRA_CONFIG_DEFAULT, type PraConfig } from './praEims';
import {
  doc, getDoc, getDocFromServer, setDoc, deleteDoc, collection, getDocs, getDocsFromServer, writeBatch, onSnapshot, runTransaction,
  query as fsQuery, limit as fsLimit, where as fsWhere,
} from 'firebase/firestore';
import { toast } from 'sonner';
import { archiveOrders } from './orderArchive';

const STORAGE_KEY_BASE = 'desi-pos-data';
// Per-tenant cache key — different restaurants must NEVER share local cache,
// otherwise switching login shows stale data (e.g. branches) from previous tenant.
function STORAGE_KEY(): string {
  const tid = getTenantId();
  return tid ? `${STORAGE_KEY_BASE}:${tid}` : STORAGE_KEY_BASE;
}

let cachedData: AppData | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let localPersistTimer: ReturnType<typeof setTimeout> | null = null;
const STORE_INIT_TIMEOUT_MS = 12000;

function flushLocalPersistence() {
  if (localPersistTimer) {
    clearTimeout(localPersistTimer);
    localPersistTimer = null;
  }
  const data = cachedData;
  if (!data || typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY(), JSON.stringify(data)); } catch {}
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushLocalPersistence);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushLocalPersistence();
  });
}

function runWhenIdle(task: () => void, timeoutMs = 1500) {
  if (typeof window === 'undefined') { task(); return; }
  const idle = (window as any).requestIdleCallback as ((cb: () => void, opts?: { timeout: number }) => number) | undefined;
  if (idle) idle(task, { timeout: timeoutMs });
  else setTimeout(task, Math.min(timeoutMs, 750));
}

function timeout<T>(promise: Promise<T>, ms: number, message = 'Store init timed out'): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(t); resolve(value); },
      (error) => { clearTimeout(t); reject(error); },
    );
  });
}

async function loadHeavyCollectionsInBackground(): Promise<void> {
  const tid = getTenantId();
  try {
    if (useSupabaseBackend()) {
      const { sbLoadAll } = await import('./supabaseStore');
      const out = await sbLoadAll(HEAVY_COLLECTIONS as readonly string[], { includeDeleted: true });
      if (!cachedData || getTenantId() !== tid) return;
      const stamped = (cachedData as any)?._tenantId;
      if (stamped && tid && stamped !== tid) return;
      // ===== v1.26.0 — this used to overwrite, not merge =====
      // HEAVY_COLLECTIONS is the history: orders, ledger, transactions,
      // attendance, day closes. Assigning the cloud rows straight over the
      // cache discarded every local row the cloud had not seen yet — bills
      // taken while offline, in the exact collections where losing one costs
      // money. The same three-way merge the critical path uses applies here.
      const pendingIds = await pendingOpKeys();
      const cloudIdFor = await loadCloudIdFn();
      for (const [name, rows] of Object.entries(out)) {
        if (!Array.isArray(rows)) continue;
        const { rows: merged, requeue } = mergeCollection(
          name, rows, ((cachedData as any)[name] || []) as any[], pendingIds, cloudIdFor,
        );
        (cachedData as any)[name] = merged.filter((r: any) => !r?.deleted);
        for (const id of requeue) enqueueDeferredOp(name, id, 'set');
        if (requeue.length) {
          console.warn(`[store] ${name}: ${requeue.length} local row(s) missing from the cloud — re-queued for upload`);
        }
      }
      saveLocal(cachedData);
      emitDataChange('*');
      console.log('[store] heavy collections loaded from active backend:', Object.keys(out).join(', '));
      return;
    }
    const out: Record<string, any[]> = {};
    await Promise.all(HEAVY_COLLECTIONS.map(async (name) => {
      const c = colRef(name); if (!c) return;
      try {
        const snap = await getDocs(c);
        const arr: any[] = [];
        snap.forEach(d => arr.push(d.data()));
        out[name] = arr;
      } catch (e) {
        console.warn('[store] heavy load skipped:', name, e);
      }
    }));
    if (!cachedData) return;
    // Tenant guard: user may have switched restaurants mid-load.
    if (getTenantId() !== tid) return;
    const stamped = (cachedData as any)?._tenantId;
    if (stamped && tid && stamped !== tid) return;
    for (const k of Object.keys(out)) (cachedData as any)[k] = out[k];
    saveLocal(cachedData);
    if (Array.isArray(out.orders)) backfillPublicOrderLookups(out.orders as any);
    emitDataChange('*');
    console.log('[store] heavy collections loaded in background:', Object.keys(out).join(', '));
  } catch (e) {
    console.warn('[store] heavy background load failed (listeners will fill in):', e);
  }
}

function refreshCloudStoreInBackground() {
  void (async () => {
    const settingsRevisionAtStart = settingsRevision;
    try {
      // Keep startup/rush traffic light: refresh only till-critical data first.
      // Historical/reporting collections load when the browser is idle.
      const remote = await cloudLoadAll(CRITICAL_COLLECTIONS);
      const local = cachedData;

      // ===== v1.25.20 — the database is the single source of truth =====
      //
      // This merge previously said:
      //     if (!cloudRow || localAt > cloudAt) byId.set(row.id, row);
      //
      // The `!cloudRow` half is what made two browsers on the SAME account show
      // DIFFERENT data, and it did two separate kinds of damage:
      //
      //  1. DELETIONS CAME BACK. Browser B deletes a menu item; the cloud no
      //     longer has it. Browser A still has it locally, sees `!cloudRow`,
      //     resurrects it, writes it back to localStorage — and pushes it back
      //     up. The delete undid itself.
      //
      //  2. FAILED SAVES LOOKED SUCCESSFUL. A row whose sync was rejected
      //     lived in localStorage forever and was re-adopted on every refresh,
      //     so the operator saw it on their till and nobody else ever did.
      //
      // A local row missing from the cloud has exactly two possible meanings:
      // it was deleted elsewhere, or it has not been pushed YET. Only the
      // durable sync queue can tell those apart — so ask it, instead of
      // assuming the favourable one.
      //
      // Anything with a pending op is kept (it is a genuine unsynced write).
      // Everything else defers to the cloud, including its absence.
      // ===== v1.25.21 — NEVER DROP A ROW ON UNCERTAINTY =====
      // getDeferredOps() reads an in-memory Map that starts EMPTY and is
      // filled by an async load. Calling it during boot returns [] meaning
      // "I have not looked yet", NOT "nothing is pending". v1.25.20 read it
      // synchronously and treated the empty result as authoritative, so on the
      // first background refresh every unsynced local row was discarded —
      // destroying precisely the data the queue exists to protect.
      //
      // Wait for the queue to be genuinely readable. If it is not, keep the
      // local rows: a stale duplicate is recoverable, a deleted order is not.
      const pendingIds = await pendingOpKeys();
      const cloudIdFor = await loadCloudIdFn();
      const loaded = loadedCollections(remote);
      // No marker at all (the Firestore path, or an older snapshot) means we
      // cannot tell — and "cannot tell" must never overwrite saved settings.
      const settingsLoaded = !!loaded && loaded.has(SETTINGS_LOADED_KEY);

      if (local) {
        // ===== v1.26.2 — the other 21 collections were being silently emptied =====
        //
        // This loop ran over CRITICAL_COLLECTIONS only, but `remote` starts
        // from emptyRuntimeData(), which pre-fills EVERY collection with [].
        // So orders, transactions, ledger, day closes, attendance, refunds and
        // the rest were never merged and never even looked at — they were
        // simply replaced with [] and then written to localStorage.
        //
        // Online that self-corrects, because loadHeavyCollectionsInBackground()
        // refills them a moment later. OFFLINE it does not: that call fails
        // too, so a refresh with no connection wiped every bill on the device.
        // Reproduced in a browser before fixing.
        //
        // Iterating all of them is the fix: a collection this refresh did not
        // ask for is "not loaded", and not-loaded always means keep local.
        for (const name of ARRAY_COLLECTIONS) {
          // ===== v1.26.0 — a collection that did not load is not an empty one =====
          // Merging against a collection whose read failed compares every
          // local row against nothing at all. Leave it exactly as it was.
          if (loaded && !loaded.has(name)) {
            (remote as any)[name] = (local as any)[name] || [];
            continue;
          }
          const { rows, requeue } = mergeCollection(
            name,
            ((remote as any)[name] || []) as any[],
            ((local as any)[name] || []) as any[],
            pendingIds,
            cloudIdFor,
          );
          (remote as any)[name] = rows;
          for (const id of requeue) enqueueDeferredOp(name, id, 'set');
          if (requeue.length) {
            console.warn(`[store] ${name}: ${requeue.length} local row(s) missing from the cloud — re-queued for upload`);
          }
        }
      }
      // Whatever survived the merge, no tombstone may reach the UI.
      stripTombstones(remote);
      // A settings save may finish while this older cloud request is still in
      // flight. Never let that stale response remove a newly saved name/logo.
      if (local?.settings && settingsRevision !== settingsRevisionAtStart) {
        remote.settings = local.settings;
      } else if (local?.settings) {
        // ===== v1.26.2 — "my restaurant name and logo vanish on refresh" =====
        //
        // cloudLoadAll() starts from emptyRuntimeData(), whose `settings` is
        // the DEFAULTS. sbLoadSettings() returns null both when the tenant has
        // no settings row AND when the read simply failed — offline, a timeout,
        // a slow cold start. Those are not the same thing, but this code could
        // not tell them apart, so a failed read installed default settings over
        // a perfectly good saved copy and persisted them to localStorage.
        //
        // That is the reported bug exactly: the branding is correct, you
        // refresh, and it is gone — while the real values sit safe in the
        // database the whole time.
        //
        // A settings read that did not produce a row is now "unknown", and
        // unknown keeps what the device already has.
        if (!settingsLoaded) {
          remote.settings = local.settings;
        } else {
          // ===== v1.26.0 — branding edited offline used to be thrown away =====
          // Both sides carry `_updatedAt`, so the newer one wins here as it
          // does everywhere else.
          const localAt = Number((local.settings as any)?._updatedAt || 0);
          const remoteAt = Number((remote.settings as any)?._updatedAt || 0);
          if (localAt > remoteAt) remote.settings = local.settings;
        }
      }
      stampTenant(remote);
      cachedData = remote;
      try { localStorage.setItem(STORAGE_KEY(), JSON.stringify(remote)); } catch {}
      try { startRealtimeListeners(); } catch (e) { console.warn('[store] realtime listeners failed', e); }
      emitDataChange('*');
      runWhenIdle(() => { void loadHeavyCollectionsInBackground(); });
    } catch (e) {
      console.warn('[store] background cloud refresh skipped', e);
      try { startRealtimeListeners(); } catch {}
    }
  })();
}

// ============================================================
// TENANT GUARD — prevents data leak between restaurants
// ============================================================
// Every cached snapshot is stamped with the tenant id it belongs to.
// Any read/write that detects a mismatch is rejected so restaurant A's
// data can NEVER overwrite restaurant B's settings/menu/etc., even during
// the brief window between login → React re-render → initStore() finishing.
function cacheTenantId(): string | null {
  return (cachedData as any)?._tenantId || null;
}
function tenantGuardOk(): boolean {
  const tid = getTenantId();
  // No cache yet, or cache has no stamp (legacy), or stamp matches → OK
  if (!cachedData) return true;
  const stamped = cacheTenantId();
  if (!stamped) return true;
  return stamped === tid;
}
function stampTenant(data: AppData) {
  try { (data as any)._tenantId = getTenantId(); } catch {}
}

function isPublicStoreRoute(): boolean {
  if (typeof window === 'undefined') return false;
  return /^#\/(order|track|rider-portal|order-taker)(\/|\?|$)/.test(window.location.hash || '');
}

function isEmptySeedLike(data: any): boolean {
  if (!data) return true;
  const hasBusinessData = ARRAY_COLLECTIONS.some(k => k !== 'users' && ((data as any)[k] || []).length > 0);
  const hasRestaurantIdentity = Boolean(
    data?.settings?.restaurantName || data?.settings?.name || data?.settings?.logo || data?.settings?.appLogo,
  );
  return !hasBusinessData && !hasRestaurantIdentity;
}

/**
 * The starting shape for a CLOUD tenant, before anything is downloaded.
 *
 * ===== v1.28.4 — "Stuck (8)" on every newly created restaurant =====
 *
 * Every caller of this function documents it as an EMPTY shape, and two of
 * them say plainly why: "Cloud tenants must never see default data". It was
 * not empty. seedData() carries eight default account categories with the
 * fixed ids 'ac1'..'ac8' and a default admin user 'u-default-admin', and this
 * handed all nine to every cloud tenant as local rows.
 *
 * The merge then did exactly what it should: nine rows that exist on the
 * device and not in the cloud are unsynced work, so it re-queued them. The
 * upload could never succeed, because a fixed local id derives a FIXED cloud
 * uuid (cloudId('ac1') is the same value for every restaurant on earth) and
 * the first restaurant to sync already owned those eight rows. PostgREST
 * upserts as INSERT ... ON CONFLICT (id) DO UPDATE, so restaurant number two
 * was asking to update restaurant number one's row, and RLS refused it:
 *
 *     new row violates row-level security policy (USING expression)
 *     for table "account_categories"
 *
 * — logged eight at a time, on every 20-second flush, for the whole life of
 * the restaurant, until six attempts each parked them in the dead-letter
 * queue and the till showed "⚠ Stuck (8)".
 *
 * RLS was right; the isolation held and nothing leaked. The mistake was
 * shipping shared row identities to tenants that must not share rows. The
 * defaults are still created for a new restaurant — server-side, in
 * sa_create_restaurant, where each one gets its own uuid (migration
 * 20260828100000). Nothing derived, nothing shared, nothing to collide.
 *
 * seedData() itself is untouched: a LOCAL (non-cloud) install still needs its
 * default admin login and its account categories, and has no other tenant to
 * collide with.
 */
function emptyRuntimeData(): AppData {
  const data = seedData() as AppData;
  // Settings defaults stay — they are this device's shape, not shared rows.
  // Business rows do not: on the cloud they belong to the restaurant, and the
  // restaurant's copy is about to arrive from the server.
  for (const k of ARRAY_COLLECTIONS) (data as any)[k] = [];
  ensureFields(data);
  stampTenant(data);
  return data;
}
// React to tenant changes (login / logout / switch) — drop in-memory cache
// and stop listeners so the next read goes to the correct tenant's cloud data.
if (typeof window !== 'undefined') {
  window.addEventListener('pos-tenant-change', () => {
    cachedData = null;
    try { stopRealtimeListeners(); } catch {}
    // v1.7.0: previously the deferred-sync setInterval leaked across every
    // tenant switch (one restaurant login/logout cycle = one zombie timer).
    // On multi-tenant SaaS deployments this piled up over a session.
    try { stopDeferredSyncTriggers(); } catch {}
    try { installDeferredSyncTriggers();

// ===== v1.26.0 — a write that gives up must say so =====
// After six failed attempts an op is parked in the dead-letter store. Nothing
// read that store, so the one path the design leaves for a permanently failing
// write ended in silence: a bill or a price change that could not be uploaded
// simply stopped being mentioned. The record is still on the device and still
// recoverable — but only if somebody knows to look.
onDeadLetter((count, parked) => {
  const what = Array.from(new Set(parked.map(o => o.col))).join(', ');
  console.error('[sync] parked after repeated failures:', parked);
  try {
    toast.error(
      `${count} change${count === 1 ? '' : 's'} could not be uploaded (${what}). ` +
      'They are saved on this device — press Sync Now, or contact support.',
      { duration: 30000 },
    );
  } catch { /* toast unavailable */ }
}); } catch {}
    // v1.9.0: PRA queue is per-tenant too — stop the old restaurant's
    // driver and let the new tenant rehydrate its own pending invoices.
    try { stopPraQueue(); } catch {}
    try { startPraQueue(); } catch {}
  });
}

// ============================================================
// Collection mapping — har array ek separate Firestore collection
// ============================================================
const ARRAY_COLLECTIONS = [
  'categories', 'menuItems', 'orders', 'tables', 'floors', 'kitchens', 'waiters', 'riders', 'users',
  'inventory', 'stockLogs', 'employees', 'attendance', 'leaves', 'payslips', 'advances',
  'accountCategories', 'transactions', 'parties', 'ledger', 'dailyCashCloses',
  'receivingEntries', 'marketingContacts', 'recipes', 'wastages', 'customers', 'branches',
  'creditPayments', 'promoCodes', 'paymentAccounts', 'deals', 'shifts', 'refunds',
] as const;


type ArrayKey = typeof ARRAY_COLLECTIONS[number];

// ============================================================
// v1.2.4 PROGRESSIVE STARTUP — kills the "Cloud data sync slow"
// safety-lock screen on login.
//
// Before: login had to download ALL 30 collections — including the
// ENTIRE orders / transactions / ledger / attendance history — within
// 12 seconds, or the safety lock fired. Busy restaurant + slow network
// = lock screen on every fresh login, and thousands of Firestore reads
// burned per device (the "limit exceeded" quota errors).
//
// Now: only the small CRITICAL set (menu, tables, staff, settings) must
// arrive to unlock the app — seconds, not minutes. The HEAVY history
// collections stream in right after, in the background, and the UI
// refreshes as they land. Nothing is skipped — only reordered.
// ============================================================
const CRITICAL_COLLECTIONS: readonly ArrayKey[] = [
  'categories', 'menuItems', 'tables', 'floors', 'kitchens', 'waiters', 'riders', 'users',
  'branches', 'promoCodes', 'paymentAccounts', 'deals',
] as const;
const HEAVY_COLLECTIONS: readonly ArrayKey[] =
  ARRAY_COLLECTIONS.filter(c => !(CRITICAL_COLLECTIONS as readonly string[]).includes(c)) as unknown as readonly ArrayKey[];


function ensureFields(data: AppData) {
  const d = data as any;
  for (const k of ARRAY_COLLECTIONS) if (!Array.isArray(d[k])) d[k] = [];
}

function tenantBase() {
  const tid = getTenantId();
  if (!tid) return null;
  return ['tenants', tid] as const;
}

function colRef(name: ArrayKey) {
  const base = tenantBase();
  if (!base) return null;
  return collection(fbDb(), base[0], base[1], name);
}

function settingsRef() {
  const base = tenantBase();
  if (!base) return null;
  return doc(fbDb(), base[0], base[1], 'meta', 'settings');
}

function counterRef() {
  const base = tenantBase();
  if (!base) return null;
  return doc(fbDb(), base[0], base[1], 'meta', 'counter');
}

function publicOrderLookupRef(orderNo: string | number) {
  const base = tenantBase();
  if (!base || orderNo == null || orderNo === '') return null;
  return doc(fbDb(), base[0], base[1], 'publicOrderLookups', String(orderNo));
}

function useFirestore(): boolean {
  // isFirebaseConfigured() is a legacy "any cloud exists" compatibility
  // flag and is also true on Supabase-only builds. Keep removed Firebase
  // calls unreachable whenever the active data backend is Supabase.
  return !useSupabaseBackend() && isFirebaseConfigured() && !!getTenantId();
}

/** True when this restaurant has any persistent cloud data backend. */
function useCloudStore(): boolean {
  return !!getTenantId() && (useSupabaseBackend() || useFirestore());
}

/**
 * v1.18.0 — is this restaurant on the Supabase backend?
 *
 * Default OFF. Read fresh each call so the Settings toggle takes effect
 * without a rebuild, and guarded so a settings-read failure can never
 * silently divert writes to the wrong backend.
 */
function useSupabaseBackend(): boolean {
  // ===== v1.19.1 — auth and data MUST agree =====
  // These were two independent flags: auth followed the device/build, data
  // followed a restaurant setting. That allowed a split brain — signed in
  // against Supabase, while every read and write still went to Firebase,
  // where that user does not exist. Reads would come back empty and writes
  // would be rejected, which looks exactly like data loss.
  //
  // The session is the authority. Whoever authenticated you owns your data:
  // a Supabase session means Supabase data, a Firebase session means
  // Firebase data. There is no combination in which mixing them is correct.
  try {
    const backend = localStorage.getItem('dtpos-auth-backend');
    if (backend === 'supabase') return true;
    if (backend === 'firebase') return false;
  } catch { /* storage unavailable — fall through */ }

  // No device choice recorded yet (first run). Follow the build, exactly as
  // usingSupabaseAuth() does, so the two can never disagree.
  const env = (import.meta as any).env ?? {};
  const supabaseBuild = !!env.VITE_SUPABASE_URL
    && !!(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY);
  return supabaseBuild;

  // NOTE — the old `settings.supabaseBackendEnabled` opt-in is deliberately no
  // longer consulted here. A test caught why: a restaurant with that setting
  // ON but a build carrying NO Supabase configuration resolved auth to
  // Firebase and data to Supabase. Data would then be sent to a client that
  // cannot even be constructed, while the session lived elsewhere.
  //
  // A per-restaurant setting cannot decide this at all: the backend is a
  // property of the BUILD and the SESSION, not of a row inside the data the
  // decision governs. The setting remains in the Features list as a visible
  // marker, but the routing follows the session.
}

// ============================================================
// Cloud helpers — per-entity writes
// ============================================================
// Firestore rejects `undefined` field values. Recursively strip them
// before any setDoc call.
function sanitizeForFirestore<T>(value: T): T {
  if (value === null || value === undefined) return value as T;
  if (Array.isArray(value)) {
    return value
      .filter(v => v !== undefined)
      .map(v => sanitizeForFirestore(v)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) {
      if (v === undefined) continue;
      out[k] = sanitizeForFirestore(v);
    }
    return out;
  }
  return value;
}

// ----- Sync status tracking (for offline indicator) -----
type SyncListener = (s: { online: boolean; pending: number; lastError?: string }) => void;
const syncListeners = new Set<SyncListener>();
let pendingWrites = 0;
let lastSyncError: string | undefined;

/**
 * v1.8.0 — SINGLE SOURCE OF TRUTH for the "Syncing" badge.
 *
 * The badge previously reported only `pendingWrites` (in-flight Firestore
 * SDK calls). A bill created OFFLINE goes straight into the deferred queue
 * and pendingWrites stays 0 — so the header confidently showed "Synced"
 * while items were actually waiting to be flushed. On an international
 * SaaS this misleads the operator into powering off with unsynced revenue.
 *
 * Now the emitted `pending` is `in-flight + queued`, so:
 *   • Online + no queue      → 0 (Synced)
 *   • Online + writes flying → pendingWrites (Syncing…)
 *   • Offline + queued items → queueDepth (Pending N)
 * Zero UI churn — every consumer already reads this one field.
 */
function emitSync() {
  const queued = deferredPendingCount();
  const snap = {
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pending: pendingWrites + queued,
    lastError: lastSyncError,
  };
  syncListeners.forEach(l => { try { l(snap); } catch { /* ignore */ } });
}
/** v1.2.4: how many Firestore writes are still in flight (data-loss guard). */
export function getPendingWriteCount(): number { return pendingWrites; }

export function onSyncStatus(cb: SyncListener): () => void {
  syncListeners.add(cb);
  emitSync();
  return () => syncListeners.delete(cb);
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { lastSyncError = undefined; emitSync(); });
  window.addEventListener('offline', () => emitSync());
  // v1.8.0 — badge stays honest as the deferred queue drains / grows.
  try { onDeferredSyncChange(() => emitSync()); } catch { /* ignore */ }
}
let toastDebounce = 0;
function reportCloudError(label: string, e: any) {
  lastSyncError = e?.message || String(e);
  console.error(`[cloud] ${label} failed`, e);

  // ===== v1.22.0 — say WHAT failed =====
  // The old message was always "Cloud sync issue — data is saved locally and
  // will retry". True, but useless: it named neither the collection nor the
  // reason, so a permanent schema mismatch looked exactly like a flaky
  // network. Three collections were failing on EVERY attempt for weeks and the
  // toast said the same reassuring thing each time.
  //
  // A retryable failure and a permanent one need different reactions, so they
  // now read differently.
  const msg = String(e?.message || '');
  const code = String(e?.code || '');
  const permanent = /does not exist|could not find (the )?(table|column|function)|schema cache|violates|invalid input|not-null|constraint|permission denied|row-level security|invalid jwt/i
    .test(msg)
    || /^(PGRST2|23|42|42501)/.test(code);

  const now = Date.now();
  if (now - toastDebounce > 5000) {
    toastDebounce = now;
    try {
      if (permanent) {
        // Retrying will never help. Name it so it can actually be fixed.
        toast.error(`Sync rejected (${label}): ${msg.slice(0, 120)}`, { duration: 9000 });
      } else {
        toast.error('Cloud sync issue — data is saved locally and will retry');
      }
    } catch { /* toast unavailable */ }
  }
  emitSync();
}

// v1.5.4: deferred queue ka flusher — entity ki TAAZA copy parh kar wohi
// guarded raste (cloudSaveItem / cloudDeleteItem) se bhejta hai. Agar entity
// ab local me nahi (day close etc.) aur op 'set' tha to write skip hota hai.
registerDeferredFlusher(async (col, id, op) => {
  // The normal cloud helpers intentionally recover by re-queuing a failed
  // online write. A queue flusher must instead let the error escape; otherwise
  // deferredSync believes the operation succeeded and deletes it permanently.
  if (col === SETTINGS_COL) {
    // Settings are a single document, not a row in a collection, so they need
    // their own read-back. Everything else about the op — backoff, ordering,
    // dead-lettering, the audit panel — is identical.
    if (useSupabaseBackend()) {
      const { sbSaveSettings } = await import('./supabaseStore');
      await sbSaveSettings(loadData().settings as any);
    }
    return;
  }
  if (useSupabaseBackend()) {
    const { sbDeleteItem, sbSaveItem } = await import('./supabaseStore');
    if (op === 'delete') { await sbDeleteItem(col, id); return; }
    const d = loadData();
    const arr = (d as any)[col] as any[] | undefined;
    const item = arr?.find(x => x.id === id);
    if (item) await sbSaveItem(col, id, item);
    return;
  }
  if (op === 'delete') { await cloudDeleteItem(col as ArrayKey, id); return; }
  const d = loadData();
  const arr = (d as any)[col] as any[] | undefined;
  const item = arr?.find(x => x.id === id);
  if (item) await cloudSaveItem(col as ArrayKey, id, item);
});
/**
 * ===== v1.28.2 — the batch path for the same queue =====
 *
 * Two costs are removed here, and the second is the one that made a large
 * backlog feel like a hang:
 *
 *   1. ONE request per chunk instead of one per record.
 *   2. ONE loadData() and one id index per chunk. The per-entity flusher above
 *      calls loadData() and then `arr.find(...)` for every op — an O(n) scan of
 *      the orders array per record. Draining 4000 queued orders that way is
 *      millions of comparisons on the main thread before a single byte is sent.
 *
 * Deletes stay on the per-entity path: sbDeleteItem carries tombstone rules a
 * blind bulk delete would skip, and a backlog of deletes is rare.
 */
registerDeferredBatchFlusher(async (col, entityIds, op) => {
  if (op === 'delete' || col === SETTINGS_COL || !useSupabaseBackend()) {
    throw new Error('batch path not applicable');   // caller falls back per entity
  }
  const { sbSaveMany } = await import('./supabaseStore');
  const d = loadData();
  const arr = ((d as any)[col] as any[] | undefined) ?? [];
  const byId = new Map<string, any>();
  for (const x of arr) if (x?.id) byId.set(String(x.id), x);

  const items: Array<{ id: string; data: any }> = [];
  const gone: string[] = [];
  for (const id of entityIds) {
    const item = byId.get(id);
    // The entity no longer exists locally (Close Day, a delete that raced the
    // queue). There is nothing to upload and nothing to retry — settled, which
    // is exactly what the per-entity flusher does by skipping the write.
    if (item) items.push({ id, data: item });
    else gone.push(id);
  }

  const res = await sbSaveMany(col, items);
  return { saved: [...res.saved, ...gone], failed: res.failed };
});

installDeferredSyncTriggers();
// Promotions, variations, wallet, campaigns, zones and daily wages are mirrored
// to the cloud too, so every module is backed up — not just the POS core.
void import('./cloudDocs').then(m => m.installCloudDocs()).catch(() => {});
// Print the build id on boot so "is the new build live?" is answerable
// from devtools instead of being inferred from synced data.
void import('./buildStamp').then(m => m.logBuildStamp()).catch(() => {});

// ===== Renumbered bills stay consistent everywhere =====
// If a bill created offline had to be given a new number by the server, the
// local copy, the counter and the reports must all follow it — otherwise the
// printed receipt and the cloud record would disagree.
onOrderRenumbered((orderId, newNumber, oldNumber) => {
  try {
    const d = loadData();
    const o = d.orders.find(x => x.id === orderId);
    if (!o) return;
    o.orderNumber = newNumber;
    (o as any)._updatedAt = Date.now();
    d.orderCounter = Math.max(d.orderCounter || 0, newNumber);
    saveLocal(d);
    emitDataChange('orders');
    if (oldNumber && oldNumber !== newNumber) {
      toast.info(`Order #${oldNumber} was already used on another till — it is now #${newNumber}`, { duration: 8000 });
    }
  } catch (e) {
    console.warn('[store] renumber apply failed', e);
  }
});


// ===== v1.9.0 — wire the PRA queue to the store =====
// The queue module never imports store.ts (no cycle, stays testable);
// instead the store injects the three things it needs: the tenant's PRA
// config, a way to re-read an order at submit time, and a status sink.
configurePraQueue({
  config: (): PraConfig | null => {
    try {
      const st = loadData().settings as any;
      if (!st?.praEimsEnabled) return null;      // module OFF for this tenant
      return { ...PRA_CONFIG_DEFAULT, ...(st.praConfig || {}) } as PraConfig;
    } catch { return null; }
  },
  order: (orderId: string) => {
    try { return loadData().orders.find(o => o.id === orderId) || null; }
    catch { return null; }
  },
  onStatus: (orderId, patch) => {
    try {
      const d = loadData();
      const idx = d.orders.findIndex(o => o.id === orderId);
      if (idx < 0) return;
      // Write the fiscal stamps straight onto the order. saveEntity is not
      // used here: this must not re-enter saveOrder (and re-queue itself).
      d.orders[idx] = { ...d.orders[idx], ...patch } as any;
      saveLocal(d);
      if (useCloudStore()) {
        const item = d.orders[idx] as any;
        if (shouldDeferCloudWrite()) enqueueDeferredOp('orders', item.id, 'set');
        else cloudSaveItem('orders', item.id, item);
      }
      emitDataChange('orders');
    } catch (e) { console.warn('[pra] status write failed', e); }
  },
});
// NOTE: startPraQueue() is deliberately NOT called at module scope — that
// would run loadData() before the app has hydrated and poison the cache
// with empty data. It is started from initStore() once data is ready.

async function cloudSaveItem(col: ArrayKey, id: string, data: any) {
  // ===== v1.18.0 — backend routing =====
  // store.ts already funnels every cloud write through this one function, so
  // switching backends here moves the whole data layer without touching the
  // 214 individual call sites and without altering any POS workflow.
  if (useSupabaseBackend()) {
    try {
      const { sbSaveItem } = await import('./supabaseStore');
      await sbSaveItem(col, id, data);
    } catch (e) {
      // Online does not mean the write reached the database. Preserve every
      // failed mutation in the durable retry queue before reporting it.
      enqueueDeferredOp(col, id, 'set');
      reportCloudError(`save ${col}/${id}`, e);
    }
    return;
  }
  if (!tenantGuardOk()) { console.warn('[firestore] BLOCKED save (tenant mismatch)', col, id); return; }
  const c = colRef(col); if (!c) return;
  pendingWrites++; emitSync();
  // Use the local _updatedAt if caller already stamped one (see saveEntity),
  // otherwise stamp here. This keeps local and remote timestamps in sync so
  // conflict merge stays deterministic.
  const stamped = { ...data, id, _updatedAt: (data && Number((data as any)._updatedAt)) || Date.now() };
  try {
    // ===== v1.2.4 SYNC FIX: guarded order writes =====
    // Root cause of "day close ke baad orders wapas aa jate hain": a device
    // with a stale cache (offline kal, ya purani tab) apna running/hold
    // snapshot blind setDoc se cloud par likh deta tha — cloud me paid/closed
    // order phir se 'running' ban jata, aur agli fresh login par sab devices
    // ko wapis nazar aata. Ab NON-final order writes transaction se guarded
    // hain: cloud ka FINAL status (paid/void/cancelled/…) kabhi downgrade
    // nahi hota, aur purane _updatedAt wali write drop ho jati hai.
    if (col === 'orders' && !isOrderFinal(stamped)) {
      let adoptedFinal: any = null;
      await runTransaction(fbDb(), async (tx) => {
        const ref = doc(c, id);
        const snap = await tx.get(ref);
        if (snap.exists()) {
          const cur: any = snap.data();
          if (isOrderFinal(cur)) {
            console.warn('[firestore] blocked cloud resurrection', id, cur.status, '<-', stamped.status);
            adoptedFinal = cur;
            return; // never downgrade a closed bill
          }
          if (Number(cur?._updatedAt || 0) > Number(stamped._updatedAt || 0)) {
            return; // our copy is older — drop the stale write
          }
        }
        tx.set(ref, sanitizeForFirestore(stamped));
      });
      // Repair the local cache with the authoritative closed bill.
      if (adoptedFinal) {
        try {
          const d = loadData();
          const arr = (d as any).orders as any[];
          const idx = arr.findIndex((o: any) => o?.id === id);
          if (idx >= 0) arr[idx] = adoptedFinal; else arr.push(adoptedFinal);
          saveLocal(d);
          emitDataChange('orders');
        } catch {}
      }
    } else {
      await setDoc(doc(c, id), sanitizeForFirestore(stamped));
    }
  }
  catch (e) { reportCloudError(`save ${col}/${id}`, e); }
  finally { pendingWrites = Math.max(0, pendingWrites - 1); emitSync(); }
}

async function cloudDeleteItem(col: ArrayKey, id: string) {
  if (useSupabaseBackend()) {
    try {
      const { sbDeleteItem } = await import('./supabaseStore');
      await sbDeleteItem(col, id);
    } catch (e) {
      enqueueDeferredOp(col, id, 'delete');
      reportCloudError(`delete ${col}/${id}`, e);
    }
    return;
  }
  if (!tenantGuardOk()) { console.warn('[firestore] BLOCKED delete (tenant mismatch)', col, id); return; }
  const c = colRef(col); if (!c) return;
  pendingWrites++; emitSync();
  try { await deleteDoc(doc(c, id)); }
  catch (e) { reportCloudError(`delete ${col}/${id}`, e); }
  finally { pendingWrites = Math.max(0, pendingWrites - 1); emitSync(); }
}

async function cloudSaveSettings(s: RestaurantSettings): Promise<void> {
  if (useSupabaseBackend()) {
    try {
      const { sbSaveSettings } = await import('./supabaseStore');
      await sbSaveSettings(s as any);
    } catch (e) {
      // ===== v1.26.0 — settings were the one thing with no retry at all =====
      // Every other module preserves a failed write in the durable queue.
      // Settings just reported the error and gave up, and saveSettings()
      // swallowed it — so a restaurant name, logo or tax change made while
      // the connection was down was gone for good, with the UI showing it
      // saved. Queue it like everything else.
      enqueueDeferredOp(SETTINGS_COL, SETTINGS_ID, 'set');
      reportCloudError('save settings', e);
      throw e;
    }
    return;
  }
  if (!tenantGuardOk()) {
    const error = new Error('Restaurant changed while settings were saving');
    console.warn('[firestore] BLOCKED settings save (tenant mismatch)');
    throw error;
  }
  const r = settingsRef(); if (!r) return;
  pendingWrites++; emitSync();
  try { await setDoc(r, sanitizeForFirestore(s as any)); }
  catch (e) { reportCloudError('save settings', e); throw e; }
  finally { pendingWrites = Math.max(0, pendingWrites - 1); emitSync(); }
}

async function cloudSaveCounter(value: number) {
  if (!tenantGuardOk()) { console.warn('[firestore] BLOCKED counter save (tenant mismatch)'); return; }
  const r = counterRef(); if (!r) return;
  // ===== v1.18.0 — "Order numbers are generated out of sequence" =====
  // This was a blind `setDoc(r, { value })`: whatever number THIS device
  // held was written straight over the shared cloud counter, with nothing
  // stopping it going backwards. With a main till plus waiter tablets:
  //
  //   counter = 50 on the server
  //   tablet goes offline, takes 3 orders → its local counter reaches 53
  //   till (still online) takes 6 orders   → server counter reaches 56
  //   tablet reconnects, takes one order   → writes 54 over the server's 56
  //   next till order                      → 55, which ALREADY EXISTS
  //
  // Result is exactly what the client described: numbers jumping around and
  // repeating, with the counter, kitchen and packing staff disagreeing.
  //
  // The counter is shared state, so it may only ever move FORWARD. A
  // transaction makes the read-and-compare atomic, so two devices writing at
  // the same instant cannot both win.
  try {
    await runTransaction(fbDb(), async (tx) => {
      const snap = await tx.get(r);
      const current = Number(snap.exists() ? (snap.data() as any)?.value : 0) || 0;
      if (value > current) tx.set(r, { value });
    });
  } catch (e) {
    // Transaction unavailable (offline, or rules refusing a read). Falling
    // back to a blind write would reintroduce the bug, so skip it — the
    // local counter is still correct and the next successful sync
    // reconciles upward.
    reportCloudError('save counter', e);
  }
}

async function cloudSaveOrderLookup(order: Order) {
  const r = publicOrderLookupRef(order.orderNumber); if (!r) return;
  const phoneLast4 = (order.customer?.phone || '').replace(/\D/g, '').slice(-4);
  try {
    const existing = await getDocFromServer(r).catch(() => null);
    if (existing?.exists()) return;
    await setDoc(r, sanitizeForFirestore({
      orderNo: String(order.orderNumber),
      orderId: order.id,
      phoneLast4: phoneLast4 || undefined,
      tableLabel: (order as any).tableLabel || undefined,
      source: order.source || undefined,
      createdAt: order.createdAt || undefined,
      updatedAt: new Date().toISOString(),
    }));
  } catch (e) { reportCloudError(`save public order lookup/${order.orderNumber}`, e); }
}

function backfillPublicOrderLookups(orders: Order[]) {
  for (const order of orders) {
    if (order?.id && order.orderNumber != null) cloudSaveOrderLookup(order);
  }
}

// ============================================================
// Real-time listeners (orders + a few hot collections)
// ============================================================
const activeUnsubs: Array<() => void> = [];
export function stopRealtimeListeners() {
  while (activeUnsubs.length) { try { activeUnsubs.pop()!(); } catch {} }
  try { stopSupabaseRealtime(); } catch {}
}
const DATA_CHANGE_EVENT = 'dt-pos-data-change';
const pendingChangeNames = new Set<string>();
let changeFlushTimer: ReturnType<typeof setTimeout> | null = null;
function emitDataChange(name: string) {
  pendingChangeNames.add(name);
  if (changeFlushTimer) return;
  // Debounce burst snapshots into one notification per ~120ms
  changeFlushTimer = setTimeout(() => {
    changeFlushTimer = null;
    const names = Array.from(pendingChangeNames);
    pendingChangeNames.clear();
    try {
      // Single combined event
      window.dispatchEvent(new CustomEvent(DATA_CHANGE_EVENT, { detail: { collection: '*', collections: names } }));
    } catch {}
  }, 120);
}
export function onDataChange(cb: (collection: string) => void): () => void {
  const h = (e: Event) => {
    try {
      const det = (e as CustomEvent).detail || {};
      const names: string[] = det.collections || [det.collection || '*'];
      // Fire once per unique collection (component decides what to do)
      const seen = new Set<string>();
      for (const n of names) {
        if (seen.has(n)) continue;
        seen.add(n);
        cb(n);
      }
    } catch {}
  };
  window.addEventListener(DATA_CHANGE_EVENT, h);
  return () => window.removeEventListener(DATA_CHANGE_EVENT, h);
}

// Pending snapshot buffer — batch local writes to avoid storm
const pendingSnapshotData = new Map<string, any[]>();
let snapshotFlushTimer: ReturnType<typeof setTimeout> | null = null;
// v1.2.4: dedupe map for self-heal re-pushes (order id -> local _updatedAt already pushed)
const repairedOrderPushes = new Map<string, number>();

// Order statuses that are FINAL (bill lifecycle closed). Once an order reaches
// any of these, we must NEVER let an older snapshot (running/hold/partial)
// resurrect it — even if timestamps disagree due to clock skew.
const ORDER_FINAL_STATUSES = new Set([
  'paid', 'void', 'cancelled', 'complimentary', 'credit_received', 'rejected',
]);
function isOrderFinal(o: any): boolean {
  return !!(o && typeof o.status === 'string' && ORDER_FINAL_STATUSES.has(o.status));
}

function scheduleSnapshotFlush() {
  if (snapshotFlushTimer) return;
  snapshotFlushTimer = setTimeout(() => {
    snapshotFlushTimer = null;
    if (pendingSnapshotData.size === 0) return;
    const d = loadData();
    for (const [name, remoteArr] of pendingSnapshotData) {
      // Conflict-aware merge: keep local item if its _updatedAt is newer than remote's.
      // For 'orders' specifically, ALSO honor a status-priority rule so a paid/closed
      // bill can never be resurrected into running/hold by a stale snapshot.
      const localArr: any[] = ((d as any)[name] || []) as any[];
      const localById = new Map(localArr.map(x => [x?.id, x]));
      const merged: any[] = [];
      const seen = new Set<string>();
      for (const remote of remoteArr) {
        const id = remote?.id;
        if (!id) {
          // v1.13.0 — a remote row with no embedded `id` used to be pushed
          // straight through, bypassing the `seen` set entirely. Such rows
          // (older builds, imports, console edits) could therefore never be
          // deduplicated and showed up as repeated cards in the menu. Keep
          // them — losing data would be worse — but collapse them on a
          // stable name key so one bad row stays ONE row.
          const key = String(remote?.name ?? '').trim().toLowerCase();
          if (key && seen.has(`name:${key}`)) continue;
          if (key) seen.add(`name:${key}`);
          merged.push(remote);
          continue;
        }
        if (seen.has(id)) continue;   // remote itself contained a duplicate
        seen.add(id);
        const local = localById.get(id);
        const lT = Number(local?._updatedAt || 0);
        const rT = Number(remote?._updatedAt || 0);

        // Orders: final status wins over non-final regardless of timestamp.
        if (name === 'orders') {
          const lFinal = isOrderFinal(local);
          const rFinal = isOrderFinal(remote);
          if (lFinal && !rFinal) {
            merged.push(local);
            // ===== v1.2.4 SELF-HEAL =====
            // Cloud still holds a stale running/hold copy of a bill this
            // device closed. Push our final version back ONCE so the cloud
            // (and every fresh login) converges to the closed bill instead
            // of "orders wapas aa jate hain" next morning.
            const localTs = Number(local?._updatedAt || 0);
            if (repairedOrderPushes.get(id) !== localTs) {
              repairedOrderPushes.set(id, localTs);
              try {
                console.warn('[sync-heal] re-pushing closed bill over stale cloud copy', id, local.status);
                void cloudSaveItem('orders', id, local);
              } catch {}
            }
            continue;
          }
          if (rFinal && !lFinal) { merged.push(remote); continue; }
        }
        merged.push(local && lT > rT ? local : remote);
      }
      // ===== v1.17.0 — DATA LOSS FIX =====
      // "Bills are printed successfully, but they completely disappear from
      //  the system and do not show up in the sales or transaction reports."
      //
      // This block preserves rows that exist locally but are absent from the
      // remote snapshot. It used to require `_updatedAt > 0`:
      //
      //     if (local?.id && !seen.has(local.id) && Number(local?._updatedAt || 0) > 0)
      //
      // Any row WITHOUT that stamp was silently dropped on the next snapshot —
      // permanently, because the merge result is written straight back to
      // local storage. Rows lacking `_updatedAt` are exactly the ones created
      // by older builds, imports, or console edits.
      //
      // The 14-day scoped orders listener made it far worse: orders older than
      // 14 days are never in `remoteArr`, so EVERY one of them takes this
      // path. One unstamped old bill = one bill deleted from the device, and
      // it vanishes from every report that reads local orders.
      //
      // A missing timestamp is not evidence that a row is junk. Keep the row
      // and stamp it, so it survives and merges correctly from now on.
      for (const local of localArr) {
        if (!local?.id || seen.has(local.id)) continue;
        if (!Number(local._updatedAt)) local._updatedAt = Date.now();
        merged.push(local);
      }
      // v1.13.0 — final guard. Whatever the inputs looked like, a collection
      // must never leave the merge holding two rows with the same id.
      (d as any)[name] = dedupeById(merged as any);
    }
    pendingSnapshotData.clear();
    saveLocal(d);
  }, 80);
}


// ============================================================
// SUPABASE REALTIME
// ============================================================
// Firestore had a listener per collection. On Supabase one channel carries
// every tenant table: each change tells us WHICH collection is stale, and we
// re-read just that one and merge it by _updatedAt. Re-reading (instead of
// applying the payload directly) keeps the row mapping in exactly one place
// and cannot resurrect a locally newer edit.
let sbRealtimeChannel: any = null;
let sbRealtimeGeneration = 0;
/** Reconnect attempts since the channel was last healthy (reset on SUBSCRIBED). */
let sbRealtimeRetry = 0;
/**
 * The generation whose channel is live or currently being built. Guards against
 * two callers each building a channel, WITHOUT blocking a rebuild that a real
 * stop() asked for — a stop bumps the generation, so the next start proceeds.
 */
let sbRealtimeStartedFor = -1;
/** Tears down the live channel using the client reference it was built with. */
let sbRealtimeDispose: (() => void) | null = null;
const SB_REALTIME_MAX_RETRY = 8;
const sbPendingReload = new Set<string>();
/** Sentinels in the reload set — not collections, so they cannot collide. */
const SETTINGS_RELOAD_KEY = '::settings';
const DOCS_RELOAD_KEY = '::module_documents';
let sbReloadTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Read the pending-op keys, or null when the durable queue could not be read.
 *
 * null is NOT "nothing is pending" — it is "I do not know", and every caller
 * must treat it as a reason to keep local rows rather than drop them.
 */
/**
 * The id the cloud keys a record under, which is not always the id this device
 * uses. Resolved lazily because supabaseStore is dynamically imported, and
 * cached because the merge calls it once per row.
 */
let _cloudIdFn: ((id: string) => string) | null = null;
async function loadCloudIdFn(): Promise<(id: string) => string> {
  if (_cloudIdFn) return _cloudIdFn;
  const { cloudId } = await import('./supabaseStore');
  _cloudIdFn = cloudId;
  return cloudId;
}

async function pendingOpKeys(): Promise<Set<string> | null> {
  try {
    const { whenDeferredQueueReady, getDeferredOps } = await import('./deferredSync');
    if (!(await whenDeferredQueueReady())) return null;
    return new Set(getDeferredOps().map(o => `${o.col}:${o.entityId}`));
  } catch { return null; }
}

async function sbReloadCollections(names: string[]) {
  const { sbLoadCollection } = await import('./supabaseStore');
  const d = loadData();
  const pendingIds = await pendingOpKeys();
  const cloudIdFor = await loadCloudIdFn();
  let touched = false;
  for (const name of names) {
    try {
      // includeDeleted — the merge needs the tombstones, not just the survivors.
      const rows = await sbLoadCollection(name, { includeDeleted: true });
      const localRows: any[] = ((d as any)[name] || []) as any[];
      // A read that succeeds but comes back completely empty for a collection
      // that has local rows is still treated as suspect (a mis-scoped tenant
      // returns zero rows without raising an error). Genuine deletions arrive
      // as tombstones inside `rows`, so this guard no longer blocks them.
      if (!rows.length && localRows.length) continue;
      const { rows: merged, requeue } = mergeCollection(name, rows, localRows, pendingIds, cloudIdFor);
      (d as any)[name] = merged;
      for (const id of requeue) enqueueDeferredOp(name, id, 'set');
      if (requeue.length) {
        console.warn(`[store] ${name}: ${requeue.length} local row(s) missing from the cloud — re-queued for upload`);
      }
      touched = true;
      emitDataChange(name);
    } catch (e) {
      console.warn(`[store] realtime reload ${name} failed`, e);
    }
  }
  if (touched) saveLocal(d);
}

/**
 * Settings changed on another device — branding, logo, restaurant name, tax
 * rules, module toggles. Never subscribed before, so a second till only ever
 * picked these up by being restarted.
 */
async function sbReloadSettings() {
  try {
    const { sbLoadSettings } = await import('./supabaseStore');
    const remote = await sbLoadSettings();
    if (!remote) return;
    const d = loadData();
    const localAt = Number((d.settings as any)?._updatedAt || 0);
    const remoteAt = Number((remote as any)._updatedAt || 0);
    // A local edit still waiting to upload must not be overwritten by the
    // older server copy it is about to replace.
    if (localAt > remoteAt) return;
    d.settings = { ...(d.settings as any), ...remote } as any;
    saveLocal(d);
    emitDataChange('settings');
  } catch (e) {
    console.warn('[store] settings realtime reload failed', e);
  }
}

export function stopSupabaseRealtime() {
  sbRealtimeGeneration += 1;
  const channel = sbRealtimeChannel;
  sbRealtimeChannel = null;
  if (!channel) return;
  // ===== v1.26.9 — unsubscribe() alone LEAKS the channel =====
  //
  // unsubscribe() leaves the channel object registered on the Supabase client.
  // The client dispatches every incoming change to EVERY registered channel
  // that matches the topic, so a leaked channel keeps a second, stale set of
  // postgres_changes bindings alive on the same socket. startRealtimeListeners
  // runs more than once during a normal boot, so a till ended up with two (or
  // more) subscriptions to the same 31 tables: every write reloaded every
  // collection twice, and the ids the server had handed the LIVE channel were
  // no longer the ones it was being sent.
  //
  // removeChannel() unsubscribes AND deregisters, which is what was meant.
  // Disposal is a closure captured when the channel was built, so stopping is
  // synchronous and needs no import of its own.
  const dispose = sbRealtimeDispose;
  sbRealtimeDispose = null;
  if (dispose) { try { dispose(); } catch {} return; }
  try { channel.unsubscribe(); } catch {}
}

export function startSupabaseRealtime() {
  if (typeof window === 'undefined') return;
  // Idempotent: startRealtimeListeners() runs from more than one place during
  // boot, and building a second channel for a tenant that already has a live
  // one is what produced the duplicate subscriptions above.
  if (sbRealtimeStartedFor === sbRealtimeGeneration) return;
  stopSupabaseRealtime();
  const generation = sbRealtimeGeneration;
  sbRealtimeStartedFor = generation;
  (async () => {
    try {
      const { sb, currentTenantId } = await import('./supabase');
      const { TABLE_FOR } = await import('./supabaseStore');
      const tenantId = currentTenantId();
      if (!tenantId) return;
      if (generation !== sbRealtimeGeneration) return;

      // table -> collection (first mapping wins; user_profiles is handled by
      // its own staff path and is deliberately not reloaded here)
      const colForTable = new Map<string, string>();
      for (const [col, table] of Object.entries(TABLE_FOR)) {
        if (table === 'user_profiles') continue;
        if (!colForTable.has(table)) colForTable.set(table, col);
      }

      const channel = sb().channel(`tenant:${tenantId}`);

      const scheduleReload = (col: string) => {
        sbPendingReload.add(col);
        if (sbReloadTimer) return;
        sbReloadTimer = setTimeout(() => {
          sbReloadTimer = null;
          const names = Array.from(sbPendingReload);
          sbPendingReload.clear();
          const wantsSettings = names.includes(SETTINGS_RELOAD_KEY);
          const wantsDocs = names.includes(DOCS_RELOAD_KEY);
          const cols = names.filter(n => n !== SETTINGS_RELOAD_KEY && n !== DOCS_RELOAD_KEY);
          if (cols.length) void sbReloadCollections(cols);
          if (wantsSettings) void sbReloadSettings();
          if (wantsDocs) {
            void import('./cloudDocs').then(m => m.hydrateCloudDocs()).catch(() => {});
          }
        }, 400);
      };

      for (const table of colForTable.keys()) {
        channel.on('postgres_changes',
          { event: '*', schema: 'public', table, filter: `tenant_id=eq.${tenantId}` },
          () => scheduleReload(colForTable.get(table)!));
      }

      // ===== v1.26.0 — the two tables nothing was listening to =====
      //
      // tenant_settings holds the restaurant name, the logo, every branding
      // and Admin Panel setting. module_documents holds the waiter and rider
      // rosters plus eighteen more modules (promotions, variations, wallet,
      // campaigns, delivery zones, daily wages, the blocked-customer list).
      //
      // Neither was in the subscription, so "Device A changes the logo, Device
      // B sees it" was never going to happen: B only picked those up by being
      // restarted, and the blocked-customer list — a fraud control — was
      // effectively per-device.
      channel.on('postgres_changes',
        { event: '*', schema: 'public', table: 'tenant_settings', filter: `tenant_id=eq.${tenantId}` },
        () => scheduleReload(SETTINGS_RELOAD_KEY));
      channel.on('postgres_changes',
        { event: '*', schema: 'public', table: 'module_documents', filter: `tenant_id=eq.${tenantId}` },
        () => {
          scheduleReload(DOCS_RELOAD_KEY);
          // waiters/riders live in module_documents but are ordinary store
          // collections, so they go through the normal collection reload too.
          scheduleReload('waiters');
          scheduleReload('riders');
        });
      if (generation !== sbRealtimeGeneration) {
        try { sb().removeChannel(channel); } catch {}
        return;
      }
      // ===== v1.26.9 — a realtime channel that fails must not fail SILENTLY =====
      //
      // subscribe() was called with no status callback, so every way this can
      // go wrong (CHANNEL_ERROR, TIMED_OUT, the socket dropping) ended with the
      // POS simply never receiving another change — no error, no retry, no way
      // for anyone to tell. That is indistinguishable from "sync is broken",
      // and it stays broken until the app is restarted.
      //
      // Now the status is reported, and a dead channel is rebuilt on a capped
      // backoff so a till that loses its websocket at 7pm is live again by
      // 7:01 instead of at the next restart.
      channel.subscribe((status: string, err?: unknown) => {
        if (generation !== sbRealtimeGeneration) return;
        if (status === 'SUBSCRIBED') {
          sbRealtimeRetry = 0;
          console.log('[store] realtime subscribed');
          return;
        }
        if (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT' && status !== 'CLOSED') return;
        console.warn(`[store] realtime ${status}`, err ?? '');
        if (sbRealtimeRetry >= SB_REALTIME_MAX_RETRY) return;
        const wait = Math.min(30000, 1000 * 2 ** sbRealtimeRetry);
        sbRealtimeRetry += 1;
        setTimeout(() => {
          if (generation !== sbRealtimeGeneration) return;
          stopSupabaseRealtime();      // clears the dead channel so start() rebuilds
          startSupabaseRealtime();
        }, wait);
      });
      sbRealtimeChannel = channel;
      sbRealtimeDispose = () => {
        try { sb().removeChannel(channel); }
        catch { try { channel.unsubscribe(); } catch {} }
      };
    } catch (e) {
      console.warn('[store] Supabase realtime failed', e);
    }
  })();
}

export function startRealtimeListeners() {
  if (!useCloudStore()) return;
  stopRealtimeListeners();
  const isPublicRoute = typeof window !== 'undefined' && /^#\/(order|track|rider-portal|order-taker)(\/|\?|$)/.test(window.location.hash || '');
  // v1.18.0 — Firestore listeners must NOT attach when the tenant is on
  // Supabase. They would burn read quota against a project this restaurant no
  // longer uses, and could overwrite Supabase data with a stale Firestore
  // snapshot. Supabase realtime is handled separately in supabaseSync.ts.
  if (useSupabaseBackend()) {
    console.log('[store] Supabase backend active — starting Supabase realtime');
    startSupabaseRealtime();
    return;
  }

  const liveCollections: ArrayKey[] = isPublicRoute
    ? ['orders', 'menuItems', 'categories', 'branches', 'riders', 'users', 'deals']
    : ['orders', 'menuItems', 'categories', 'inventory', 'customers', 'riders', 'tables', 'floors', 'kitchens', 'waiters', 'branches', 'promoCodes', 'paymentAccounts', 'users', 'deals'];

  // v1.7.0 — SCOPED ORDERS LISTENER (enterprise cost / RAM fix)
  // The `orders` collection grows without bound: a Singapore restaurant
  // doing 200 orders/day accumulates 60k orders/year. The old code
  // listened to the WHOLE collection on every device, at every startup —
  // so each device downloaded and cached the entire history, and every
  // change re-emitted a full snapshot.
  //
  // Fix: the live listener only watches the recent window (default 14 days).
  // Reports/history pages call `loadHistoricalOrders()` on demand.
  // Effect on Firestore reads at 10 devices × 1 year of history:
  //     old: 10 × 60,000 = 600,000 reads per cold start
  //     new: 10 × ~2,800 =  28,000 reads per cold start (~95% saving)
  const RECENT_ORDERS_DAYS = 14;
  const recentSince = Date.now() - RECENT_ORDERS_DAYS * 24 * 60 * 60 * 1000;

  for (const name of liveCollections) {
    const c = colRef(name); if (!c) continue;
    // Only the orders collection is time-scoped — every other collection
    // (menu, tables, users, ...) is small and bounded, so a full listener
    // is fine and matches existing behaviour exactly.
    const source: any = name === 'orders'
      ? fsQuery(c, fsWhere('_updatedAt', '>=', recentSince))
      : c;
    const unsub = onSnapshot(source, (snap) => {
      const arr: any[] = [];
      snap.forEach(d => arr.push(d.data()));
      pendingSnapshotData.set(name, arr);
      scheduleSnapshotFlush();
      emitDataChange(name);
    }, (err) => reportCloudError(`listen ${name}`, err));
    activeUnsubs.push(unsub);
  }
  // settings live
  const sr = settingsRef();
  if (sr) {
    const unsubS = onSnapshot(sr, (snap) => {
      if (!snap.exists()) return;
      const d = loadData();
      (d as any).settings = snap.data();
      saveLocal(d);
      emitDataChange('settings');
    }, (err) => reportCloudError('listen settings', err));
    activeUnsubs.push(unsubS);
  }
}


// One-time migration: agar pehle wala `data/all` doc mojood hai, usko collections mein bikhair do
async function migrateLegacyDocIfPresent() {
  const base = tenantBase(); if (!base) return;
  const legacyRef = doc(fbDb(), base[0], base[1], 'data', 'all');
  try {
    const snap = await getDoc(legacyRef);
    if (!snap.exists()) return;
    const old = snap.data() as AppData;
    console.log('[firestore] Migrating legacy data/all → collections…');
    const batch = writeBatch(fbDb());
    for (const col of ARRAY_COLLECTIONS) {
      const arr = ((old as any)[col] || []) as any[];
      for (const item of arr) {
        if (!item?.id) continue;
        batch.set(doc(colRef(col)!, item.id), item);
      }
    }
    if (old.settings) batch.set(settingsRef()!, old.settings as any);
    if (typeof old.orderCounter === 'number') batch.set(counterRef()!, { value: old.orderCounter });
    await batch.commit();
    await deleteDoc(legacyRef);
    console.log('[firestore] Legacy migration complete.');
  } catch (e) {
    console.warn('[firestore] legacy migration skipped:', e);
  }
}

/**
 * Which collections a cloud load actually reached. Anything not listed is
 * UNKNOWN — never "empty" — and callers must leave the local copy alone.
 * Carried on the snapshot itself so it cannot drift from the data it describes.
 */
const LOADED_KEY = '_loadedCollections';
/** Marks that the settings document itself was genuinely read. */
const SETTINGS_LOADED_KEY = '::settingsLoaded';

function markLoadedCollections(data: any, names: readonly string[]): void {
  Object.defineProperty(data, LOADED_KEY, {
    value: new Set(names), enumerable: false, configurable: true, writable: true,
  });
}

function loadedCollections(data: any): Set<string> | null {
  const v = data?.[LOADED_KEY];
  return v instanceof Set ? v : null;
}

/** Drop tombstoned rows from a snapshot that is about to be used as-is. */
function stripTombstones(data: any): void {
  for (const name of ARRAY_COLLECTIONS) {
    const arr = data?.[name];
    if (Array.isArray(arr) && arr.some((r: any) => r?.deleted)) {
      data[name] = arr.filter((r: any) => !r?.deleted);
    }
  }
}

async function cloudLoadAll(names: readonly ArrayKey[] = ARRAY_COLLECTIONS): Promise<AppData> {
  // ===== v1.18.0 — Supabase read path =====
  // Returns only the collections that loaded successfully. A collection whose
  // read FAILED is deliberately absent from the result rather than present and
  // empty: an empty array here would look like a legitimately empty collection
  // and overwrite good local data. That exact confusion is what made employee
  // records appear to vanish on Firebase.
  if (useSupabaseBackend()) {
    const { sbLoadAll, sbLoadSettings } = await import('./supabaseStore');
    const [cols, settings] = await Promise.all([
      // Tombstones come down too: the caller's merge needs to know which rows
      // were DELETED elsewhere, not merely which ones survived.
      sbLoadAll(names as readonly string[], { includeDeleted: true }),
      sbLoadSettings(),
    ]);
    // Start from an empty runtime shape. Starting from seedData() here made a
    // failed/empty cloud read look like genuine demo menu data and could then
    // overwrite a restaurant's local import on refresh.
    const out: any = emptyRuntimeData();
    for (const [k, v] of Object.entries(cols)) out[k] = v;
    if (settings) out.settings = { ...(out.settings || {}), ...settings };

    // ===== v1.26.0 — "absent" and "empty" were the same thing, and should not be =====
    //
    // sbLoadAll deliberately OMITS a collection whose read failed, so the
    // caller can keep its local copy. But this function then started from
    // emptyRuntimeData(), which pre-fills every collection with [] — so the
    // omission was immediately overwritten by an empty array that looks
    // exactly like a successful read of an empty collection.
    //
    // The caller could not tell the difference, so a single timed-out request
    // for `menuItems` presented as "the restaurant has no menu", and the merge
    // below then dropped the local rows to match. One flaky response could
    // empty a till.
    //
    // Recording what actually loaded is the whole fix: a collection not in
    // this set means UNKNOWN, and unknown must never overwrite anything.
    // 'settings' rides the same "did this actually load?" set. It is not an
    // ArrayKey, so it can never collide with a collection name.
    markLoadedCollections(out, [...Object.keys(cols), ...(settings ? [SETTINGS_LOADED_KEY] : [])]);

    // ===== v1.19.9 — THE CRASH THAT BROKE THE WHOLE POS =====
    // The Firebase path calls ensureFields() before returning; this one did
    // not. So on Supabase the app received an object with NO settings and no
    // defaults, and getSettings() blew up on `s.urduFont` with
    // "Cannot read properties of undefined (reading 'urduFont')".
    //
    // Everything downstream depends on getSettings(): the sidebar reads the
    // optional-module flags from it, so when it threw, the entire module list
    // vanished and the software looked empty. One missing call, whole app.
    ensureFields(out);
    return out as AppData;
  }

  // Pehle migrate (idempotent) — one-time guarded so we don't hit getDoc('data/all')
  // on every session. Marker stored per-tenant in localDb.settings.
  // Original migrateLegacyDocIfPresent() preserved intact as the fallback path.
  try {
    const tid = getTenantId();
    const markerId = tid ? `legacy_migration_done_${tid}` : 'legacy_migration_done_anon';
    let done = false;
    try {
      const rows = await localDb.getRows('settings');
      done = !!rows.find((r: any) => r.id === markerId);
    } catch {}
    if (!done) {
      await migrateLegacyDocIfPresent();
      try {
        await localDb.putRow('settings', { id: markerId, at: Date.now() } as any);
      } catch {}
    }
  } catch (e) {
    // If the guard itself fails for any reason, fall back to original behavior
    // so we never skip a needed migration silently.
    try { await migrateLegacyDocIfPresent(); } catch {}
  }

  const out: any = {};
  let loadedOrdersFromCloud = false;
  const loadErrors: Array<{ name: string; error: any }> = [];
  const publicRoute = isPublicStoreRoute();
  // Parallel load all collections. Public customer/staff links can only read
  // menu-facing collections, so keep permitted data instead of failing the
  // whole store when private collections (users/orders/etc.) are blocked.
  // Cache-first reads: getDocs() returns instantly from local Firestore persistence
  // when available, otherwise hits the server. Realtime listeners (startRealtimeListeners)
  // immediately refresh stale data afterwards. This avoids the long "Cloud data sync slow"
  // safety lock that getDocsFromServer caused on cold starts behind slow networks.
  await Promise.all(names.map(async (name) => {
    const c = colRef(name)!;
    try {
      const snap = await getDocs(c);
      const arr: any[] = [];
      snap.forEach(d => arr.push(d.data()));
      // ===== v1.17.0 — "Employee records have completely disappeared" =====
      // An error is handled below, but a read that SUCCEEDS and comes back
      // empty was trusted blindly. It is not always trustworthy: a read that
      // hits the Firestore quota ceiling, or races a rules refresh, can
      // resolve empty for a collection that is perfectly intact on the
      // server. That empty array then replaced the local cache and was
      // saved — so staff, menu or inventory simply "vanished" from the app
      // while the real data sat safe in Firestore, invisible.
      //
      // A collection going from "has rows" to "has none" in one read is
      // never normal. Deleting every employee is a deliberate act; it does
      // not happen between two logins. Keep what we have and say so loudly.
      // The realtime listener will deliver a genuine deletion soon enough.
      const existingRows = (cachedData as any)?.[name];
      if (arr.length === 0 && Array.isArray(existingRows) && existingRows.length > 0) {
        out[name] = existingRows;
        console.warn(
          `[store] ${name}: cloud returned 0 rows but ${existingRows.length} exist locally — ` +
          'keeping local copy (suspected quota or permission issue, NOT a deletion)',
        );
        return;
      }
      out[name] = arr;
      if (name === 'orders') loadedOrdersFromCloud = true;
    } catch (e: any) {
      const existing = (cachedData as any)?.[name];
      out[name] = Array.isArray(existing) ? existing : [];
      if (!publicRoute || e?.code !== 'permission-denied') {
        loadErrors.push({ name, error: e });
        console.warn(`[store] load ${name} skipped:`, e);
      }
    }
  }));

  // Don't fail the whole init when some collections were slow/unreachable —
  // realtime listeners + background refresh will fill them in shortly.
  if (loadErrors.length && !publicRoute) {
    console.warn('[store] partial cloud load; continuing with cache for:', loadErrors.map(x => x.name));
  }

  // Settings (cache-first)
  let sSnap;
  try { sSnap = await getDoc(settingsRef()!); }
  catch (e: any) { console.warn('[store] settings load skipped:', e); sSnap = null as any; }
  out.settings = sSnap && sSnap.exists() ? sSnap.data() : ((cachedData as any)?.settings || (seedData() as any).settings);

  // Counter (cache-first)
  let cSnap;
  try { cSnap = await getDoc(counterRef()!); }
  catch (e: any) { console.warn('[store] counter load skipped:', e); cSnap = null as any; }
  // ===== v1.18.0 — the second way order numbers went out of sequence =====
  // This used to take the cloud value outright. A device that billed while
  // offline holds a LOCAL counter ahead of the server's, so the next login
  // pulled it backwards and it began re-issuing numbers that already exist
  // on printed bills.
  //
  // Highest wins, always — matching the write path, which now only moves the
  // shared counter forward. A gap in numbering is harmless; two bills with
  // the same number are not.
  const cloudCounter = Number(cSnap && cSnap.exists() ? (cSnap.data() as any).value : 0) || 0;
  const localCounter = Number((cachedData as any)?.orderCounter) || 0;
  out.orderCounter = Math.max(cloudCounter, localCounter);
  if (localCounter > cloudCounter) {
    console.warn(`[store] local counter ${localCounter} ahead of cloud ${cloudCounter} — keeping local, pushing up`);
    void cloudSaveCounter(localCounter);
  }

  ensureFields(out);
  markLoadedCollections(out, [
    ...(names as readonly string[]),
    ...(sSnap && sSnap.exists() ? [SETTINGS_LOADED_KEY] : []),
  ]);
  if (loadedOrdersFromCloud) backfillPublicOrderLookups(out.orders || []);
  return out as AppData;
}

// First-time seed: write seed data into collections
async function cloudSeedIfEmpty(): Promise<AppData> {
  const seed = seedData() as AppData;
  ensureFields(seed);
  const batch = writeBatch(fbDb());
  for (const col of ARRAY_COLLECTIONS) {
    const arr = ((seed as any)[col] || []) as any[];
    for (const item of arr) {
      if (!item?.id) continue;
      batch.set(doc(colRef(col)!, item.id), item);
    }
  }
  batch.set(settingsRef()!, seed.settings as any);
  batch.set(counterRef()!, { value: seed.orderCounter || 0 });
  await batch.commit();
  return seed;
}

// ============================================================
// initStore
// ============================================================
export async function initStore(): Promise<void> {
  // v1.9.0 — start the PRA background driver once per init, AFTER the cache
  // is about to be hydrated. Starting it at module scope would call
  // loadData() too early and freeze an empty cache.
  try { startPraQueue(); } catch { /* PRA is optional; never block boot */ }
  // Reset in-memory cache — previous tenant's data must not leak across login switches.
  cachedData = null;
  let hasLocalCache = false;
  // STEP 1 — Instant: hydrate from per-tenant localStorage cache so UI can render immediately
  try {
    const raw = localStorage.getItem(STORAGE_KEY());
    if (raw) {
      const parsed = JSON.parse(raw);
      const stamped = parsed?._tenantId;
      // Only adopt if it belongs to the current tenant (or legacy unstamped blob).
      if (!stamped || stamped === getTenantId()) {
        ensureFields(parsed);
        stampTenant(parsed);
        if (useFirestore() && isEmptySeedLike(parsed)) {
          // Old buggy builds could save empty/default data after a sync timeout.
          // Never trust that as the restaurant cache; force a real cloud load.
          localStorage.removeItem(STORAGE_KEY());
        } else {
          cachedData = parsed;
          hasLocalCache = true;
        }
      }
    }
  } catch {}

  // ===== v1.28.4 — clear the seed rows a cloud till should never have carried =====
  //
  // emptyRuntimeData() used to hand every cloud tenant the eight default
  // account categories ('ac1'..'ac8'). Their cloud primary key is derived from
  // the local id alone, so all restaurants derived the SAME eight uuids and
  // every restaurant but the first was upserting onto rows it does not own —
  // refused by RLS, six times each, then dead-lettered as "⚠ Stuck (8)".
  //
  // The shipping side is fixed above and the real defaults are now created
  // per-tenant by the server. A till that already has the rows cached and the
  // eight failures parked would keep re-queueing them, so they are retired
  // here: once per restaurant, only the rows the seed itself shipped, and only
  // while they are still untouched.
  if (useCloudStore()) {
    try {
      const { cleanupShippedSeedRows } = await import('./seedRowCleanup');
      // Called even with no local cache: the dead-lettered ops live in
      // IndexedDB and outlive the cache, so a till whose localStorage was
      // cleared is still carrying the eight failures.
      const cleaned = await cleanupShippedSeedRows(cachedData ?? {}, getTenantId());
      if (cleaned) {
        if (cachedData) saveLocal(cachedData);
        console.log('[store] retired shipped seed rows', cleaned);
      }
    } catch (e) {
      console.warn('[store] seed row cleanup skipped', e);
    }
  }

  if (useCloudStore()) {
    if (hasLocalCache) {
      refreshCloudStoreInBackground();
      return;
    }
    try {
      // PROGRESSIVE STARTUP: only the small critical set gates readiness.
      let data = await timeout(cloudLoadAll(CRITICAL_COLLECTIONS), STORE_INIT_TIMEOUT_MS);
      for (const k of HEAVY_COLLECTIONS) (data as any)[k] = (data as any)[k] ?? [];
      // Fresh-tenant seeding: critical set empty AND settings seed-like AND
      // (cheap limit(1) probe) genuinely no orders — never seed over a real tenant.
      const criticalEmpty = CRITICAL_COLLECTIONS.every(k => ((data as any)[k] || []).length === 0)
                      && isEmptySeedLike(data);
      if (criticalEmpty && !useSupabaseBackend()) {
        let hasOrders = false;
        try {
          const probe = await getDocs(fsQuery(colRef('orders')!, fsLimit(1)));
          hasOrders = !probe.empty;
        } catch {}
        if (!hasOrders) {
          console.log('[firestore] Fresh tenant — seeding default data');
          data = await cloudSeedIfEmpty();
        }
      }
      // One-time migration: legacy localStorage deals → Firestore-synced deals collection.
      try {
        if ((!(data as any).deals || (data as any).deals.length === 0)) {
          const legacy = localStorage.getItem('dt-deals');
          if (legacy) {
            const arr = JSON.parse(legacy);
            if (Array.isArray(arr) && arr.length) {
              (data as any).deals = arr;
              for (const dl of arr) { if (dl?.id) cloudSaveItem('deals' as any, dl.id, dl); }
              console.log('[store] migrated', arr.length, 'legacy deals to cloud');
            }
          }
        }
      } catch {}
      stripTombstones(data);
      stampTenant(data);
      cachedData = data;
      // NOTE: localStorage cache is intentionally NOT written yet — heavy
      // collections (orders/ledger/...) are still loading. Persisting a
      // partial snapshot could look like data loss on the next boot.
      // loadHeavyCollectionsInBackground() persists the full snapshot.
      try { startRealtimeListeners(); } catch (e) { console.warn('[store] realtime listeners failed', e); }
      runWhenIdle(() => { void loadHeavyCollectionsInBackground(); });
      return;
    } catch (e) {
      // ===== v1.2.4 OFFLINE LOGIN FIX =====
      // Pehle: cloud na mile to app HAMESHA lock. Nateeja — internet band
      // hone par restaurant login hi nahi kar pata tha (offline system kaam
      // nahi karta). Ab: agar is device par ISI tenant ka valid cache mojood
      // hai (menu/settings ke sath), to us se offline chalao — data delete
      // nahi hota, aur net aate hi listeners sab sync kar dete hain.
      // Lock sirf tab lagta hai jab cache bhi khali ho (warna khali/default
      // data se asli data overwrite hone ka khatra hai).
      try {
        const raw = localStorage.getItem(STORAGE_KEY());
        if (raw) {
          const parsed = JSON.parse(raw);
          const tid = getTenantId();
          const stamped = parsed?._tenantId;
          const cacheUsable = (!stamped || stamped === tid)
            && (((parsed?.menuItems || []).length > 0) || ((parsed?.orders || []).length > 0));
          if (cacheUsable) {
            console.warn('[store] cloud unreachable — running OFFLINE from local cache');
            ensureFields(parsed);
            cachedData = parsed;
            try { toast.warning('Offline mode — using local data; it will sync as soon as you are back online'); } catch {}
            refreshCloudStoreInBackground();
            try { startRealtimeListeners(); } catch {}
            return;
          }
        }
      } catch (cacheErr) {
        console.warn('[store] offline cache fallback failed', cacheErr);
      }
      console.error('[store] Firestore init failed and no usable cache; keeping app locked:', e);
      refreshCloudStoreInBackground();
      throw e;
    }
  }


  // Electron file
  if (isElectron()) {
    try {
      const raw = await dbRead();
      if (raw) {
        cachedData = JSON.parse(raw);
        ensureFields(cachedData!);
        stampTenant(cachedData!);
        try { localStorage.setItem(STORAGE_KEY(), JSON.stringify(cachedData)); } catch {}
        return;
      }
    } catch (e) { console.error('[store] Electron read failed:', e); }
  }

  // localStorage
  try {
    const raw = localStorage.getItem(STORAGE_KEY());
    if (raw) {
      cachedData = JSON.parse(raw);
      ensureFields(cachedData!);
      stampTenant(cachedData!);
      return;
    }
  } catch (e) { console.error('[store] localStorage read failed:', e); }

  // Seed only in local/non-cloud mode. Cloud tenants must never see default data
  // when sync is slow, because it looks like restaurant data was deleted.
  if (useCloudStore()) {
    cachedData = emptyRuntimeData();
    return;
  }
  cachedData = seedData() as AppData;
  ensureFields(cachedData);
  stampTenant(cachedData);
  saveLocal(cachedData);
}

function loadData(): AppData {
  // Tenant guard — if cached data belongs to a different tenant, drop it.
  if (cachedData && !tenantGuardOk()) {
    console.warn('[store] dropping stale cache from previous tenant');
    cachedData = null;
  }
  if (cachedData) return cachedData;
  try {
    const raw = localStorage.getItem(STORAGE_KEY());
    if (raw) {
      const parsed = JSON.parse(raw);
      // Only adopt cached blob if its stamp matches current tenant (or unstamped legacy + we have a tenant).
      const stamped = parsed?._tenantId;
      const tid = getTenantId();
      if (!stamped || stamped === tid) {
        cachedData = parsed;
        ensureFields(cachedData!);
        stampTenant(cachedData!);
        return cachedData!;
      }
    }
  } catch (e) { console.error(e); }
  cachedData = useCloudStore() ? emptyRuntimeData() : seedData() as AppData;
  ensureFields(cachedData);
  stampTenant(cachedData);
  if (!useCloudStore()) saveLocal(cachedData);
  return cachedData;
}

// Local cache only — used after every mutation
function saveLocal(data: AppData) {
  stampTenant(data);
  cachedData = data;
  // Keep cashier interactions synchronous in memory, but batch the expensive
  // whole-cache serialization. pagehide/visibilitychange above forces a final
  // flush, so fast billing does not trade away offline durability.
  if (localPersistTimer) clearTimeout(localPersistTimer);
  localPersistTimer = setTimeout(flushLocalPersistence, 120);
  if (isElectron()) {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      dbWrite(JSON.stringify(data, null, 2)).catch(err => console.error('[electron] write fail:', err));
    }, 200);
  }
}

/**
 * v1.7.0 — Cryptographically-strong ID generation.
 *
 * The previous implementation combined Date.now() with Math.random(), giving
 * roughly 60 bits of entropy. For a small restaurant that is fine, but the
 * software now targets multi-tenant deployments where the same second may
 * see thousands of writes across devices — and financial-audit reviewers
 * (Singapore IRAS, EU EN 16931) expect RFC 4122-grade IDs on money records.
 *
 * `crypto.randomUUID()` provides 122 bits of entropy from the OS CSPRNG and
 * is available in every modern browser, Node ≥14, and Electron. The Math
 * fallback preserves compatibility with legacy contexts (extremely rare).
 */
export function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // getRandomValues fallback — still cryptographic, but hand-formatted.
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40; // version 4
      b[8] = (b[8] & 0x3f) | 0x80; // variant 1
      const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    }
  } catch { /* fall through */ }
  // Last-resort legacy path — retained only so unit tests in environments
  // without crypto don't crash. Never reached in production.
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function upsert<T extends { id: string }>(arr: T[], item: T) {
  const i = arr.findIndex(x => x.id === item.id);
  if (i >= 0) arr[i] = item; else arr.push(item);
}

// ============================================================
// Per-entity save helpers — local + cloud
// ============================================================
function saveEntity<T extends { id: string }>(col: ArrayKey, item: T) {
  const d = loadData();
  const arr = (d as any)[col] as T[];
  // Stamp _updatedAt LOCALLY too (same value used for cloud write) so that
  // conflict-aware snapshot merge doesn't demote a fresh local paid/closed
  // order to an older remote running/hold state. Also stamp orders with a
  // status priority guard used by scheduleSnapshotFlush().
  const stamped: any = { ...(item as any), _updatedAt: Date.now() };
  upsert(arr, stamped);
  saveLocal(d);
  if (useCloudStore()) {
    // v1.5.4: offline ya manual sync mode me cloud write DEFER hota hai —
    // billing kabhi network ka intezaar nahi karti. Net aane par (ya "Sync
    // Now" par) flush wohi guarded cloudSaveItem raste se hota hai.
    if (shouldDeferCloudWrite()) enqueueDeferredOp(col, stamped.id, 'set');
    else cloudSaveItem(col, stamped.id, stamped);
  }
}

function deleteEntity(col: ArrayKey, id: string) {
  const d = loadData();
  (d as any)[col] = ((d as any)[col] as any[]).filter(x => x.id !== id);
  saveLocal(d);
  if (useCloudStore()) {
    if (shouldDeferCloudWrite()) enqueueDeferredOp(col, id, 'delete');
    else cloudDeleteItem(col, id);
  }
}

// ============ Categories ============
export function getCategories(): Category[] {
  // v1.9.1 — honour sortOrder. The field existed on the type from early on
  // but nothing ever sorted by it, so categories appeared in insertion order
  // and there was no way to arrange the menu. Legacy rows with no sortOrder
  // fall to the end, then sort by name, so existing menus stay predictable.
  // v1.13.0 — same total ordering + dedupe as getMenuItems(); see the
  // comment there for why the id tiebreak matters.
  return normalizeForDisplay(
    loadData().categories.filter(c => !(c as any).deleted) as any,
  ) as Category[];
}
export function getDeletedCategories(): Category[] {
  return loadData().categories.filter(c => (c as any).deleted);
}
export function saveCategory(cat: Category) { saveEntity('categories', cat); }
/** Soft delete — moves to Recycle Bin. Restorable. */
export function deleteCategory(id: string) {
  const d = loadData();
  const c = d.categories.find(x => x.id === id);
  if (!c) return;
  saveEntity('categories', { ...c, deleted: true, deletedAt: Date.now() } as any);
}
export function restoreCategory(id: string) {
  const d = loadData();
  const c = d.categories.find(x => x.id === id);
  if (!c) return;
  const { deleted, deletedAt, ...clean } = c as any;
  saveEntity('categories', clean as Category);
}
export function permanentDeleteCategory(id: string) { deleteEntity('categories', id); }

// ============ Menu ============
export function getMenuItems(): MenuItem[] {
  // v1.13.0 — deduplicate, then order by a TOTAL comparator.
  //
  // The v1.9.1 version tie-broke on name only. Two rows sharing a name
  // compared equal, so their relative order was left to the source array,
  // which is rebuilt on every Firestore snapshot flush — the list visibly
  // reshuffled at random moments (typically right after a tap, because a
  // tap writes an order and a flush follows). Adding `id` as the final
  // tiebreak makes the order deterministic no matter what the source does.
  //
  // dedupeById is a second line of defence: a row that somehow exists
  // twice can no longer render as two cards.
  return normalizeForDisplay(
    loadData().menuItems.filter(m => !(m as any).deleted) as any,
  ) as MenuItem[];
}
export function getDeletedMenuItems(): MenuItem[] {
  return loadData().menuItems.filter(m => (m as any).deleted);
}
export function saveMenuItem(item: MenuItem) { saveEntity('menuItems', item); }
/** Soft delete — moves to Recycle Bin. Restorable. */
export function deleteMenuItem(id: string) {
  const d = loadData();
  const m = d.menuItems.find(x => x.id === id);
  if (!m) return;
  saveEntity('menuItems', { ...m, deleted: true, deletedAt: Date.now() } as any);
}
export function restoreMenuItem(id: string) {
  const d = loadData();
  const m = d.menuItems.find(x => x.id === id);
  if (!m) return;
  const { deleted, deletedAt, ...clean } = m as any;
  saveEntity('menuItems', clean as MenuItem);
}
export function permanentDeleteMenuItem(id: string) { deleteEntity('menuItems', id); }

// ============ Orders ============
export function getOrders(): Order[] {
  // Old or partially migrated cloud rows may not contain the nested arrays
  // expected by report/KDS/reprint screens. Normalize at the store boundary so
  // one malformed row cannot crash whichever module happens to render it.
  return loadData().orders.map(order => ({
    ...order,
    items: Array.isArray(order.items) ? order.items : [],
    payments: Array.isArray(order.payments) ? order.payments : [],
  }));
}

/**
 * v1.7.0 — Load orders older than the live-listener window on demand.
 *
 * The realtime listener only watches the last 14 days (see startRealtimeListeners).
 * When a Reports page needs historical data, it calls this. Results are
 * merged into the local cache so subsequent reads are instant AND the merged
 * items participate in the same conflict-aware snapshot flow.
 *
 * @param fromMs  inclusive lower bound (epoch ms)
 * @param toMs    inclusive upper bound (epoch ms); defaults to the listener window
 * @returns the newly-loaded orders (already merged into the local cache)
 */
export async function loadHistoricalOrders(fromMs: number, toMs?: number): Promise<Order[]> {
  // ===== v1.27.1 — this had no Supabase branch at all =====
  //
  // It went straight to the local-only path on a Supabase restaurant, so the
  // Admin sales and audit reports could never pull a closed day back from the
  // cloud — they only ever showed what happened to be on THIS device. Combined
  // with Day Close deleting the rows, that is how a restaurant's history came
  // to exist in one browser's localStorage and nowhere else.
  //
  // Archived bills are the whole point of the query, so they are included here
  // and nowhere else: the till's own loads still leave them out.
  if (useSupabaseBackend() && useCloudStore()) {
    try {
      const { sbLoadCollection } = await import('./supabaseStore');
      const rows = await sbLoadCollection('orders', { includeArchived: true }) as Order[];
      const inRange = rows.filter(o => {
        const t = new Date((o as any).paidAt || o.createdAt).getTime();
        return Number.isFinite(t) && t >= fromMs && (!toMs || t <= toMs);
      });

      // Merge without letting a stale local copy demote a settled bill — the
      // same rule the live snapshot merger uses.
      const d = loadData();
      const byId = new Map(d.orders.map(o => [o.id, o]));
      for (const remote of inRange) {
        const local = byId.get(remote.id);
        if (!local) continue;   // archived bills stay OUT of the till's cache
        const lFinal = isOrderFinal(local);
        const rFinal = isOrderFinal(remote);
        if (lFinal && !rFinal) continue;
        if (rFinal && !lFinal) { byId.set(remote.id, remote); continue; }
        if (Number((remote as any)._updatedAt || 0) >= Number((local as any)._updatedAt || 0)) {
          byId.set(remote.id, remote);
        }
      }
      d.orders = Array.from(byId.values());
      saveLocal(d);
      emitDataChange('orders');
      return inRange;
    } catch (e) {
      console.warn('[store] loadHistoricalOrders (supabase) failed', e);
      // Fall through to the local copy rather than showing an empty report.
      return getOrders().filter(o => {
        const t = new Date(o.createdAt).getTime();
        return t >= fromMs && (!toMs || t <= toMs);
      });
    }
  }

  if (!useFirestore()) {
    // Local-only mode — nothing extra to load; return whatever matches locally.
    return getOrders().filter(o => {
      const t = new Date(o.createdAt).getTime();
      return t >= fromMs && (!toMs || t <= toMs);
    });
  }
  const c = colRef('orders');
  if (!c) return [];
  try {
    const constraints: any[] = [fsWhere('_updatedAt', '>=', fromMs)];
    if (toMs) constraints.push(fsWhere('_updatedAt', '<=', toMs));
    const snap = await getDocs(fsQuery(c, ...constraints));
    const loaded: Order[] = [];
    snap.forEach(d => loaded.push(d.data() as Order));

    // Merge into local cache with the same status/timestamp rules the live
    // snapshot merger uses — so a paid bill on cloud never gets demoted by
    // a stale local copy.
    const d = loadData();
    const byId = new Map(d.orders.map(o => [o.id, o]));
    for (const remote of loaded) {
      const local = byId.get(remote.id);
      if (!local) { byId.set(remote.id, remote); continue; }
      const lFinal = isOrderFinal(local);
      const rFinal = isOrderFinal(remote);
      if (lFinal && !rFinal) continue;
      if (rFinal && !lFinal) { byId.set(remote.id, remote); continue; }
      const lT = Number((local as any)._updatedAt || 0);
      const rT = Number((remote as any)._updatedAt || 0);
      if (rT >= lT) byId.set(remote.id, remote);
    }
    d.orders = Array.from(byId.values());
    saveLocal(d);
    emitDataChange('orders');
    return loaded;
  } catch (e) {
    console.warn('[store] loadHistoricalOrders failed', e);
    return [];
  }
}


/**
 * Pull latest orders from Firestore into local cache. Used by the
 * Online Portal / Delivery Board / New-Order Notifier so website orders
 * appear without a full page reload.
 */
export async function refreshOrdersFromCloud(): Promise<Order[]> {
  if (!useCloudStore()) return getOrders();
  try {
      if (useSupabaseBackend()) {
        const { sbLoadCollection } = await import('./supabaseStore');
        const arr = await sbLoadCollection('orders') as Order[];
        const d = loadData();
        const localById = new Map(d.orders.map(o => [o.id, o]));
        for (const remote of arr) {
          const local = localById.get(remote.id) as any;
          if (!local || Number((remote as any)._updatedAt || 0) >= Number(local?._updatedAt || 0)) {
            localById.set(remote.id, remote);
          }
        }
        d.orders = Array.from(localById.values());
        saveLocal(d);
        return d.orders;
      }
      const c = colRef('orders'); if (!c) return getOrders();
    const snap = await getDocsFromServer(c);
    const arr: Order[] = [];
    snap.forEach(d => arr.push(d.data() as Order));
    const d = loadData();
    // Conflict-aware merge — DO NOT blow away local orders.
    // A stale server snapshot must never resurrect a locally-paid/closed
    // bill back into running/hold. Same rule as scheduleSnapshotFlush().
    const localArr: any[] = (d.orders as any[]) || [];
    const localById = new Map(localArr.map(x => [x?.id, x]));
    const merged: Order[] = [];
    const seen = new Set<string>();
    for (const remote of arr) {
      const id = (remote as any)?.id;
      if (!id) { merged.push(remote); continue; }
      seen.add(id);
      const local: any = localById.get(id);
      const lT = Number(local?._updatedAt || 0);
      const rT = Number((remote as any)?._updatedAt || 0);
      const lFinal = isOrderFinal(local);
      const rFinal = isOrderFinal(remote);
      if (lFinal && !rFinal) {
        console.warn('[refreshOrdersFromCloud] kept local FINAL over stale remote', id, local?.status, '<- remote', (remote as any)?.status);
        merged.push(local as Order); continue;
      }
      if (rFinal && !lFinal) { merged.push(remote); continue; }
      merged.push((local && lT > rT ? local : remote) as Order);
    }
    for (const local of localArr) {
      if (local?.id && !seen.has(local.id) && Number(local?._updatedAt || 0) > 0) {
        merged.push(local as Order);
      }
    }
    d.orders = merged;
    saveLocal(d);
    backfillPublicOrderLookups(arr);
    return merged;
  } catch (e) {
    console.error('[store] refreshOrdersFromCloud failed', e);
    return getOrders();
  }
}

/** Public-safe single order fetch. Firestore rules allow GET for tracking, but not LIST. */
export async function getOrderFromCloudById(orderId: string): Promise<Order | null> {
  if (!orderId) return null;
  if (useSupabaseBackend()) {
    try {
      const tenantId = getTenantId();
      if (!tenantId) return null;
      const { trackPublicOrder } = await import('./publicPortal.functions');
      const { normalizeTrackedOrder } = await import('./trackedOrder');
      // NEVER cast the RPC result straight to Order: it is an RPC, so it does
      // not pass through rowFromDb, and a missing `items` array took the whole
      // tracker down with "Cannot read properties of undefined".
      return normalizeTrackedOrder(await trackPublicOrder({ data: {
        tenantId, orderId, orderNumber: null, phoneLast4: null, tableLabel: null,
      } }));
    } catch (e) {
      console.error('[store] public order id lookup failed', e);
      return getOrders().find(o => o.id === orderId) || null;
    }
  }
  if (!useFirestore()) return getOrders().find(o => o.id === orderId) || null;
  try {
    const c = colRef('orders'); if (!c) return null;
    const snap = await getDocFromServer(doc(c, orderId));
    if (!snap.exists()) return null;
    const order = snap.data() as Order;
    const d = loadData();
    upsert(d.orders, order);
    saveLocal(d);
    return order;
  } catch (e) {
    console.error('[store] getOrderFromCloudById failed', e);
    return getOrders().find(o => o.id === orderId) || null;
  }
}

export async function getOrderFromCloudByLookup(orderNo: string | number, phoneLast4?: string, tableLabel?: string): Promise<Order | null> {
  if (!orderNo) return null;
  if (useSupabaseBackend()) {
    try {
      const tenantId = getTenantId();
      const orderNumber = Number(orderNo);
      if (!tenantId || !Number.isInteger(orderNumber) || orderNumber <= 0) return null;
      const { normalizeTrackedOrder } = await import('./trackedOrder');
      const args = {
        p_tenant: tenantId,
        p_order_id: null,
        p_order_number: orderNumber,
        p_phone_last4: phoneLast4 || null,
        p_table_label: tableLabel || null,
      };

      // ===== v1.52.0 — the RPC direct, not through the website's origin =====
      //
      // REPORTED: order #1046 exists — paid, Rs 410, phone ending 3354 — and
      // the tracking page said "Order not found". Called directly the RPC
      // returns it in full, so the lookup was never the problem: it went
      // through a TanStack server function on the WEBSITE'S origin, which the
      // packaged app is not serving and which throws on any deployment without
      // a service-role key. The catch below turned that into "not found", and
      // the customer was sent to re-check a number that was correct.
      //
      // Direct first (public_track_order is anon-granted since v1.52.0, with
      // its own guard unchanged), server function second — so nothing that
      // works today stops working.
      const { sb } = await import('./supabase');
      const { data, error } = await sb().rpc('public_track_order' as never, args as never);
      if (!error) return normalizeTrackedOrder(data as any);

      const { trackPublicOrder } = await import('./publicPortal.functions');
      return normalizeTrackedOrder(await trackPublicOrder({ data: {
        tenantId, orderId: null, orderNumber,
        phoneLast4: phoneLast4 || null, tableLabel: tableLabel || null,
      } }));
    } catch (e) {
      // Rethrow so the caller can tell "this order does not exist" from "we
      // could not ask". Reporting both as "not found" is what made a working
      // order look like a wrong number.
      console.error('[store] public order number lookup failed', e);
      throw e instanceof Error ? e : new Error(String(e));
    }
  }
  if (!useFirestore()) return null;
  try {
    const lookupRef = publicOrderLookupRef(orderNo); if (!lookupRef) return null;
    const snap = await getDocFromServer(lookupRef);
    if (!snap.exists()) return null;
    const lookup: any = snap.data();
    const expectedPhone = (phoneLast4 || '').replace(/\D/g, '').slice(-4);
    const expectedTable = (tableLabel || '').trim().toLowerCase();
    if (expectedPhone && lookup.phoneLast4 && lookup.phoneLast4 !== expectedPhone) return null;
    if (expectedTable && lookup.tableLabel && !String(lookup.tableLabel).toLowerCase().includes(expectedTable)) return null;
    return await getOrderFromCloudById(lookup.orderId);
  } catch (e) {
    console.error('[store] getOrderFromCloudByLookup failed', e);
    return null;
  }
}
export function getNextOrderNumber(): number {
  const d = loadData();
  d.orderCounter += 1;
  saveLocal(d);
  if (useFirestore()) cloudSaveCounter(d.orderCounter);
  return d.orderCounter;
}
/** Peek the next order number without incrementing (for previews). */
export function peekNextOrderNumber(): number {
  const d = loadData();
  return (d.orderCounter || 0) + 1;
}
/**
 * Atomic order number — uses Firestore transaction so multiple devices/tabs
 * never get the same number. Falls back to local counter if offline.
 */
export async function getNextOrderNumberAsync(): Promise<number> {
  // ===== Cloud backend: the SERVER owns the sequence =====
  // Every till asking one atomic counter is the only way "#42 twice" and
  // "numbers jumping around" both disappear. It races a short timeout, so
  // billing never waits on the network; offline the local counter is used and
  // the number is corrected during sync if it clashes.
  if (useSupabaseBackend()) {
    try {
      const { allocateServerOrderNumber } = await import('./orderNumbers');
      const n = await allocateServerOrderNumber();
      if (n) {
        const d = loadData();
        d.orderCounter = Math.max(d.orderCounter || 0, n);
        saveLocal(d);
        return n;
      }
    } catch { /* fall through to the local counter */ }
    return getNextOrderNumber();
  }
  if (!useFirestore()) return getNextOrderNumber();
  const r = counterRef();

  if (!r) return getNextOrderNumber();
  // ===== v1.5.4 BILLING SPEED FIX =====
  // Ye function har bill par cloud TRANSACTION karta tha (server read +
  // write) aur billing us ka INTEZAAR karti thi — slow net par har order
  // kai second stuck, offline par SDK retry me phansa rehta. "Order create
  // karte hi sync shuru ho jata hai aur kaam ruk jata hai" ki asal wajah
  // yehi thi. Ab:
  //   • Offline ho to seedha LOCAL counter — koi network call hi nahi.
  //   • Online ho to cloud transaction sirf 1.5s tak race karta hai; der
  //     ho to LOCAL counter foran number de deta hai aur billing chalti
  //     rahegi. Transaction background me poora ho kar counter ko aage
  //     reconcile kar deta hai (Math.max merge duplicate nahi banne deta).
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return getNextOrderNumber();
  }
  const cloudAttempt = (async (): Promise<number | null> => {
    try {
      const next = await runTransaction(fbDb(), async (tx) => {
        const snap = await tx.get(r);
        const cur = snap.exists() ? ((snap.data() as any).value || 0) : 0;
        const nv = cur + 1;
        tx.set(r, { value: nv });
        return nv;
      });
      const d = loadData();
      d.orderCounter = Math.max(d.orderCounter, next);
      saveLocal(d);
      return next;
    } catch (e) {
      console.warn('[store] atomic counter failed, fallback to local', e);
      return null;
    }
  })();
  const winner = await Promise.race<number | null>([
    cloudAttempt,
    new Promise<null>((res) => setTimeout(() => res(null), 1500)),
  ]);
  if (winner !== null) return winner;
  // Cloud was too slow — bill NOW with the local counter; the in-flight
  // transaction (if it eventually succeeds) only raises the shared counter,
  // and the Math.max merge above keeps this device consistent.
  console.warn('[store] counter cloud slow — billing with local number');
  return getNextOrderNumber();
}
export function saveOrder(order: Order, options: { cloud?: boolean } = {}) {
  // Stamp current branch automatically if not set
  if (!order.branchId) {
    const bid = getCurrentBranchId();
    if (bid) order.branchId = bid;
  }
  const prev = loadData().orders.find(o => o.id === order.id);

  // ===== Bill lifecycle guard =====
  // Once a bill reaches a FINAL status (paid/void/cancelled/complimentary/
  // credit_received/rejected) it must NEVER be flipped back to running/hold/
  // partial by a stale save (double-click, offline replay, another device).
  // Block the save and return the previous (closed) order untouched.
  if (prev && ORDER_FINAL_STATUSES.has(prev.status as string)
      && !ORDER_FINAL_STATUSES.has(order.status as string)) {
    console.warn('[saveOrder] blocked resurrection of closed order', order.id, prev.status, '->', order.status);
    return;
  }
  // Duplicate payment guard: if already paid, don't re-run payment side-effects.
  if (prev?.status === 'paid' && order.status === 'paid') {
    console.log('[saveOrder] duplicate paid save ignored (metadata merge only)', { orderId: order.id, orderNumber: order.orderNumber });
    // still allow harmless metadata edits (notes, reprint) — merge but skip stock/customer re-increment
    saveEntity('orders', { ...prev, ...order, status: 'paid' } as Order);
    return;
  }

  const justPaid = order.status === 'paid' && prev?.status !== 'paid';
  const wasCounted = prev && (prev.status === 'paid' || prev.status === 'credit_received');
  const isCounted = order.status === 'paid' || order.status === 'credit_received';

  // ===== Full bill-lifecycle stamps on transition to a final status =====
  // Ensures Running/Hold pages never see this bill again after refresh or
  // multi-device sync — see also the status-priority merge rule.
  if (justPaid || (!prev && order.status === 'paid')) {
    const nowIso = new Date().toISOString();
    const uid = (typeof localStorage !== 'undefined' && localStorage.getItem('pos-user-id')) || undefined;
    const uname = getCurrentUserName();
    order.paidAt = order.paidAt || nowIso;
    (order as any).closedAt = (order as any).closedAt || nowIso;
    (order as any).updatedAt = nowIso;
    (order as any).paidBy = (order as any).paidBy || uname || uid;
    (order as any).closedBy = (order as any).closedBy || uname || uid;
    (order as any).updatedBy = uname || uid;
    (order as any).isRunning = false;
    (order as any).isHold = false;
    (order as any).isActive = false;
    (order as any).paymentStatus = 'paid';
    (order as any).syncStatus = 'synced';
    console.log('[saveOrder] PAID transition', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      oldStatus: prev?.status,
      newStatus: 'paid',
      paidAt: order.paidAt,
      amountPaid: order.amountPaid,
      grandTotal: order.grandTotal,
    });
  }
  if ((order.status === 'void' || order.status === 'cancelled' || order.status === 'complimentary') && prev?.status !== order.status) {
    const nowIso = new Date().toISOString();
    (order as any).closedAt = (order as any).closedAt || nowIso;
    (order as any).isRunning = false;
    (order as any).isHold = false;
    (order as any).isActive = false;
    (order as any).paymentStatus = order.status === 'complimentary' ? 'complimentary' : 'unpaid';
  }
  if (order.status === 'running' || order.status === 'partial') {
    (order as any).isRunning = true;
    (order as any).isHold = false;
    (order as any).isActive = true;
    (order as any).paymentStatus = order.status === 'partial' ? 'partial' : 'unpaid';
  } else if (order.status === 'hold') {
    (order as any).isRunning = false;
    (order as any).isHold = true;
    (order as any).isActive = true;
    (order as any).paymentStatus = 'unpaid';
  }

  // ===== Append-only edit history (auto-diff) =====
  try {
    const newLogs: import('./types').OrderEditLog[] = [];
    if (!prev) {
      newLogs.push(makeEditLog('CREATE', { newValue: `Order #${order.orderNumber}` }));
      for (const it of order.items || []) {
        newLogs.push(makeEditLog('ADD', { itemId: it.id, itemName: it.name, newValue: it.quantity }));
      }
    } else {
      newLogs.push(...diffItemEdits(prev.items, order.items));
      newLogs.push(...diffOrderMeta(prev, order));
    }
    if (newLogs.length) {
      order.editLogs = [...(order.editLogs || prev?.editLogs || []), ...newLogs];
    } else if (!order.editLogs && prev?.editLogs) {
      order.editLogs = prev.editLogs;
    }
  } catch (e) { console.warn('[edit-log] failed', e); }

  if (options.cloud === false) {
    const d = loadData();
    upsert(d.orders, { ...order, _updatedAt: Date.now() } as Order);
    saveLocal(d);
    emitDataChange('orders');
  } else {
    saveEntity('orders', order);
  }
  if (useFirestore()) cloudSaveOrderLookup(order);
  // ===== v1.9.0 PRA EIMS =====
  // Fiscalise the sale. enqueuePraInvoice is synchronous, non-throwing and
  // returns immediately — the actual submission happens in the background,
  // so billing NEVER waits for the fiscal device. It no-ops entirely when
  // the restaurant has not enabled PRA.
  try { enqueuePraInvoice(order); } catch (e) { console.warn('[pra] enqueue skipped', e); }
  if (justPaid) {
    try { deductStockForOrder(order); } catch (e) { console.error('[recipe] deduction failed', e); }
    // ===== v1.15.1 — "After Day Close the Shift Report shows 0 orders" =====
    // Archive at the moment of settlement, not only during Day Close. Day
    // Close removes orders from the live store, and a Day Close run on
    // ANOTHER device removes them from this one too (via sync) — in which
    // case this device's archive would never have been written and its
    // reports would show nothing for that day, forever.
    try { archiveOrders([order]); } catch (e) { console.warn('[archive] skipped', e); }
  }
  // Customer profile sync — pass a flag so totals only increment on the FIRST transition into a counted state.
  if (order.customer || order.creditCustomerPhone) {
    const shouldIncrement = isCounted && !wasCounted;
    try { upsertCustomerFromOrder(order, shouldIncrement); } catch (e) { console.error('[customer] upsert failed', e); }
  }
}

export function deleteOrder(id: string) { deleteEntity('orders', id); }

// ============ Refunds (v1.15.0) ============
export function getRefunds(): Refund[] {
  return (loadData() as any).refunds || [];
}
export function getRefundsForOrder(orderId: string): Refund[] {
  return getRefunds().filter(r => r.orderId === orderId);
}

/**
 * Record a refund against a completed sale.
 *
 * The original order is NOT voided — the sale genuinely happened and must
 * stay in the day's figures. The refund is its own event, so reports can
 * show gross sales and refunds separately, exactly as the client's Shift
 * Report sample does.
 */
export function createRefund(orderId: string, req: RefundRequest):
  { ok: boolean; refund?: Refund; errors?: string[] } {
  const order = loadData().orders.find(o => o.id === orderId);
  if (!order) return { ok: false, errors: ['Order not found'] };

  const prior = getRefundsForOrder(orderId);
  const check = buildRefund(order, prior, req);
  if (!check.ok || !check.preview) return { ok: false, errors: check.errors };

  const refund: Refund = {
    ...check.preview,
    id: genId(),
    orderId: order.id,
    orderNumber: order.orderNumber,
    at: new Date().toISOString(),
    deviceId: getDeviceId() || 'unknown',
  };
  saveEntity('refunds' as any, refund as any);

  // Stamp cumulative totals on the order so bill lookups and receipts can
  // show the refunded state without re-scanning the refunds collection.
  const allRefunds = [...prior, refund];
  const refundedTotal = allRefunds.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const refundedQty = allRefunds.reduce(
    (s, r) => s + (r.lines || []).reduce((n, l) => n + l.quantity, 0), 0,
  );
  saveEntity('orders', {
    ...order,
    refundedAmount: Math.round(refundedTotal * 100) / 100,
    refundedQty,
  } as any);

  // Put the goods back on the shelf when the operator asked for it.
  if (req.restock) {
    try {
      const menuItems = (loadData() as any).menuItems || [];
      for (const line of refund.lines) {
        const mi = menuItems.find((m: any) => m.id === line.menuItemId);
        if (!mi?.inventoryItemId) continue;
        const perUnit = Number(mi.stockPerUnit) > 0 ? Number(mi.stockPerUnit) : 1;
        // v1.26.0 — restock is an IN movement with a POSITIVE quantity.
        // (The old call passed a negative qty with type 'in', which added a
        // negative number and silently reduced stock on every refund.)
        // The movement id makes a replayed refund a no-op.
        adjustStock(
          mi.inventoryItemId,
          perUnit * line.quantity,
          'in',
          `Refund • Order #${order.orderNumber} • ${line.name}`,
          {
            movementId: movementIdFor('refund', refund.id, mi.inventoryItemId, line.menuItemId),
            refType: 'refund', refId: refund.id,
          },
        );

      }
    } catch (e) { console.warn('[refund] restock failed', e); }
  }

  return { ok: true, refund };
}

// ============ Shifts / Cash drawer (v1.11.0) ============
export function getShifts(): Shift[] {
  return (loadData() as any).shifts || [];
}
export function saveShift(shift: Shift) { saveEntity('shifts' as any, shift as any); }

/** The currently open shift on THIS device, if any. */
export function getOpenShift(): Shift | undefined {
  const dev = getDeviceId();
  return getShifts().find(s => s.status === 'open' && s.deviceId === dev);
}

/**
 * Open a shift. Refuses if one is already open on this device — two open
 * shifts on one drawer would make the cash reconciliation meaningless.
 */
export function openShift(input: {
  startingCash: number; staffName: string; staffId?: string; staffEmail?: string;
}): { ok: boolean; shift?: Shift; error?: string } {
  if (getOpenShift()) return { ok: false, error: 'A shift is already open on this device' };
  const shift: Shift = {
    id: genId(),
    deviceId: getDeviceId() || 'unknown',
    staffId: input.staffId,
    staffName: input.staffName || 'Staff',
    staffEmail: input.staffEmail,
    openedAt: new Date().toISOString(),
    startingCash: Math.max(0, Number(input.startingCash) || 0),
    payIns: [],
    payOuts: [],
    status: 'open',
  };
  saveShift(shift);
  return { ok: true, shift };
}

/** Close the open shift with the physically counted cash. */
export function closeShift(actualEndingCash: number, notes?: string):
  { ok: boolean; shift?: Shift; error?: string } {
  const open = getOpenShift();
  if (!open) return { ok: false, error: 'No shift is open' };
  const closed: Shift = {
    ...open,
    closedAt: new Date().toISOString(),
    actualEndingCash: Math.max(0, Number(actualEndingCash) || 0),
    status: 'closed',
    notes,
  };
  saveShift(closed);
  return { ok: true, shift: closed };
}

/** Record cash added to (payIn) or removed from (payOut) the drawer. */
export function addCashMovement(kind: 'payIn' | 'payOut', amount: number, reason: string):
  { ok: boolean; error?: string } {
  const open = getOpenShift();
  if (!open) return { ok: false, error: 'Open a shift first' };
  const amt = Number(amount) || 0;
  if (amt <= 0) return { ok: false, error: 'Amount must be greater than 0' };
  const movement = {
    id: genId(),
    at: new Date().toISOString(),
    amount: Math.abs(amt),
    reason: reason || (kind === 'payIn' ? 'Cash in' : 'Cash out'),
    by: getCurrentUserName() || 'staff',
  };
  const next: Shift = kind === 'payIn'
    ? { ...open, payIns: [...(open.payIns || []), movement] }
    : { ...open, payOuts: [...(open.payOuts || []), movement] };
  saveShift(next);
  return { ok: true };
}

/**
 * v1.6.0 — Payment correction (feedback #2 item 5).
 * "Customer ne card se diya lekin cashier ne cash select kar diya" — method
 * badalta hai, PAISA NAHI: amounts, status, totals sab waise ke waise.
 * Har correction ka audit trail order par hamesha ke liye rehta hai
 * (kisne, kab, kis se kis par) taake cash reconciliation par sawal na uthe.
 */
export function correctOrderPayment(
  orderId: string,
  to: { method: string; accountId?: string; accountName?: string },
  by: string,
): { ok: boolean; error?: string } {
  const d = loadData();
  const o = d.orders.find(x => x.id === orderId);
  if (!o) return { ok: false, error: 'Order not found' };
  if (!['paid', 'partial', 'credit_received'].includes(o.status)) {
    return { ok: false, error: 'Only a paid or partial bill can have its payment corrected' };
  }
  const entry = {
    at: new Date().toISOString(),
    by: by || 'unknown',
    fromMethod: o.paymentMethod,
    fromAccountName: o.paymentAccountName,
    toMethod: to.method,
    toAccountId: to.accountId,
    toAccountName: to.accountName,
  };
  const corrected: Order = {
    ...o,
    paymentMethod: to.method as any,
    paymentAccountId: to.accountId,
    paymentAccountName: to.accountName,
    // Re-label existing payment entries too so settlement reports move the
    // money to the right column — amounts untouched.
    payments: (o.payments || []).map(p => ({
      ...p,
      method: to.method as any,
      ...(to.accountName ? { accountName: to.accountName } : {}),
    })),
    paymentCorrections: [...(o.paymentCorrections || []), entry],
  };
  saveEntity('orders', corrected as any);
  return { ok: true };
}

/**
 * v1.5.1 — Reset the order-number counter (Day Close option).
 *
 * THE BUG THIS FIXES: Day Close's "Reset order number" checkbox did
 * nothing at all. It tried to remove localStorage keys named
 * `dt-pos-order-number*` / `*order-counter*` — but no such keys exist.
 * The counter actually lives in the app data blob (`orderCounter`) and,
 * when Firestore is configured, in a dedicated counter document. So order
 * numbers kept climbing after every close.
 *
 * Awaited on purpose: like the bulk delete, a fire-and-forget cloud write
 * here would let the old value sync back down and undo the reset.
 */
export async function resetOrderCounter(startAt = 0): Promise<boolean> {
  const value = Math.max(0, Math.floor(startAt) || 0);
  const d = loadData();
  d.orderCounter = value;
  saveLocal(d);
  flushLocalPersistence(); // Day Close must survive an instant reload
  // Supabase is the authority for bill numbers — reset it there too, or the
  // next order picks the old server number straight back up.
  if (useSupabaseBackend() && useCloudStore()) {
    try {
      const { sbResetOrderCounter } = await import('./supabaseStore');
      await sbResetOrderCounter(value);
      return true;
    } catch (e) {
      reportCloudError('reset counter', e);
      return false;
    }
  }
  if (!useFirestore()) return true;
  try {
    const r = counterRef();
    if (r) await setDoc(r, { value });
    return true;
  } catch (e) {
    reportCloudError('reset counter', e);
    return false;
  }
}

/**
 * v1.5.1 — Bulk delete for Day Close.
 *
 * THE BUG THIS FIXES: "day close par data zero nahi hota."
 * `deleteOrder()` fires its cloud delete WITHOUT awaiting it. Day Close
 * called it in a loop, so closing a busy day fired hundreds of concurrent,
 * unawaited deletes and then immediately showed "Day closed" — even though
 * the cloud deletes were still in flight. Any that failed (quota, offline,
 * transient network) left the order on the server, and the realtime
 * listener promptly restored it into the local cache. The orders "came
 * back", so the day never actually looked closed.
 *
 * This version:
 *   • deletes in Firestore batches (500 = the hard per-batch limit),
 *   • AWAITS every batch, so we know the true outcome,
 *   • only removes an order locally after the server confirms,
 *   • returns real counts so the caller can tell the admin the truth.
 *
 * Offline is treated as a failure on purpose: deleting locally while the
 * server still holds the orders is precisely what makes them reappear.
 */
/**
 * Close the day on these bills WITHOUT deleting them.
 *
 * ===== WHY THIS EXISTS =====
 * Day Close used to call deleteOrdersBulk() for paid bills. That tombstones the
 * row in the cloud, which syncs to every device, leaving the restaurant's
 * takings in exactly one place: `dt-pos-order-archive::<tenant>` in one
 * browser's localStorage — capped at 400 days and 20,000 orders, and HALVED
 * when the quota is hit. A new till, a reinstall or a cleared browser had no
 * sales history at all, and neither did the database.
 *
 * Archiving keeps the row in full on the server and only stops it loading into
 * the till. Operational reports start from zero for the new day; the Admin
 * sales and audit reports still see every bill.
 *
 * Same contract as deleteOrdersBulk: offline is a failure, and nothing is
 * cleared locally until the server confirms — otherwise the next sync brings it
 * straight back and the day never looks closed.
 */
export async function archiveOrdersBulk(
  ids: string[],
): Promise<{ archived: number; failed: number; offline: boolean; error?: string }> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return { archived: 0, failed: 0, offline: false };

  // Keep the device's own copy before anything moves, so a till that is the
  // only witness to today's trade still has it if the write fails.
  try {
    const { archiveOrders } = await import('./orderArchive');
    const byId = new Set(unique);
    archiveOrders(loadData().orders.filter(o => byId.has(o.id)));
  } catch { /* the server copy is the one that matters */ }

  if (useSupabaseBackend() && useCloudStore()) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { archived: 0, failed: unique.length, offline: true, error: 'Device offline' };
    }
    try {
      const { sbArchiveMany } = await import('./supabaseStore');
      const done = await sbArchiveMany('orders', unique);
      const gone = new Set(done);
      const d = loadData();
      d.orders = d.orders.filter(o => !gone.has(o.id));
      saveLocal(d);
      emitDataChange('orders');
      return { archived: done.length, failed: unique.length - done.length, offline: false };
    } catch (e: any) {
      reportCloudError('archive orders', e);
      return { archived: 0, failed: unique.length, offline: false, error: e?.message || String(e) };
    }
  }

  // No cloud configured: the local archive above IS the record, and nothing can
  // resurrect these rows, so clearing them locally is safe.
  const d = loadData();
  const idSet = new Set(unique);
  d.orders = d.orders.filter(o => !idSet.has(o.id));
  saveLocal(d);
  emitDataChange('orders');
  return { archived: unique.length, failed: 0, offline: false };
}

export async function deleteOrdersBulk(
  ids: string[],
): Promise<{ deleted: number; failed: number; offline: boolean; error?: string }> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return { deleted: 0, failed: 0, offline: false };

  // ===== Supabase backend =====
  // This branch did not exist, so on a Supabase restaurant Day Close fell
  // through to the "local only" path below: the till looked empty while
  // every bill was still live on the server, and the next sync brought them
  // all back. Now the SERVER clears first (soft delete, so the admin keeps
  // the closed day in history) and only confirmed ids leave the device.
  if (useSupabaseBackend() && useCloudStore()) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { deleted: 0, failed: unique.length, offline: true, error: 'Device offline' };
    }
    try {
      const { sbDeleteMany } = await import('./supabaseStore');
      const done = await sbDeleteMany('orders', unique);
      const gone = new Set(done);
      const d = loadData();
      d.orders = d.orders.filter(o => !gone.has(o.id));
      saveLocal(d);
      emitDataChange('orders');
      return { deleted: done.length, failed: unique.length - done.length, offline: false };
    } catch (e: any) {
      reportCloudError('bulk delete orders', e);
      return { deleted: 0, failed: unique.length, offline: false, error: e?.message || String(e) };
    }
  }

  // Local-only mode (no cloud configured): nothing can resurrect.
  if (!useFirestore()) {
    const d = loadData();
    const idSet = new Set(unique);
    d.orders = d.orders.filter(o => !idSet.has(o.id));
    saveLocal(d);
    emitDataChange('orders');
    return { deleted: unique.length, failed: 0, offline: false };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { deleted: 0, failed: unique.length, offline: true, error: 'Device offline' };
  }


  const c = colRef('orders');
  if (!c) return { deleted: 0, failed: unique.length, offline: false, error: 'No collection' };

  const confirmed: string[] = [];
  let failed = 0;
  let firstError: string | undefined;

  const CHUNK = 500; // Firestore hard limit per batch
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    pendingWrites++; emitSync();
    try {
      const batch = writeBatch(fbDb());
      for (const id of slice) batch.delete(doc(c, id));
      await batch.commit();
      confirmed.push(...slice);
    } catch (e: any) {
      failed += slice.length;
      if (!firstError) firstError = e?.message || String(e);
      reportCloudError('bulk delete orders', e);
    } finally {
      pendingWrites = Math.max(0, pendingWrites - 1); emitSync();
    }
  }

  // Only drop locally what the SERVER confirmed — anything else would be
  // resurrected by the realtime listener anyway.
  if (confirmed.length) {
    const d = loadData();
    const gone = new Set(confirmed);
    d.orders = d.orders.filter(o => !gone.has(o.id));
    saveLocal(d);
    emitDataChange('orders');
  }

  return { deleted: confirmed.length, failed, offline: false, error: firstError };
}

/** Log a reprint event on an order (receipt / KOT / token). */
export function logOrderReprint(orderId: string, type: 'receipt' | 'kot' | 'token' = 'receipt', by?: string) {
  const o = loadData().orders.find(x => x.id === orderId);
  if (!o) return;
  const entry = { at: new Date().toISOString(), by: by || getCurrentUserName(), type };
  o.reprintLog = [...(o.reprintLog || []), entry];
  o.reprintCount = (o.reprintCount || 0) + 1;
  // Also append to permanent editLogs so it shows in Audit History
  try {
    o.editLogs = [...(o.editLogs || []), makeEditLog('REPRINT', { newValue: type, reason: by })];
  } catch {}
  saveEntity('orders', o);
}

function getCurrentUserName(): string | undefined {
  try {
    const u = JSON.parse(localStorage.getItem('dt_pos_current_user') || 'null');
    return u?.name || u?.username;
  } catch { return undefined; }
}

/** Phase 3 — Kitchen workflow status setter */
export function setOrderKitchenStatus(orderId: string, status: 'pending' | 'accepted' | 'preparing' | 'ready' | 'served' | 'delivered') {
  const o = loadData().orders.find(x => x.id === orderId);
  if (!o) return;
  o.kitchenStatus = status;
  o.kitchenStatusAt = new Date().toISOString();
  // P2 fix: keep deliveryStatus in sync for delivery orders so Delivery Board / Rider App see it.
  if (status === 'ready' && (o.orderType as any) === 'delivery') {
    if (o.deliveryStatus !== 'delivered' && o.deliveryStatus !== 'cancelled') {
      o.deliveryStatus = 'ready';
      (o as any).readyAt = (o as any).readyAt || new Date().toISOString();
    }
  }
  // For dine-in/takeaway: stamp readyAt so TrackOrderPage + Pickup screens can react.
  if (status === 'ready' && !(o as any).readyAt) {
    (o as any).readyAt = new Date().toISOString();
  }
  saveEntity('orders', o);

  // ===== Auto-queue WhatsApp to customer on Ready =====
  // Works for dine-in, takeaway, AND delivery — silently adds to pending queue.
  if (status === 'ready' && o.customer?.phone) {
    try {
      // Lazy import to avoid circular deps
      import('./delivery').then(({ notifyCustomerStage }) => {
        notifyCustomerStage(o, 'ready');
      }).catch(() => {});
    } catch {}
  }
}

/**
 * Phase 3 — mark an order as Void / Complimentary / Cancelled with a required reason.
 * These statuses NEVER count as paid sales (see isPaidSale in src/lib/sales.ts).
 */
export function markOrderVoid(orderId: string, reason: string, by?: string) {
  const o = loadData().orders.find(x => x.id === orderId);
  if (!o) return;
  o.status = 'void';
  o.voidReason = reason;
  o.voidBy = by;
  o.voidedAt = new Date().toISOString();
  saveEntity('orders', o);
}
export function markOrderComplimentary(orderId: string, reason: string, by?: string) {
  const o = loadData().orders.find(x => x.id === orderId);
  if (!o) return;
  o.status = 'complimentary';
  o.complimentaryReason = reason;
  o.complimentaryBy = by;
  o.complimentaryAt = new Date().toISOString();
  saveEntity('orders', o);
}
export function markOrderCancelled(orderId: string, reason: string, by?: string) {
  const o = loadData().orders.find(x => x.id === orderId);
  if (!o) return;
  o.status = 'cancelled';
  o.cancelReason = reason;
  o.cancelledBy = by;
  o.cancelledAt = new Date().toISOString();
  saveEntity('orders', o);
}

// ============ Tables ============
/**
 * ===== v1.29.0 — the rows the staff portals fetch for themselves =====
 *
 * The Rider and Order Taker apps have no Supabase session, so the ordinary
 * cloud load returns them nothing but the public menu — no tables, no riders,
 * no orders. They read through the portal_* functions instead, and this is
 * where what comes back is adopted.
 *
 * Deliberately NOT saveEntity(): these rows came FROM the server, so pushing
 * them back would queue an upload per row on every login and hand the till a
 * backlog it did not create. saveLocal writes the cache and nothing else.
 *
 * A collection that was not fetched is left alone. "Not asked for" and "empty"
 * are different, and confusing them is what emptied tills in v1.26.2.
 */
export async function adoptPortalRows(input: {
  tables?: any[] | null;
  floors?: any[] | null;
  riders?: any[] | null;
  orders?: any[] | null;
  // v1.43.0 — the menu comes with the bootstrap now.
  //
  // REPORTED: "Order Taker mein menu properly show nahi hota. Kabhi menu nazar
  // nahi aata lekin order phir bhi place ho jata hai."
  //
  // The portal used to take everything EXCEPT the menu from portal_bootstrap,
  // and left the menu to initStore()'s ordinary cloud load — a different path
  // with different failure modes. When that half failed the screen still
  // worked, because the POS allows a manual line, so an order could be placed
  // against a menu that was never there. One source now, so it cannot
  // half-load.
  categories?: any[] | null;
  menuItems?: any[] | null;
}): Promise<void> {
  // Awaited rather than raced: a lazy import that has not resolved yet would
  // adopt raw Postgres column names on the first login of every session, and
  // the UI would show a table with no name until something else refreshed it.
  const { rowFromDb } = await import('./supabaseStore');

  const data = loadData();
  let touched = false;

  const adopt = (key: ArrayKey, rows: any[] | null | undefined, table?: string) => {
    if (!Array.isArray(rows)) return;
    (data as any)[key] = table
      ? rows.map(r => rowFromDb(r, table)).filter(r => !r?.deleted)
      : rows;
    touched = true;
  };

  adopt('tables', input.tables, 'dining_tables');
  adopt('floors', input.floors, 'floors');
  // portal_riders and portal_orders already return app-shaped records, so
  // there is nothing to translate.
  adopt('riders', input.riders);
  adopt('orders', input.orders);

  // Only when the server actually sent a menu. An empty array is a real answer
  // ("this restaurant has no items"); undefined means this bootstrap predates
  // v1.43.0, and wiping a cached menu over that would be worse than the bug.
  if (Array.isArray(input.categories)) adopt('categories', input.categories, 'categories');
  if (Array.isArray(input.menuItems))  adopt('menuItems',  input.menuItems,  'menu_items');

  if (!touched) return;
  saveLocal(data);
  emitDataChange('*');
}

export function getTables(): DiningTable[] { return loadData().tables; }
export function saveTable(table: DiningTable) { saveEntity('tables', table); }
export function deleteTable(id: string) { deleteEntity('tables', id); }

export function getFloors(): Floor[] {
  return (loadData().floors || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
}
export function saveFloor(f: Floor) { saveEntity('floors', f); }
export function deleteFloor(id: string) { deleteEntity('floors', id); }

export function getKitchens(): Kitchen[] {
  return (loadData().kitchens || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
}
export function saveKitchen(k: Kitchen) { saveEntity('kitchens', k); }
export function deleteKitchen(id: string) { deleteEntity('kitchens', id); }



// ============ Waiters ============
export function getWaiters(): Waiter[] { return loadData().waiters; }
export function saveWaiter(w: Waiter) { saveEntity('waiters', w); }
export function deleteWaiter(id: string) { deleteEntity('waiters', id); }

// ============ Riders ============
export function getRiders(): Rider[] { return loadData().riders; }
export function saveRider(r: Rider) { saveEntity('riders', r); }
export function deleteRider(id: string) { deleteEntity('riders', id); }

// ============ Users ============
export function getUsers(): User[] { return loadData().users; }
export function saveUser(u: User) { saveEntity('users', u); }

/**
 * v1.21.4 — cache a POS user in the LOCAL store only, never the cloud.
 *
 * Used right after a Supabase staff login. getCurrentUser() and the sidebar
 * both resolve the signed-in user by scanning the local `users` array; on
 * Supabase that array is empty, so the lookup failed and
 * visiblePagesForUser() returned [] — an empty sidebar with no error.
 *
 * Deliberately NOT saveUser(): that goes through saveEntity() and would push
 * the record to the cloud, duplicating a row that already exists in
 * `user_profiles` — and doing so with an empty password field, which could
 * later be mistaken for a real credential.
 */
export function saveUserLocal(u: User): void {
  try {
    const d = loadData();
    if (!Array.isArray(d.users)) d.users = [];
    const i = d.users.findIndex(x => x.id === u.id);
    if (i >= 0) d.users[i] = { ...d.users[i], ...u };
    else d.users.push(u);
    saveLocal(d);
    try {
      window.dispatchEvent(new CustomEvent(DATA_CHANGE_EVENT, {
        detail: { collection: 'users', collections: ['users'] },
      }));
    } catch { /* non-browser context */ }
  } catch (e) {
    console.error('[store] saveUserLocal failed', e);
  }
}
export function deleteUser(id: string) { deleteEntity('users', id); }

/** Currently logged-in POS user (resolved from localStorage 'pos-user-id'). */
export function getCurrentUser(): User | null {
  try {
    const id = localStorage.getItem('pos-user-id');
    if (!id) return null;
    return getUsers().find(u => u.id === id) || null;
  } catch { return null; }
}

/** True when the active user may freely switch branches (admin / manager). */
export function canSwitchBranch(): boolean {
  const u = getCurrentUser();
  if (!u) return true; // pre-login / super-admin context
  return u.role === 'admin' || u.role === 'manager';
}


// ============ Settings ============
export function getSettings(): RestaurantSettings {
  const s = loadData().settings;
  // v1.4.0: keep the currency module in sync with this restaurant's setting
  // so formatMoney() works anywhere without importing the store.
  try { setActiveCurrency(s?.currencyCode); } catch {}
  // v1.19.9 — `s` was dereferenced unguarded from here down. One undefined
  // settings object took the whole application with it, and the message named
  // a font rather than the real problem. Defensive now: a missing settings
  // object yields defaults instead of a white screen.
  const normalizedSettings = {
    ...(s || {}),
    // Older imported backups used `restaurantName`; normalize them so the
    // restaurant identity remains visible after import and cloud refresh.
    name: s?.name || (s as any)?.restaurantName || 'My Restaurant',
    currencyCode: s?.currencyCode || DEFAULT_CURRENCY,
    urduFont: s?.urduFont || 'none',
    marketingFooter: (s?.marketingFooter && s?.marketingFooter.trim()) ? s?.marketingFooter : 'DIGITAL TARGET SOFTWARE SOLUTIONS\nDeveloped By: Taimoor Younas\n📞 0345-1873354',
    paperSize: s?.paperSize || '80mm',
    receiptSizePreset: s?.receiptSizePreset || 'standard-80',
    receiptMode: s?.receiptMode || 'continuous',
    printerDriverType: s?.printerDriverType || 'escpos',
    disableExtraFeed: s?.disableExtraFeed !== false,
    autoCut: s?.autoCut !== false,
    cutMode: s?.cutMode || 'full',
    // v1.5.0: clamp the stored top margin on read too, so a device that
    // already has a runaway value is corrected without user action.
    receiptMarginTop: typeof s?.receiptMarginTop === 'number' ? Math.max(0, Math.min(10, s?.receiptMarginTop)) : 0,
    // v1.5.0 tax engine defaults — 'none' preserves existing behaviour.
    taxMode: s?.taxMode || 'none',
    taxPercent: typeof s?.taxPercent === 'number' ? s?.taxPercent : 0,
    taxOnServiceCharge: s?.taxOnServiceCharge !== false,
    taxLabel: s?.taxLabel || 'GST',
    roundGrandTotal: s?.roundGrandTotal === true,
    receiptMarginBottom: typeof s?.receiptMarginBottom === 'number' ? s?.receiptMarginBottom : 0,
    receiptMarginLeft: typeof s?.receiptMarginLeft === 'number' ? Math.max(3, s?.receiptMarginLeft) : 3,
    receiptMarginRight: typeof s?.receiptMarginRight === 'number' ? Math.max(3, s?.receiptMarginRight) : 3,
    receiptTrimMm: typeof s?.receiptTrimMm === 'number' ? s?.receiptTrimMm : 3,
    kitchenPreparingMinutes: s?.kitchenPreparingMinutes || 5,
    kitchenWarningMinutes: Math.max(s?.kitchenWarningMinutes || 10, s?.kitchenPreparingMinutes || 5),
    defaultPrepTimeMinutes: typeof s?.defaultPrepTimeMinutes === 'number' && s?.defaultPrepTimeMinutes > 0 ? s?.defaultPrepTimeMinutes : 15,
    autoReadyEnabled: s?.autoReadyEnabled !== false,
    menuGridColumns: s?.menuGridColumns || 6,
    categoryLayout: s?.categoryLayout || 'top',
    // Phase-1: Silent Print ON by default (Electron silent direct print).
    // User can explicitly disable in Settings → Printing.
    silentPrint: s?.silentPrint !== false,
    kotEnabled: s?.kotEnabled !== false,
    autoPrintKot: s?.autoPrintKot !== false,
    autoKitchenPrint: s?.autoKitchenPrint !== false,
    manualSendToKitchen: s?.manualSendToKitchen === true,
    kotFallbackToReceipt: s?.kotFallbackToReceipt !== false,
  } as RestaurantSettings;

  return {
    ...normalizedSettings,
    whatsappTemplates: getWhatsAppTemplates(normalizedSettings),
    defaultPaidWhatsAppTemplateId: normalizedSettings.defaultPaidWhatsAppTemplateId || 'paid-default',
    defaultDeliveryWhatsAppTemplateId: normalizedSettings.defaultDeliveryWhatsAppTemplateId || 'delivery-default',
  };
}
let settingsSyncTimer: any = null;
let settingsRevision = 0;

/**
 * Settings ride the same durable queue as every collection, under a reserved
 * pseudo-collection. One document, so one fixed id — repeated edits coalesce
 * onto it exactly as repeated edits of one menu item do.
 */
const SETTINGS_COL = 'settings';
const SETTINGS_ID = '__settings__';

/**
 * Stamp the local settings copy so the merge can compare it against the
 * server's `updated_at`. Without this, settings were the only collection with
 * no version at all and the cloud copy simply overwrote the local one — which
 * is how a branding change made offline reverted the moment the connection
 * came back.
 */
function stampSettings(s: RestaurantSettings): RestaurantSettings {
  return { ...(s as any), _updatedAt: Date.now() } as RestaurantSettings;
}

export function saveSettings(s: RestaurantSettings) {
  const d = loadData();
  const stamped = stampSettings(s);
  d.settings = stamped;
  settingsRevision += 1;
  saveLocal(d);
  emitDataChange('settings');
  // Debounce cloud writes — typing in Settings shouldn't hit the network per keystroke
  if (useCloudStore()) {
    if (settingsSyncTimer) clearTimeout(settingsSyncTimer);
    settingsSyncTimer = setTimeout(() => {
      settingsSyncTimer = null;
      // Offline or manual-sync mode: straight to the queue, same as billing.
      if (shouldDeferCloudWrite()) { enqueueDeferredOp(SETTINGS_COL, SETTINGS_ID, 'set'); return; }
      void cloudSaveSettings(stamped).catch(() => { /* queued + reported by cloudSaveSettings */ });
    }, 600);
  }
}

/**
 * Save restaurant identity/settings durably and wait for cloud confirmation.
 * Use this for the explicit Settings Save button so success is never reported
 * while only the browser copy exists.
 */
export async function saveSettingsNow(s: RestaurantSettings): Promise<void> {
  const d = loadData();
  const stamped = stampSettings(s);
  d.settings = stamped;
  settingsRevision += 1;
  saveLocal(d);
  emitDataChange('settings');
  flushLocalPersistence();
  if (settingsSyncTimer) {
    clearTimeout(settingsSyncTimer);
    settingsSyncTimer = null;
  }
  if (!useCloudStore()) throw new Error('Restaurant cloud session is not ready');
  // The caller reports success or failure to the operator, so this still
  // throws — but the write is on the queue first, so a reported failure means
  // "not uploaded YET", never "discarded".
  if (shouldDeferCloudWrite()) {
    enqueueDeferredOp(SETTINGS_COL, SETTINGS_ID, 'set');
    throw new Error('Saved on this device — it will upload as soon as you are back online');
  }
  await cloudSaveSettings(stamped);
}


// ============ Backup & Restore ============
/**
 * Records per cloud request when restoring a backup. Matches the deferred
 * queue's CHUNK_SIZE so both paths behave the same under load.
 */
const IMPORT_CHUNK_SIZE = 100;

export function exportData(): string { return JSON.stringify(loadData(), null, 2); }
export function importData(json: string) {
  const data = JSON.parse(json) as AppData;
  ensureFields(data);

  const current = loadData() as any;
  const d = data as any;

  // ---- 1) Never lock the operator out of their own app -------------------
  // A backup from another device/restaurant carries ITS staff list. Replacing
  // ours wholesale removes the currently signed-in user, getCurrentUser()
  // returns null, and every sidebar module disappears. Merge instead: import
  // wins on matching ids, local-only users survive, and the active user is
  // always kept.
  try {
    const localUsers: any[] = Array.isArray(current.users) ? current.users : [];
    const importedUsers: any[] = Array.isArray(d.users) ? d.users : [];
    const byId = new Map<string, any>();
    for (const u of localUsers) if (u?.id) byId.set(String(u.id), u);
    for (const u of importedUsers) if (u?.id) byId.set(String(u.id), u);
    const activeId = localStorage.getItem('pos-user-id');
    if (activeId) {
      const active = localUsers.find(u => String(u?.id) === activeId);
      if (active) byId.set(activeId, { ...(byId.get(activeId) || {}), ...active });
    }
    d.users = Array.from(byId.values());
  } catch { /* keep imported users as-is */ }

  // ---- 2) Optional modules must not vanish -------------------------------
  // Module visibility is driven by boolean flags on settings. An older backup
  // simply lacks the newer flags, so a straight overwrite silently turns those
  // modules off. OR the flags together: an enabled module stays enabled.
  if (d.settings) {
    try {
      const prev: any = current.settings || {};

      for (const f of OPTIONAL_FEATURES) {
        if (prev[f.key] === true) (d.settings as any)[f.key] = true;
      }
    } catch { /* flags stay as imported */ }
  }

  saveLocal(data);

  // ---- 3) Push everything to the CLOUD the session actually uses ---------
  // The old path wrote a Firestore batch, which does nothing on Supabase — the
  // import looked fine locally and was lost on the next device.
  if (useCloudStore()) {
    (async () => {
      let ok = 0, failed = 0;
      const stamp = Date.now();
      // ===== v1.28.2 — a restore is a bulk upload, not 6000 little ones =====
      //
      // This was one awaited cloudSaveItem per record. Restoring a real
      // restaurant's backup — 4000 orders, 2000 customers, 800 menu items —
      // meant ~7000 sequential HTTP requests on the main thread while the
      // operator stared at a screen that never finished. Chunked upserts turn
      // that into ~70 requests, and the yield between chunks keeps the till
      // usable while it runs.
      //
      // ARRAY_COLLECTIONS is already ordered parents-first, so uploading a
      // collection at a time preserves the foreign keys.
      const total = ARRAY_COLLECTIONS.reduce(
        (n, col) => n + (((data as any)[col] || []) as any[]).filter(x => x?.id).length, 0);
      let processed = 0;
      const emitProgress = () => {
        try {
          window.dispatchEvent(new CustomEvent('dt-import-progress', {
            detail: { processedCount: processed, totalCount: total },
          }));
        } catch { /* non-browser context */ }
      };
      emitProgress();

      const useSb = useSupabaseBackend();
      const { sbSaveMany } = useSb ? await import('./supabaseStore') : ({} as any);

      for (const col of ARRAY_COLLECTIONS) {
        const arr = (((data as any)[col] || []) as any[]).filter(x => x?.id);
        for (let i = 0; i < arr.length; i += IMPORT_CHUNK_SIZE) {
          const chunk = arr.slice(i, i + IMPORT_CHUNK_SIZE)
            .map(item => ({ id: String(item.id), data: { ...item, _updatedAt: stamp } }));
          if (useSb) {
            try {
              const res = await sbSaveMany(col, chunk);
              ok += res.saved.length;
              failed += res.failed.length;
              for (const f of res.failed) {
                console.warn(`[import] ${col}/${f.id} rejected — ${f.error}`);
              }
            } catch (e: any) {
              // A whole chunk failed. Log it, count it, and carry on: the rest
              // of the backup must still be restored.
              failed += chunk.length;
              console.warn(`[import] ${col} chunk of ${chunk.length} failed — ${e?.message || e}`);
            }
          } else {
            for (const it of chunk) {
              try { await cloudSaveItem(col, it.id, it.data); ok++; }
              catch { failed++; }
            }
          }
          processed += chunk.length;
          emitProgress();
          // Hand the main thread back so the UI can paint between chunks.
          await new Promise(r => setTimeout(r, 0));
        }
      }
      if (data.settings) { try { await cloudSaveSettings(data.settings); } catch { failed++; } }

      // Modules that live outside ARRAY_COLLECTIONS (promotions, wallet,
      // campaigns, zones, daily wages …) mirror through cloudDocs.
      try {
        const { MIRRORED_KEYS, mirrorList, flushCloudDocs } = await import('./cloudDocs');
        for (const key of MIRRORED_KEYS) {
          try {
            const raw = localStorage.getItem(key);
            const val = raw ? JSON.parse(raw) : null;
            if (Array.isArray(val)) mirrorList(key, val);
          } catch { /* skip this module */ }
        }
        await flushCloudDocs();
      } catch { /* mirror best-effort */ }

      console.info(`[import] cloud push done — ${ok} records, ${failed} failed`);
    })();
  }
}

export function resetData() {
  const data = seedData();
  ensureFields(data as any);
  saveLocal(data as any);
  if (useCloudStore()) {
    (async () => {
      for (const col of ARRAY_COLLECTIONS) {
        const snap = await getDocs(colRef(col)!);
        const batch = writeBatch(fbDb());
        snap.forEach(d => batch.delete(d.ref));
        try { await batch.commit(); } catch {}
      }
      await cloudSeedIfEmpty();
    })();
  }
}

export interface ResetOutcome {
  /** Collections whose rows were removed on the server, with how many. */
  cleared: Record<string, number>;
  /** Collections the server refused, with why. The caller MUST surface these. */
  failed: Array<{ collection: string; error: string }>;
}

/**
 * Selectively wipe given collections, locally and on the server.
 *
 * ===== v1.29.3 — "close day kiya, data zero nahi hua" =====
 *
 * REPORTED as a major bug: after Close Day the selected modules should read
 * zero, and they did not — the figures came back.
 *
 * This function cleared the local cache and then deleted from FIREBASE:
 * getDocs, writeBatch, fbDb. Firebase was removed in v1.24.0 and every one of
 * those now resolves to a stub that THROWS. The throw landed in
 * `catch (e) { console.error(...) }` and went no further.
 *
 * So Close Day did exactly half its job, quietly: the till went to zero, the
 * server kept everything, and the next sync pulled it all back. Nothing in the
 * UI could tell, because the failure was swallowed by design.
 *
 * The delete now goes through sbDeleteMany, which is tombstone-aware: tables in
 * SOFT_DELETE get `deleted_at` rather than being destroyed, so the removal
 * REPLICATES to every other till (v1.26.0) — and so it can be undone. That is
 * what makes a recycle bin possible at all; see lib/recycleBin.ts.
 *
 * Failures are returned, not logged and forgotten. A Close Day that could not
 * clear the server must say so, or the operator trusts a total that is wrong.
 */
export async function resetSelectedData(keys: readonly ArrayKey[]): Promise<ResetOutcome> {
  const outcome: ResetOutcome = { cleared: {}, failed: [] };
  const d = loadData() as any;

  // The ids have to be read BEFORE the local copy is cleared: they are what
  // tells the server which rows to remove.
  const idsByCollection = new Map<ArrayKey, string[]>();
  for (const k of keys) {
    const rows = Array.isArray(d[k]) ? d[k] : [];
    idsByCollection.set(k, rows.map((r: any) => r?.id).filter(Boolean));
  }

  if (useSupabaseBackend()) {
    const { sbDeleteMany } = await import('./supabaseStore');
    for (const col of keys) {
      const ids = idsByCollection.get(col) ?? [];
      if (!ids.length) { outcome.cleared[col] = 0; continue; }
      try {
        const done = await sbDeleteMany(col, ids);
        outcome.cleared[col] = done.length;
      } catch (e: any) {
        outcome.failed.push({ collection: col, error: e?.message || String(e) });
      }
    }
  }

  // Only the collections the server actually accepted are cleared locally. A
  // collection that failed keeps its rows, so the till still agrees with the
  // server and the operator can try again instead of losing the record.
  const refused = new Set(outcome.failed.map(f => f.collection));
  for (const k of keys) if (!refused.has(k)) d[k] = [];
  saveLocal(d);
  emitDataChange('*');

  return outcome;
}

export const RESETTABLE_COLLECTIONS = ARRAY_COLLECTIONS;
export type ResettableCollection = ArrayKey;

// ============ Inventory ============
export function getInventory(): InventoryItem[] { return loadData().inventory || []; }
export function saveInventoryItem(item: InventoryItem) { saveEntity('inventory', item); }
export function deleteInventoryItem(id: string) { deleteEntity('inventory', id); }
export function getStockLogs(): StockLog[] { return loadData().stockLogs || []; }
export function addStockLog(log: StockLog) { saveEntity('stockLogs', log); }
export function adjustStock(
  itemId: string,
  qty: number,
  type: 'in' | 'out' | 'adjustment' | 'sale',
  note: string,
  opts?: { movementId?: string; refType?: MovementRef; refId?: string; allowNegative?: boolean },
): { applied: boolean; duplicate: boolean; needsReview: boolean; balanceAfter: number } {
  const d = loadData();
  if (!d.inventory) d.inventory = [];
  if (!d.stockLogs) d.stockLogs = [];
  const item = d.inventory.find(x => x.id === itemId);
  if (!item) return { applied: false, duplicate: false, needsReview: false, balanceAfter: 0 };

  // ---- v1.26.0: idempotency. A replayed sale/refund (crash retry, duplicate
  // sync, double-submit) must NEVER deduct stock twice. ----
  if (opts?.movementId && isDuplicateMovement(d.stockLogs as any, opts.movementId)) {
    return { applied: false, duplicate: true, needsReview: false, balanceAfter: Number(item.quantity) || 0 };
  }

  // ---- Deterministic, guarded movement (no silent negative stock) ----
  const plan = planMovement(Number(item.quantity) || 0, type, qty, opts?.allowNegative);
  item.quantity = plan.balanceAfter;
  // Stamp _updatedAt like saveEntity() does, so the conflict-aware snapshot
  // merge does not treat this row as older than the cloud copy.
  (item as any)._updatedAt = Date.now();

  const log: any = {
    id: genId(),
    inventoryItemId: itemId,
    type,
    quantity: qty,
    note,
    date: new Date().toISOString(),
    movementId: opts?.movementId,
    refType: opts?.refType,
    refId: opts?.refId,
    deviceId: getDeviceId() || 'unknown',
    delta: plan.delta,
    balanceAfter: plan.balanceAfter,
    ...(plan.needsReview ? { needsReview: true, shortfall: plan.shortfall } : {}),
  };
  d.stockLogs.push(log);
  saveLocal(d);
  if (useFirestore()) {
    // Same deferred path as every other write — never fire at the network on
    // the billing hot path, and never lose the op when offline/manual mode.
    if (shouldDeferCloudWrite()) {
      enqueueDeferredOp('inventory', item.id, 'set');
      enqueueDeferredOp('stockLogs', log.id, 'set');
    } else {
      cloudSaveItem('inventory', item.id, item);
      cloudSaveItem('stockLogs', log.id, log);
    }
  }
  return { applied: true, duplicate: false, needsReview: plan.needsReview, balanceAfter: plan.balanceAfter };
}


// ============ HR ============
export function getEmployees(): Employee[] { return loadData().employees || []; }
export function saveEmployee(e: Employee) { saveEntity('employees', e); }
export function deleteEmployee(id: string) { deleteEntity('employees', id); }

export function getAttendance(): Attendance[] { return loadData().attendance || []; }
export function saveAttendance(a: Attendance) { saveEntity('attendance', a); }
export function deleteAttendance(id: string) { deleteEntity('attendance', id); }
export function markAttendance(employeeId: string, date: string, status: Attendance['status'], inTime?: string, outTime?: string, note?: string) {
  const d = loadData();
  let existing = d.attendance.find(a => a.employeeId === employeeId && a.date === date);
  if (existing) {
    existing.status = status;
    if (inTime !== undefined) existing.inTime = inTime;
    if (outTime !== undefined) existing.outTime = outTime;
    if (note !== undefined) existing.note = note;
  } else {
    existing = { id: genId(), employeeId, date, status, inTime, outTime, note };
    d.attendance.push(existing);
  }
  saveLocal(d);
  if (useFirestore()) cloudSaveItem('attendance', existing.id, existing);
}

export function getLeaves(): Leave[] { return loadData().leaves || []; }
export function saveLeave(l: Leave) { saveEntity('leaves', l); }
export function deleteLeave(id: string) { deleteEntity('leaves', id); }

export function getPayslips(): Payslip[] { return loadData().payslips || []; }
export function savePayslip(p: Payslip) { saveEntity('payslips', p); }
export function deletePayslip(id: string) { deleteEntity('payslips', id); }

export function getAdvances(): Advance[] { return loadData().advances || []; }
export function saveAdvance(a: Advance) { saveEntity('advances', a); }
export function deleteAdvance(id: string) { deleteEntity('advances', id); }

// ============ Accounts ============
export function getAccountCategories(): AccountCategory[] { return loadData().accountCategories || []; }
export function saveAccountCategory(c: AccountCategory) { saveEntity('accountCategories', c); }
export function deleteAccountCategory(id: string) { deleteEntity('accountCategories', id); }

export function getTransactions(): Transaction[] { return loadData().transactions || []; }
export function saveTransaction(t: Transaction) { saveEntity('transactions', t); }
export function deleteTransaction(id: string) { deleteEntity('transactions', id); }

export function getParties(): Party[] { return loadData().parties || []; }
export function saveParty(p: Party) { saveEntity('parties', p); }
export function deleteParty(id: string) { deleteEntity('parties', id); }

/** Centralized Party Master: find by case-insensitive name (+type) or create new. */
export function findOrCreateParty(
  name: string,
  type: LedgerType = 'supplier',
  extra?: { phone?: string; address?: string; openingBalance?: number },
): Party {
  const clean = (name || '').trim();
  if (!clean) throw new Error('Party name required');
  const existing = (loadData().parties || []).find(
    p => p.name.trim().toLowerCase() === clean.toLowerCase() && p.type === type,
  );
  if (existing) {
    // Enrich missing fields without overwriting existing data
    let changed = false;
    const upd = { ...existing };
    if (extra?.phone && !existing.phone) { upd.phone = extra.phone; changed = true; }
    if (extra?.address && !existing.address) { upd.address = extra.address; changed = true; }
    if (changed) saveEntity('parties', upd);
    return upd;
  }
  const created: Party = {
    id: genId(),
    type,
    name: clean,
    phone: extra?.phone || '',
    address: extra?.address || '',
    openingBalance: extra?.openingBalance || 0,
    isActive: true,
  };
  saveEntity('parties', created);
  return created;
}

export function getLedger(): LedgerEntry[] { return loadData().ledger || []; }
export function addLedgerEntry(l: LedgerEntry) { saveEntity('ledger', l); }
export function deleteLedgerEntry(id: string) { deleteEntity('ledger', id); }

export function getDailyCashCloses(): DailyCashClose[] { return loadData().dailyCashCloses || []; }
export function saveDailyCashClose(c: DailyCashClose) { saveEntity('dailyCashCloses', c); }
export function deleteDailyCashClose(id: string) { deleteEntity('dailyCashCloses', id); }

// ============ Payment Accounts (Bank/JazzCash/Easypaisa) ============
export function getPaymentAccounts(): PaymentAccount[] {
  return (loadData() as any).paymentAccounts || [];
}
export function savePaymentAccount(a: PaymentAccount) { saveEntity('paymentAccounts' as any, a); }
export function deletePaymentAccount(id: string) { deleteEntity('paymentAccounts' as any, id); }

// ============ Receiving (GRN) ============
import type { ReceivingEntry, MarketingContact } from './types';
import { toBaseQty, getBaseUnit } from './units';

export function getReceivingEntries(): ReceivingEntry[] { return loadData().receivingEntries || []; }

/** Save a receiving entry AND auto-update stock + moving-average cost + supplier ledger. */
export function saveReceivingEntry(e: ReceivingEntry) {
  const d = loadData();
  const existing = (d.receivingEntries || []).find(x => x.id === e.id);

  // Only apply stock change for brand-new entries linked to an inventory item.
  if (!existing && e.inventoryItemId) {
    const item = (d.inventory || []).find(i => i.id === e.inventoryItemId);
    if (item) {
      const base = getBaseUnit(item);
      const baseQty = toBaseQty(item, e.quantity || 0, e.unit || base);
      const factor = baseQty > 0 && e.quantity > 0 ? baseQty / e.quantity : 1;
      const surcharge = e.surcharge || 0;
      const totalCost = ((e.rate || 0) * (e.quantity || 0)) + surcharge;
      const baseUnitCost = baseQty > 0 ? totalCost / baseQty : 0;

      // Moving average
      const oldQty = item.quantity || 0;
      const oldAvg = item.avgCostPrice ?? item.costPrice ?? 0;
      const newQty = oldQty + baseQty;
      const newAvg = newQty > 0 ? ((oldQty * oldAvg) + (baseQty * baseUnitCost)) / newQty : baseUnitCost;

      item.quantity = newQty;
      item.avgCostPrice = newAvg;
      if (baseUnitCost > 0) item.costPrice = baseUnitCost; // latest cost
      item.baseUnit = base;
      saveEntity('inventory', item);

      // Stamp computed fields back on the entry
      e.baseQty = baseQty;
      e.baseUnit = base;
      e.baseUnitCost = baseUnitCost;

      // Stock log
      const log = {
        id: genId(), inventoryItemId: item.id, type: 'in' as const,
        quantity: baseQty,
        note: `GRN • ${e.supplierName} • ${e.quantity} ${e.unit} @ Rs.${e.rate}${surcharge ? ` + Rs.${surcharge} surcharge` : ''}`,
        date: e.date || new Date().toISOString(),
      };
      d.stockLogs = d.stockLogs || [];
      d.stockLogs.push(log);
      saveLocal(d);
      if (useFirestore()) cloudSaveItem('stockLogs', log.id, log);
    }
  }

  // ============ Party Master + Ledger auto-link ============
  if (!existing && e.supplierName && (e.supplierName || '').trim()) {
    try {
      const party = findOrCreateParty(e.supplierName.trim(), 'supplier');
      // Stamp party id on the receiving entry for traceability
      (e as any).partyId = party.id;
      // Create a credit ledger entry (we owe the supplier) for the receiving total
      const totalBill = ((e.rate || 0) * (e.quantity || 0)) + (e.surcharge || 0);
      if (totalBill > 0) {
        const ledgerEntry: LedgerEntry = {
          id: genId(),
          partyId: party.id,
          date: (e.date || new Date().toISOString()).slice(0, 10),
          description: `GRN • ${e.itemName} • ${e.quantity} ${e.unit}${e.surcharge ? ` (incl. Rs.${e.surcharge} surcharge)` : ''}`,
          debit: 0,
          credit: totalBill,
          reference: `GRN-${e.id}`,
        };
        saveEntity('ledger', ledgerEntry);
      }
    } catch (err) {
      console.warn('[receiving] party/ledger auto-link failed', err);
    }
  }

  saveEntity('receivingEntries', e);
}

export function deleteReceivingEntry(id: string) { deleteEntity('receivingEntries', id); }

// ============ Marketing ============
export function getMarketingContacts(): MarketingContact[] { return loadData().marketingContacts || []; }
export function saveMarketingContact(c: MarketingContact) { saveEntity('marketingContacts', c); }
export function deleteMarketingContact(id: string) { deleteEntity('marketingContacts', id); }

// Marketing template (single doc under meta/marketing)
function marketingMetaRef() {
  const base = tenantBase(); if (!base) return null;
  return doc(fbDb(), base[0], base[1], 'meta', 'marketing');
}
const MARKETING_TPL_KEY = 'pos-marketing-template';
export function getMarketingTemplate(): string {
  try { return localStorage.getItem(MARKETING_TPL_KEY) || ''; } catch { return ''; }
}
export function saveMarketingTemplate(tpl: string) {
  try { localStorage.setItem(MARKETING_TPL_KEY, tpl); } catch {}
  try { void import('./cloudDocs').then(m => m.mirrorValue(MARKETING_TPL_KEY, tpl)); } catch {}
  if (useFirestore()) {
    const r = marketingMetaRef(); if (!r) return;
    setDoc(r, { template: tpl }).catch(e => console.error('[firestore] marketing template save failed', e));
  }
}

// ============================================================
// RECIPES (BOM) & AUTO-STOCK DEDUCTION
// ============================================================
export function getRecipes(): Recipe[] { return loadData().recipes || []; }
export function getRecipeForMenuItem(menuItemId: string, variantKey?: string): Recipe | undefined {
  const all = loadData().recipes || [];
  // Prefer variant-specific recipe when variantKey is given; otherwise the default (empty variantKey) recipe.
  if (variantKey) {
    const v = all.find(r => r.menuItemId === menuItemId && (r.variantKey || '') === variantKey);
    if (v) return v;
  }
  return all.find(r => r.menuItemId === menuItemId && !r.variantKey);
}
export function saveRecipe(r: Recipe) { saveEntity('recipes', r); }
export function deleteRecipe(id: string) { deleteEntity('recipes', id); }

/** Build the variantKey used to scope a recipe to a specific size/inch variant. */
export function cartVariantKey(line: Pick<CartItem, 'variantType' | 'variantName'>): string {
  return line.variantName ? `${line.variantType || 'size'}:${line.variantName}` : '';
}

/** Deducts inventory based on each line's recipe. For weight-based items,
 *  qty multiplier = weightGrams / 1000. For fixed/manual items, multiplier = quantity.
 *  Variant-aware: picks recipe matching (menuItemId, variantKey) if present, else falls back to default. */
/**
 * v1.14.1 — low-stock listeners.
 *
 * `lowStockThreshold` existed on every inventory item but nothing ever
 * checked it, so no warning could ever fire — the client reported exactly
 * that. Sales now report which items crossed their threshold and the UI
 * subscribes here to surface it.
 */
type LowStockListener = (items: { id: string; name: string; quantity: number; threshold: number }[]) => void;
const lowStockListeners = new Set<LowStockListener>();
export function onLowStock(l: LowStockListener): () => void {
  lowStockListeners.add(l);
  return () => lowStockListeners.delete(l);
}

/** Items at or below their reorder threshold right now. */
export function getLowStockItems(): { id: string; name: string; quantity: number; threshold: number }[] {
  const inv = (loadData() as any).inventory || [];
  return inv
    .filter((i: any) => i?.isActive !== false
      && Number(i?.lowStockThreshold) > 0
      && Number(i?.quantity ?? 0) <= Number(i.lowStockThreshold))
    .map((i: any) => ({
      id: i.id, name: i.name,
      quantity: Number(i.quantity ?? 0),
      threshold: Number(i.lowStockThreshold),
    }));
}

export function deductStockForOrder(order: Order) {
  const d = loadData();
  const recipes = d.recipes || [];
  // v1.14.1 — do NOT bail out when there are no recipes. A retail item is
  // linked straight to an inventory row (menuItem.inventoryItemId) and must
  // still decrement. The old early return meant minimart stock never moved.
  const menuItems = (d as any).menuItems || [];
  const touched = new Set<string>();

  for (const line of order.items) {
    const vk = cartVariantKey(line);
    const recipe = (vk && recipes.find(r => r.menuItemId === line.menuItemId && (r.variantKey || '') === vk))
                || recipes.find(r => r.menuItemId === line.menuItemId && !r.variantKey);
    if (!recipe || !recipe.components?.length) {
      // ---- Retail path: the product IS the stock item ----
      const mi = menuItems.find((m: any) => m.id === line.menuItemId);
      const invId = mi?.inventoryItemId;
      if (!invId) continue;                       // neither recipe nor link
      const perUnit = Number(mi?.stockPerUnit) > 0 ? Number(mi.stockPerUnit) : 1;
      const qty = line.pricingType === 'weight'
        ? (line.weightGrams || 0) / 1000
        : (line.quantity || 0);
      const consumed = perUnit * qty;
      if (consumed <= 0) continue;
      try {
        adjustStock(invId, consumed, 'sale', `Sale • Order #${order.orderNumber} • ${line.name}`, {
          movementId: movementIdFor('sale', order.id, invId, line.id || line.menuItemId),
          refType: 'sale', refId: order.id,
        });
        touched.add(invId);
      } catch (e) { console.error('[stock] direct deduct failed', e); }
      continue;
    }
    const multiplier = line.pricingType === 'weight'
      ? (line.weightGrams || 0) / 1000
      : (line.quantity || 0);
    if (multiplier <= 0) continue;
    for (const comp of recipe.components) {
      const item = (d.inventory || []).find(i => i.id === comp.inventoryItemId);
      const perUnitBase = item ? toBaseQty(item, comp.quantity, comp.unit) : comp.quantity;
      const consumed = perUnitBase * multiplier;
      if (consumed <= 0) continue;
      const note = `Auto-deduct • Order #${order.orderNumber} • ${line.name}${line.variantName ? ' (' + line.variantName + ')' : ''}`;
      try {
        adjustStock(comp.inventoryItemId, consumed, 'sale', note, {
          movementId: movementIdFor('sale', order.id, comp.inventoryItemId, `${line.id || line.menuItemId}:${comp.inventoryItemId}`),
          refType: 'sale', refId: order.id,
        });
        touched.add(comp.inventoryItemId);
      } catch (e) { console.error(e); }
    }

  }

  // v1.14.1 — warn about anything this sale pushed to/below its threshold.
  if (touched.size > 0) {
    try {
      const low = getLowStockItems().filter(i => touched.has(i.id));
      if (low.length > 0) lowStockListeners.forEach(l => { try { l(low); } catch { /* ignore */ } });
    } catch (e) { console.warn('[stock] low-stock check failed', e); }
  }
}

// ============================================================
// DEALS / COMBOS — tenant-synced (was localStorage-only in blink-modules)
// ============================================================
export function getDeals(): Deal[] { return (loadData() as any).deals || []; }
export function getDealById(id: string): Deal | undefined { return getDeals().find(d => d.id === id); }
export function saveDeal(deal: Deal) { saveEntity('deals' as any, deal); }
export function deleteDeal(id: string) { deleteEntity('deals' as any, id); }

// ============================================================
// WASTAGE
// ============================================================
export function getWastages(): Wastage[] { return loadData().wastages || []; }
export function saveWastage(w: Wastage) {
  // Persist record + actually deduct stock
  saveEntity('wastages', w);
  try {
    adjustStock(w.inventoryItemId, w.quantity, 'out', `Wastage: ${w.reason}${w.note ? ' — ' + w.note : ''}`, {
      movementId: movementIdFor('wastage', w.id, w.inventoryItemId),
      refType: 'wastage', refId: w.id,
    });
  } catch (e) { console.error(e); }

}
export function deleteWastage(id: string) { deleteEntity('wastages', id); }

// ============================================================
// CUSTOMER DATABASE (Phase 5)
// ============================================================
import { normalizePhone } from './whatsapp';

export function getCustomers(): CustomerProfile[] { return loadData().customers || []; }
export function saveCustomer(c: CustomerProfile) { saveEntity('customers', c); }
export function deleteCustomer(id: string) { deleteEntity('customers', id); }

export function findCustomerByPhone(phone?: string): CustomerProfile | undefined {
  if (!phone) return;
  const key = normalizePhone(phone) || phone.replace(/[^\d]/g, '');
  if (!key) return;
  return (loadData().customers || []).find(c => c.id === key || c.phone.replace(/[^\d]/g, '') === key.replace(/[^\d]/g, ''));
}

/** Create or update a customer profile when an order is saved/paid. */
export function upsertCustomerFromOrder(order: Order, incrementTotals = true) {
  const cust = order.customer;
  const phoneRaw = cust?.phone || order.creditCustomerPhone;
  if (!phoneRaw) return;
  const key = normalizePhone(phoneRaw) || phoneRaw.replace(/[^\d]/g, '');
  if (!key) return;

  const name = cust?.name || order.creditCustomerName || 'Walk-in';
  const address = cust?.fullAddress || cust?.address || order.creditCustomerAddress || '';
  const d = loadData();
  if (!d.customers) d.customers = [];

  const now = new Date().toISOString();
  let profile = d.customers.find(c => c.id === key);
  if (!profile) {
    profile = {
      id: key,
      name,
      phone: phoneRaw,
      addresses: address ? [address] : [],
      totalOrders: 0,
      totalSpent: 0,
      firstOrderAt: now,
      createdAt: now,
    };
    d.customers.push(profile);
  }
  profile.name = profile.name || name;
  if (address && !profile.addresses.includes(address)) profile.addresses.push(address);

  // Merge structured address fields (only fill empties)
  if (cust) {
    profile.altPhone      = profile.altPhone      || cust.altPhone;
    profile.email         = profile.email         || cust.email;
    profile.province      = cust.province         || profile.province;
    profile.district      = cust.district         || profile.district;
    profile.city          = cust.city             || profile.city;
    profile.area          = cust.area             || profile.area;
    profile.society       = cust.society          || profile.society;
    profile.street        = cust.street           || profile.street;
    profile.streetNumber  = cust.streetNumber     || profile.streetNumber;
    profile.houseNumber   = cust.houseNumber      || profile.houseNumber;
    profile.fullAddress   = cust.fullAddress      || profile.fullAddress || address;
    if (cust.lat != null && cust.lng != null) {
      profile.lat = cust.lat;
      profile.lng = cust.lng;
      profile.locationLabel = cust.locationLabel || profile.locationLabel;
      profile.locationCapturedAt = cust.locationCapturedAt || now;
    }
  }
  if (order.branchId) profile.preferredBranchId = order.branchId;
  if (order.riderId) profile.lastRiderId = order.riderId;

  // Only counted (paid / credit_received) orders increment totals
  const counted = incrementTotals && (order.status === 'paid' || order.status === 'credit_received');
  if (counted) {
    profile.totalOrders += 1;
    profile.totalSpent += order.grandTotal || 0;
    profile.lastOrderAt = now;
    profile.avgOrderValue = Math.round(profile.totalSpent / Math.max(1, profile.totalOrders));
    // Grade
    const t = profile.totalSpent;
    profile.grade = t >= 50000 ? 'platinum' : t >= 20000 ? 'gold' : t >= 5000 ? 'silver' : 'regular';
    // Frequency
    if (profile.firstOrderAt && profile.totalOrders > 1) {
      const spanDays = (new Date(now).getTime() - new Date(profile.firstOrderAt).getTime()) / 86400000;
      profile.orderFrequencyDays = Math.max(1, Math.round(spanDays / (profile.totalOrders - 1)));
    }
    // Favourite item (top by qty across this order — incremental, light)
    const tally = new Map<string, { name: string; n: number }>();
    for (const it of order.items || []) {
      const k = it.menuItemId || it.name;
      const e = tally.get(k) || { name: it.name, n: 0 };
      e.n += it.quantity || 1;
      tally.set(k, e);
    }
    const top = [...tally.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    if (top && !profile.favoriteItemId) {
      profile.favoriteItemId = top[0];
      profile.favoriteItemName = top[1].name;
    }

    // Loyalty Program — award points on counted orders
    try {
      const s = getSettings();
      if (s?.loyaltyEnabled) {
        // Deduct points used at checkout FIRST (redemption)
        const used = Number((order as any).loyaltyPointsUsed) || 0;
        if (used > 0) {
          profile.loyaltyPoints = Math.max(0, (profile.loyaltyPoints || 0) - used);
        }
        const earnRate = Number(s.loyaltyEarnPerRs100) > 0 ? Number(s.loyaltyEarnPerRs100) : 1;
        const earned = Math.floor(((order.grandTotal || 0) / 100) * earnRate);
        if (earned > 0) {
          profile.loyaltyPoints = (profile.loyaltyPoints || 0) + earned;
          profile.loyaltyLifetimePoints = (profile.loyaltyLifetimePoints || 0) + earned;
        }
      }
    } catch { /* loyalty optional */ }
  }



  saveLocal(d);
  if (useFirestore()) cloudSaveItem('customers', profile.id, profile);
}

// ============================================================
// MULTI-BRANCH (Phase 6)
// ============================================================
const CURRENT_BRANCH_KEY = 'pos-current-branch';

export function getBranches(): Branch[] {
  return (loadData().branches || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
}
export function saveBranch(b: Branch) { saveEntity('branches', b); }
export function deleteBranch(id: string) { deleteEntity('branches', id); }

export function getCurrentBranchId(): string | null {
  try { return localStorage.getItem(CURRENT_BRANCH_KEY); } catch { return null; }
}
export function setCurrentBranchId(id: string | null) {
  try {
    if (id) localStorage.setItem(CURRENT_BRANCH_KEY, id);
    else localStorage.removeItem(CURRENT_BRANCH_KEY);
  } catch {}
}
export function getCurrentBranch(): Branch | null {
  const id = getCurrentBranchId();
  if (!id) return null;
  return getBranches().find(b => b.id === id) || null;
}

// ============================================================
// CREDIT / UDHAAR
// ============================================================
export function getCreditPayments(): CreditPayment[] {
  return loadData().creditPayments || [];
}
export function saveCreditPayment(p: CreditPayment) { saveEntity('creditPayments', p); }
export function deleteCreditPayment(id: string) { deleteEntity('creditPayments', id); }

/** All credit orders (paymentMethod = 'credit'). Excludes void/cancelled. */
export function getCreditOrders(): Order[] {
  return loadData().orders.filter(o =>
    o.paymentMethod === 'credit' &&
    o.status !== 'void' && o.status !== 'cancelled'
  );
}

/** Returns { paid, balance, status } for a given credit order id. */
export function getCreditOrderSummary(orderId: string): { total: number; paid: number; balance: number; status: 'unpaid' | 'partial' | 'paid' } {
  const order = loadData().orders.find(o => o.id === orderId);
  const total = order?.grandTotal || 0;
  const paid = getCreditPayments()
    .filter(p => p.orderId === orderId)
    .reduce((s, p) => s + (p.amount || 0), 0);
  const balance = Math.max(0, total - paid);
  const status: 'unpaid' | 'partial' | 'paid' =
    paid <= 0 ? 'unpaid' : balance <= 0 ? 'paid' : 'partial';
  return { total, paid, balance, status };
}

export function recordCreditPayment(orderId: string, amount: number, method: PaymentMethod = 'cash', note?: string, receivedBy?: string): CreditPayment {
  const order = loadData().orders.find(o => o.id === orderId);
  const p: CreditPayment = {
    id: genId(),
    orderId,
    customerName: order?.creditCustomerName || order?.customer?.name,
    customerPhone: order?.creditCustomerPhone || order?.customer?.phone,
    amount,
    method,
    date: new Date().toISOString(),
    receivedBy,
    note,
  };
  saveCreditPayment(p);
  return p;
}

// ============================================================
// PROMO CODES (Phase 11)
// ============================================================
export function getPromoCodes(): PromoCode[] {
  return loadData().promoCodes || [];
}
export function savePromoCode(p: PromoCode) {
  p.code = (p.code || '').trim().toUpperCase();
  saveEntity('promoCodes', p);
}
export function deletePromoCode(id: string) { deleteEntity('promoCodes', id); }

/** Validate a promo code against the current cart subtotal. Returns null if invalid. */
export function validatePromoCode(code: string, cartSubtotal: number): { promo: PromoCode; discount: number } | { error: string } {
  const norm = (code || '').trim().toUpperCase();
  if (!norm) return { error: 'Enter a promo code' };
  const promo = getPromoCodes().find(p => p.code === norm);
  if (!promo) return { error: 'Invalid promo code' };
  if (!promo.isActive) return { error: 'Promo code inactive' };
  const now = Date.now();
  if (promo.startDate && new Date(promo.startDate).getTime() > now) return { error: 'Promo not started yet' };
  if (promo.endDate && new Date(promo.endDate).getTime() + 86400000 < now) return { error: 'Promo expired' };
  if (promo.usageLimit && promo.usageCount >= promo.usageLimit) return { error: 'Promo usage limit reached' };
  if (promo.minOrderAmount && cartSubtotal < promo.minOrderAmount) return { error: `Minimum order Rs. ${promo.minOrderAmount}` };
  const discount = promo.discountType === 'percent'
    ? Math.round(cartSubtotal * (promo.discountValue || 0) / 100)
    : Math.min(cartSubtotal, promo.discountValue || 0);
  return { promo, discount };
}

/** Increment usage counter after order is paid with promo. */
export function incrementPromoUsage(code: string) {
  const norm = (code || '').trim().toUpperCase();
  if (!norm) return;
  const promo = getPromoCodes().find(p => p.code === norm);
  if (!promo) return;
  promo.usageCount = (promo.usageCount || 0) + 1;
  savePromoCode(promo);
}

// ============================================================
// DAY CLOSE — module reset
// Clears whole collections (local + cloud) so every ticked module
// really shows 00 after a Day Close.
// ============================================================
export async function clearCollectionsForDayClose(cols: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const valid = cols.filter(c => (ARRAY_COLLECTIONS as readonly string[]).includes(c)) as ArrayKey[];
  if (!valid.length) return counts;

  const d = loadData();
  const idsByCol: Record<string, string[]> = {};
  for (const col of valid) {
    const arr = ((d as any)[col] as any[]) || [];
    idsByCol[col] = arr.map(x => String(x?.id)).filter(Boolean);
    counts[col] = arr.length;
    (d as any)[col] = [];
  }
  saveLocal(d);
  flushLocalPersistence();

  if (useCloudStore()) {
    for (const col of valid) {
      const ids = idsByCol[col];
      if (!ids.length) continue;
      // One round-trip per 100 rows instead of one per row: a busy day used
      // to fire hundreds of requests and time out halfway, leaving the
      // module full on the server.
      if (useSupabaseBackend() && !shouldDeferCloudWrite()) {
        try {
          const { sbDeleteMany } = await import('./supabaseStore');
          await sbDeleteMany(col, ids);
          continue;
        } catch { /* fall back to per-row queueing below */ }
      }
      for (const id of ids) {
        try {
          if (shouldDeferCloudWrite()) enqueueDeferredOp(col, id, 'delete');
          else await cloudDeleteItem(col, id);
        } catch { enqueueDeferredOp(col, id, 'delete'); }
      }
    }
  }
  return counts;
}
