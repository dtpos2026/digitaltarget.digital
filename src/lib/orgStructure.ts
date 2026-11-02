// ============================================================
// ORGANISATION STRUCTURE (v1.97.0) — who manages what, the way a food chain is run.
//
//   Head Office ── the Owner (and co-owners): every branch, every setting, the money, the people
//   Branch      ── the Branch Manager: one branch's day, end to end
//   Departments ── a head per function: Kitchen, Store & Purchasing, Accounts, HR, Marketing & CRM, Delivery & Riders
//   Floor staff ── Cashier, Order Taker, Rider: the apps they use all day
//
// There was no way to express this: the software has five technical roles (admin, manager, cashier, order taker, rider)
// and ticking ~90 page boxes per person. A ROLE PRESET is a named position — "Kitchen Head", "Accounts Head" — that sets
// the technical role and the page and feature permissions in one click. It adds nothing to the database: a department
// head is a `manager` with a curated set of pages, and the person's branch (or "all branches") is set as before.
// Everything stays editable after the preset is applied.
// ============================================================
import type { User, UserRole } from './types';
import { PAGES, FEATURE_PERMISSIONS, defaultPermissionsForRole, defaultFeaturePermissionsForRole } from './permissions';

export type OrgLevel = 'head-office' | 'branch' | 'department' | 'floor';

export type DepartmentId = 'kitchen' | 'store' | 'accounts' | 'hr' | 'marketing' | 'delivery';

export interface Department { id: DepartmentId; name: string; manages: string }

export const DEPARTMENTS: Department[] = [
  { id: 'kitchen', name: 'Kitchen', manages: 'Kitchen display, recipes, wastage, the menu and its variations, kitchen slips.' },
  { id: 'store', name: 'Store & Purchasing', manages: 'Inventory, receiving, purchase orders, suppliers, barcodes, stock wastage.' },
  { id: 'accounts', name: 'Accounts & Finance', manages: 'Accounts, ledgers, wages, shifts and cash drawers, day close, sales and profit reports.' },
  { id: 'hr', name: 'HR & Staff', manages: 'Employees and payroll, the staff audit log, staff locations, riders as staff.' },
  { id: 'marketing', name: 'Marketing & CRM', manages: 'Customers, CRM, campaigns, promo codes, WhatsApp, the customer website and blocked customers.' },
  { id: 'delivery', name: 'Delivery & Riders', manages: 'Delivery and pickup boards, riders and their live map, online order approval, Foodpanda.' },
];

export interface RolePreset {
  id: string;
  name: string;
  level: OrgLevel;
  department?: DepartmentId;
  /** The technical role the person is saved with. */
  role: UserRole;
  /** One line for the picker. */
  summary: string;
  /** Page keys (permissions.ts PAGES). Empty with role 'admin' = every page. */
  pages: string[];
  /** Feature keys (permissions.ts FEATURE_PERMISSIONS). */
  features: string[];
  /** Whether this position normally sees all branches (a head-office or department head) rather than one branch. */
  acrossBranches: boolean;
}

/**
 * An EMPTY feature list means "the role's defaults" everywhere in the software (permissions.userHasFeature), so a position
 * that should have no special rights cannot be stored as an empty list — an HR Head would silently get a manager's void,
 * refund and price-edit rights. This marker keeps the list non-empty and grants nothing (no feature has this key).
 */
export const NO_FEATURES = 'feat.none';

const MANAGER_PAGES = defaultPermissionsForRole('manager');
const MANAGER_FEATURES = defaultFeaturePermissionsForRole('manager');

export const ROLE_PRESETS: RolePreset[] = [
  {
    id: 'owner', name: 'Owner / Head Office', level: 'head-office', role: 'admin', acrossBranches: true,
    summary: 'Everything, in every branch: settings, money, people, devices, backups.',
    pages: [], features: FEATURE_PERMISSIONS.map(f => f.key),
  },
  {
    id: 'branch-manager', name: 'Branch Manager', level: 'branch', role: 'manager', acrossBranches: false,
    summary: 'Runs one branch end to end: sales, stock, staff, reports, day close request.',
    pages: MANAGER_PAGES, features: MANAGER_FEATURES,
  },
  {
    id: 'kitchen-head', name: 'Kitchen Head', level: 'department', department: 'kitchen', role: 'manager', acrossBranches: true,
    summary: 'Kitchen display, recipes, wastage, the menu and kitchen slips.',
    pages: ['kitchen', 'recipes', 'wastage', 'menu', 'variations', 'printing-center', 'itemSalesReport'],
    features: ['feat.bill.cancel-kot', 'feat.inv.wastage'],
  },
  {
    id: 'store-head', name: 'Store & Purchasing Head', level: 'department', department: 'store', role: 'manager', acrossBranches: true,
    summary: 'Inventory, receiving, purchase orders, suppliers and barcodes.',
    pages: ['inventory', 'receiving', 'procurement', 'wastage', 'barcode', 'parties', 'recipes'],
    features: ['feat.inv.adjust', 'feat.inv.wastage', 'feat.inv.receive', 'feat.inv.cost-view'],
  },
  {
    id: 'accounts-head', name: 'Accounts Head', level: 'department', department: 'accounts', role: 'manager', acrossBranches: true,
    summary: 'Accounts, ledgers, wages, shifts, day close and the financial reports.',
    pages: ['accounts', 'parties', 'daily-wages', 'shifts', 'day-close', 'dashboard', 'reports', 'reports-center', 'advanced-reports', 'itemSalesReport', 'profitability', 'costing', 'audit-history', 'void-bills', 'credits', 'credit-customers'],
    features: ['feat.report.sales', 'feat.report.profit', 'feat.report.export', 'feat.report.cashier-perf', 'feat.admin.day-close', 'feat.inv.cost-view'],
  },
  {
    id: 'hr-head', name: 'HR Head', level: 'department', department: 'hr', role: 'manager', acrossBranches: true,
    summary: 'Employees, payroll, the staff audit log and staff locations.',
    pages: ['hr', 'staff-audit', 'staff-locations', 'riders'],
    features: [],
  },
  {
    id: 'marketing-head', name: 'Marketing & CRM Head', level: 'department', department: 'marketing', role: 'manager', acrossBranches: true,
    summary: 'Customers, CRM, campaigns, promo codes, WhatsApp and the customer website.',
    pages: ['customers', 'customer-map', 'crm', 'marketing', 'promo-codes', 'whatsapp', 'online-portal', 'blocked-customers', 'blocked-locations'],
    features: ['feat.report.sales'],
  },
  {
    id: 'delivery-head', name: 'Delivery Head', level: 'department', department: 'delivery', role: 'manager', acrossBranches: true,
    summary: 'Delivery and pickup, riders and the live map, online order approval.',
    pages: ['delivery', 'pickup', 'riders', 'rider-app', 'live-map', 'live-riders', 'online-approval', 'foodpanda-orders', 'bills'],
    features: ['feat.bill.reprint'],
  },
  {
    id: 'cashier', name: 'Cashier', level: 'floor', role: 'cashier', acrossBranches: false,
    summary: 'Takes orders and payments at the till.',
    pages: defaultPermissionsForRole('cashier'), features: defaultFeaturePermissionsForRole('cashier'),
  },
  {
    id: 'order-taker', name: 'Order Taker', level: 'floor', role: 'order_taker', acrossBranches: false,
    summary: 'Takes table orders on a phone.',
    pages: defaultPermissionsForRole('order_taker'), features: defaultFeaturePermissionsForRole('order_taker'),
  },
  {
    id: 'rider', name: 'Rider', level: 'floor', role: 'rider', acrossBranches: false,
    summary: 'Delivers orders from the rider app.',
    pages: defaultPermissionsForRole('rider'), features: defaultFeaturePermissionsForRole('rider'),
  },
];

export const LEVEL_LABEL: Record<OrgLevel, string> = {
  'head-office': 'Head Office', branch: 'Branch', department: 'Department heads', floor: 'Floor staff',
};

export const LEVEL_ORDER: OrgLevel[] = ['head-office', 'branch', 'department', 'floor'];

export function findPreset(id: string): RolePreset | undefined { return ROLE_PRESETS.find(p => p.id === id); }

/** The permission lists a preset sets. Owner = the role's own defaults (admin has every page). */
export function presetPermissions(p: RolePreset): { role: UserRole; permissions: string[]; featurePermissions: string[] } {
  return {
    role: p.role,
    permissions: p.role === 'admin' ? defaultPermissionsForRole('admin') : [...p.pages],
    featurePermissions: p.features.length ? [...p.features] : [NO_FEATURES],
  };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));

/**
 * Which named position a person's current settings amount to, or null when they have been customised.
 * A department head is recognised by the exact set of pages — it is what makes the Users list readable at a glance.
 */
export function matchPreset(u: Pick<User, 'role' | 'permissions' | 'featurePermissions'>): RolePreset | null {
  const pages = u.permissions && u.permissions.length ? u.permissions : defaultPermissionsForRole(u.role);
  const feats = (u.featurePermissions && u.featurePermissions.length ? u.featurePermissions : defaultFeaturePermissionsForRole(u.role)).filter(k => k !== NO_FEATURES);
  for (const p of ROLE_PRESETS) {
    if (p.role !== u.role) continue;
    const want = presetPermissions(p);
    if (sameSet(pages, want.permissions) && (u.role === 'admin' || sameSet(feats, want.featurePermissions.filter(k => k !== NO_FEATURES)))) return p;
  }
  return null;
}

/** Page keys that do not exist (a typo here would silently give a department head nothing). Empty when the table is sound. */
export function unknownPresetKeys(): string[] {
  const pageKeys = new Set(PAGES.map(p => p.key));
  const featKeys = new Set(FEATURE_PERMISSIONS.map(f => f.key));
  const bad: string[] = [];
  for (const p of ROLE_PRESETS) {
    for (const k of p.pages) if (!pageKeys.has(k)) bad.push(`${p.id}:${k}`);
    for (const k of p.features) if (!featKeys.has(k)) bad.push(`${p.id}:${k}`);
  }
  return bad;
}
