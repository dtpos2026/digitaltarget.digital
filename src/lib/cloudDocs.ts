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
  'dt-online-accounts-v2',       // customer portal accounts registry
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
  } catch {
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
  if (changed.length) void pushRows(changed);
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


/** Retry anything that could not reach the cloud earlier. */
export async function flushCloudDocs(): Promise<void> {
  const all = readJson<PendingRow[]>(RETRY_KEY, []);
  if (!all.length || !ready()) return;
  writeJson(RETRY_KEY, []);
  const ok = await pushRows(all);
  if (!ok) return; // pushRows re-queued them
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
      const rows = byKind.get(key);
      if (!rows || !rows.length) continue;
      const local = readJson<any[]>(key, []);
      const merged = new Map<string, any>();
      for (const it of local) if (it?.id) merged.set(String(it.id), it);
      for (const row of rows) {
        if (row.deleted_at) merged.delete(String(row.doc_id));
        else merged.set(String(row.doc_id), { id: row.doc_id, ...(row.data || {}) });
      }
      const list = Array.from(merged.values());
      writeJson(key, list);
      // Refresh the signature snapshot so hydration does not re-push everything.
      const snap: Record<string, string> = {};
      for (const it of list) snap[String(it.id)] = JSON.stringify(it);
      writeJson(SNAP_KEY(key), snap);
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
