import { firestoreUnavailable } from './legacyFirebaseGuard';
// ============================================================
// DT POS — Version Audit / Update History (v1.0.5)
// ============================================================
// Two collections:
//   1) Global: systemVersionAudit/{autoId}  — Super Admin dashboard feed
//   2) Per tenant: tenants/{tid}/versionHistory/{autoId}  — tenant view
//
// Every time a device boots with an installed version different from the
// one previously stamped on its devices/{did} record, we write BOTH an
// audit entry and update the device record's currentVersion / updateStatus.
// ============================================================
import {
  collection, addDoc, onSnapshot, query, orderBy, limit, serverTimestamp,
  getDoc, doc, setDoc,
} from 'firebase/firestore';
import { fbDb, isFirebaseConfigured } from './firebase';
import { compareVersions } from './releases';

export type UpdateStatus = 'updated' | 'available' | 'updating' | 'failed';

export interface VersionAuditEntry {
  id: string;
  tenantId: string;
  restaurantName?: string;
  branchId?: string;
  branchName?: string;
  deviceId: string;
  deviceName?: string;
  oldVersion?: string;
  newVersion: string;
  status: 'success' | 'failed';
  reason?: string;
  updatedBy?: string;
  at?: any;
}

const GLOBAL_COLL = 'systemVersionAudit';

/** Compute the visible status badge given installed vs latest released version. */
export function getUpdateStatus(current?: string, latest?: string): UpdateStatus {
  if (!current) return 'available';
  if (!latest) return 'updated';
  const cmp = compareVersions(current, latest);
  return cmp >= 0 ? 'updated' : 'available';
}

/** Write one audit entry to both the global feed and the tenant's history. */
export async function logVersionUpdate(input: {
  tenantId: string;
  restaurantName?: string;
  branchId?: string;
  branchName?: string;
  deviceId: string;
  deviceName?: string;
  oldVersion?: string;
  newVersion: string;
  status?: 'success' | 'failed';
  reason?: string;
  updatedBy?: string;
}): Promise<void> {
  if (firestoreUnavailable() || !isFirebaseConfigured()) return;
  const payload = {
    tenantId: input.tenantId,
    restaurantName: input.restaurantName || '',
    branchId: input.branchId || '',
    branchName: input.branchName || '',
    deviceId: input.deviceId,
    deviceName: input.deviceName || '',
    oldVersion: input.oldVersion || '',
    newVersion: input.newVersion,
    status: input.status || 'success',
    reason: input.reason || '',
    updatedBy: input.updatedBy || '',
    at: serverTimestamp(),
  };
  try {
    await addDoc(collection(fbDb(), GLOBAL_COLL), payload);
  } catch (e) { console.warn('[versionAudit] global write failed', e); }
  try {
    await addDoc(collection(fbDb(), 'tenants', input.tenantId, 'versionHistory'), payload);
  } catch (e) { console.warn('[versionAudit] tenant write failed', e); }
}

/** Subscribe to the global audit feed (Super Admin). */
export function subscribeGlobalAudit(cb: (rows: VersionAuditEntry[]) => void, max = 500): () => void {
  // v1.19.7 — on Supabase this Firestore subscription would never fire
  // AND never error, so the caller's spinner ran forever (the Releases tab
  // hung exactly this way). Call back once with an empty result so the UI
  // settles into an honest empty state instead of loading indefinitely.
  if (firestoreUnavailable()) {
    try { cb([] as any); } catch { /* ignore */ }
    return () => {};
  }

  if (!isFirebaseConfigured()) { cb([]); return () => {}; }
  try {
    const q = query(collection(fbDb(), GLOBAL_COLL), orderBy('at', 'desc'), limit(max));
    return onSnapshot(q, (snap) => {
      cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }, (err) => { console.warn('[versionAudit] global feed err', err); cb([]); });
  } catch { cb([]); return () => {}; }
}

/** Subscribe to a single tenant's version history (Restaurant Admin). */
export function subscribeTenantAudit(tenantId: string, cb: (rows: VersionAuditEntry[]) => void, max = 200): () => void {
  // v1.19.7 — on Supabase this Firestore subscription would never fire
  // AND never error, so the caller's spinner ran forever (the Releases tab
  // hung exactly this way). Call back once with an empty result so the UI
  // settles into an honest empty state instead of loading indefinitely.
  if (firestoreUnavailable()) {
    try { cb([] as any); } catch { /* ignore */ }
    return () => {};
  }

  if (!isFirebaseConfigured() || !tenantId) { cb([]); return () => {}; }
  try {
    const q = query(collection(fbDb(), 'tenants', tenantId, 'versionHistory'), orderBy('at', 'desc'), limit(max));
    return onSnapshot(q, (snap) => {
      cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }, (err) => { console.warn('[versionAudit] tenant feed err', err); cb([]); });
  } catch { cb([]); return () => {}; }
}

/**
 * Called on app boot. Reads the device's previously-recorded version. If it
 * differs from the installed version, logs an audit entry and updates the
 * device record. Idempotent — safe to call every boot.
 */
export async function syncDeviceVersion(opts: {
  tenantId: string;
  deviceId: string;
  installedVersion: string;
  restaurantName?: string;
  branchId?: string;
  branchName?: string;
  deviceName?: string;
  updatedBy?: string;
}): Promise<void> {
  if (firestoreUnavailable() || !isFirebaseConfigured()) return;
  const ref = doc(fbDb(), 'tenants', opts.tenantId, 'devices', opts.deviceId);
  let oldVersion: string | undefined;
  try {
    const snap = await getDoc(ref);
    oldVersion = (snap.data() as any)?.currentVersion || (snap.data() as any)?.appVersion;
  } catch { /* ignore */ }

  // Always stamp current version + status
  try {
    await setDoc(ref, {
      appVersion: opts.installedVersion,
      currentVersion: opts.installedVersion,
      updateStatus: 'updated',
      lastVersionSyncAt: serverTimestamp(),
      lastUpdatedBy: opts.updatedBy || '',
      ...(opts.deviceName ? { deviceName: opts.deviceName } : {}),
    }, { merge: true });
  } catch (e) { console.warn('[versionAudit] device stamp failed', e); }

  // Only audit when it changed (skip first-ever boot where old === new).
  if (oldVersion && oldVersion !== opts.installedVersion) {
    await logVersionUpdate({
      tenantId: opts.tenantId,
      restaurantName: opts.restaurantName,
      branchId: opts.branchId,
      branchName: opts.branchName,
      deviceId: opts.deviceId,
      deviceName: opts.deviceName,
      oldVersion,
      newVersion: opts.installedVersion,
      status: 'success',
      updatedBy: opts.updatedBy,
    });
  }
}
