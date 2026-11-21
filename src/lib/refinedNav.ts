// The pure part of the DT Refined sidebar (v1.85.0): grouping, which groups start open, and the sync card's words.
import type { PageDef, PageGroup } from './permissions';

/** The design package's group order (SW-02 / SW-10). */
export const GROUP_ORDER: PageGroup[] = ['Operations', 'Marketing', 'Inventory', 'Accounts', 'Staff', 'Reports', 'Admin'];
export const OPEN_GROUPS_KEY = 'dtpos-refined-open-groups';

/**
 * v1.129.0 — the design's Operations group holds ten modules (POS, Tables, Retrieve, Delivery, Pickup, Kitchen, Online Order Approval,
 * Credits / Udhaar, Refund, Tokens); ours listed twenty and scrolled. The ten this software has on top of the design sit in the group they
 * belong to, under DT Refined only. Nothing is removed: every one is still one click away and still found by the module search.
 */
export const REFINED_GROUP_OF: Record<string, PageGroup> = {
  'cake-orders': 'Inventory',
  'rider-app': 'Staff',
  'credit-customers': 'Accounts',
  'void-bills': 'Accounts',
  'pending-payments': 'Accounts',
  'bill-reprint': 'Reports',
  'foodpanda-orders': 'Marketing',
  'online-portal': 'Marketing',
  'blocked-customers': 'Marketing',
  'blocked-locations': 'Marketing',
};

/**
 * v1.129.0 — inside a group the design's modules come first, in the design's order (SW-06 / SW-13 / SW-22 sidebars); the rest of
 * ours follow in their usual order. So the first screenful of every group is the design's, however many more this software has.
 */
export const REFINED_ORDER: Partial<Record<PageGroup, string[]>> = {
  Operations: ['pos', 'tables', 'bills', 'delivery', 'pickup', 'kitchen', 'online-approval', 'credits', 'refund', 'tokens'],
  Marketing: ['whatsapp', 'customers', 'crm', 'marketing', 'promo-codes'],
  Inventory: ['menu', 'variations', 'inventory', 'recipes', 'wastage', 'receiving'],
  Accounts: ['accounts', 'parties', 'daily-wages', 'shifts'],
  Staff: ['hr', 'users', 'riders', 'staff-audit'],
  Reports: ['dashboard', 'reports-center', 'profitability', 'owner-management'],
};

/** Pages grouped in the design's order, keeping each group's own order; empty groups are left out. */
export function groupPages(pages: PageDef[]): { group: PageGroup; items: PageDef[] }[] {
  const by = new Map<PageGroup, PageDef[]>();
  for (const p of pages) {
    const own = REFINED_GROUP_OF[p.key] ?? p.group;
    const g = (GROUP_ORDER.includes(own) ? own : 'Admin') as PageGroup;
    const list = by.get(g) || [];
    if (!list.some(x => x.key === p.key)) list.push(p);
    by.set(g, list);
  }
  return GROUP_ORDER.filter(g => (by.get(g) || []).length > 0).map(g => {
    const items = by.get(g)!;
    const first = REFINED_ORDER[g] || [];
    const rank = (k: string) => { const i = first.indexOf(k); return i < 0 ? first.length : i; };
    // a stable sort: what the design does not list keeps its own relative order after the design's
    return { group: g, items: items.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p.key) - rank(b.p.key) || a.i - b.i).map(x => x.p) };
  });
}

export function readOpenGroups(): string[] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) || 'null');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : null;
  } catch { return null; }
}

/**
 * First visit: only the group of the page that is open (as in the design's SW-02, where Reports is open on the
 * Dashboard), or Operations when the page is in no group. Afterwards: what the user left open. The group of the open
 * page is always open.
 */
export function initialOpenGroups(saved: string[] | null, activeGroup?: string): Set<string> {
  // v1.129.0 — an accordion, as in the design: ONE group open. The page that is open decides; otherwise what was left open last
  // time (the first of it, if an older build saved several), otherwise Operations.
  if (activeGroup) return new Set([activeGroup]);
  return new Set([saved && saved.length > 0 ? saved[0] : 'Operations']);
}

/** Open a group and fold the others; touching the open one folds it. */
export function toggleGroup(open: ReadonlySet<string>, group: string): Set<string> {
  return open.has(group) ? new Set([...open].filter(g => g !== group)) : new Set([group]);
}

/** The words on the sidebar's status card. */
export function syncLabel(s: { online: boolean; pending: number; lastError?: string }): { tone: 'ok' | 'warn' | 'bad'; title: string; detail: string } {
  const queue = s.pending > 0 ? `${s.pending} change${s.pending === 1 ? '' : 's'} waiting to sync` : 'queue empty';
  if (!s.online) return { tone: 'bad', title: 'Offline', detail: `Working locally · ${queue}` };
  if (s.lastError) return { tone: 'warn', title: 'Online — sync needs attention', detail: queue };
  return { tone: s.pending > 0 ? 'warn' : 'ok', title: 'Online', detail: `Offline-ready · ${queue}` };
}
