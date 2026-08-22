// Strict cross-tenant cache wipe.
//
// Same browser par agar koi user pehle tenant A login karta hai, phir logout
// karke tenant B login karta hai, to tenant A ka KOI bhi cached data tenant B
// ke session me dikhna nahi chahiye. Ye file har possible storage layer ko
// wipe karti hai on tenant switch:
//
//   1. localStorage  — pos-* / desi-pos-* / enc::* (non-current tenant)
//   2. sessionStorage — sab kuch (tab-level)
//   3. IndexedDB     — Firestore offline cache + image cache
//   4. CacheStorage  — service worker / fetch caches
//   5. In-memory     — pos-tenant-change event store.ts ko trigger karta hai
//
// Tenant ID se signed marker store hota hai — agar load par marker mismatch ho
// (browser ka koi aur tab pehle dusra tenant load kar chuka), wipe trigger hota
// hai before any data renders.

import { getTenantId } from './tenant';
import { wipeOtherTenants } from './secureStorage';

const SAFE_KEEP_KEYS = new Set<string>([
  'pos-tenant-id',
  'pos-tenant-name',
  'pos-device-id',
  'pos-owner-remember-email',
  'pos-owner-saved-email',
  'pos-remember-username',
  'pos-saved-username',
  'pos-user-role',
  'pos-current-user',     // active session marker
  'pos-active-tenant-marker',
]);

const SHARED_PREFIXES = ['pos-', 'desi-pos-'];

function isTenantScopedKey(k: string, currentTenantId: string | null): boolean {
  if (SAFE_KEEP_KEYS.has(k)) return false;
  // v1.2.4: emergency backups are the last line of defence against data loss —
  // they must SURVIVE every wipe, including logout and cross-tenant switches.
  if (k.startsWith('dt-pos-emergency-backup::')) return false;
  if (currentTenantId && k === `desi-pos-data:${currentTenantId}`) return false;
  return SHARED_PREFIXES.some(p => k.startsWith(p));
}

/** Wipe every localStorage key that belongs to the *previous* tenant. */
function wipeSharedLocalStorage(currentTenantId: string | null): number {
  let removed = 0;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (isTenantScopedKey(k, currentTenantId)) {
      localStorage.removeItem(k);
      removed++;
    }
  }
  return removed;
}

/** Wipe sessionStorage — tab-level, always safe to clear on tenant switch. */
function wipeSessionStorage(): number {
  const n = sessionStorage.length;
  try { sessionStorage.clear(); } catch { /* ignore */ }
  return n;
}

/** Drop Firestore offline IndexedDB + our image cache so cross-tenant docs don't bleed. */
async function wipeIndexedDb(currentTenantId: string | null): Promise<number> {
  if (!('indexedDB' in window)) return 0;
  // Known DB names used by this app + Firestore.
  const known = ['firestoreDb', 'firestore/[DEFAULT]/main', 'pos-image-cache'];
  if (!currentTenantId) known.push('firebaseLocalStorageDb');
  let dropped = 0;
  // If the browser supports databases() (Chrome/Edge), enumerate dynamically.
  try {
    const anyIdb = indexedDB as any;
    if (typeof anyIdb.databases === 'function') {
      const list: { name?: string }[] = await anyIdb.databases();
      list.forEach(db => { if (db.name) known.push(db.name); });
    }
  } catch { /* ignore */ }
  const uniq = Array.from(new Set(known));
  await Promise.all(uniq.map(name => new Promise<void>(resolve => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => { dropped++; resolve(); };
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch { resolve(); }
  })));
  return dropped;
}

/** Drop Cache Storage entries (service worker / fetch). */
async function wipeCacheStorage(): Promise<number> {
  if (!('caches' in window)) return 0;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    return keys.length;
  } catch { return 0; }
}

/** Full wipe — call before showing UI for the new tenant. */
export async function fullCrossTenantWipe(
  newTenantId: string | null,
  opts: { wipeIndexedDb?: boolean; wipeCacheStorage?: boolean } = {},
): Promise<void> {
  const wipeIdb = opts.wipeIndexedDb === true;
  const wipeCaches = opts.wipeCacheStorage === true;
  try { wipeOtherTenants(newTenantId); } catch { /* ignore */ }
  wipeSharedLocalStorage(newTenantId);
  wipeSessionStorage();
  // IMPORTANT: Do not delete Firestore IndexedDB while Firebase is active.
  // Deleting it during login makes Firestore emit "shutting down", then the
  // app falls back to empty/default data. Only hard logout uses this deep wipe.
  if (wipeIdb) void wipeIndexedDb(newTenantId);
  if (wipeCaches) void wipeCacheStorage();
}
/**
 * Forceful logout + cache wipe.
 * Use when account is invalid/deleted/disabled, or on intentional logout.
 * - Signs out of Firebase
 * - Clears tenant context
 * - Wipes localStorage / sessionStorage / IndexedDB / CacheStorage
 * - Shows toast with the reason (if provided)
 */
export async function forceLogoutAndWipe(reason?: string): Promise<void> {
  try { sessionStorage.setItem('pos-intentional-logout', '1'); } catch {}
  try {
    const { fbAuth, isFirebaseConfigured } = await import('./firebase');
    if (isFirebaseConfigured()) {
      const { signOut } = await import('firebase/auth');
      // v1.18.0 — adapter clears the local session even if the network call fails.
      try { const { authSignOut } = await import('./authProvider'); await authSignOut(); } catch { /* ignore */ }
    }
  } catch {}
  try {
    const { clearTenant } = await import('./tenant');
    clearTenant();
  } catch {}
  try { localStorage.removeItem('pos-user-id'); } catch {}
  try { localStorage.removeItem('pos-user-role'); } catch {}
  try { localStorage.removeItem('pos-current-user'); } catch {}
  try { localStorage.removeItem('dt_pos_current_user'); } catch {}
  await fullCrossTenantWipe(null, { wipeIndexedDb: true, wipeCacheStorage: true });
  if (reason) {
    try {
      const { toast } = await import('sonner');
      toast.error(reason);
    } catch {}
  }
}


// ============== Active-tenant marker (multi-tab safety) ==============
// Har tab apna session marker rakhta hai. Agar dusre tab me different tenant
// login ho gaya to ye tab `storage` event par detect kare ga aur reload ho ga
// fresh data ke saath.

const MARKER_KEY = 'pos-active-tenant-marker';

function writeMarker(tid: string | null) {
  try {
    if (tid) localStorage.setItem(MARKER_KEY, tid);
    else localStorage.removeItem(MARKER_KEY);
  } catch { /* ignore */ }
}

if (typeof window !== 'undefined') {
  // On tenant change inside this tab — wipe everything from previous tenant.
  window.addEventListener('pos-tenant-change', async (e: Event) => {
    const detail = (e as CustomEvent).detail as { from: string | null; to: string | null };
    // Normal login (null → tenant) must be lightweight; Firestore is already
    // running, so wiping IndexedDB here breaks sync. Deep wipe is reserved for
    // forceLogoutAndWipe().
    await fullCrossTenantWipe(detail?.to ?? null);
    writeMarker(detail?.to ?? null);
  });

  // On first load — set marker + wipe any stale other-tenant data lying around.
  try {
    const cur = getTenantId();
    const prev = localStorage.getItem(MARKER_KEY);
    if (cur && prev && prev !== cur) {
      // A different tenant was last active here → hard wipe before rendering.
      void fullCrossTenantWipe(cur);
    }
    writeMarker(cur);
  } catch { /* ignore */ }

  // Another tab logged into a different tenant → reload this tab to avoid mixed data.
  window.addEventListener('storage', (e) => {
    if (e.key !== MARKER_KEY) return;
    const cur = getTenantId();
    if (cur && e.newValue && e.newValue !== cur) {
      // Force reload so this tab doesn't keep showing the old tenant's data.
      try { window.location.reload(); } catch { /* ignore */ }
    }
  });
}
