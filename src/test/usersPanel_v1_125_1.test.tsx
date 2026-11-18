// v1.125.1 — the Users screen in the master-detail layout (SW-22): tap a person and see how they sign in, what they can open and do, the
// rules on them and anything waiting for an admin, beside the list; and on the cloud the list now carries the STORED action rights, phone and
// "all branches", so editing a person no longer writes role defaults over them.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { User } from '@/lib/types';
import type { RightsRequest, RightsRule } from '@/lib/rightsRules';
import { signInKind, userLine, userPanel } from '@/lib/userPanel';
import { NO_FEATURES } from '@/lib/orgStructure';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }));
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

const cloud = { on: false };
vi.mock('@/lib/authProvider', async (orig) => ({ ...(await orig<typeof import('@/lib/authProvider')>()), usingSupabaseAuth: () => cloud.on }));
const rpc = vi.fn();
vi.mock('@/lib/supabase', async (orig) => ({ ...(await orig<typeof import('@/lib/supabase')>()), sb: () => ({ rpc }) }));
const saveStaffUser = vi.fn(async () => ({ ok: true }));
const deleteStaffUser = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/staffAuth.functions', () => ({ saveStaffUser, deleteStaffUser }));

const user = (over: Partial<User> & { id: string }): User => ({ username: over.id, password: '', name: over.id, role: 'cashier', isActive: true, ...over } as User);
const branchName = (id: string) => ({ b1: 'Gulberg', b2: 'DHA' } as Record<string, string>)[id] ?? id;
const rule = (over: Partial<RightsRule>): RightsRule => ({ id: 'r1', userId: 'u1', userName: 'Sana', mode: 'limit', kind: 'feature', key: 'feat.discount.apply', branchIds: ['b2'], fromTime: '10:00', toTime: '22:00', createdAt: '2026-11-01T00:00:00Z', ...over });

describe('what the panel says about a person', () => {
  it('a cashier on role defaults: their modules and actions, grouped in the sidebar’s order', () => {
    const m = userPanel(user({ id: 'u1', role: 'cashier' }), { rules: [], requests: [], branchName });
    expect(m.isAdmin).toBe(false);
    expect(m.signIn).toBe('username');
    expect(m.pageCount).toBeGreaterThan(0);
    expect(m.pageCount).toBeLessThan(m.pageTotal);
    expect(m.pages.map(g => g.group)[0]).toBe('Operations');                        // GROUP_ORDER, not alphabetical
    expect(m.features.flatMap(g => g.titles)).toEqual(expect.arrayContaining(['Reprint Bill', 'Apply Discount']));
    expect(m.features.flatMap(g => g.titles)).not.toContain('Void Bill');
  });
  it('an admin has everything and the panel says so', () => {
    const m = userPanel(user({ id: 'a', role: 'admin' }), { rules: [], requests: [], branchName });
    expect(m).toMatchObject({ isAdmin: true, pageCount: m.pageTotal, featureCount: m.featureTotal });
  });
  it('stored lists win over role defaults; an explicit "no actions" is not turned back into the defaults', () => {
    const own = userPanel(user({ id: 'u2', role: 'manager', permissions: ['dashboard', 'pos'], featurePermissions: ['feat.bill.void'] }), { rules: [], requests: [], branchName });
    expect(own.pages.flatMap(g => g.titles)).toHaveLength(2);
    expect(own.features.flatMap(g => g.titles)).toEqual(['Void Bill']);
    const none = userPanel(user({ id: 'u3', role: 'manager', featurePermissions: [NO_FEATURES] }), { rules: [], requests: [], branchName });
    expect(none.featureCount).toBe(0);
    expect(none.features).toEqual([]);
  });
  it('riders and order takers sign in with phone + PIN, everyone else with a username', () => {
    expect(['rider', 'order_taker'].map(role => signInKind({ role } as User))).toEqual(['phone', 'phone']);
    expect(['admin', 'manager', 'cashier'].map(role => signInKind({ role } as User))).toEqual(['username', 'username', 'username']);
  });
  it('the rules on the person (not revoked, not someone else’s) and the changes waiting for an admin', () => {
    const rules = [rule({}), rule({ id: 'r2', mode: 'grant', kind: 'page', key: 'accounts', branchIds: [], fromTime: undefined, toTime: undefined, validUntil: '2026-11-25' }), rule({ id: 'r3', revokedAt: '2026-11-02T00:00:00Z' }), rule({ id: 'r4', userId: 'u9' })];
    const requests = [{ id: 'q1', userId: 'u1', userName: 'Sana', requestedBy: 'm', requestedByName: 'Bilal', summary: '+ Refund', payload: {}, status: 'pending', createdAt: '' }, { id: 'q2', userId: 'u1', status: 'approved' }, { id: 'q3', userId: 'u9', status: 'pending' }] as RightsRequest[];
    const m = userPanel(user({ id: 'u1' }), { rules, requests, branchName });
    expect(m.rules.map(r => r.id)).toEqual(['r1', 'r2']);
    expect(m.rules[0]).toMatchObject({ mode: 'limit', what: 'Apply Discount' });
    expect(m.rules[0].scope).toContain('DHA');
    expect(m.rules[1]).toMatchObject({ mode: 'grant', what: 'Accounts' });
    expect(m.waiting).toEqual([{ id: 'q1', summary: '+ Refund', by: 'Bilal' }]);
  });
  it('the line under the name: position or role, then the branch or "all branches"', () => {
    expect(userLine({ branchId: 'b1' }, 'Branch Manager', 'Manager', branchName)).toBe('Branch Manager · Gulberg');
    expect(userLine({}, undefined, 'Cashier', branchName)).toBe('Cashier · all branches');
  });
});

// ---------------------------------------------------------------- the screen, through the real store
const STORE_KEY = 'desi-pos-data';
const seed = () => {
  localStorage.clear();
  localStorage.setItem(STORE_KEY, JSON.stringify({
    settings: { name: 'Butt Bakers', currencySymbol: 'Rs ' },
    users: [
      { id: 'u-admin', name: 'Ayesha Khan', username: 'admin', password: 'x', role: 'admin', isActive: true },
      { id: 'u1', name: 'Sana Malik', username: 'sana', password: 'x', role: 'manager', branchId: 'b1', isActive: true, permissions: ['dashboard', 'pos', 'inventory'], featurePermissions: ['feat.bill.void', 'feat.inv.adjust'] },
      { id: 'u2', name: 'Bilal Ahmed', username: 'bilal', password: 'x', role: 'cashier', isActive: false },
      { id: 'u3', name: 'Rashid Rider', username: '03001234567', password: '1234', role: 'rider', phone: '03001234567', pin: '1234', isActive: true },
    ],
    branches: [{ id: 'b1', name: 'Gulberg', isActive: true, sortOrder: 1 }, { id: 'b2', name: 'DHA', isActive: true, sortOrder: 2 }],
    rightsRules: [rule({ id: 'r1', userId: 'u1', userName: 'Sana Malik', branchIds: ['b2'] })],
    rightsRequests: [{ id: 'q1', userId: 'u1', userName: 'Sana Malik', requestedBy: 'u-admin', requestedByName: 'Ayesha Khan', summary: '+ Refund', payload: {}, status: 'pending', createdAt: '2026-11-17T00:00:00Z' }],
    categories: [], inventory: [], stockLogs: [], menuItems: [], recipes: [], orders: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], transactions: [], orderCounter: 1,
  }));
  localStorage.setItem('pos-user-id', 'u-admin'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-tenant-plan', 'enterprise');
  window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
};
const setWide = (wide: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: wide && /min-width/.test(q), media: q, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
};

describe('the Users screen (offline / local store)', () => {
  beforeEach(() => { cleanup(); cloud.on = false; seed(); setWide(false); saveStaffUser.mockClear(); deleteStaffUser.mockClear(); rpc.mockReset(); });

  it('tapping a row opens the person’s panel: status, position line, counts, sign-in, rules, what is waiting, what they can open and do', async () => {
    const { default: Page } = await import('@/pages/UsersRolesPage');
    render(<Page />);
    expect(document.querySelector('[data-user-panel]')).toBeNull();
    fireEvent.click(document.querySelector('[data-user-row="u1"]')!);
    const panel = document.querySelector('[data-user-panel="u1"]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.querySelector('[data-panel-status]')!.getAttribute('data-panel-status')).toBe('active');
    expect(panel.querySelector('[data-panel-line]')!.textContent).toContain('Gulberg');
    expect(panel.querySelector('[data-panel-pages]')!.textContent).toMatch(/^3/);
    expect(panel.querySelector('[data-panel-features]')!.textContent).toMatch(/^2/);
    expect(panel.querySelector('[data-panel-rules-count]')!.textContent).toBe('1');
    expect(panel.querySelector('[data-panel-signin]')!.textContent).toContain('Username + password');
    expect(panel.querySelector('[data-panel-rules]')!.textContent).toContain('Apply Discount');
    expect(panel.querySelector('[data-panel-waiting]')!.textContent).toContain('+ Refund');
    expect(panel.querySelector('[data-panel-can-do]')!.textContent).toContain('Void Bill');
    expect(panel.querySelector('[data-panel-can-do]')!.textContent).not.toContain('Refund');
    expect(panel.textContent).not.toMatch(/password: |pin_hash|SECRET/i);                  // never a secret
  });
  it('a rider is shown as phone + PIN with the phone; an inactive person says Inactive; an admin says everything', async () => {
    const { default: Page } = await import('@/pages/UsersRolesPage');
    render(<Page />);
    fireEvent.click(document.querySelector('[data-user-row="u3"]')!);
    expect(document.querySelector('[data-panel-signin]')!.textContent).toContain('Phone + PIN');
    expect(document.querySelector('[data-panel-signin]')!.textContent).toContain('03001234567');
    fireEvent.click(document.querySelector('[data-user-row="u2"]')!);
    expect(document.querySelector('[data-panel-status]')!.getAttribute('data-panel-status')).toBe('inactive');
    fireEvent.click(document.querySelector('[data-user-row="u-admin"]')!);
    expect(document.querySelector('[data-panel-can-open]')!.textContent).toContain('Everything');
    expect(document.querySelector('[data-panel-can-do]')).toBeNull();
  });
  it('the row’s own Edit and Delete buttons do what they always did and do not open the panel', async () => {
    const { default: Page } = await import('@/pages/UsersRolesPage');
    const { getByRole } = render(<Page />);
    fireEvent.click(getByRole('button', { name: 'Edit Sana Malik' }));
    expect(document.querySelector('[data-user-panel]')).toBeNull();
    expect(document.body.textContent).toContain('Edit User — sana');
  });
  it('the panel’s Edit opens the same dialog', async () => {
    const { default: Page } = await import('@/pages/UsersRolesPage');
    render(<Page />);
    fireEvent.click(document.querySelector('[data-user-row="u1"]')!);
    fireEvent.click(document.querySelector('[data-panel-edit]')!);
    await waitFor(() => expect(document.body.textContent).toContain('Edit User — sana'));
  });
  it('the panel’s Delete asks first; "no" changes nothing, "yes" removes the person and closes the panel', async () => {
    const { default: Page } = await import('@/pages/UsersRolesPage');
    render(<Page />);
    fireEvent.click(document.querySelector('[data-user-row="u2"]')!);
    const confirm = vi.fn(() => false);
    window.confirm = confirm as unknown as typeof window.confirm;
    fireEvent.click(document.querySelector('[data-panel-delete]')!);
    expect(confirm).toHaveBeenCalledWith('Delete Bilal Ahmed?');
    await new Promise(r => setTimeout(r, 30));
    expect(document.querySelector('[data-user-row="u2"]')).not.toBeNull();
    confirm.mockReturnValue(true);
    fireEvent.click(document.querySelector('[data-panel-delete]')!);
    await waitFor(() => expect(document.querySelector('[data-user-row="u2"]')).toBeNull());
    await waitFor(() => expect(document.querySelector('[data-user-panel]')).toBeNull());
    expect(document.querySelector('[data-user-row="u1"]')).not.toBeNull();            // the others are untouched
  });
  it('on a phone every person is a card (the table needs a desktop’s width); the card opens the panel', async () => {
    const { default: Page } = await import('@/pages/UsersRolesPage');
    render(<Page />);
    expect(document.querySelectorAll('[data-user-card]')).toHaveLength(4);
    expect(document.querySelector('[data-user-cards]')!.className).toContain('sm:hidden');
    expect(document.querySelector('[data-user-table]')!.parentElement!.className).toContain('hidden sm:block');
    fireEvent.click(document.querySelector('[data-user-card="u1"]')!);
    expect(document.querySelector('[data-user-panel="u1"]')).not.toBeNull();
  });
  it('on a wide window the panel sits beside the list, the list gives up two columns for it, and the empty panel says what to do', async () => {
    setWide(true);
    const { default: Page } = await import('@/pages/UsersRolesPage');
    render(<Page />);
    expect(document.querySelector('[data-master-detail="wide"]')).not.toBeNull();
    expect(document.querySelector('[data-detail-empty]')!.textContent).toContain('Select a person');
    const heads = () => [...document.querySelectorAll('[data-user-table] th')].map(h => h.textContent);
    expect(heads()).toContain('Username');
    fireEvent.click(document.querySelector('[data-user-row="u1"]')!);
    expect(document.querySelector('[data-detail-panel] [data-user-panel="u1"]')).not.toBeNull();
    expect(heads()).not.toContain('Username');
    expect(heads()).not.toContain('Pages');
    expect(document.querySelector('[data-user-row="u1"]')!.className).toContain('bg-primary/5');
  });
});

describe('the Users screen (cloud): the list carries what is stored', () => {
  beforeEach(() => { cleanup(); cloud.on = true; seed(); setWide(false); saveStaffUser.mockClear(); rpc.mockReset(); });
  const stored = [{ user_id: 'c1', username: 'sana', display_name: 'Sana Malik', role: 'manager', branch_id: 'b1', is_active: true, permissions: ['dashboard', 'pos'], feature_permissions: ['feat.bill.void'], phone: '03001112222', all_branches: true }];

  it('uses pos_list_staff, and the panel shows the stored actions, not the role defaults', async () => {
    rpc.mockImplementation(async (name: string) => (name === 'pos_list_staff' ? { data: stored, error: null } : { data: null, error: { message: 'wrong function' } }));
    const { default: Page } = await import('@/pages/UsersRolesPage');
    render(<Page />);
    await waitFor(() => expect(document.querySelector('[data-user-row="c1"]')).not.toBeNull());
    expect(rpc).toHaveBeenCalledWith('pos_list_staff');
    fireEvent.click(document.querySelector('[data-user-row="c1"]')!);
    expect(document.querySelector('[data-panel-can-do]')!.textContent).toContain('Void Bill');
    expect(document.querySelector('[data-panel-can-do]')!.textContent).not.toContain('Reprint Bill');   // a manager's DEFAULT that this person does not have
    expect(document.querySelector('[data-panel-features]')!.textContent).toMatch(/^1/);
  });
  it('editing and saving sends the STORED action rights, phone and all-branches flag back, not role defaults', async () => {
    rpc.mockImplementation(async (name: string) => (name === 'pos_list_staff' ? { data: stored, error: null } : { data: null, error: { message: 'x' } }));
    const { default: Page } = await import('@/pages/UsersRolesPage');
    const { getByRole, getByPlaceholderText, getByText } = render(<Page />);
    await waitFor(() => expect(document.querySelector('[data-user-row="c1"]')).not.toBeNull());
    fireEvent.click(getByRole('button', { name: 'Edit Sana Malik' }));
    fireEvent.change(getByPlaceholderText('Password'), { target: { value: 'newpass1' } });
    fireEvent.click(getByText('Save User'));
    await waitFor(() => expect(saveStaffUser).toHaveBeenCalled());
    const sent = (saveStaffUser.mock.calls as unknown as [{ data: Record<string, unknown> }][])[0][0].data;
    expect(sent.featurePermissions).toEqual(['feat.bill.void']);
    expect(sent.phone).toBe('03001112222');
    expect(sent.allBranches).toBe(true);
    expect(sent.permissions).toEqual(['dashboard', 'pos']);
  });
  it('where pos_list_staff does not exist yet, the older list is used and the screen still works', async () => {
    rpc.mockImplementation(async (name: string) => (name === 'pos_list_staff'
      ? { data: null, error: { message: 'Could not find the function public.pos_list_staff' } }
      : { data: [{ user_id: 'c1', username: 'sana', display_name: 'Sana Malik', role: 'manager', branch_id: 'b1', is_active: true, permissions: ['dashboard'] }], error: null }));
    const { default: Page } = await import('@/pages/UsersRolesPage');
    render(<Page />);
    await waitFor(() => expect(document.querySelector('[data-user-row="c1"]')).not.toBeNull());
    expect(rpc).toHaveBeenCalledWith('pos_list_users');
  });
});

describe('wiring and the database', () => {
  it('the page is built on MasterDetail like the other desktop screens, with stop-propagation on the row buttons', () => {
    const src = read('src/pages/UsersRolesPage.tsx');
    expect(src).toContain("import MasterDetail, { useWideScreen } from '@/components/layout/MasterDetail'");
    expect(src).toContain('<MasterDetail');
    expect(src).toContain('e.stopPropagation(); openEdit(u)');
    expect(src).toContain("rpc('pos_list_staff' as never)");
    expect(src).toContain('allBranches: toSave.allBranches === true');
  });
  it('the migration adds the read-only function and never returns the password hash; the rollback drops it', () => {
    const mig = 'supabase/migrations/20261118130000_v1_125_1_pos_list_staff.sql';
    const rb = 'docs/rollback/2026-11-18-v1_125_1-pos-list-staff-before.sql';
    expect(existsSync(resolve(__dirname, '../..', mig))).toBe(true);
    const s = read(mig);
    expect(s).toContain('create or replace function public.pos_list_staff()');
    expect(s).toContain('where p.tenant_id = auth_tenant_id()');
    expect(s).not.toContain('pin_hash');
    expect(s).toContain('revoke all on function public.pos_list_staff() from public, anon;');
    expect(read(rb)).toContain('drop function if exists public.pos_list_staff();');
  });
});
