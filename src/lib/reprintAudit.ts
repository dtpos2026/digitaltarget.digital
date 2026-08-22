/**
 * Reprint Audit Log — every customer-receipt reprint from the Bill Reprint
 * page records an entry. Local-first, then best-effort Firestore mirror.
 * Read-only on the UI: cashier cannot edit / delete entries.
 */
import { fbDb, isFirebaseConfigured } from './firebase';
import { getTenantId } from './tenant';
import { collection, doc, setDoc, getDocs, serverTimestamp, query, orderBy, limit } from 'firebase/firestore';

const LS_KEY = 'pos-reprint-audit-v1';

export interface ReprintAuditEntry {
  id: string;
  at: string;              // ISO
  orderId: string;
  billNumber: number;
  reprintedBy: string;
  reprintedByRole?: string;
  orderStatus: string;
  type: 'receipt' | 'kot' | 'token';
}

function readLocal(): ReprintAuditEntry[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function writeLocal(arr: ReprintAuditEntry[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(0, 1000))); } catch {}
}

export function getReprintLog(): ReprintAuditEntry[] {
  return readLocal().sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export function logReprint(opts: {
  orderId: string;
  billNumber: number;
  orderStatus: string;
  type?: 'receipt' | 'kot' | 'token';
}): ReprintAuditEntry {
  const entry: ReprintAuditEntry = {
    id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    orderId: opts.orderId,
    billNumber: opts.billNumber,
    orderStatus: opts.orderStatus,
    type: opts.type || 'receipt',
    reprintedBy: localStorage.getItem('pos-user-name') || localStorage.getItem('pos-user-id') || 'unknown',
    reprintedByRole: localStorage.getItem('pos-user-role') || undefined,
  };
  const all = readLocal();
  all.unshift(entry);
  writeLocal(all);

  // Best-effort cloud mirror. The local copy above is already written, so a
  // cloud failure never blocks a reprint at the counter.
  void mirrorToCloud(entry);
  return entry;
}

/**
 * v1.19.0 — mirror to whichever backend this restaurant is on.
 *
 * Reprints are an audit trail: who reprinted which bill, when. On Supabase the
 * row lands in `reprint_logs`, which has an INSERT+SELECT policy and no UPDATE
 * or DELETE policy at all — so an entry physically cannot be altered or erased
 * through the API once written. That is stronger than the Firestore version,
 * where a rules change could have permitted an edit.
 */
async function mirrorToCloud(entry: ReprintAuditEntry): Promise<void> {
  try {
    const { usingSupabaseAuth } = await import('./authProvider');
    if (usingSupabaseAuth()) {
      const { sb } = await import('./supabase');
      const { authTenantId, authBranchId } = await import('./authProvider');
      const tid = authTenantId();
      if (!tid) return;
      await sb().from('reprint_logs').insert({
        id: crypto.randomUUID(),
        tenant_id: tid,
        branch_id: authBranchId(),
        order_id: entry.orderId,
        kind: entry.type,
        reprinted_at: entry.at,
        reprinted_by_name: entry.reprintedBy,
        reason: entry.reprintedByRole ?? null,
      });
      return;
    }
    if (!isFirebaseConfigured()) return;
    const tid = getTenantId();
    if (!tid) return;
    await setDoc(doc(fbDb(), 'tenants', tid, 'reprintLogs', entry.id), {
      ...entry, createdAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal by design: the local log is the source of truth for the till.
  }
}

export async function fetchCloudReprintLog(max = 200): Promise<ReprintAuditEntry[]> {
  try {
    const { usingSupabaseAuth, authTenantId } = await import('./authProvider');
    if (usingSupabaseAuth()) {
      const tid = authTenantId();
      if (!tid) return [];
      const { sb } = await import('./supabase');
      const { data, error } = await sb()
        .from('reprint_logs').select('*')
        .eq('tenant_id', tid).order('reprinted_at', { ascending: false }).limit(max);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id, at: r.reprinted_at, orderId: r.order_id,
        billNumber: 0, orderStatus: '', type: r.kind,
        reprintedBy: r.reprinted_by_name ?? 'unknown',
        reprintedByRole: r.reason ?? undefined,
      })) as ReprintAuditEntry[];
    }
  } catch { return []; }

  if (!isFirebaseConfigured()) return [];
  const tid = getTenantId();
  if (!tid) return [];
  try {
    const q = query(collection(fbDb(), 'tenants', tid, 'reprintLogs'), orderBy('at', 'desc'), limit(max));
    const snap = await getDocs(q);
    const arr: ReprintAuditEntry[] = [];
    snap.forEach(d => arr.push(d.data() as ReprintAuditEntry));
    return arr;
  } catch { return []; }
}
