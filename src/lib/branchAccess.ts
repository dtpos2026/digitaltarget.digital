// ============================================================================
// BRANCH ACCESS — which branches the signed-in user may actually use.
//
// The database is the authority: `auth_branch_ids()` (SECURITY DEFINER) returns
// the branch ids the caller is allowed to read/write, derived from
// user_profiles (single branch / all_branches / owner+admin roles) and
// user_branch_access (multi-branch managers). Row Level Security enforces the
// same rule on every table, so this module is only for UI convenience —
// hiding a branch here is NOT the security boundary.
// ============================================================================

import { isSupabaseConfigured, sb, currentIdentity } from './supabase';

let _ids: string[] | null = null;   // null = not loaded yet
let _all = false;                   // true = owner/admin/all-branches
let _loading: Promise<void> | null = null;

export function authorizedBranchIds(): string[] | null { return _ids; }
export function hasAllBranchAccess(): boolean { return _all; }

/** UI check. RLS still blocks unauthorized branches server-side. */
export function isBranchAllowed(branchId: string | null | undefined): boolean {
  if (!branchId) return true;
  if (_all || _ids === null) return true;
  return _ids.includes(branchId);
}

/** Keep only the branches the user may see. */
export function filterAllowedBranches<T extends { id: string }>(list: T[]): T[] {
  if (_all || _ids === null) return list;
  return list.filter(b => _ids!.includes(b.id));
}

/** Load (once) the authorized branch ids from the backend. */
export function loadBranchAccess(force = false): Promise<void> {
  if (_loading && !force) return _loading;
  if (_ids !== null && !force) return Promise.resolve();
  _loading = (async () => {
    try {
      if (!isSupabaseConfigured()) { _ids = null; _all = true; return; }
      const id = currentIdentity();
      const { data, error } = await sb().rpc('auth_branch_ids' as any);
      if (error) throw error;
      const ids = (data as any[] | null)?.map(r => r.branch_id).filter(Boolean) ?? [];
      _ids = ids;
      // Owner / admin / all_branches profiles get every tenant branch back from
      // the RPC, so treat that as full access for the switcher UI.
      _all = !!id && (id.allBranches || id.role === 'owner' || id.role === 'admin');
    } catch {
      // Never lock the user out of the UI because of a transient failure —
      // RLS still protects the data underneath.
      _ids = null;
      _all = false;
    } finally {
      _loading = null;
    }
  })();
  return _loading;
}

export function resetBranchAccess() { _ids = null; _all = false; _loading = null; }
