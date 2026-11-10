// v1.114.0 — found in the live logs after v1.113.0 was deployed:
//   • get_workspace_code answered 401 fifteen times in one hour (a rider / order taker / PIN session has no Supabase user),
//   • "duplicate key … orders_tenant_id_branch_id_order_number_key" ~45 times a day: a till numbered bills from one branch's counter
//     and stamped them with another.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const state = vi.hoisted(() => ({ session: null as null | { user: { id: string } }, rpc: vi.fn(), authBranch: null as string | null, authTenant: 't1' as string | null }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: state.session } }) },
    rpc: (...a: unknown[]) => state.rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }), then: (r: (v: unknown) => void) => r({ data: [] }) }), then: (r: (v: unknown) => void) => r({ data: [] }) }) }),
  },
}));
vi.mock('@/lib/authProvider', async (orig) => ({ ...(await orig<typeof import('@/lib/authProvider')>()), authBranchId: () => state.authBranch, authTenantId: () => state.authTenant }));
vi.mock('@/lib/supabase', async (orig) => ({ ...(await orig<typeof import('@/lib/supabase')>()), isSupabaseConfigured: () => true, sb: () => ({ rpc: (...a: unknown[]) => state.rpc(...a) }) }));

import { branchForNumbering, canAllocateFromServer, allocateServerOrderNumber } from '@/lib/orderNumbers';
import { resolveRestaurantIdentity, resetWorkspaceRpcRefusal } from '@/lib/restaurantIdentity';

beforeEach(() => { state.session = null; state.rpc.mockReset(); state.authBranch = null; state.authTenant = 't1'; localStorage.clear(); resetWorkspaceRpcRefusal(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('bill numbers come from the branch the bill is stamped with', () => {
  it('the branch the till is working in wins over the account\'s own; the account\'s is the fallback; none means local', () => {
    state.authBranch = 'branch-A';
    expect(branchForNumbering('branch-B')).toBe('branch-B');
    expect(branchForNumbering('')).toBe('branch-A');
    expect(branchForNumbering(null)).toBe('branch-A');
    expect(branchForNumbering('  ')).toBe('branch-A');
    state.authBranch = null;
    expect(branchForNumbering(null)).toBeNull();
    expect(canAllocateFromServer(null)).toBe(false);
    expect(canAllocateFromServer('branch-B')).toBe(true);       // an account with no branch of its own can still use the server's counter
  });
  it('asks the server for THAT branch', async () => {
    state.authBranch = 'branch-A';
    state.rpc.mockResolvedValue({ data: 42, error: null });
    expect(await allocateServerOrderNumber('branch-B')).toBe(42);
    expect(state.rpc).toHaveBeenCalledWith('next_order_number', { p_tenant: 't1', p_branch: 'branch-B' });
  });
  it('the till and the renumber-on-clash both pass the bill\'s branch', () => {
    expect(readFileSync('src/lib/store.ts', 'utf8')).toContain('allocateServerOrderNumber(getCurrentBranchId())');
    expect(readFileSync('src/lib/supabaseStore.ts', 'utf8')).toContain("allocateServerOrderNumber(typeof row.branch_id === 'string' ? row.branch_id : null)");
  });
});

describe('the workspace code is asked for only by a signed-in user, and never again after a refusal', () => {
  it('a portal or PIN session (no Supabase user) never calls get_workspace_code', async () => {
    state.session = null;
    localStorage.setItem('pos-tenant-id', 'tenant-1');
    await resolveRestaurantIdentity();
    expect(state.rpc.mock.calls.filter(c => c[0] === 'get_workspace_code')).toHaveLength(0);
  });
  it('a signed-in user asks once; a refusal stops it for the session', async () => {
    state.session = { user: { id: 'u1' } };
    state.rpc.mockResolvedValue({ data: null, error: { code: '42501', status: 401, message: 'permission denied for function get_workspace_code' } });
    localStorage.setItem('pos-tenant-id', 'tenant-2');
    await resolveRestaurantIdentity(true as never).catch(() => undefined);
    await resolveRestaurantIdentity(true as never).catch(() => undefined);
    await resolveRestaurantIdentity(true as never).catch(() => undefined);
    expect(state.rpc.mock.calls.filter(c => c[0] === 'get_workspace_code').length).toBeLessThanOrEqual(1);
  });
});
