// ============================================================================
// v1.63.0 — a till in one branch was shown every branch's bills
//
// REQUESTED: "multi branch wala b check krna ky data wgara owner me show ho
// konsi bransh ye fla ... her branch ka alg alg pos, mukmle software, mamlat
// alg ho, taky data mix na ho."
//
// MEASURED BEFORE CHANGING ANYTHING:
//
//   * cashierScope.scopeOrders() filtered by USER id and never mentioned a
//     branch. It was the only scoping helper in the app.
//   * sbLoadCollection() filters on tenant_id alone, so the POS downloads
//     EVERY branch's orders, tables, inventory and shifts.
//   * BRANCH_SCOPED in supabaseStore is used on WRITE only — to stamp
//     branch_id — never on read.
//   * 10 of 81 pages mention branchId at all, and those are mostly reports
//     with their own dropdown.
//
// So an admin standing at Burewala saw Burewala, Multan, Hafiz and Main in one
// list with nothing to separate them. That is the mixing that was reported.
//
// Owner and admin still see everything, deliberately: they are the people who
// need to, and auth_branch_ids() grants them exactly that server-side. Client
// and server disagreeing here is how a screen shows rows the database would
// refuse — or hides rows it would happily serve.
//
// An order with NO branch stamped is KEPT. Older rows predate branch stamping,
// and hiding a real bill is far worse than showing one that cannot be placed.
// ============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

const user = vi.hoisted(() => ({ current: null as any }));

vi.mock('@/lib/store', () => ({
  getUsers: () => [],
  getCurrentUser: () => user.current,
  getCurrentBranchId: () => {
    try { return localStorage.getItem('pos-current-branch'); } catch { return null; }
  },
}));

const { scopeOrders, scopeToBranch, getCurrentScope } = await import('@/lib/cashierScope');

const BURE = 'branch-burewala';
const MULT = 'branch-multan';

const order = (id: string, branchId: string | undefined, cashierId: string) =>
  ({ id, branchId, cashierId }) as any;

const bills = [
  order('a', BURE, 'u1'),
  order('b', MULT, 'u1'),
  order('c', BURE, 'u2'),
  order('d', undefined, 'u1'),   // older row, no branch stamped
];

beforeEach(() => {
  localStorage.clear();
  user.current = null;
});

describe('a cashier sees their own bills, in their own branch', () => {
  it('filters by both, not just by user', () => {
    user.current = { id: 'u1', role: 'cashier', branchId: BURE };
    const out = scopeOrders(bills).map(o => o.id);
    expect(out).toContain('a');          // theirs, their branch
    expect(out).not.toContain('b');      // theirs, ANOTHER branch
    expect(out).not.toContain('c');      // their branch, someone else's
  });

  it('keeps an older bill that has no branch stamped', () => {
    user.current = { id: 'u1', role: 'cashier', branchId: BURE };
    expect(scopeOrders(bills).map(o => o.id)).toContain('d');
  });
});

describe('an owner or admin still sees every branch', () => {
  it('admin is not branch-filtered', () => {
    user.current = { id: 'boss', role: 'admin', branchId: BURE };
    expect(scopeOrders(bills)).toHaveLength(4);
  });

  it('owner is not branch-filtered', () => {
    user.current = { id: 'boss', role: 'owner', branchId: BURE };
    expect(scopeOrders(bills)).toHaveLength(4);
  });

  it('nor is a user explicitly granted all branches', () => {
    user.current = { id: 'm1', role: 'manager', branchId: BURE, allBranches: true };
    expect(scopeOrders(bills)).toHaveLength(4);
  });
});

describe('a manager pinned to one branch sees that branch', () => {
  it('sees every cashier there, but only there', () => {
    user.current = { id: 'm1', role: 'manager', branchId: BURE };
    const out = scopeOrders(bills).map(o => o.id);
    expect(out).toEqual(expect.arrayContaining(['a', 'c', 'd']));
    expect(out).not.toContain('b');
  });
});

describe('the branch picker cannot re-assign a pinned staff member', () => {
  it('the user own branch wins over the till selection', () => {
    // Someone switching the picker must not turn a Burewala cashier into a
    // Multan one — that would show them another branch's money.
    localStorage.setItem('pos-current-branch', MULT);
    user.current = { id: 'u1', role: 'cashier', branchId: BURE };
    expect(getCurrentScope().branchId).toBe(BURE);
  });

  it('but the picker is used when the user has no branch of their own', () => {
    localStorage.setItem('pos-current-branch', MULT);
    user.current = { id: 'u1', role: 'cashier' };
    expect(getCurrentScope().branchId).toBe(MULT);
  });
});

describe('the same rule is available for any branch-stamped rows', () => {
  it('scopeToBranch filters tables, shifts, anything with a branchId', () => {
    user.current = { id: 'u1', role: 'cashier', branchId: BURE };
    const rows = [{ branchId: BURE }, { branchId: MULT }, { branchId: undefined }];
    expect(scopeToBranch(rows)).toHaveLength(2);   // own branch + unstamped
  });

  it('and leaves an owner everything', () => {
    user.current = { id: 'boss', role: 'owner' };
    const rows = [{ branchId: BURE }, { branchId: MULT }];
    expect(scopeToBranch(rows)).toHaveLength(2);
  });
});
