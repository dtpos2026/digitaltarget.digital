import { firestoreUnavailable, legacyRead } from './legacyFirebaseGuard';
// ============================================================
// DT POS — Zero Data Loss Update System (v1.0.7)
// Pre-update backup + post-update history + rollback markers.
// All data stays in Firestore (tenants/{tid}/*). This module
// only adds a *safety net* so a faulty Windows update can't
// destroy local state without a recoverable snapshot.
// ============================================================
import { fbDb, isFirebaseConfigured } from './firebase';
import { getTenantId, getDeviceId, getDeviceMeta } from './tenant';
import { exportData } from './store';
import {
  collection, doc, setDoc, getDocs, query, orderBy, limit,
  deleteDoc, serverTimestamp, getDoc,
} from 'firebase/firestore';

const LS_LAST_VER = 'dt_pos_last_installed_version';
const LS_LAST_BACKUP_AT = 'dt_pos_last_update_backup_at';
const LS_LAST_BACKUP_ID = 'dt_pos_last_update_backup_id';
const LS_ROLLBACK_PENDING = 'dt_pos_rollback_pending';
const LS_LAST_INSPECT_AT = 'dt_pos_last_inspect_at';
const LS_SYNC_HEALTH = 'dt_pos_sync_health';

const MAX_UPDATE_BACKUPS = 10;

export interface UpdateHistoryEntry {
  id: string;
  tenantId: string;
  deviceId: string;
  deviceName?: string;
  fromVersion: string;
  toVersion: string;
  startedAtMs: number;
  finishedAtMs: number;
  durationMs: number;
  success: boolean;
  rollback?: boolean;
  backupId?: string;
  backupBytes?: number;
  cloudBackup?: boolean;
  localBackup?: boolean;
  updatedBy?: string;
  errorMessage?: string;
}

function backupsCol() {
  if (!isFirebaseConfigured()) return null;
  const tid = getTenantId(); if (!tid) return null;
  return collection(fbDb(), 'tenants', tid, 'updateBackups');
}
function historyCol() {
  if (!isFirebaseConfigured()) return null;
  const tid = getTenantId(); if (!tid) return null;
  return collection(fbDb(), 'tenants', tid, 'updateHistory');
}

/** Save a JSON blob (or chunked) to tenants/{tid}/updateBackups. */
async function saveBackupBlob(json: string, id: string): Promise<{ ok: boolean; bytes: number }> {
  const col = backupsCol();
  const bytes = new TextEncoder().encode(json).length;
  if (!col) return { ok: false, bytes };
  try {
    if (bytes <= 900_000) {
      await setDoc(doc(col, id), {
        id, json, bytes, kind: 'pre-update',
        createdAt: serverTimestamp(), createdAtMs: Date.now(),
      });
    } else {
      const chunkSize = 800_000;
      const chunks: string[] = [];
      for (let i = 0; i < json.length; i += chunkSize) chunks.push(json.slice(i, i + chunkSize));
      await setDoc(doc(col, id), {
        id, bytes, kind: 'pre-update', chunked: true, chunkCount: chunks.length,
        createdAt: serverTimestamp(), createdAtMs: Date.now(),
      });
      for (let i = 0; i < chunks.length; i++) {
        await setDoc(doc(col, `${id}__${i}`), { parentId: id, index: i, data: chunks[i] });
      }
    }
    pruneOldBackups().catch(() => {});
    return { ok: true, bytes };
  } catch (e) {
    console.warn('[updateSafety] cloud backup failed', e);
    return { ok: false, bytes };
  }
}

async function pruneOldBackups() {
  const col = backupsCol(); if (!col) return;
  try {
    const snap = await getDocs(query(col, orderBy('createdAtMs', 'desc'), limit(MAX_UPDATE_BACKUPS + 50)));
    const docs = snap.docs.filter(d => !d.id.includes('__'));
    if (docs.length <= MAX_UPDATE_BACKUPS) return;
    for (const d of docs.slice(MAX_UPDATE_BACKUPS)) {
      try { await deleteDoc(d.ref); } catch {}
      const data = d.data() as any;
      if (data?.chunked && data?.chunkCount) {
        for (let i = 0; i < data.chunkCount; i++) {
          try { await deleteDoc(doc(col, `${d.id}__${i}`)); } catch {}
        }
      }
    }
  } catch {}
}

/** Trigger a local download as a hard offline fallback. */
function downloadLocal(json: string, filename: string) {
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    return true;
  } catch { return false; }
}

/** Detect version change and create a backup BEFORE handing off to the new code paths. */
export async function runPreUpdateBackupIfNeeded(installedVersion: string): Promise<{
  changed: boolean; from?: string; to?: string; backupId?: string;
}> {
  const prev = localStorage.getItem(LS_LAST_VER);
  if (!prev) {
    // First boot of this version on this device — just stamp, no backup.
    localStorage.setItem(LS_LAST_VER, installedVersion);
    return { changed: false };
  }
  if (prev === installedVersion) return { changed: false };

  const startedAtMs = Date.now();
  const id = `upd_${prev}_to_${installedVersion}_${startedAtMs}`;
  let backupBytes = 0;
  let cloudOk = false;
  let localOk = false;
  let errorMessage: string | undefined;

  try {
    const json = exportData();
    backupBytes = new TextEncoder().encode(json).length;
    // 1) Cloud backup first (preferred, survives device wipe)
    const cloudRes = await saveBackupBlob(json, id);
    cloudOk = cloudRes.ok;
    // 2) Local backup (silent — no download dialog, store in IndexedDB-like LS slot)
    try {
      // Keep only the latest local snapshot to avoid bloating localStorage.
      localStorage.setItem('dt_pos_pre_update_backup', json);
      localStorage.setItem('dt_pos_pre_update_backup_meta', JSON.stringify({
        id, fromVersion: prev, toVersion: installedVersion, bytes: backupBytes, ts: startedAtMs,
      }));
      localOk = true;
    } catch (e) {
      // localStorage quota — that's fine, cloud is the primary.
      localOk = false;
    }
  } catch (e: any) {
    errorMessage = e?.message || String(e);
  }

  const finishedAtMs = Date.now();
  const meta = getDeviceMeta();
  const tid = getTenantId() || '';
  const did = getDeviceId() || '';

  const entry: UpdateHistoryEntry = {
    id, tenantId: tid, deviceId: did, deviceName: meta?.deviceName,
    fromVersion: prev, toVersion: installedVersion,
    startedAtMs, finishedAtMs, durationMs: finishedAtMs - startedAtMs,
    success: cloudOk || localOk,
    backupId: id, backupBytes,
    cloudBackup: cloudOk, localBackup: localOk,
    errorMessage,
  };

  // Pull updatedBy from current user if present
  try {
    const u = JSON.parse(localStorage.getItem('dt_pos_current_user') || 'null');
    entry.updatedBy = u?.name || u?.username || u?.email;
  } catch {}

  const col = historyCol();
  if (col) {
    try {
      await setDoc(doc(col, id), { ...entry, createdAt: serverTimestamp() });
    } catch (e) { console.warn('[updateSafety] history save failed', e); }
  }

  // Stamp success
  localStorage.setItem(LS_LAST_VER, installedVersion);
  localStorage.setItem(LS_LAST_BACKUP_AT, String(finishedAtMs));
  localStorage.setItem(LS_LAST_BACKUP_ID, id);
  localStorage.removeItem(LS_ROLLBACK_PENDING);

  return { changed: true, from: prev, to: installedVersion, backupId: id };
}

/** Manual backup trigger (user-initiated from Update Safety dashboard). */
export async function runManualBackup(opts?: { downloadLocally?: boolean }): Promise<{
  ok: boolean; id: string; bytes: number; cloud: boolean; local: boolean;
}> {
  const id = `manual_${Date.now()}`;
  const json = exportData();
  const bytes = new TextEncoder().encode(json).length;
  const cloudRes = await saveBackupBlob(json, id);
  let local = false;
  if (opts?.downloadLocally) {
    local = downloadLocal(json, `dtpos-backup-${id}.json`);
  } else {
    try {
      localStorage.setItem('dt_pos_pre_update_backup', json);
      localStorage.setItem('dt_pos_pre_update_backup_meta', JSON.stringify({
        id, kind: 'manual', bytes, ts: Date.now(),
      }));
      local = true;
    } catch { local = false; }
  }
  localStorage.setItem(LS_LAST_BACKUP_AT, String(Date.now()));
  localStorage.setItem(LS_LAST_BACKUP_ID, id);
  return { ok: cloudRes.ok || local, id, bytes, cloud: cloudRes.ok, local };
}

/** List recent update history entries for this tenant. */
export async function listUpdateHistory(max = 50): Promise<UpdateHistoryEntry[]> {
  if (firestoreUnavailable()) return legacyRead([] as any, 'listUpdateHistory');

  const col = historyCol(); if (!col) return [];
  try {
    const snap = await getDocs(query(col, orderBy('startedAtMs', 'desc'), limit(max)));
    return snap.docs.map(d => d.data() as UpdateHistoryEntry);
  } catch { return []; }
}

/** List recent pre-update backups (without full json payload). */
export async function listUpdateBackups(max = 20): Promise<Array<{
  id: string; bytes: number; createdAtMs: number; kind?: string;
}>> {
  if (firestoreUnavailable()) return legacyRead([] as any, 'listUpdateBackups');
  const col = backupsCol(); if (!col) return [];
  try {
    const snap = await getDocs(query(col, orderBy('createdAtMs', 'desc'), limit(max + 50)));
    return snap.docs
      .filter(d => !d.id.includes('__'))
      .slice(0, max)
      .map(d => {
        const x: any = d.data();
        return { id: x.id || d.id, bytes: x.bytes || 0, createdAtMs: x.createdAtMs || 0, kind: x.kind };
      });
  } catch { return []; }
}

/** Restore a backup JSON from cloud (rebuilds chunks if needed). */
export async function fetchBackupJson(id: string): Promise<string | null> {
  if (firestoreUnavailable()) return legacyRead(null as any, 'fetchBackupJson');

  const col = backupsCol(); if (!col) return null;
  try {
    const head = await getDoc(doc(col, id));
    if (!head.exists()) return null;
    const data: any = head.data();
    if (!data.chunked) return data.json || null;
    const parts: string[] = [];
    for (let i = 0; i < data.chunkCount; i++) {
      const c = await getDoc(doc(col, `${id}__${i}`));
      if (!c.exists()) return null;
      parts.push((c.data() as any).data || '');
    }
    return parts.join('');
  } catch { return null; }
}

/** Mark that the previous update attempt failed → next boot should rollback. */
export function markRollbackPending(reason: string) {
  localStorage.setItem(LS_ROLLBACK_PENDING, JSON.stringify({ reason, ts: Date.now() }));
}

export function getRollbackPending(): { reason: string; ts: number } | null {
  try { return JSON.parse(localStorage.getItem(LS_ROLLBACK_PENDING) || 'null'); } catch { return null; }
}

export function clearRollbackPending() { localStorage.removeItem(LS_ROLLBACK_PENDING); }

/** Last successful backup timestamp on this device. */
export function getLastBackupAt(): number | null {
  const v = localStorage.getItem(LS_LAST_BACKUP_AT);
  return v ? Number(v) : null;
}

export function getLastBackupId(): string | null {
  return localStorage.getItem(LS_LAST_BACKUP_ID);
}

export function getLastInspectAt(): number | null {
  const v = localStorage.getItem(LS_LAST_INSPECT_AT);
  return v ? Number(v) : null;
}

export type SyncHealth = 'healthy' | 'warning' | 'error' | 'unknown';

export function getSyncHealth(): SyncHealth {
  return (localStorage.getItem(LS_SYNC_HEALTH) as SyncHealth) || 'unknown';
}

export function setSyncHealth(h: SyncHealth) {
  localStorage.setItem(LS_SYNC_HEALTH, h);
}

export function stampInspection() {
  localStorage.setItem(LS_LAST_INSPECT_AT, String(Date.now()));
}
