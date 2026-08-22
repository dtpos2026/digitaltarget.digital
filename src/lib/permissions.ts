import { User, UserRole } from './types';
import { featureEnabled, getCurrentTenantPlan, getCurrentTenantOverrides } from './plans';
import { disabledModulePageKeys } from './optionalModules';

export type PageGroup = 'Operations' | 'Marketing' | 'Inventory' | 'Accounts' | 'Staff' | 'Reports' | 'Admin';

export interface PageDef {
  key: string;            // unique key (also matches route path used in sidebar)
  path: string;           // route path
  title: string;
  group: PageGroup;
  defaultRoles: UserRole[];
}

/** Sidebar group display order. */
export const GROUP_ORDER: PageGroup[] = ['Operations', 'Marketing', 'Inventory', 'Accounts', 'Staff', 'Reports', 'Admin'];

export const PAGES: PageDef[] = [
  // Operations — daily floor work
  { key: 'pos',        path: '/',           title: 'POS',        group: 'Operations', defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'tables',     path: '/tables',     title: 'Tables',     group: 'Operations', defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'bills',      path: '/bills',      title: 'Retrieve',   group: 'Operations', defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'delivery',   path: '/delivery',   title: 'Delivery',   group: 'Operations', defaultRoles: ['admin', 'manager', 'cashier', 'rider'] },
  { key: 'pickup',     path: '/pickup',     title: 'Pickup Orders', group: 'Operations', defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'rider-app',  path: '/rider',      title: 'Rider App',  group: 'Operations', defaultRoles: ['admin', 'manager', 'rider'] },
  { key: 'kitchen',    path: '/kitchen',    title: 'Kitchen',    group: 'Operations', defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'credits',    path: '/credits',    title: 'Credits / Udhaar', group: 'Operations', defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'credit-customers', path: '/credit-customers', title: 'Credit Customers (Ledger)', group: 'Operations', defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'void-bills', path: '/void-bills', title: 'Void / Comp / Cancel', group: 'Operations', defaultRoles: ['admin', 'manager'] },
  { key: 'retray',     path: '/retray',     title: 'Retray (Reprint/Pay)', group: 'Operations', defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'tokens',     path: '/tokens',     title: 'Token Management', group: 'Operations', defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'itemSalesReport', path: '/item-sales-report', title: 'Item Sales Report', group: 'Reports', defaultRoles: ['admin', 'manager'] },
  { key: 'praEims', path: '/pra-eims', title: 'PRA EIMS', group: 'Admin', defaultRoles: ['admin'] },
  { key: 'moduleManagement', path: '/module-management', title: 'Module Management', group: 'Admin', defaultRoles: ['admin'] },
  { key: 'shifts', path: '/shifts', title: 'Shift & Cash Drawer', group: 'Accounts', defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'dataIntegrity', path: '/data-integrity', title: 'Data Integrity', group: 'Admin', defaultRoles: ['admin'] },
  { key: 'refund', path: '/refund', title: 'Refund', group: 'Operations', defaultRoles: ['admin', 'manager'] },
  { key: 'barcode', path: '/barcode', title: 'Barcode & Labels', group: 'Inventory', defaultRoles: ['admin', 'manager'] },
  { key: 'pending-payments', path: '/pending-payments', title: 'Pending Payments', group: 'Operations', defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'bill-reprint', path: '/bill-reprint', title: 'Bill Reprint (Read-only)', group: 'Operations', defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'foodpanda-orders', path: '/foodpanda-orders', title: 'Foodpanda Orders', group: 'Operations', defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'online-portal', path: '/online-portal', title: 'Customer Portal / Website', group: 'Operations', defaultRoles: ['admin', 'manager'] },
  
  { key: 'online-approval', path: '/online-approval', title: 'Online Order Approval', group: 'Operations', defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'blocked-customers', path: '/blocked-customers', title: 'Blocked Customers', group: 'Operations', defaultRoles: ['admin', 'manager'] },
  { key: 'blocked-locations', path: '/blocked-locations', title: 'Blocked Locations', group: 'Operations', defaultRoles: ['admin', 'manager'] },

  // Marketing & customer outreach
  { key: 'whatsapp',   path: '/whatsapp',   title: 'WhatsApp',   group: 'Marketing',  defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'customers',     path: '/customers',     title: 'Customers',     group: 'Marketing',  defaultRoles: ['admin', 'manager'] },
  { key: 'customer-map',  path: '/customer-map',  title: 'Customer Map',  group: 'Marketing',  defaultRoles: ['admin', 'manager'] },
  { key: 'crm',        path: '/crm',        title: 'CRM Insights', group: 'Marketing', defaultRoles: ['admin', 'manager'] },
  { key: 'marketing',  path: '/marketing',  title: 'Contacts',   group: 'Marketing',  defaultRoles: ['admin', 'manager'] },
  { key: 'promo-codes', path: '/promo-codes', title: 'Promo Codes', group: 'Marketing', defaultRoles: ['admin', 'manager'] },

  // Inventory & menu
  { key: 'menu',       path: '/menu',       title: 'Menu',       group: 'Inventory',  defaultRoles: ['admin', 'manager'] },
  { key: 'variations', path: '/variations', title: 'Deals / Combos', group: 'Inventory', defaultRoles: ['admin', 'manager'] },
  { key: 'inventory',  path: '/inventory',  title: 'Inventory',  group: 'Inventory',  defaultRoles: ['admin', 'manager'] },
  { key: 'recipes',    path: '/recipes',    title: 'Recipes',    group: 'Inventory',  defaultRoles: ['admin', 'manager'] },
  { key: 'wastage',    path: '/wastage',    title: 'Wastage',    group: 'Inventory',  defaultRoles: ['admin', 'manager'] },
  { key: 'receiving',  path: '/receiving',  title: 'Receiving',  group: 'Inventory',  defaultRoles: ['admin', 'manager'] },

  // Accounts
  { key: 'accounts',   path: '/accounts',   title: 'Accounts',   group: 'Accounts',   defaultRoles: ['admin', 'manager'] },
  { key: 'parties',    path: '/parties',    title: 'Party Master', group: 'Accounts', defaultRoles: ['admin', 'manager'] },
  { key: 'daily-wages', path: '/daily-wages', title: 'Daily Wages', group: 'Accounts', defaultRoles: ['admin', 'manager', 'cashier'] },

  // Staff
  { key: 'hr',         path: '/hr',         title: 'HR',         group: 'Staff',      defaultRoles: ['admin', 'manager'] },
  { key: 'users',      path: '/users',      title: 'Users',      group: 'Staff',      defaultRoles: ['admin'] },
  { key: 'staff-audit', path: '/staff-audit', title: 'Staff Audit Log', group: 'Staff', defaultRoles: ['admin', 'manager'] },
  { key: 'staff-locations', path: '/staff-locations', title: 'Location History', group: 'Staff', defaultRoles: ['admin', 'manager'] },

  // Reports
  { key: 'dashboard',  path: '/dashboard',  title: 'Dashboard',  group: 'Reports',    defaultRoles: ['admin', 'manager'] },
  { key: 'profitability', path: '/profitability', title: 'Profitability', group: 'Reports', defaultRoles: ['admin', 'manager'] },
  { key: 'costing',    path: '/costing',    title: 'Cost Reports', group: 'Reports', defaultRoles: ['admin', 'manager'] },
  { key: 'reports',    path: '/reports',    title: 'Reports',    group: 'Reports',    defaultRoles: ['admin', 'manager'] },
  { key: 'reports-center', path: '/reports-center', title: 'Reports Center', group: 'Reports', defaultRoles: ['admin', 'manager'] },
  { key: 'advanced-reports', path: '/advanced-reports', title: 'Advanced Item/Variant Reports', group: 'Reports', defaultRoles: ['admin', 'manager'] },
  { key: 'admin-sales-history', path: '/admin-sales-history', title: 'Admin Sales History', group: 'Reports', defaultRoles: ['admin'] },
  { key: 'audit-history', path: '/audit-history', title: 'Bill / KOT Edit History', group: 'Reports', defaultRoles: ['admin', 'manager'] },
  { key: 'bill-editor', path: '/bill-editor', title: 'Bill Editor', group: 'Reports', defaultRoles: ['admin', 'manager'] },

  // Admin
  { key: 'settings',   path: '/settings',   title: 'Settings',   group: 'Admin',      defaultRoles: ['admin'] },
  { key: 'printing-center', path: '/printing-center', title: 'Printing Center', group: 'Admin', defaultRoles: ['admin', 'manager'] },
  { key: 'branches',   path: '/branches',   title: 'Branches',   group: 'Admin',      defaultRoles: ['admin'] },
  { key: 'branches-map', path: '/branches-map', title: 'Branches Map', group: 'Admin',  defaultRoles: ['admin', 'manager'] },
  { key: 'live-map',    path: '/live-map',    title: 'Live Map',    group: 'Admin',     defaultRoles: ['admin', 'manager'] },
  { key: 'live-riders', path: '/live-riders', title: 'Live Riders Map', group: 'Admin',     defaultRoles: ['admin', 'manager'] },
  { key: 'riders',      path: '/riders',      title: 'Riders',          group: 'Staff',     defaultRoles: ['admin', 'manager'] },
  { key: 'backup',     path: '/backup',     title: 'Backup',     group: 'Admin',      defaultRoles: ['admin'] },
  { key: 'devices',    path: '/devices',    title: 'Devices',    group: 'Admin',      defaultRoles: ['admin'] },
  { key: 'version',    path: '/version',    title: 'Software Version', group: 'Admin', defaultRoles: ['admin'] },
  // Virtual permission: controls who can *request* / *confirm* Day Close inside Settings.
  { key: 'day-close',  path: '/settings',   title: 'Day Close',  group: 'Admin',      defaultRoles: ['admin'] },
];


/** Admins always get every page. Order takers get only POS / Tables / Running Bills. */
export function defaultPermissionsForRole(role: UserRole): string[] {
  if (role === 'order_taker') return ['pos', 'tables', 'bills'];
  return PAGES.filter(p => p.defaultRoles.includes(role)).map(p => p.key);
}

// ============== Feature / Action level permissions ==============
export type FeatureGroup = 'Billing' | 'Discounts' | 'Inventory' | 'Reports' | 'Admin';

export interface FeaturePermDef {
  key: string;
  title: string;
  desc: string;
  group: FeatureGroup;
  defaultRoles: UserRole[]; // who is allowed by default
}

export const FEATURE_GROUP_ORDER: FeatureGroup[] = ['Billing', 'Discounts', 'Inventory', 'Reports', 'Admin'];

export const FEATURE_PERMISSIONS: FeaturePermDef[] = [
  // Billing actions
  { key: 'feat.bill.edit',         title: 'Edit Bill',           desc: 'Modify items / qty after KOT', group: 'Billing',   defaultRoles: ['admin', 'manager'] },
  { key: 'feat.bill.void',         title: 'Void Bill',           desc: 'Void a completed bill',         group: 'Billing',   defaultRoles: ['admin', 'manager'] },
  { key: 'feat.bill.cancel-kot',   title: 'Cancel KOT Item',     desc: 'Remove item from running KOT',  group: 'Billing',   defaultRoles: ['admin', 'manager'] },
  { key: 'feat.bill.reprint',      title: 'Reprint Bill',        desc: 'Reprint receipt / KOT',         group: 'Billing',   defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'feat.bill.refund',       title: 'Refund',              desc: 'Issue refund on paid bill',     group: 'Billing',   defaultRoles: ['admin', 'manager'] },
  { key: 'feat.bill.price-edit',   title: 'Edit Item Price',     desc: 'Change item price on POS',      group: 'Billing',   defaultRoles: ['admin', 'manager'] },
  { key: 'feat.bill.open-drawer',  title: 'Open Cash Drawer',    desc: 'Open drawer without sale',      group: 'Billing',   defaultRoles: ['admin', 'manager'] },

  // Discounts
  { key: 'feat.discount.apply',    title: 'Apply Discount',      desc: 'Apply discount on bill',        group: 'Discounts', defaultRoles: ['admin', 'manager', 'cashier'] },
  { key: 'feat.discount.approve',  title: 'Approve Discount',    desc: 'Approve cashier discount req.', group: 'Discounts', defaultRoles: ['admin', 'manager'] },
  { key: 'feat.discount.complimentary', title: 'Complimentary',  desc: 'Mark items / bill as comp',     group: 'Discounts', defaultRoles: ['admin', 'manager'] },

  // Inventory
  { key: 'feat.inv.adjust',        title: 'Stock Adjustment',    desc: 'Manual stock add/remove',       group: 'Inventory', defaultRoles: ['admin', 'manager'] },
  { key: 'feat.inv.wastage',       title: 'Record Wastage',      desc: 'Mark wastage entries',          group: 'Inventory', defaultRoles: ['admin', 'manager'] },
  { key: 'feat.inv.receive',       title: 'Receive Goods',       desc: 'Create receiving / GRN',        group: 'Inventory', defaultRoles: ['admin', 'manager'] },
  { key: 'feat.inv.cost-view',     title: 'View Cost Price',     desc: 'See product cost / margin',     group: 'Inventory', defaultRoles: ['admin', 'manager'] },

  // Reports
  { key: 'feat.report.sales',      title: 'Sales Reports',       desc: 'View sales reports',            group: 'Reports',   defaultRoles: ['admin', 'manager'] },
  { key: 'feat.report.profit',     title: 'Profit Reports',      desc: 'View profitability',            group: 'Reports',   defaultRoles: ['admin'] },
  { key: 'feat.report.export',     title: 'Export / Download',   desc: 'Export Excel / PDF',            group: 'Reports',   defaultRoles: ['admin', 'manager'] },
  { key: 'feat.report.cashier-perf', title: 'Cashier Performance', desc: 'View cashier-wise breakdown', group: 'Reports',   defaultRoles: ['admin', 'manager'] },

  // Admin
  { key: 'feat.admin.day-close',   title: 'Day Close',           desc: 'Run day close process',         group: 'Admin',     defaultRoles: ['admin'] },
  { key: 'feat.admin.settings-edit', title: 'Edit Settings',     desc: 'Change app settings',           group: 'Admin',     defaultRoles: ['admin'] },
  { key: 'feat.admin.users-manage', title: 'Manage Users',       desc: 'Add / edit / delete users',     group: 'Admin',     defaultRoles: ['admin'] },
  { key: 'feat.admin.backup',      title: 'Backup / Restore',    desc: 'Backup / restore data',         group: 'Admin',     defaultRoles: ['admin'] },
  { key: 'feat.admin.device-approve', title: 'Approve Devices',  desc: 'Approve new devices',           group: 'Admin',     defaultRoles: ['admin'] },
];

export function defaultFeaturePermissionsForRole(role: UserRole): string[] {
  if (role === 'admin') return FEATURE_PERMISSIONS.map(f => f.key);
  return FEATURE_PERMISSIONS.filter(f => f.defaultRoles.includes(role)).map(f => f.key);
}

export function userHasFeature(user: User | undefined | null, featureKey: string): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const perms = user.featurePermissions && user.featurePermissions.length > 0
    ? user.featurePermissions
    : defaultFeaturePermissionsForRole(user.role);
  return perms.includes(featureKey);
}


/** Legacy page keys merged into newer modules (kept so saved staff
 *  permissions do not silently lose access after a module merge). */
const LEGACY_KEY_ALIASES: Record<string, string[]> = {
  'printing-center': ['printer-settings', 'printer-diagnostics', 'pending-prints'],
};

export function userHasAccess(user: User | undefined | null, pageKey: string): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true; // admin = full access always
  const perms = user.permissions && user.permissions.length > 0
    ? user.permissions
    : defaultPermissionsForRole(user.role);
  if (perms.includes(pageKey)) return true;
  return (LEGACY_KEY_ALIASES[pageKey] || []).some((k) => perms.includes(k));
}


/** Pages hidden when "Food Cost & Profit Tracking" master toggle is OFF. */
export const COST_TRACKING_PAGES = ['recipes', 'profitability', 'wastage', 'costing'];

/** Convenience for the layout: filter pages a user can see (role + cost toggle + plan). */
export function visiblePagesForUser(
  user: User | undefined | null,
  costTrackingEnabled = true,
  settings?: import('./types').RestaurantSettings | null,
): PageDef[] {
  if (!user) return [];
  const all = user.role === 'admin'
    ? PAGES
    : (() => {
        const perms = user.permissions && user.permissions.length > 0
          ? user.permissions
          : defaultPermissionsForRole(user.role);
        return PAGES.filter(p => userHasAccess(user, p.key));
      })();
  const afterCost = costTrackingEnabled ? all : all.filter(p => !COST_TRACKING_PAGES.includes(p.key));
  // v1.3.1 multi-tenant safety: hide pages belonging to optional modules
  // this restaurant has NOT enabled. One update ships to every tenant, so a
  // module another restaurant asked for must stay completely invisible here.
  const hiddenModulePages = disabledModulePageKeys(settings ?? null);
  const afterModules = hiddenModulePages.length
    ? afterCost.filter(p => !hiddenModulePages.includes(p.key))
    : afterCost;
  // Plan + per-tenant overrides — Settings always remains visible so owner can upgrade.
  const plan = getCurrentTenantPlan();
  const overrides = getCurrentTenantOverrides();
  return afterModules.filter(p => p.key === 'settings' || featureEnabled(plan, p.key, overrides));
}

