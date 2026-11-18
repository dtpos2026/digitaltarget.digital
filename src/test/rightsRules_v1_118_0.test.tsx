// v1.118.0 — rights by branch, by hour and by date, and an approval step for the risky ones.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import type { User } from '@/lib/types';
import { describeScope, effectiveRight, inHours, inScope, isRisky, mayDecide, needsApproval, ruleIssues, ruleNeedsApproval, type RightsRule, type RuleDraft } from '@/lib/rightsRules';
import { registerRightsRules, userHasAccess, userHasFeature } from '@/lib/permissions';

let cloud = false;
vi.mock('@/lib/authProvider', () => ({ usingSupabaseAuth: () => cloud }));   // the page saves locally; the cloud path has its own tests
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }));
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const at = (iso: string) => new Date(iso);                       // local time, e.g. '2026-11-18T23:30:00'
const rule = (extra: Partial<RightsRule> = {}): RightsRule => ({ id: 'r1', userId: 'c', userName: 'Bilal', mode: 'limit', kind: 'feature', key: 'feat.discount.apply', createdAt: '2026-11-01T00:00:00Z', ...extra });
const ctx = (iso: string, branchId: string | null = 'A') => ({ now: at(iso), branchId });

describe('the hours', () => {
  it('inside, outside, the end minute outside, wrapping past midnight, and no hours = always', () => {
    expect(inHours('10:00', '22:00', at('2026-11-18T12:00:00'))).toBe(true);
    expect(inHours('10:00', '22:00', at('2026-11-18T09:59:00'))).toBe(false);
    expect(inHours('10:00', '22:00', at('2026-11-18T22:00:00'))).toBe(false);
    expect(inHours('22:00', '02:00', at('2026-11-18T23:30:00'))).toBe(true);
    expect(inHours('22:00', '02:00', at('2026-11-19T01:00:00'))).toBe(true);
    expect(inHours('22:00', '02:00', at('2026-11-19T03:00:00'))).toBe(false);
    expect(inHours(undefined, undefined, at('2026-11-18T03:00:00'))).toBe(true);
  });
});

describe('where and when a rule applies', () => {
  it('a branch rule needs that branch — and an unknown branch does not match', () => {
    const r = rule({ branchIds: ['A', 'B'] });
    expect(inScope(r, ctx('2026-11-18T12:00:00', 'A'))).toBe(true);
    expect(inScope(r, ctx('2026-11-18T12:00:00', 'C'))).toBe(false);
    expect(inScope(r, ctx('2026-11-18T12:00:00', null))).toBe(false);
    expect(inScope(rule(), ctx('2026-11-18T12:00:00', null))).toBe(true);        // no branches named = every branch
  });
  it('days of the week (2026-11-18 is a Wednesday)', () => {
    expect(inScope(rule({ days: [3] }), ctx('2026-11-18T12:00:00'))).toBe(true);
    expect(inScope(rule({ days: [0, 6] }), ctx('2026-11-18T12:00:00'))).toBe(false);
  });
  it('a grant is inside its dates, both ends included; a removed rule never applies', () => {
    const g = rule({ mode: 'grant', validFrom: '2026-11-18', validUntil: '2026-11-20' });
    expect(inScope(g, ctx('2026-11-17T23:59:00'))).toBe(false);
    expect(inScope(g, ctx('2026-11-18T00:01:00'))).toBe(true);
    expect(inScope(g, ctx('2026-11-20T23:59:00'))).toBe(true);
    expect(inScope(g, ctx('2026-11-21T00:01:00'))).toBe(false);
    expect(inScope({ ...g, revokedAt: '2026-11-19T00:00:00Z' }, ctx('2026-11-19T12:00:00'))).toBe(false);
  });
});

describe('the right after the rules', () => {
  const lim = rule({ branchIds: ['A'], fromTime: '10:00', toTime: '22:00' });
  it('no rules: the base right, untouched', () => {
    expect(effectiveRight(true, [], ctx('2026-11-18T03:00:00'))).toBe(true);
    expect(effectiveRight(false, [], ctx('2026-11-18T03:00:00'))).toBe(false);
  });
  it('a limit can only take power away: in its branch and hours the right stays, outside it is off, and it never adds one', () => {
    expect(effectiveRight(true, [lim], ctx('2026-11-18T12:00:00', 'A'))).toBe(true);
    expect(effectiveRight(true, [lim], ctx('2026-11-18T23:00:00', 'A'))).toBe(false);
    expect(effectiveRight(true, [lim], ctx('2026-11-18T12:00:00', 'B'))).toBe(false);
    expect(effectiveRight(false, [lim], ctx('2026-11-18T12:00:00', 'A'))).toBe(false);
  });
  it('two limits must both hold', () => {
    const two = [lim, rule({ id: 'r2', days: [1] })];                         // Mondays only
    expect(effectiveRight(true, two, ctx('2026-11-18T12:00:00', 'A'))).toBe(false);   // a Wednesday
    expect(effectiveRight(true, two, ctx('2026-11-16T12:00:00', 'A'))).toBe(true);    // a Monday
  });
  it('a grant adds the right inside its time and place, and ends by itself', () => {
    const g = rule({ mode: 'grant', key: 'feat.bill.void', branchIds: ['B'], validUntil: '2026-11-25' });
    expect(effectiveRight(false, [g], ctx('2026-11-20T12:00:00', 'B'))).toBe(true);
    expect(effectiveRight(false, [g], ctx('2026-11-20T12:00:00', 'A'))).toBe(false);
    expect(effectiveRight(false, [g], ctx('2026-11-26T12:00:00', 'B'))).toBe(false);
  });
});

describe('a rule must make sense', () => {
  const ok: RuleDraft = { userId: 'c', userName: 'Bilal', mode: 'limit', kind: 'feature', key: 'feat.discount.apply' };
  const today = '2026-11-18';
  it('names what is missing', () => {
    expect(ruleIssues(ok, { role: 'cashier' }, today)).toEqual([]);
    expect(ruleIssues(ok, undefined, today)).toContain('Choose the person');
    expect(ruleIssues(ok, { role: 'admin' }, today).join()).toContain('An admin always has everything');
    expect(ruleIssues({ ...ok, key: '' }, { role: 'cashier' }, today)).toContain('Choose the module or action');
    expect(ruleIssues({ ...ok, fromTime: '10:00' }, { role: 'cashier' }, today).join()).toContain('both the first and the last hour');
  });
  it('a temporary grant needs an end date that is not past and not before its start', () => {
    const g: RuleDraft = { ...ok, mode: 'grant' };
    expect(ruleIssues(g, { role: 'cashier' }, today)).toContain('A temporary right needs an end date');
    expect(ruleIssues({ ...g, validUntil: '2026-11-10' }, { role: 'cashier' }, today)).toContain('The end date is already past');
    expect(ruleIssues({ ...g, validFrom: '2026-12-01', validUntil: '2026-11-25' }, { role: 'cashier' }, today)).toContain('The start date is after the end date');
    expect(ruleIssues({ ...g, validUntil: '2026-11-25' }, { role: 'cashier' }, today)).toEqual([]);
  });
  it('says it in words', () => {
    const name = (id: string) => ({ A: 'DHA', B: 'Gulberg' })[id] ?? id;
    expect(describeScope(rule({ branchIds: ['A'], fromTime: '10:00', toTime: '22:00', days: [1, 2, 3, 4, 5, 6] }), name)).toBe('Only in DHA · 10:00–22:00 · Mon–Sat');
    expect(describeScope(rule({ mode: 'grant', validUntil: '2026-11-25', branchIds: ['B'] }), name)).toBe('Until 2026-11-25 · In Gulberg');
    expect(describeScope(rule({ days: [0, 6] }), name)).toBe('Sun, Sat');
  });
});

describe('approval', () => {
  const admin = { id: 'a', role: 'admin' as const }, mgr = { id: 'm', role: 'manager' as const };
  it('an admin never needs it', () => expect(needsApproval(admin, { id: 'c' }, { pages: ['users'], features: ['feat.bill.refund'] }).needed).toBe(false));
  it('giving a risky right needs it; giving an ordinary one does not; taking away never does', () => {
    expect(needsApproval(mgr, { id: 'c' }, { pages: [], features: ['feat.bill.refund'] }).needed).toBe(true);
    expect(needsApproval(mgr, { id: 'c' }, { pages: ['settings'], features: [] }).needed).toBe(true);
    expect(needsApproval(mgr, { id: 'c' }, { pages: [], features: ['feat.admin.backup'] }).needed).toBe(true);
    expect(needsApproval(mgr, { id: 'c' }, { pages: ['customers'], features: ['feat.inv.count'] }).needed).toBe(false);
    expect(needsApproval(mgr, { id: 'c' }, { pages: [], features: [] }).needed).toBe(false);
  });
  it('nobody gives themselves anything without an admin', () => {
    expect(needsApproval(mgr, { id: 'm' }, { pages: ['customers'], features: [] })).toMatchObject({ needed: true });
    expect(needsApproval(mgr, { id: 'm' }, { pages: [], features: [] }).needed).toBe(false);
  });
  it('a limit never needs approval; a grant of something risky does', () => {
    expect(ruleNeedsApproval(mgr, { id: 'c' }, { mode: 'limit', kind: 'feature', key: 'feat.bill.refund' }).needed).toBe(false);
    expect(ruleNeedsApproval(mgr, { id: 'c' }, { mode: 'grant', kind: 'feature', key: 'feat.bill.refund' }).needed).toBe(true);
    expect(ruleNeedsApproval(mgr, { id: 'c' }, { mode: 'grant', kind: 'page', key: 'customers' }).needed).toBe(false);
  });
  it('only an admin decides, and only a pending request', () => {
    expect(mayDecide(admin, { status: 'pending' }).ok).toBe(true);
    expect(mayDecide(mgr, { status: 'pending' })).toEqual({ ok: false, reason: 'Only an admin can approve or reject' });
    expect(mayDecide(admin, { status: 'approved' })).toEqual({ ok: false, reason: 'Already decided' });
  });
  it('what counts as risky', () => {
    for (const k of ['feat.bill.void', 'feat.bill.refund', 'feat.bill.price-edit', 'feat.admin.users-manage', 'feat.discount.complimentary']) expect(isRisky('feature', k)).toBe(true);
    for (const k of ['feat.bill.reprint', 'feat.inv.count', 'feat.discount.apply']) expect(isRisky('feature', k)).toBe(false);
    for (const k of ['users', 'rights-matrix', 'settings', 'backup']) expect(isRisky('page', k)).toBe(true);
    expect(isRisky('page', 'customers')).toBe(false);
  });
});

describe('inside userHasFeature / userHasAccess', () => {
  const cashier = { id: 'c', name: 'Bilal', username: 'bilal', password: 'x', role: 'cashier', isActive: true } as User;
  const manager = { id: 'm', name: 'Sana', username: 'sana', password: 'x', role: 'manager', isActive: true } as User;
  afterEach(() => registerRightsRules(() => [], () => ({ now: new Date(), branchId: null })));
  it('an hours limit turns the right off outside the hours, for the moment of the check', () => {
    let now = at('2026-11-18T12:00:00');
    registerRightsRules(id => (id === 'c' ? [rule({ fromTime: '10:00', toTime: '22:00' })] : []), () => ({ now, branchId: null }));
    expect(userHasFeature(cashier, 'feat.discount.apply')).toBe(true);
    now = at('2026-11-18T23:00:00');
    expect(userHasFeature(cashier, 'feat.discount.apply')).toBe(false);
    expect(userHasFeature(cashier, 'feat.bill.reprint')).toBe(true);            // another right, no rule: untouched
    expect(userHasFeature(manager, 'feat.discount.apply')).toBe(true);          // another person: untouched
  });
  it('a limit on a module hides it; a grant opens one the role does not have, until its date', () => {
    let now = at('2026-11-18T12:00:00');
    registerRightsRules(id => (id === 'c' ? [rule({ kind: 'page', key: 'tables', days: [0] }), rule({ id: 'g', mode: 'grant', kind: 'page', key: 'accounts', validUntil: '2026-11-20' })] : []), () => ({ now, branchId: null }));
    expect(userHasAccess(cashier, 'tables')).toBe(false);                       // Wednesday, rule says Sundays only
    expect(userHasAccess(cashier, 'accounts')).toBe(true);                      // the grant
    now = at('2026-11-21T12:00:00');
    expect(userHasAccess(cashier, 'accounts')).toBe(false);                     // ended by itself
  });
  it('an admin is never limited', () => {
    registerRightsRules(() => [rule({ userId: 'a', fromTime: '03:00', toTime: '04:00' })], () => ({ now: at('2026-11-18T12:00:00'), branchId: null }));
    expect(userHasFeature({ ...cashier, id: 'a', role: 'admin' } as User, 'feat.discount.apply')).toBe(true);
  });
});

// ---------------------------------------------------------------- the screen, through the real store
const STORE_KEY = 'desi-pos-data';
const staff = (id: string, name: string, role: string, extra: Record<string, unknown> = {}) => ({ id, name, username: name.toLowerCase(), password: 'x', role, isActive: true, ...extra });
const seed = (signedIn: string) => {
  localStorage.clear();
  localStorage.setItem(STORE_KEY, JSON.stringify({
    settings: { name: 'Butt Bakers', currencySymbol: 'Rs ' },
    users: [staff('u-admin', 'Ayesha', 'admin'), staff('u-man', 'Sana', 'manager', { permissions: ['dashboard', 'rights-matrix', 'customers'], featurePermissions: ['feat.admin.users-manage', 'feat.inv.count'] }), staff('u-cash', 'Bilal', 'cashier')],
    branches: [], rightsRules: [], rightsRequests: [], stockLogs: [], inventory: [], orders: [], menuItems: [], categories: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], transactions: [], recipes: [], orderCounter: 1,
  }));
  localStorage.setItem('pos-user-id', signedIn); localStorage.setItem('pos-user-role', signedIn === 'u-admin' ? 'admin' : 'manager'); localStorage.setItem('pos-tenant-plan', 'enterprise');
  window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
};
const openTab = (sel: string) => { fireEvent.mouseDown(document.querySelector(sel)!); fireEvent.click(document.querySelector(sel)!); };
const cellOf = (rowKey: string, userIndex: number) => within(document.querySelector(`[data-right-row="${rowKey}"]`) as HTMLElement).getAllByRole('switch')[userIndex];
// columns: Ayesha (admin), then by name: Bilal (cashier), Sana (manager)

describe('the Rights screen with approvals', () => {
  beforeEach(() => { cleanup(); cloud = false; });

  it('on the cloud a manager’s change always goes through an admin, because only an admin can save rights there', async () => {
    cloud = true;
    seed('u-man');
    const s = await import('@/lib/store');
    const { default: Page } = await import('@/pages/RightsMatrixPage');
    render(<Page />);
    fireEvent.click(cellOf('customers', 1));
    await vi.waitFor(() => expect(s.getRightsRequests()).toHaveLength(1));
    expect(s.getUsers().find(u => u.id === 'u-cash')!.permissions ?? []).not.toContain('customers');
  });

  it('a manager who may manage users gives an ordinary right straight away', async () => {
    seed('u-man');
    const s = await import('@/lib/store');
    const { default: Page } = await import('@/pages/RightsMatrixPage');
    render(<Page />);
    fireEvent.click(cellOf('customers', 1));                                    // Bilal gets Customers
    await vi.waitFor(() => expect(s.getUsers().find(u => u.id === 'u-cash')!.permissions).toContain('customers'));
    expect(s.getRightsRequests()).toHaveLength(0);
  });

  it('giving a risky right is NOT applied: it becomes a request for an admin', async () => {
    seed('u-man');
    const s = await import('@/lib/store');
    const { default: Page } = await import('@/pages/RightsMatrixPage');
    render(<Page />);
    openTab('[data-rights-tab-actions]');
    fireEvent.click(cellOf('feat.bill.void', 1));                               // Bilal → Void Bill
    await vi.waitFor(() => expect(s.getRightsRequests()).toHaveLength(1));
    expect(s.getUsers().find(u => u.id === 'u-cash')!.featurePermissions ?? []).not.toContain('feat.bill.void');
    expect(s.getRightsRequests()[0]).toMatchObject({ userId: 'u-cash', requestedBy: 'u-man', status: 'pending' });
    expect(s.getRightsRequests()[0].summary).toContain('Void Bill');
  });

  it('a manager cannot give themselves a right, even an ordinary one', async () => {
    seed('u-man');
    const s = await import('@/lib/store');
    const { default: Page } = await import('@/pages/RightsMatrixPage');
    render(<Page />);
    fireEvent.click(cellOf('inventory', 2));                                    // Sana → Inventory
    await vi.waitFor(() => expect(s.getRightsRequests()).toHaveLength(1));
    expect(s.getUsers().find(u => u.id === 'u-man')!.permissions).not.toContain('inventory');
  });

  it('taking a right away is never held up', async () => {
    seed('u-man');
    const s = await import('@/lib/store');
    const { default: Page } = await import('@/pages/RightsMatrixPage');
    render(<Page />);
    openTab('[data-rights-tab-actions]');
    fireEvent.click(cellOf('feat.bill.reprint', 1));                            // Bilal had Reprint → off
    await vi.waitFor(() => expect(s.getUsers().find(u => u.id === 'u-cash')!.featurePermissions).not.toContain('feat.bill.reprint'));
    expect(s.getRightsRequests()).toHaveLength(0);
  });

  it('an admin sees the request, approves it, and the right is applied; the manager only sees "waiting"', async () => {
    seed('u-man');
    const s = await import('@/lib/store');
    const first = await import('@/pages/RightsMatrixPage');
    const view = render(<first.default />);
    openTab('[data-rights-tab-actions]');
    fireEvent.click(cellOf('feat.bill.void', 1));
    await vi.waitFor(() => expect(s.getRightsRequests()).toHaveLength(1));
    openTab('[data-rights-tab-rules]');
    expect(document.querySelector('[data-request-waiting]')).not.toBeNull();
    expect(document.querySelector('[data-request-approve]')).toBeNull();
    view.unmount(); cleanup();

    localStorage.setItem('pos-user-id', 'u-admin'); localStorage.setItem('pos-user-role', 'admin');       // the admin signs in on the same device
    const second = await import('@/pages/RightsMatrixPage');
    render(<second.default />);
    openTab('[data-rights-tab-rules]');
    const id = s.getRightsRequests()[0].id;
    fireEvent.click(document.querySelector(`[data-request-approve="${id}"]`)!);
    await vi.waitFor(() => expect(s.getRightsRequests()[0].status).toBe('approved'));
    expect(s.getUsers().find(u => u.id === 'u-cash')!.featurePermissions).toContain('feat.bill.void');
    expect(s.getRightsRequests()[0]).toMatchObject({ decidedBy: 'u-admin' });
  });

  it('rejecting leaves the rights as they were', async () => {
    seed('u-admin');
    const s = await import('@/lib/store');
    s.saveRightsRequest({ id: 'rq', userId: 'u-cash', userName: 'Bilal', requestedBy: 'u-man', requestedByName: 'Sana', summary: 'Bilal: + Refund', payload: { featurePermissions: ['feat.bill.refund'] }, status: 'pending', createdAt: new Date().toISOString() });
    const { default: Page } = await import('@/pages/RightsMatrixPage');
    render(<Page />);
    openTab('[data-rights-tab-rules]');
    fireEvent.click(document.querySelector('[data-request-reject="rq"]')!);
    await vi.waitFor(() => expect(s.getRightsRequests()[0].status).toBe('rejected'));
    expect(s.getUsers().find(u => u.id === 'u-cash')!.featurePermissions ?? []).not.toContain('feat.bill.refund');
  });

  it('a rule is made from the tab: a limit by an admin is saved at once and then shows in the list and can be removed', async () => {
    seed('u-admin');
    const s = await import('@/lib/store');
    const { default: Page } = await import('@/pages/RightsMatrixPage');
    render(<Page />);
    openTab('[data-rights-tab-rules]');
    fireEvent.click(document.querySelector('[data-rule-new]')!);
    expect((document.querySelector('[data-rule-save]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(document.querySelector('[data-rule-person]')!, { target: { value: 'u-cash' } });
    fireEvent.change(document.querySelector('[data-rule-right]')!, { target: { value: 'feature:feat.discount.apply' } });
    fireEvent.change(document.querySelector('[data-rule-from]')!, { target: { value: '10:00' } });
    fireEvent.change(document.querySelector('[data-rule-to]')!, { target: { value: '22:00' } });
    fireEvent.click(document.querySelector('[data-rule-save]')!);
    expect(s.getRightsRules()).toHaveLength(1);
    expect(s.getRightsRules()[0]).toMatchObject({ userId: 'u-cash', mode: 'limit', key: 'feat.discount.apply', fromTime: '10:00', toTime: '22:00' });
    const row = document.querySelector('[data-rule-row]') as HTMLElement;
    expect(row.textContent).toContain('10:00–22:00');
    fireEvent.click(document.querySelector('[data-rule-revoke]')!);
    expect(document.querySelector('[data-rule-row]')).toBeNull();
    expect(s.getRightsRules()[0].revokedAt).toBeTruthy();
  });

  it('a temporary grant of a risky right by a manager is sent as a request, not saved as a rule', async () => {
    seed('u-man');
    const s = await import('@/lib/store');
    const { default: Page } = await import('@/pages/RightsMatrixPage');
    render(<Page />);
    openTab('[data-rights-tab-rules]');
    fireEvent.click(document.querySelector('[data-rule-new]')!);
    fireEvent.change(document.querySelector('[data-rule-person]')!, { target: { value: 'u-cash' } });
    fireEvent.change(document.querySelector('[data-rule-mode]')!, { target: { value: 'grant' } });
    fireEvent.change(document.querySelector('[data-rule-right]')!, { target: { value: 'feature:feat.bill.refund' } });
    const next = new Date(); next.setDate(next.getDate() + 3);
    fireEvent.change(document.querySelector('[data-rule-until]')!, { target: { value: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}` } });
    expect(document.querySelector('[data-rule-gate]')).not.toBeNull();
    fireEvent.click(document.querySelector('[data-rule-save]')!);
    expect(s.getRightsRules()).toHaveLength(0);
    expect(s.getRightsRequests()).toHaveLength(1);
    expect(s.getRightsRequests()[0].payload.rule).toMatchObject({ mode: 'grant', key: 'feat.bill.refund' });
  });
});

describe('where it lives', () => {
  it('rules and requests are synced documents; permissions asks for them; the audit has three new actions', () => {
    expect(read('src/lib/supabaseStore.ts')).toContain("'rightsRules', 'rightsRequests'");
    expect(read('src/lib/store.ts')).toContain('registerRightsRules(');
    expect(read('src/lib/permissions.ts')).toContain('withRules(user,');
    for (const a of ['RIGHTS_RULE', 'RIGHTS_REQUEST', 'RIGHTS_DECISION']) expect(read('src/lib/staffAudit.ts')).toContain(a);
  });
});
