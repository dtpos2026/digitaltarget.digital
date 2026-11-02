// ============================================================
// v1.97.0 — the organisation structure: Head Office → Branch → Department heads → Floor staff, as role presets.
// Pure: a preset is a technical role plus page and feature permissions; nothing is added to the database.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PAGES, FEATURE_PERMISSIONS, defaultPermissionsForRole, defaultFeaturePermissionsForRole } from '@/lib/permissions';
import { DEPARTMENTS, LEVEL_ORDER, NO_FEATURES, ROLE_PRESETS, findPreset, matchPreset, presetPermissions, unknownPresetKeys } from '@/lib/orgStructure';
import { userHasFeature, userHasAccess } from '@/lib/permissions';
import type { User } from '@/lib/types';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('the table of positions', () => {
  it('names only pages and features that exist (a typo would give a department head nothing)', () => {
    expect(unknownPresetKeys()).toEqual([]);
  });

  it('has the four levels, one owner, one branch manager, a head for every department, and the three floor roles', () => {
    expect(LEVEL_ORDER).toEqual(['head-office', 'branch', 'department', 'floor']);
    expect(ROLE_PRESETS.filter(p => p.level === 'head-office').map(p => p.id)).toEqual(['owner']);
    expect(ROLE_PRESETS.filter(p => p.level === 'branch').map(p => p.id)).toEqual(['branch-manager']);
    expect(ROLE_PRESETS.filter(p => p.level === 'floor').map(p => p.id)).toEqual(['cashier', 'order-taker', 'rider']);
    expect(ROLE_PRESETS.filter(p => p.level === 'department').map(p => p.department).sort()).toEqual(DEPARTMENTS.map(d => d.id).sort());
    expect(new Set(ROLE_PRESETS.map(p => p.id)).size).toBe(ROLE_PRESETS.length);
  });

  it('only the owner is an admin; heads of department and the branch manager are managers; the floor keeps its own roles', () => {
    for (const p of ROLE_PRESETS) {
      if (p.level === 'head-office') expect(p.role).toBe('admin');
      else if (p.level === 'branch' || p.level === 'department') expect(p.role, p.id).toBe('manager');
    }
    expect(findPreset('cashier')!.role).toBe('cashier');
    expect(findPreset('order-taker')!.role).toBe('order_taker');
    expect(findPreset('rider')!.role).toBe('rider');
  });

  it('a department head never gets the owner\'s pages: settings, users, backup, devices, branches, financials, module management', () => {
    const OWNER_ONLY = ['users', 'settings', 'backup', 'devices', 'moduleManagement', 'owner-management', 'financials', 'branches', 'praEims', 'dataIntegrity', 'version', 'admin-sales-history', 'branch-performance'];
    for (const p of ROLE_PRESETS.filter(x => x.level === 'department')) {
      for (const k of OWNER_ONLY) expect(p.pages, `${p.id} has ${k}`).not.toContain(k);
      for (const k of ['feat.admin.settings-edit', 'feat.admin.users-manage', 'feat.admin.backup', 'feat.admin.device-approve']) expect(p.features, `${p.id} has ${k}`).not.toContain(k);
      expect(p.pages.length, p.id).toBeGreaterThan(2);
    }
  });

  it('each department head has the pages of their department and not the others\' (kitchen ≠ accounts ≠ HR)', () => {
    const pages = (id: string) => findPreset(id)!.pages;
    expect(pages('kitchen-head')).toEqual(expect.arrayContaining(['kitchen', 'recipes', 'wastage']));
    expect(pages('kitchen-head')).not.toContain('accounts');
    expect(pages('accounts-head')).toEqual(expect.arrayContaining(['accounts', 'daily-wages', 'shifts', 'profitability']));
    expect(pages('accounts-head')).not.toContain('hr');
    expect(pages('hr-head')).toEqual(expect.arrayContaining(['hr', 'staff-audit']));
    expect(pages('hr-head')).not.toContain('accounts');
    expect(pages('store-head')).toEqual(expect.arrayContaining(['inventory', 'receiving', 'procurement']));
    expect(pages('marketing-head')).toEqual(expect.arrayContaining(['customers', 'crm', 'promo-codes']));
    expect(pages('delivery-head')).toEqual(expect.arrayContaining(['delivery', 'riders', 'live-riders']));
    // the money screens belong to Accounts, not to Marketing or Delivery
    for (const id of ['marketing-head', 'delivery-head', 'kitchen-head']) expect(pages(id), id).not.toContain('profitability');
  });

  it('the branch manager is exactly what a manager was, and the floor roles are what they were', () => {
    expect(findPreset('branch-manager')!.pages).toEqual(defaultPermissionsForRole('manager'));
    expect(findPreset('branch-manager')!.features).toEqual(defaultFeaturePermissionsForRole('manager'));
    expect(findPreset('cashier')!.pages).toEqual(defaultPermissionsForRole('cashier'));
    expect(findPreset('rider')!.pages).toEqual(defaultPermissionsForRole('rider'));
  });
});

describe('applying and recognising a position', () => {
  it('applying a preset gives its role and its lists (the owner gets every page and every feature)', () => {
    const k = presetPermissions(findPreset('kitchen-head')!);
    expect(k.role).toBe('manager');
    expect(k.permissions).toContain('kitchen');
    expect(k.featurePermissions).toEqual(['feat.bill.cancel-kot', 'feat.inv.wastage']);
    const owner = presetPermissions(findPreset('owner')!);
    expect(owner.role).toBe('admin');
    expect(owner.permissions.length).toBe(PAGES.length);
    expect(owner.featurePermissions.length).toBe(FEATURE_PERMISSIONS.length);
  });

  it('every position is recognised from its own settings, and a copy of the lists is applied (editing one person never edits the table)', () => {
    for (const p of ROLE_PRESETS) {
      const applied = presetPermissions(p);
      expect(matchPreset(applied)?.id, p.id).toBe(p.id);
    }
    const a = presetPermissions(findPreset('hr-head')!);
    a.permissions.push('settings');
    expect(findPreset('hr-head')!.pages).not.toContain('settings');
  });

  it('a person whose pages were customised is not given a position', () => {
    const base = presetPermissions(findPreset('accounts-head')!);
    expect(matchPreset({ ...base, permissions: [...base.permissions, 'hr'] })).toBeNull();
    expect(matchPreset({ ...base, permissions: base.permissions.filter(k => k !== 'costing') })).toBeNull();
    expect(matchPreset({ role: 'manager', permissions: [], featurePermissions: [] })?.id).toBe('branch-manager');   // no list = the role's defaults
  });

  it('presets that do not carry their own features are matched by pages and features together', () => {
    const base = presetPermissions(findPreset('kitchen-head')!);
    expect(matchPreset({ ...base, featurePermissions: [...base.featurePermissions, 'feat.bill.void'] })).toBeNull();
  });
});

describe('a position with no special rights', () => {
  it('is stored as an explicit marker, because an empty list would mean the manager defaults', () => {
    const hr = presetPermissions(findPreset('hr-head')!);
    expect(hr.featurePermissions).toEqual([NO_FEATURES]);
    const person = { id: 'u', name: 'H', username: 'h', password: '', isActive: true, ...hr } as unknown as User;
    for (const k of ['feat.bill.void', 'feat.bill.refund', 'feat.bill.price-edit', 'feat.discount.complimentary', 'feat.admin.day-close']) expect(userHasFeature(person, k), k).toBe(false);
    // …whereas the same person saved with an EMPTY list would have all of a manager's rights: the trap this avoids
    const trap = { ...person, featurePermissions: [] } as User;
    expect(userHasFeature(trap, 'feat.bill.void')).toBe(true);
    expect(userHasAccess(person, 'hr')).toBe(true);
    expect(userHasAccess(person, 'accounts')).toBe(false);
  });
  it('no preset stores an empty list, and the marker is not a real feature', () => {
    for (const p of ROLE_PRESETS) expect(presetPermissions(p).featurePermissions.length, p.id).toBeGreaterThan(0);
    expect(FEATURE_PERMISSIONS.some(f => f.key === NO_FEATURES)).toBe(false);
  });
});

describe('the users page', () => {
  const page = read('src/pages/UsersRolesPage.tsx');
  it('offers the positions grouped by level, applies one in a click, clears the branch lock for a head of department, and shows the position in the list', () => {
    expect(page).toContain('data-testid="position-picker"');
    expect(page).toMatch(/LEVEL_ORDER\.map\(level =>/);
    expect(page).toMatch(/\.\.\.\(preset\.acrossBranches \? \{ branchId: undefined \} : \{\}\)/);
    expect(page).toMatch(/matchPreset\(u\)!\.name/);
    // it still saves through the same path as before: no new fields
    expect(page).toContain('permissions: (toSave.permissions ?? []) as string[]');
  });
});
