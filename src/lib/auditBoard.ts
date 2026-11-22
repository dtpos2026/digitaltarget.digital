// v1.145.0 — the Staff audit log as the design draws it (SW-39): "8,632 events", Export, a search with All · Void · Discount … chips, and a table —
// Time · User · Action (a coloured pill) · Bill · Amount · Reason · Approved by. Pure: audit rows in, words and groups out.
import type { AuditAction, StaffAuditEntry } from './staffAudit';

export type AuditGroup = 'all' | 'void' | 'refund' | 'discount' | 'payment' | 'login' | 'approval' | 'rights';
export const AUDIT_GROUPS: { key: AuditGroup; label: string; actions: AuditAction[] }[] = [
  { key: 'all', label: 'All', actions: [] },
  { key: 'void', label: 'Void', actions: ['VOID'] },
  { key: 'refund', label: 'Refund', actions: ['REFUND'] },
  { key: 'discount', label: 'Discount', actions: ['DISCOUNT'] },
  { key: 'payment', label: 'Payment', actions: ['PAYMENT', 'BILL_CLOSE'] },
  { key: 'login', label: 'Login', actions: ['LOGIN', 'LOGOUT'] },
  { key: 'approval', label: 'Approvals', actions: ['RESTRICTED_BLOCKED', 'MANAGER_APPROVAL'] },
  { key: 'rights', label: 'Rights', actions: ['RIGHTS_CHANGED', 'RIGHTS_RULE', 'RIGHTS_REQUEST', 'RIGHTS_DECISION'] },
];

export type PillTone = 'warn' | 'bad' | 'info' | 'ok' | 'accent' | 'neutral';

/** The short word on the pill (the full sentence is the pill's tooltip). */
export const ACTION_WORD: Record<AuditAction, string> = {
  ORDER_CREATE: 'Order', ORDER_EDIT: 'Edit', SEND_TO_KITCHEN: 'Kitchen', PAYMENT: 'Payment', DISCOUNT: 'Discount', VOID: 'Void', REFUND: 'Refund', FREE_TABLE: 'Table',
  BILL_CLOSE: 'Closed', LOGIN: 'Login', LOGOUT: 'Logout', RESTRICTED_BLOCKED: 'Blocked', MANAGER_APPROVAL: 'Approved', PO_CREATED: 'PO', PO_APPROVED: 'PO approved', PO_SENT: 'PO sent',
  PO_RECEIVED: 'PO received', PO_CANCELLED: 'PO cancelled', RIGHTS_CHANGED: 'Rights', RIGHTS_RULE: 'Rule', RIGHTS_REQUEST: 'Rights ask', RIGHTS_DECISION: 'Rights decision',
};

export function actionTone(a: AuditAction): PillTone {
  if (a === 'DISCOUNT') return 'warn';
  if (a === 'VOID' || a === 'REFUND' || a === 'RESTRICTED_BLOCKED' || a === 'PO_CANCELLED') return 'bad';
  if (a === 'LOGIN' || a === 'LOGOUT') return 'info';
  if (a === 'PAYMENT' || a === 'BILL_CLOSE' || a === 'PO_RECEIVED') return 'ok';
  if (a === 'MANAGER_APPROVAL' || a.startsWith('RIGHTS_') || a === 'PO_APPROVED') return 'accent';
  return 'neutral';
}

const ACTIONS_OF = new Map(AUDIT_GROUPS.map(g => [g.key, new Set<string>(g.actions)]));

export function matchesGroup(r: Pick<StaffAuditEntry, 'action'>, g: AuditGroup): boolean {
  return g === 'all' || !!ACTIONS_OF.get(g)?.has(r.action);
}

export function matchesAuditQuery(r: StaffAuditEntry, q: string): boolean {
  const s = q.trim().toLowerCase().replace(/^#/, '');
  if (!s) return true;
  return [r.userName, r.userRole, r.reason, r.approvedBy, r.tableLabel, r.deviceName, r.orderNumber ? String(r.orderNumber) : ''].some(v => String(v || '').toLowerCase().includes(s));
}

/** The table: the group and the exact action chosen, the search, newest first. */
export function auditRows(rows: StaffAuditEntry[], group: AuditGroup, exact: AuditAction | 'all', q: string): StaffAuditEntry[] {
  const t = (r: StaffAuditEntry) => { const x = new Date(r.at).getTime(); return Number.isFinite(x) ? x : 0; };
  return rows.filter(r => matchesGroup(r, group) && (exact === 'all' || r.action === exact) && matchesAuditQuery(r, q)).sort((a, b) => t(b) - t(a));
}

export const timeOf = (iso: string): string => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—'; };
export const billOf = (r: Pick<StaffAuditEntry, 'orderNumber' | 'orderId'>): string => r.orderNumber ? `#${r.orderNumber}` : r.orderId ? r.orderId.slice(0, 8) : '—';

/** "12 events on 22 Nov 2026" (or the day's name). */
export function auditSubtitle(n: number, day: string, today: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const label = day === today ? 'today' : `on ${d} ${MONTH[(m || 1) - 1]} ${y}`;
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'event' : 'events'} ${label}`;
}

/** The CSV the old page made, with the amount as a plain number. */
export function auditCsv(rows: StaffAuditEntry[], titles: Record<string, string>): string {
  const head = ['Date/Time', 'User', 'Role', 'Action', 'Order', 'Table', 'Device', 'Approved By', 'Amount', 'Reason'];
  const body = rows.map(r => [new Date(r.at).toLocaleString(), r.userName || '', r.userRole || '', titles[r.action] || r.action, billOf(r) === '—' ? '' : billOf(r), r.tableLabel || '', r.deviceName || '', r.approvedBy || '', r.amount ?? '', (r.reason || '').replace(/"/g, "'")]);
  return [head, ...body].map(line => line.map(c => `"${c}"`).join(',')).join('\n');
}
