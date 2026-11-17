// v1.116.0 — Rights: who can open which module and do which action, one grid, every change audited; new actions guard the new screens.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, within } from '@testing-library/react';
import type { User } from '@/lib/types';
import { FEATURE_PERMISSIONS, PAGES, defaultFeaturePermissionsForRole, defaultPermissionsForRole, userHasAccess, userHasFeature } from '@/lib/permissions';
import { NO_FEATURES, findPreset, unknownPresetKeys } from '@/lib/orgStructure';
import { NO_PAGES, applyPreset, describeChange, diffRights, effectiveFeatures, effectivePages, matrixCsv, setFeature, setPage } from '@/lib/rightsMatrix';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const user = (over: Partial<User> = {}): User => ({ id: 'u1', username: 'sana', password: 'x', name: 'Sana', role: 'manager', isActive: true, ...over });

describe('the arithmetic', () => {
  it('an empty list means the role’s defaults; the first change writes down what the person has and changes one key', () => {
    const u = user();
    expect(effectivePages(u)).toEqual(defaultPermissionsForRole('manager'));
    const off = setPage(u, 'inventory', false);
    expect(off.permissions).toEqual(defaultPermissionsForRole('manager').filter(k => k !== 'inventory'));
    expect(userHasAccess(off, 'inventory')).toBe(false);
    expect(userHasAccess(off, 'menu')).toBe(true);
    expect(setPage(off, 'inventory', true).permissions).toContain('inventory');
  });
  it('taking the last module away stores a marker, not an empty list — an empty list would hand the role’s defaults back', () => {
    let u = user({ permissions: ['recipes'] });
    u = setPage(u, 'recipes', false);
    expect(u.permissions).toEqual([NO_PAGES]);
    expect(effectivePages(u)).toEqual([]);
    expect(userHasAccess(u, 'recipes')).toBe(false);
    expect(userHasAccess(u, 'dashboard')).toBe(false);
  });
  it('the same for actions: the last action off is the NO_FEATURES marker, so void and refund do not come back', () => {
    let u = user({ featurePermissions: ['feat.bill.void'] });
    u = setFeature(u, 'feat.bill.void', false);
    expect(u.featurePermissions).toEqual([NO_FEATURES]);
    expect(userHasFeature(u, 'feat.bill.void')).toBe(false);
    expect(userHasFeature(u, 'feat.bill.refund')).toBe(false);
  });
  it('an admin is never changed; an unknown key changes nothing', () => {
    const a = user({ role: 'admin' });
    expect(setPage(a, 'inventory', false)).toBe(a);
    expect(setFeature(a, 'feat.bill.void', false)).toBe(a);
    expect(setPage(user(), 'no-such-page', true).permissions).toBeUndefined();
    expect(effectivePages(a)).toHaveLength(PAGES.length);
    expect(effectiveFeatures(a)).toHaveLength(FEATURE_PERMISSIONS.length);
  });
  it('a change reports what it added and removed, in words, for the audit log', () => {
    const before = user();
    const after = setFeature(setPage(before, 'wastage', false), 'feat.bill.void', false);
    const c = diffRights(before, after);
    expect(c).toEqual({ pagesAdded: [], pagesRemoved: ['wastage'], featuresAdded: [], featuresRemoved: ['feat.bill.void'] });
    expect(describeChange(c)).toBe('− Wastage · − Void Bill');
  });
  it('a whole position can be applied (to a person of its own role): the Head Baker gets the bakery modules and actions, nothing else', () => {
    const p = findPreset('production-head')!;
    const u = applyPreset(user(), p);
    expect(u.role).toBe('manager');
    expect(applyPreset(user({ role: 'cashier' }), p).permissions).toBeUndefined();        // a cashier is not turned into a manager by a preset
    expect(userHasAccess(u, 'production-plan')).toBe(true);
    expect(userHasAccess(u, 'recipe-costing')).toBe(true);
    expect(userHasAccess(u, 'stock-count')).toBe(true);
    expect(userHasAccess(u, 'settings')).toBe(false);
    expect(userHasFeature(u, 'feat.inv.count')).toBe(true);
    expect(userHasFeature(u, 'feat.bill.void')).toBe(false);
    expect(unknownPresetKeys()).toEqual([]);
  });
  it('CSV: one row per module and action, one column per person', () => {
    const csv = matrixCsv([user({ name: 'Sana' }), user({ id: 'u2', name: 'Bilal', role: 'cashier' })]).split('\n');
    expect(csv[0]).toBe('Type,Module / action,Sana (manager),Bilal (cashier)');
    expect(csv).toHaveLength(1 + PAGES.length + FEATURE_PERMISSIONS.length);
    expect(csv.find(r => r.startsWith('Action,Void Bill'))).toBe('Action,Void Bill,Yes,—');
  });
});

describe('the new actions', () => {
  it('exist, are for admins and managers by default, and guard the new screens', () => {
    for (const k of ['feat.inv.count', 'feat.prod.edit', 'feat.recipe.edit']) {
      expect(FEATURE_PERMISSIONS.find(f => f.key === k)?.defaultRoles).toEqual(['admin', 'manager']);
      expect(defaultFeaturePermissionsForRole('cashier')).not.toContain(k);
    }
    expect(read('src/pages/StockCountPage.tsx')).toContain("userHasFeature(getCurrentUser(), 'feat.inv.count')");
    expect(read('src/pages/StockCountPage.tsx')).toContain("if (!canPost) { toast.error('You do not have the right to post a stock count'); return; }");
    expect(read('src/components/production/ProductionSheetPanel.tsx')).toContain("userHasFeature(getCurrentUser(), 'feat.prod.edit')");
    expect(read('src/pages/RecipesPage.tsx')).toContain("userHasFeature(getCurrentUser(), 'feat.recipe.edit')");
  });
  it('the server function that saves rights is for an active owner or admin, in their own restaurant, only touches the two lists, and never an owner or admin row', () => {
    const src = read('src/lib/staffAuth.functions.ts');
    const fn = src.slice(src.indexOf('export const setStaffRights'), src.indexOf('Remove a POS staff user.'));
    expect(fn).toContain("['owner', 'admin'].includes(caller.role)");
    expect(fn).toContain(".eq('tenant_id', caller.tenant_id).eq('username'");
    expect(fn).toContain("if (['owner', 'admin'].includes(target.data.role)) throw");
    expect(fn).toContain('.update({ permissions: data.permissions, feature_permissions: data.featurePermissions })');
    expect(fn).not.toContain('password');
  });
  it('the Rights page itself is for admins and is audited', () => {
    expect(PAGES.find(p => p.key === 'rights-matrix')).toMatchObject({ path: '/rights-matrix', group: 'Staff', defaultRoles: ['admin'] });
    expect(read('src/App.tsx')).toContain('<Route path="/rights-matrix" element={<RightsMatrixPage />} />');
    expect(read('src/lib/staffAudit.ts')).toContain("RIGHTS_CHANGED: 'Staff rights changed'");
    expect(read('src/lib/i18nNav.ts').match(/"nav\.rights-matrix"/g)).toHaveLength(3);
  });
});

// ---- the page, with the store replaced
let users: User[] = [];
const saved: User[] = [];
const audit = vi.fn();
let actor: Partial<User> = { name: 'Owner', role: 'admin' };
vi.mock('@/lib/store', () => ({
  getUsers: () => users,
  saveUser: (u: User) => { saved.push(u); users = users.map(x => (x.id === u.id ? u : x)); },
  getCurrentUser: () => actor,
}));
vi.mock('@/lib/staffAudit', () => ({ logStaffAction: (...a: unknown[]) => audit(...a) }));
let cloud = false;
const setStaffRights = vi.fn();
vi.mock('@/lib/authProvider', () => ({ usingSupabaseAuth: () => cloud }));
vi.mock('@/lib/staffAuth.functions', () => ({ setStaffRights: (...a: unknown[]) => setStaffRights(...a) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('Rights page', () => {
  beforeEach(() => {
    users = [user({ id: 'a', name: 'Owner', role: 'admin' }), user({ id: 'm', name: 'Sana' }), user({ id: 'c', name: 'Bilal', role: 'cashier' }), user({ id: 'x', name: 'Gone', isActive: false })];
    saved.length = 0; audit.mockClear(); setStaffRights.mockReset(); cloud = false; actor = { name: 'Owner', role: 'admin' };
  });
  it('on the cloud the rights are saved on the server first — only the two lists and the username — and shown only once that worked', async () => {
    cloud = true; setStaffRights.mockResolvedValue({ ok: true });
    const { default: Page } = await import('@/pages/RightsMatrixPage');
    render(<Page />);
    fireEvent.click(within(document.querySelector('[data-right-row="inventory"]') as HTMLElement).getAllByRole('switch')[2]);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(setStaffRights).toHaveBeenCalledWith({ data: { username: 'sana', permissions: expect.not.arrayContaining(['inventory']), featurePermissions: expect.any(Array) } });
    expect(audit).toHaveBeenCalled();
  });
  it('if the server refuses, nothing changes on screen, nothing is saved here and nothing is logged', async () => {
    cloud = true; setStaffRights.mockRejectedValue(new Error('Only an active owner or admin can change staff rights'));
    const { default: Page } = await import('@/pages/RightsMatrixPage');
    render(<Page />);
    fireEvent.click(within(document.querySelector('[data-right-row="inventory"]') as HTMLElement).getAllByRole('switch')[2]);
    await vi.waitFor(() => expect(setStaffRights).toHaveBeenCalled());
    await Promise.resolve();
    expect(saved).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
    expect(within(document.querySelector('[data-right-row="inventory"]') as HTMLElement).getAllByRole('switch')[2].getAttribute('aria-checked')).toBe('true');
  });
  it('one column per active person, admin locked on every cell, everyone else switchable', async () => {
    const { default: Page } = await import('@/pages/RightsMatrixPage');
    render(<Page />);
    expect(document.querySelectorAll('[data-right-user]')).toHaveLength(3);
    const row = within(document.querySelector('[data-right-row="inventory"]') as HTMLElement).getAllByRole('switch');
    expect(row).toHaveLength(3);
    expect((row[0] as HTMLButtonElement).disabled).toBe(true);                 // the admin
    // columns: the admin first, then the others by name — Bilal (cashier), Sana (manager)
    expect((row[1] as HTMLButtonElement).disabled).toBe(false);
    expect(row[1].getAttribute('aria-checked')).toBe('false');                 // a cashier does not open Inventory
    expect(row[2].getAttribute('aria-checked')).toBe('true');                  // a manager does by default
  });
  it('switching a module saves the person with that one key changed and writes who changed what to the audit log', async () => {
    const { default: Page } = await import('@/pages/RightsMatrixPage');
    render(<Page />);
    fireEvent.click(within(document.querySelector('[data-right-row="inventory"]') as HTMLElement).getAllByRole('switch')[2]);
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('m');
    expect(userHasAccess(saved[0], 'inventory')).toBe(false);
    expect(userHasAccess(saved[0], 'menu')).toBe(true);
    expect(audit).toHaveBeenCalledWith('RIGHTS_CHANGED', expect.objectContaining({ reason: 'Sana: − Inventory', meta: expect.objectContaining({ pagesRemoved: ['inventory'] }) }));
    expect(within(document.querySelector('[data-right-row="inventory"]') as HTMLElement).getAllByRole('switch')[2].getAttribute('aria-checked')).toBe('false');
  });
  it('the Actions tab switches an action; a position can be applied from the column header', async () => {
    const { default: Page } = await import('@/pages/RightsMatrixPage');
    render(<Page />);
    fireEvent.mouseDown(document.querySelector('[data-rights-tab-actions]')!);
    fireEvent.click(document.querySelector('[data-rights-tab-actions]')!);
    fireEvent.click(within(document.querySelector('[data-right-row="feat.bill.void"]') as HTMLElement).getAllByRole('switch')[2]);   // Sana, a manager: void is on by default
    expect(saved[0].id).toBe('m');
    expect(userHasFeature(saved[0], 'feat.bill.void')).toBe(false);
    fireEvent.change(document.querySelector('[data-right-preset="m"]')!, { target: { value: 'production-head' } });
    const baker = saved.at(-1)!;
    expect(baker.id).toBe('m');
    expect(baker.role).toBe('manager');
    expect(userHasAccess(baker, 'production-plan')).toBe(true);
    expect(userHasAccess(baker, 'settings')).toBe(false);
    // a cashier's column offers only the positions of a cashier, never a manager's
    const options = [...(document.querySelector('[data-right-preset="c"]') as HTMLSelectElement).options].map(o => o.textContent);
    expect(options.join('|')).not.toContain('Head Baker');
  });
  it('a person who may not manage users sees the grid but cannot change it', async () => {
    actor = { name: 'Sana', role: 'manager', featurePermissions: ['feat.bill.reprint'] };
    const { default: Page } = await import('@/pages/RightsMatrixPage');
    render(<Page />);
    expect(document.querySelector('[data-rights-readonly]')).not.toBeNull();
    for (const s of within(document.querySelector('[data-right-row="inventory"]') as HTMLElement).getAllByRole('switch')) expect((s as HTMLButtonElement).disabled).toBe(true);
    expect(saved).toHaveLength(0);
  });
  it('the search narrows the rows; the CSV button is there; the page is built from the shared frame', async () => {
    const { default: Page } = await import('@/pages/RightsMatrixPage');
    render(<Page />);
    fireEvent.change(document.querySelector('[data-rights-search]')!, { target: { value: 'wastage' } });
    expect(document.querySelector('[data-right-row="wastage"]')).not.toBeNull();
    expect(document.querySelector('[data-right-row="inventory"]')).toBeNull();
    expect(document.querySelector('[data-rights-csv]')).not.toBeNull();
    const src = read('src/pages/RightsMatrixPage.tsx');
    for (const k of ['<PageHeader', '<FilterBar', '<EmptyState', "from '@/components/ui/table'", 'space-y-4 p-4 lg:p-6']) expect(src, k).toContain(k);
  });
});
