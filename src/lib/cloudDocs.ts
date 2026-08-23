// ============================================================
// Cloud mirror for the remaining localStorage-only modules.
//
// Promotions, Item Variations, Customer Wallet, Campaigns, Delivery Zones and
// the Daily Wages module used to live ONLY on the device: a browser reset or a
// second till meant the data was gone. They keep their local-first behaviour
// (writes never wait for the network) but are now mirrored, per record, into
// public.module_documents so nothing is device-bound any more.
// ============================================================
import { sb, isSupabaseConfigured, currentTenantId, currentBranchId } from './supabase';

/** Local key -> module kind stored in the cloud (list-shaped modules). */
export const MIRRORED_KEYS = [
  'dt-promotions',
  'dt-variations',
  'dt-wallet-entries',
  'dt-campaigns',
  'dt-zones',
  'dt-wage-workers',
  'dt-wage-entries',
  'dt-wage-payments',
  'dt-wage-audit',
  // Blocked customers / locations are fraud controls: if they stay on one
  // till, a blocked number can simply order from the next device.
  'pos-blocked-customers',
  'pos-blocked-locations',
] as const;
export type MirroredKey = typeof MIRRORED_KEYS[number];

/**
 * Single-value modules (one setting or one keyed object rather than a list).
 * They are stored as one document per key so they survive a browser reset and
 * follow the restaurant to every device.
 */
export const MIRRORED_VALUE_KEYS = [
  'pos-marketing-template',      // WhatsApp/SMS campaign template
  // v1.27.0 — 'dt-online-accounts-v2' was removed from this list. It carried
  // EVERY customer of a restaurant, PIN hashes included, in one document.
  // Customer accounts are rows in `customers` now, reached through the
  // public_customer_* RPCs with a per-customer session token.
  'dt-admin-signature-dataurl',  // agreement signature
  'dt-admin-stamp-dataurl',      // agreement stamp
  'dt-admin-agreement-custom',   // custom agreement text
  'dt-admin-signature',
] as const;
export type MirroredValueKey = typeof MIRRORED_VALUE_KEYS[number];

const VALUE_DOC_ID = '_value';

const isMirrored = (k: string): k is MirroredKey =>
  (MIRRORED_KEYS as readonly string[]).includes(k);

const isMirroredValue = (k: string): k is MirroredValueKey =>
  (MIRRORED_VALUE_KEYS as readonly string[]).includes(k);


const RETRY_KEY = 'dt-cloud-docs-retry';
const SNAP_KEY = (k: string) => `dt-cloud-docs-snap:${k}`;
/**
 * When each record was last changed ON THIS DEVICE.
 *
 * hydrateCloudDocs() used to let the cloud copy win unconditionally, so an
 * edit made offline was overwritten by the older server copy at the next boot
 * — the same class of silent loss that settings had. These modules keep no
 * `_updatedAt` of their own, so the local change time is recorded here and
 * compared against the row's server `updated_at`.
 */
const LOCALAT_KEY = (k: string) => `dt-cloud-docs-localat:${k}`;

interface PendingRow { kind: string; doc_id: string; data: any; deleted: boolean; at: number }

function readJson<T>(key: string, fallback: T): T {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) as T : fallback; }
  catch { return fallback; }
}
function writeJson(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* quota */ }
}

function ready(): boolean {
  return typeof window !== 'undefined' && isSupabaseConfigured() && !!currentTenantId();
}

function queue(rows: PendingRow[]) {
  if (!rows.length) return;
  const all = readJson<PendingRow[]>(RETRY_KEY, []);
  for (const r of rows) {
    const i = all.findIndex(x => x.kind === r.kind && x.doc_id === r.doc_id);
    if (i >= 0) all[i] = r; else all.push(r);
  }
  // Never let the retry buffer grow without bound.
  writeJson(RETRY_KEY, all.slice(-4000));
}

async function pushRows(rows: PendingRow[]): Promise<boolean> {
  if (!rows.length) return true;
  if (!ready()) { queue(rows); return false; }
  const tenantId = currentTenantId()!;
  const branchId = currentBranchId();
  try {
    const payload = rows.map(r => ({
      tenant_id: tenantId,
      branch_id: branchId,
      kind: r.kind,
      doc_id: r.doc_id,
      data: r.data ?? {},
      deleted_at: r.deleted ? new Date(r.at).toISOString() : null,
      updated_at: new Date(r.at).toISOString(),
    }));
    const { error } = await sb()
      .from('module_documents')
      .upsert(payload, { onConflict: 'tenant_id,kind,doc_id' });
    if (error) throw error;
    return true;
  } catch (e) {
    console.warn('[cloudDocs] push failed — kept for retry', e);
    queue(rows);
    return false;
  }
}

/**
 * Mirror a whole list after a local write. Only records that actually changed
 * (or disappeared) are sent, so repeated saves stay cheap.
 */
export function mirrorList(key: string, items: any[]): void {
  if (!isMirrored(key)) return;
  const kind = key;
  const prev = readJson<Record<string, string>>(SNAP_KEY(key), {});
  const next: Record<string, string> = {};
  const now = Date.now();
  const changed: PendingRow[] = [];

  for (const it of items || []) {
    const id = String(it?.id ?? '');
    if (!id) continue;
    const sig = JSON.stringify(it);
    next[id] = sig;
    if (prev[id] !== sig) changed.push({ kind, doc_id: id, data: it, deleted: false, at: now });
  }
  for (const id of Object.keys(prev)) {
    if (!(id in next)) changed.push({ kind, doc_id: id, data: {}, deleted: true, at: now });
  }

  writeJson(SNAP_KEY(key), next);
  if (!changed.length) return;
  // Remember WHEN this device changed each record, so a later hydrate can tell
  // whether the server's copy is actually newer than ours.
  const localAt = readJson<Record<string, number>>(LOCALAT_KEY(key), {});
  for (const r of changed) localAt[r.doc_id] = now;
  writeJson(LOCALAT_KEY(key), localAt);
  void pushRows(changed);
}

/**
 * Mirror a single-value module (a template, a signature, a keyed registry).
 * Local write stays instant; the cloud copy follows and is re-tried offline.
 */
export function mirrorValue(key: string, value: unknown): void {
  if (!isMirroredValue(key)) return;
  const sig = JSON.stringify(value ?? null);
  const prev = readJson<Record<string, string>>(SNAP_KEY(key), {});
  if (prev[VALUE_DOC_ID] === sig) return;
  writeJson(SNAP_KEY(key), { [VALUE_DOC_ID]: sig });
  void pushRows([{
    kind: key, doc_id: VALUE_DOC_ID,
    data: { id: VALUE_DOC_ID, value: value ?? null },
    deleted: false, at: Date.now(),
  }]);
}


/**
 * Retry anything that could not reach the cloud earlier.
 *
 * ===== v1.26.0 — this used to empty the buffer BEFORE sending =====
 * The old order was: read the buffer, write [] over it, then push. Closing the
 * tab (or losing the connection at the wrong moment) between the write and the
 * push destroyed the batch — pushRows() can only re-queue rows if it is still
 * running. Nothing is removed now until the server has accepted it, and rows
 * queued while the push was in flight are preserved by matching on identity
 * rather than by overwriting the whole buffer.
 */
export async function flushCloudDocs(): Promise<void> {
  const all = readJson<PendingRow[]>(RETRY_KEY, []);
  if (!all.length || !ready()) return;
  const ok = await pushRows(all);
  if (!ok) return;   // still unsent — the buffer is untouched, so nothing is lost
  const sent = new Set(all.map(r => `${r.kind}\u0000${r.doc_id}\u0000${r.at}`));
  const remaining = readJson<PendingRow[]>(RETRY_KEY, [])
    .filter(r => !sent.has(`${r.kind}\u0000${r.doc_id}\u0000${r.at}`));
  writeJson(RETRY_KEY, remaining);
}

/**
 * Pull every mirrored module down from the cloud and merge into localStorage.
 * Newer copy wins per record; a cloud tombstone removes the local record.
 */
export async function hydrateCloudDocs(): Promise<void> {
  if (!ready()) return;
  const tenantId = currentTenantId()!;
  try {
    const { data, error } = await sb()
      .from('module_documents')
      .select('kind, doc_id, data, deleted_at, updated_at')
      .eq('tenant_id', tenantId);
    if (error || !data) return;

    const byKind = new Map<string, any[]>();
    for (const row of data) {
      const arr = byKind.get(row.kind) ?? [];
      arr.push(row);
      byKind.set(row.kind, arr);
    }

    for (const key of MIRRORED_KEYS) {
      const rows = byKind.get(key) ?? [];
      const local = readJson<any[]>(key, []);
      if (!rows.length && !local.length) continue;
      const localAt = readJson<Record<string, number>>(LOCALAT_KEY(key), {});

      const merged = new Map<string, any>();
      for (const it of local) if (it?.id) merged.set(String(it.id), it);

      // Records the cloud confirmed and we adopted — only these may have their
      // signature banked below.
      const fromCloud = new Set<string>();

      for (const row of rows) {
        const id = String(row.doc_id);
        const cloudAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
        // ===== v1.26.0 — the cloud used to win unconditionally =====
        // An edit made on this device while offline was replaced by the older
        // server copy at the next boot, and nothing said so. Deletions get the
        // same rule: a tombstone is an edit, and the newer edit wins.
        if (Number(localAt[id] || 0) > cloudAt && merged.has(id)) continue;
        if (row.deleted_at) merged.delete(id);
        else merged.set(id, { id: row.doc_id, ...(row.data || {}) });
        fromCloud.add(id);
      }

      const list = Array.from(merged.values());
      writeJson(key, list);

      // ===== v1.26.0 — hydration used to silence records it had never sent =====
      // The snapshot was rebuilt from the MERGED list, so a local record the
      // cloud had never seen — one whose push failed — got its signature
      // banked as though it had synced. mirrorList() then saw it as unchanged
      // and never offered it again: permanently stranded on one device, and
      // permanently invisible.
      //
      // Only a record the SERVER confirmed may be marked as in sync. Everything
      // else is pushed right now, which is what should have happened before.
      const snap = readJson<Record<string, string>>(SNAP_KEY(key), {});
      const now = Date.now();
      const toPush: PendingRow[] = [];
      for (const it of list) {
        const id = String(it.id);
        if (fromCloud.has(id)) { snap[id] = JSON.stringify(it); continue; }
        delete snap[id];
        toPush.push({ kind: key, doc_id: id, data: it, deleted: false, at: localAt[id] || now });
      }
      for (const id of Object.keys(snap)) if (!merged.has(id)) delete snap[id];
      writeJson(SNAP_KEY(key), snap);
      if (toPush.length) {
        console.warn(`[cloudDocs] ${key}: ${toPush.length} record(s) exist only on this device — uploading`);
        void pushRows(toPush);
      }

      try { window.dispatchEvent(new CustomEvent('dt-wages-changed')); } catch { /* no-op */ }
      try { window.dispatchEvent(new CustomEvent('dt-blocklist-changed')); } catch { /* no-op */ }
    }

    for (const key of MIRRORED_VALUE_KEYS) {
      const row = (byKind.get(key) || []).find(r => String(r.doc_id) === VALUE_DOC_ID);
      if (!row || row.deleted_at) continue;
      const value = (row.data || {}).value;
      if (value === undefined || value === null) continue;
      try {
        // Plain strings (templates, data URLs) are stored raw; objects as JSON.
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      } catch { /* quota */ }
      writeJson(SNAP_KEY(key), { [VALUE_DOC_ID]: JSON.stringify(value) });
    }
  } catch { /* offline — local data stays authoritative */ }

}

let installed = false;
/** Boot hook: hydrate once, then retry pending writes periodically. */
export function installCloudDocs(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  void hydrateCloudDocs().then(flushCloudDocs);
  window.addEventListener('online', () => { void flushCloudDocs(); });
  setInterval(() => { void flushCloudDocs(); }, 20_000);
}
