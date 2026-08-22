// ============================================================
// Staff Action Audit Trail
// ------------------------------------------------------------
// Every sensitive action (order create/edit/KOT, payment, discount,
// void, refund, free table, bill close) is recorded with:
//   User · Date/Time · Order · Table · Device · Action
// Local-first (never lost offline) with a best-effort cloud mirror
// into public.staff_audit_logs. Append-only: no edit, no delete.
// ============================================================
import { getDeviceMeta } from './tenant';

const LS_KEY = 'pos-staff-audit-v1';
const MAX_LOCAL = 3000;

export type AuditAction =
  | 'ORDER_CREATE'
  | 'ORDER_EDIT'
  | 'SEND_TO_KITCHEN'
  | 'PAYMENT'
  | 'DISCOUNT'
  | 'VOID'
  | 'REFUND'
  | 'FREE_TABLE'
  | 'BILL_CLOSE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'RESTRICTED_BLOCKED'
  | 'MANAGER_APPROVAL';

export interface StaffAuditEntry {
  id: string;
  at: string;                 // ISO date/time
  action: AuditAction;
  userId?: string;
  userName?: string;
  userRole?: string;
  orderId?: string;
  orderNumber?: number;
  tableLabel?: string;
  deviceId?: string;
  deviceName?: string;
  approvedBy?: string;        // manager who authorised a restricted action
  reason?: string;
  amount?: number;
  meta?: Record<string, unknown>;
  synced?: boolean;
}

/** Human title used by the audit screens. */
export const AUDIT_ACTION_TITLES: Record<AuditAction, string> = {
  ORDER_CREATE: 'Order created',
  ORDER_EDIT: 'Order edited',
  SEND_TO_KITCHEN: 'Sent to kitchen',
  PAYMENT: 'Payment taken',
  DISCOUNT: 'Discount applied',
  VOID: 'Bill voided',
  REFUND: 'Refund issued',
  FREE_TABLE: 'Table freed',
  BILL_CLOSE: 'Bill closed',
  LOGIN: 'Signed in',
  LOGOUT: 'Signed out',
  RESTRICTED_BLOCKED: 'Restricted action blocked',
  MANAGER_APPROVAL: 'Manager approved a restricted action',
};

function readLocal(): StaffAuditEntry[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function writeLocal(rows: StaffAuditEntry[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(rows.slice(0, MAX_LOCAL))); } catch { /* quota */ }
}

function currentActor(): { id?: string; name?: string; role?: string } {
  try {
    const id = localStorage.getItem('pos-user-id') || undefined;
    const role = localStorage.getItem('pos-user-role') || undefined;
    let name = localStorage.getItem('pos-user-name') || undefined;
    if (!name) {
      const u = JSON.parse(localStorage.getItem('dt_pos_current_user') || 'null');
      name = u?.name || u?.username;
    }
    return { id, name, role };
  } catch { return {}; }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(v?: string | null) { return v && UUID_RE.test(v) ? v : null; }

/** Local-first audit write. Returns the stored entry. */
export function logStaffAction(
  action: AuditAction,
  fields: Partial<Omit<StaffAuditEntry, 'id' | 'at' | 'action'>> = {},
): StaffAuditEntry {
  const actor = currentActor();
  let device: { deviceId?: string; deviceName?: string } = {};
  try { const m = getDeviceMeta(); device = { deviceId: m.deviceId, deviceName: m.deviceName }; } catch { /* ignore */ }

  const entry: StaffAuditEntry = {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    action,
    userId: actor.id,
    userName: actor.name,
    userRole: actor.role,
    ...device,
    ...fields,
  };

  const all = readLocal();
  all.unshift(entry);
  writeLocal(all);
  void pushToCloud(entry);
  return entry;
}

async function pushToCloud(entry: StaffAuditEntry) {
  try {
    const { usingSupabaseAuth, authTenantId } = await import('./authProvider');
    if (!usingSupabaseAuth()) return;
    const tenantId = authTenantId();
    if (!tenantId) return;
    const { getCurrentBranchId } = await import('./store');
    const { sb } = await import('./supabase');
    const { error } = await sb().from('staff_audit_logs').insert({
      tenant_id: tenantId,
      branch_id: uuidOrNull(getCurrentBranchId()),
      user_id: uuidOrNull(entry.userId),
      user_name: entry.userName ?? null,
      user_role: entry.userRole ?? null,
      action: entry.action,
      order_id: entry.orderId ?? null,
      order_number: entry.orderNumber ?? null,
      table_label: entry.tableLabel ?? null,
      device_id: entry.deviceId ?? null,
      device_name: entry.deviceName ?? null,
      approved_by: entry.approvedBy ?? null,
      reason: entry.reason ?? null,
      amount: entry.amount ?? null,
      meta: (entry.meta || {}) as Record<string, unknown>,
      created_at: entry.at,
    });
    if (error) throw error;
    const all = readLocal();
    const hit = all.find(r => r.id === entry.id);
    if (hit) { hit.synced = true; writeLocal(all); }
  } catch {
    // Offline / RLS — the local copy stays and is retried by flushAuditQueue().
  }
}

/** Retry any audit rows that never reached the cloud. */
export async function flushAuditQueue(): Promise<number> {
  const pending = readLocal().filter(r => !r.synced).slice(0, 100);
  for (const row of pending) await pushToCloud(row);
  return pending.length;
}

/** Local audit entries, newest first. */
export function getLocalAudit(): StaffAuditEntry[] {
  return readLocal();
}

export interface AuditQuery {
  from?: string;     // ISO
  to?: string;       // ISO
  action?: AuditAction | 'all';
  staff?: string;    // matches user name or id
  limit?: number;
}

/** Cloud audit entries (falls back to local when offline). */
export async function fetchAuditLog(q: AuditQuery = {}): Promise<StaffAuditEntry[]> {
  try {
    const { usingSupabaseAuth, authTenantId } = await import('./authProvider');
    const tenantId = usingSupabaseAuth() ? authTenantId() : null;
    if (!tenantId) throw new Error('offline');
    const { sb } = await import('./supabase');
    let req = sb().from('staff_audit_logs').select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(q.limit || 500);
    if (q.from) req = req.gte('created_at', q.from);
    if (q.to) req = req.lte('created_at', q.to);
    if (q.action && q.action !== 'all') req = req.eq('action', q.action);
    const { data, error } = await req;
    if (error) throw error;
    const rows = (data || []).map((r: Record<string, unknown>): StaffAuditEntry => ({
      id: String(r['id']),
      at: String(r['created_at']),
      action: r['action'] as AuditAction,
      userId: (r['user_id'] as string) || undefined,
      userName: (r['user_name'] as string) || undefined,
      userRole: (r['user_role'] as string) || undefined,
      orderId: (r['order_id'] as string) || undefined,
      orderNumber: (r['order_number'] as number) ?? undefined,
      tableLabel: (r['table_label'] as string) || undefined,
      deviceId: (r['device_id'] as string) || undefined,
      deviceName: (r['device_name'] as string) || undefined,
      approvedBy: (r['approved_by'] as string) || undefined,
      reason: (r['reason'] as string) || undefined,
      amount: (r['amount'] as number) ?? undefined,
      meta: (r['meta'] as Record<string, unknown>) || {},
      synced: true,
    }));
    return filterLocal(rows, q);
  } catch {
    return filterLocal(readLocal(), q);
  }
}

function filterLocal(rows: StaffAuditEntry[], q: AuditQuery): StaffAuditEntry[] {
  const staff = (q.staff || '').trim().toLowerCase();
  return rows.filter(r => {
    if (q.from && r.at < q.from) return false;
    if (q.to && r.at > q.to) return false;
    if (q.action && q.action !== 'all' && r.action !== q.action) return false;
    if (staff && !`${r.userName || ''} ${r.userId || ''} ${r.userRole || ''}`.toLowerCase().includes(staff)) return false;
    return true;
  });
}
