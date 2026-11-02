// The pure part of the DT Refined sidebar (v1.85.0): grouping, which groups start open, and the sync card's words.
import type { PageDef, PageGroup } from './permissions';

/** The design package's group order (SW-02 / SW-10). */
export const GROUP_ORDER: PageGroup[] = ['Operations', 'Marketing', 'Inventory', 'Accounts', 'Staff', 'Reports', 'Admin'];
export const OPEN_GROUPS_KEY = 'dtpos-refined-open-groups';

/** Pages grouped in the design's order, keeping each group's own order; empty groups are left out. */
export function groupPages(pages: PageDef[]): { group: PageGroup; items: PageDef[] }[] {
  const by = new Map<PageGroup, PageDef[]>();
  for (const p of pages) {
    const g = (GROUP_ORDER.includes(p.group) ? p.group : 'Admin') as PageGroup;
    const list = by.get(g) || [];
    if (!list.some(x => x.key === p.key)) list.push(p);
    by.set(g, list);
  }
  return GROUP_ORDER.filter(g => (by.get(g) || []).length > 0).map(g => ({ group: g, items: by.get(g)! }));
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
  const s = new Set(saved ?? (activeGroup ? [] : ['Operations']));
  if (activeGroup) s.add(activeGroup);
  return s;
}

/** The words on the sidebar's status card. */
export function syncLabel(s: { online: boolean; pending: number; lastError?: string }): { tone: 'ok' | 'warn' | 'bad'; title: string; detail: string } {
  const queue = s.pending > 0 ? `${s.pending} change${s.pending === 1 ? '' : 's'} waiting to sync` : 'queue empty';
  if (!s.online) return { tone: 'bad', title: 'Offline', detail: `Working locally · ${queue}` };
  if (s.lastError) return { tone: 'warn', title: 'Online — sync needs attention', detail: queue };
  return { tone: s.pending > 0 ? 'warn' : 'ok', title: 'Online', detail: `Offline-ready · ${queue}` };
}
