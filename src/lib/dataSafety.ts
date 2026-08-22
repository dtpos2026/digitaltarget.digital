// ============================================================
// v1.2.4 DATA-LOSS GUARD
//
// Reported: "Sync error ho, bills bane hon, aur sync hone se pehle app band
// kar ke ya logout kar ke login karein to saara data urh jata hai."
//
// Root cause: logout / clear-cache did a HARD WIPE — localStorage,
// sessionStorage, IndexedDB and CacheStorage — without ever checking whether
// local work had actually reached Firestore. Anything still queued (offline
// bills, failed writes) was destroyed with no warning and no way back.
//
// This module provides:
//   1. countUnsyncedWork()  — is there local work not yet on the server?
//   2. flushUnsyncedWork()  — try to push it now, with a timeout
//   3. emergencyBackup()    — always dump a JSON snapshot before destruction
// ============================================================
import { localDb } from './localDb';
import { getTenantId } from './tenant';

export interface UnsyncedSummary {
  queuedItems: number;   // offline sync-queue rows (bills, payments, …)
  pendingWrites: number; // in-flight Firestore writes
  total: number;
}

/** How much local work has NOT been confirmed by the server yet? */
export async function countUnsyncedWork(): Promise<UnsyncedSummary> {
  let queuedItems = 0;
  let pendingWrites = 0;
  try {
    const q = await localDb.readQueue();
    queuedItems = Array.isArray(q) ? q.length : 0;
  } catch {}
  try {
    const { getPendingWriteCount } = await import('./store');
    pendingWrites = getPendingWriteCount();
  } catch {}
  return { queuedItems, pendingWrites, total: queuedItems + pendingWrites };
}

/**
 * Try to push everything to the cloud before a destructive action.
 * Resolves with the work still outstanding after the attempt.
 */
export async function flushUnsyncedWork(timeoutMs = 8000): Promise<UnsyncedSummary> {
  try {
    // ===== v1.21.0 — this was flushing the WRONG queue =====
    // It called runSyncOnce() from syncWorker.ts, which was disconnected in
    // v1.7.0 and never runs. So the one function whose entire job is "push
    // everything to the cloud before we destroy local data" was pushing
    // nothing at all, then reporting how much was still outstanding —
    // truthfully, because it had not tried.
    //
    // deferredSync.ts is the canonical queue. flushDeferredOps() is what
    // actually sends.
    const { flushDeferredOps } = await import('./deferredSync');
    await Promise.race([
      flushDeferredOps(),
      new Promise((r) => setTimeout(r, timeoutMs)),
    ]);
  } catch (e) {
    console.warn('[dataSafety] pre-destructive flush failed', e);
  }
  return countUnsyncedWork();
}

/**
 * Always dump a local JSON snapshot before wiping. This is the last line of
 * defence: even if the cloud is unreachable, the operator keeps a file that
 * can be restored from Backup & Restore.
 */
export async function emergencyBackup(tag = 'pre-logout'): Promise<boolean> {
  try {
    const { exportData } = await import('./store');
    const json = exportData();
    if (!json || json.length < 20) return false;
    const tid = getTenantId() || 'unknown';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // Keep a copy inside the app too (survives even if the download is
    // blocked/cancelled) — stored under a key the wipe routines preserve.
    try {
      localStorage.setItem(`dt-pos-emergency-backup::${tid}`, JSON.stringify({ at: stamp, tag, json }));
    } catch {}

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dtpos-${tag}-backup-${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
}

/** Emergency backups are never wiped — this key prefix is protected. */
export const EMERGENCY_BACKUP_PREFIX = 'dt-pos-emergency-backup::';

export function getEmergencyBackup(): { at: string; tag: string; json: string } | null {
  try {
    const raw = localStorage.getItem(`${EMERGENCY_BACKUP_PREFIX}${getTenantId() || 'unknown'}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
