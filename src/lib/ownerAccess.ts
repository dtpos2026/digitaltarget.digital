// Who may open the Owner app (v1.86.0) and which of its tabs — from the permission system, never a role list of its own.
import { getBranches, getSettings, getUsers } from './store';
import { visiblePagesForUser } from './permissions';

/** The signed-in user, a page-key check (role + plan + modules switched on), and whether the Owner app is theirs. */
export function ownerAppAccess() {
  const user = (() => { try { return getUsers().find(u => u.id === (localStorage.getItem('pos-user-id') || '')); } catch { return undefined; } })();
  const settings = getSettings();
  const keys = new Set(visiblePagesForUser(user, !!settings.costTrackingEnabled, settings, { branchCount: getBranches().length }).map(p => p.key));
  const can = (k: string) => keys.has(k);
  return { user, can, allowed: !!user && (user.role === 'admin' || user.role === 'manager') && can('owner-app') };
}
