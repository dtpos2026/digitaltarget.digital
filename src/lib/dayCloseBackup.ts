// Cloud-backed Day Close snapshots + audit log.
// Local JSON download stays (user safety), but we also push a copy to
// Firestore so backup history survives across devices / browser resets.
import { getTenantId } from './tenant';
import { fbDb, isFirebaseConfigured } from './firebase';
import { doc, setDoc, collection, getDocs, query, orderBy, limit, deleteDoc, serverTimestamp } from 'firebase/firestore';

export interface DayCloseLogEntry {
  id: string;
  closedAt: string;          // ISO
  closedByUid: string;
  closedByName: string;
  orderCount: number;
  cleared: {
    paid: number;
    runningHold: number;
    voidComp: number;
    credit: number;
  };
  config: Record<string, boolean>;
  backupBytes?: number;
}

const MAX_BACKUPS = 30; // keep last 30 day-close JSON snapshots in cloud

function backupsCol() {
  if (!isFirebaseConfigured()) return null;
  const tid = getTenantId(); if (!tid) return null;
  return collection(fbDb(), 'tenants', tid, 'dayCloseBackups');
}
function logCol() {
  if (!isFirebaseConfigured()) return null;
  const tid = getTenantId(); if (!tid) return null;
  return collection(fbDb(), 'tenants', tid, 'dayCloseLog');
}

/** Save backup JSON to Firestore. Returns true on success. Best-effort. */
export async function saveBackupToCloud(json: string, id: string): Promise<boolean> {
  // ===== v1.19.3 — Supabase path =====
  // Day Close takes a backup BEFORE deleting anything. If that backup silently
  // fails, the deletion still proceeds and the day is gone. So this must work
  // on whichever backend the session belongs to, and must report honestly.
  //
  // Postgres has no 1 MB document ceiling, so the chunking the Firestore path
  // needs below is simply not required here — one row, whatever the size.
  try {
    const { usingSupabaseAuth, authTenantId, authBranchId } = await import('./authProvider');
    if (usingSupabaseAuth()) {
      const tid = authTenantId();
      if (!tid) return false;
      const { sb } = await import('./supabase');
      // day_closes is a document table (id/tenant_id/branch_id/data) — all
      // metadata lives inside `data`, and the row id must be a real UUID.
      const rowId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`) as string;
      const bytes = new TextEncoder().encode(json).length;
      const path = `${tid}/dayclose/${id}.json`;

      // Payload goes to Storage first — if that fails we must NOT report success.
      const blob = new Blob([json], { type: 'application/json' });
      const up = await sb().storage.from('branding').upload(path, blob, { upsert: true });
      if (up.error) {
        console.error('[dayClose] backup payload upload failed', up.error.message);
        return false;
      }

      const { error } = await sb().from('day_closes').insert({
        id: rowId,
        tenant_id: tid,
        branch_id: authBranchId() || null,
        data: {
          key: id,
          business_date: new Date().toISOString().slice(0, 10),
          closed_at: new Date().toISOString(),
          bytes,
          backup_path: path,
        },
      });
      if (error) { console.error('[dayClose] cloud backup failed', error.message); return false; }
      return true;
    }
  } catch (e) {
    console.error('[dayClose] supabase backup threw', e);
    return false;
  }


  const col = backupsCol(); if (!col) return false;
  try {
    // Firestore doc size limit ~1MB. Chunk if larger.
    const bytes = new TextEncoder().encode(json).length;
    if (bytes <= 900_000) {
      await setDoc(doc(col, id), {
        id, json, bytes,
        createdAt: serverTimestamp(),
        createdAtMs: Date.now(),
      });
    } else {
      // Split into ~800KB chunks
      const chunkSize = 800_000;
      const chunks: string[] = [];
      for (let i = 0; i < json.length; i += chunkSize) chunks.push(json.slice(i, i + chunkSize));
      await setDoc(doc(col, id), {
        id, bytes,
        chunked: true,
        chunkCount: chunks.length,
        createdAt: serverTimestamp(),
        createdAtMs: Date.now(),
      });
      for (let i = 0; i < chunks.length; i++) {
        await setDoc(doc(col, `${id}__${i}`), { parentId: id, index: i, data: chunks[i] });
      }
    }
    // Prune old
    pruneOldBackups().catch(() => {});
    return true;
  } catch (e) {
    console.error('[dayCloseBackup] cloud save failed', e);
    return false;
  }
}

async function pruneOldBackups() {
  const col = backupsCol(); if (!col) return;
  try {
    const snap = await getDocs(query(col, orderBy('createdAtMs', 'desc'), limit(MAX_BACKUPS + 50)));
    const docs = snap.docs.filter(d => !d.id.includes('__'));
    if (docs.length <= MAX_BACKUPS) return;
    const toDelete = docs.slice(MAX_BACKUPS);
    for (const d of toDelete) {
      await deleteDoc(d.ref);
      // delete chunks if any
      const data = d.data() as any;
      if (data?.chunked && data?.chunkCount) {
        for (let i = 0; i < data.chunkCount; i++) {
          try { await deleteDoc(doc(col, `${d.id}__${i}`)); } catch {}
        }
      }
    }
  } catch {}
}

/** Append an audit-log entry for this Day Close. */
export async function logDayCloseEvent(entry: DayCloseLogEntry): Promise<void> {
  try {
    const { usingSupabaseAuth, authTenantId, authBranchId } = await import('./authProvider');
    if (usingSupabaseAuth()) {
      const tid = authTenantId();
      if (!tid) return;
      const { sb } = await import('./supabase');
      const rowId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`) as string;
      const { error } = await sb().from('day_closes').insert({
        id: rowId,
        tenant_id: tid,
        branch_id: authBranchId() || null,
        data: { type: 'log', ...entry },
      });
      if (error) console.error('[dayClose] audit log failed', error.message);
      return;
    }
  } catch (e) {
    console.error('[dayClose] audit log threw', e);
    return;
  }

  const col = logCol(); if (!col) return;

  try {
    await setDoc(doc(col, entry.id), {
      ...entry,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error('[dayCloseBackup] audit log failed', e);
  }
}
