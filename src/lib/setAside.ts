// ============================================================
// SET ASIDE (v1.110.0) — records that cannot be saved here, and never will be.
//
// Live logs showed bursts of ten `POST /customers → 403` every ~25 minutes and, with each burst, the toast "Cloud sync issue" /
// "Sync rejected". Cause (see syncErrors.ts): a record carried over from ANOTHER restaurant derives the same cloud id as that
// restaurant's row, PostgREST upserts it as INSERT … ON CONFLICT DO UPDATE, and row-level security refuses the UPDATE with
// "(USING expression)". Isolation is working; retrying can never help — so retrying only repeats the noise.
//
// The fix is to stop pretending: such a record is set aside (kept, untouched, never uploaded), the retry queue forgets it, no toast
// is shown, and Admin → Data Integrity lists what was set aside. A plain network error is NOT set aside — it keeps retrying.
// ============================================================
import { getTenantId } from '@/lib/tenant';

export interface SetAsideRecord { col: string; id: string; reason: string; at: string }

const key = () => `dt-set-aside::${getTenantId() || 'local'}`;
const MAX = 500;

/** True only for the cross-restaurant collision: an upsert refused by the UPDATE policy of a row that is not ours. */
export function isForeignRecordError(e: unknown): boolean {
  const msg = String((e as { message?: string } | null)?.message || e || '');
  return /row-level security policy \(USING expression\)/i.test(msg);
}

export function getSetAside(): SetAsideRecord[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key()) || '[]');
    return Array.isArray(raw) ? raw.filter(r => r && typeof r.col === 'string' && typeof r.id === 'string') : [];
  } catch { return []; }
}

const write = (list: SetAsideRecord[]) => { try { localStorage.setItem(key(), JSON.stringify(list.slice(-MAX))); } catch { /* private mode */ } };

export function isSetAside(col: string, id: string): boolean {
  return getSetAside().some(r => r.col === col && r.id === id);
}

/** Remember a record as set aside. Returns true the first time (so the caller can log once). */
export function setAside(col: string, id: string, reason: string): boolean {
  const list = getSetAside();
  if (list.some(r => r.col === col && r.id === id)) return false;
  write([...list, { col, id, reason: reason.slice(0, 200), at: new Date().toISOString() }]);
  try { window.dispatchEvent(new CustomEvent('dt-set-aside')); } catch { /* no window */ }
  return true;
}

/** Let a record try again (the owner pressed "Try again", or it was repaired). */
export function releaseSetAside(col?: string, id?: string): number {
  const list = getSetAside();
  const keep = list.filter(r => !(col === undefined || (r.col === col && (id === undefined || r.id === id))));
  write(keep);
  try { window.dispatchEvent(new CustomEvent('dt-set-aside')); } catch { /* no window */ }
  return list.length - keep.length;
}

/** "save customers/abc123" → { col, id }. */
export function parseSaveLabel(label: string): { col: string; id: string } | null {
  const m = /^save ([A-Za-z_]+)\/(.+)$/.exec(label.trim());
  return m ? { col: m[1], id: m[2] } : null;
}

/**
 * v1.128.0 — the BATCH path of the sync queue (registerDeferredBatchFlusher) never asked this list, which is why the 403s kept coming.
 * Live logs, 21 Nov 2026: 86 `POST /customers -> 403` from one restaurant in seven hours, long after v1.110.0. The per-record paths
 * skip a set-aside record; the batch path (one request for up to 100 records) sent them again on every flush, and a rejected chunk is
 * retried record by record, so each flush produced a burst of refused requests, each burst counted a retry, and after six the record
 * went to the dead-letter list the status bar shows as "sync needs attention". The re-queue after a cloud reload did the same.
 */
export function partitionSetAside(col: string, ids: readonly string[]): { send: string[]; skipped: string[] } {
  const send: string[] = []; const skipped: string[] = [];
  for (const id of ids) (isSetAside(col, id) ? skipped : send).push(id);
  return { send, skipped };
}

/** A batch failure that is "another restaurant's record" is set aside and SETTLED (never retried); everything else still fails and retries. */
export function settleBatchFailures<T extends { id: string; error: string }>(col: string, failed: readonly T[]): { settled: string[]; failed: T[] } {
  const settled: string[] = []; const rest: T[] = [];
  for (const f of failed) {
    if (isForeignRecordError(f.error)) { setAside(col, f.id, f.error); settled.push(f.id); } else rest.push(f);
  }
  return { settled, failed: rest };
}
