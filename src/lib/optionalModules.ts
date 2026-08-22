// ============================================================
// v1.3.1 — OPTIONAL FEATURE REGISTRY (multi-tenant safety)
//
// WHY THIS EXISTS
// DT POS is a multi-tenant product: one update ships to EVERY restaurant.
// A feature that one restaurant asked for must never disturb the others.
// So every feature added after v1.2.4 is:
//   • registered here in ONE place,
//   • DEFAULT OFF (except where noted as a sub-option of an off-by-default
//     module, which can never surface on its own),
//   • toggleable by that restaurant's own Admin from Settings,
//   • stored in that tenant's own settings document (never global).
//
// RULE FOR FUTURE WORK: do not add a new module/feature without adding an
// entry here. That is what keeps upgrades safe for existing customers.
// ============================================================
import type { RestaurantSettings } from './types';

export type FeatureCategory = 'Module' | 'Printing' | 'Security';

export interface OptionalFeature {
  /** Settings key on RestaurantSettings. */
  key: keyof RestaurantSettings & string;
  label: string;
  description: string;
  category: FeatureCategory;
  /** Value used when the restaurant has never touched this setting. */
  defaultValue: boolean;
  /** Sidebar page keys that only exist while this feature is ON. */
  gatesPages?: string[];
  /** Only shown/relevant while this parent feature is ON. */
  requires?: string;
  /** Version this shipped in — helps support explain "what's new". */
  since: string;
}

export const OPTIONAL_FEATURES: OptionalFeature[] = [
  // ---------- Modules ----------
  {
    key: 'itemSalesReportEnabled',
    label: '📊 Item Sales Report (category/product-wise)',
    description:
      'Client-sample format ka detailed sales report: category-wise items (Qty/Amt), '
      + 'SUB TOTAL, SETTLEMENT (payment types), order types. Date presets (Aaj/Kal/Hafta/'
      + 'Month/Year/Custom) and 80mm printing. When on, an "Item Sales Report" page appears in the sidebar.',
    category: 'Module',
    defaultValue: false,
    gatesPages: ['itemSalesReport'],
    since: 'v1.6.0',
  },
  {
    key: 'shiftsEnabled',
    label: '💰 Shifts & Cash Drawer',
    description:
      'Staff shift open/close ke sath cash drawer reconciliation: starting cash, '
      + 'pay in / pay out, expected vs actual ending cash aur variance. Shift Report '
      + 'me "Cash drawer report" and shift header are built from this data. Where a drawer '
      + 'is never counted, leave this off.',
    category: 'Module',
    defaultValue: false,
    gatesPages: ['shifts'],
    since: 'v1.11.0',
  },
  {
    key: 'barcodeEnabled',
    gatesPages: ['barcode'],
    label: '🏷️ Barcode / SKU on items',
    description:
      'Adds a barcode/SKU field to every item, and the POS search also finds items '
      + 'by barcode — a USB barcode scanner (which types like a keyboard) '
      + 'works straight away. Intended for minimart and retail. On restaurant-only setups '
      + 'leave it off to keep the item form clean.',
    category: 'Module',
    defaultValue: false,
    since: 'v1.9.1',
  },
  {
    key: 'praEimsEnabled',
    label: '🧾 PRA EIMS (Punjab Revenue Authority)',
    description:
      'Electronic Invoice Monitoring System integration for PRA-registered restaurants in Punjab. '
      + 'integration. When on, a "PRA EIMS" settings page appears in the sidebar where each '
      + 'branch enters its own POS ID. Every paid bill is sent to the PRA fiscal device, '
      + 'and the returned Fiscal Invoice Number is printed on the receipt with a QR code. '
      + 'Only for businesses bound by PRA compliance.',
    category: 'Module',
    defaultValue: false,
    gatesPages: ['praEims'],
    since: 'v1.9.0',
  },
  {
    key: 'customPaymentTypesEnabled',
    label: '💳 Custom Payment Types',
    description:
      'Add your own payment types (for example NETS, PayNow, GrabPay) which appear on the payment screen '
      + 'as their own buttons and are counted separately in reports and settlement. The list of types '
      + 'is managed under Settings → Payments.',
    category: 'Module',
    defaultValue: false,
    since: 'v1.6.1',
  },
  {
    key: 'tokenModuleEnabled',
    label: '🎫 Token Printing Module',
    description:
      'Counter or festival style token sales. When on, a "Print Token" button, '
      + 'An "Is Token Item" option appears on menu items, and a Token Management page appears in the sidebar. '
      + 'When off, none of it is visible anywhere.',
    category: 'Module',
    defaultValue: false,
    gatesPages: ['tokens'],
    since: 'v1.3.0',
  },
  {
    key: 'tokenIncludeRevenueInReports',
    label: 'Include token amounts in the Sales Report',
    description: 'Turn this off to hide prices in token reports — only token counts and quantities are shown.',
    category: 'Module',
    defaultValue: true,
    requires: 'tokenModuleEnabled',
    since: 'v1.3.0',
  },
  {
    key: 'tokenSlipQr',
    label: 'Token slip par QR code',
    description: 'Prints a QR code on the token slip (optional).',
    category: 'Module',
    defaultValue: false,
    requires: 'tokenModuleEnabled',
    since: 'v1.3.0',
  },
  {
    key: 'tokenCounterDailyReset',
    label: 'Token counter roz reset',
    description: 'The token number restarts from 1 each day.',
    category: 'Module',
    defaultValue: true,
    requires: 'tokenModuleEnabled',
    since: 'v1.3.0',
  },

  // ---------- Printing ----------
  {
    key: 'paidOnlyReceipts',
    label: 'Only print receipts for PAID bills',
    description:
      'When on, slips for running, hold, unpaid and credit-pending bills will not go to the printer — '
      + 'only paid (plus credit-received and complimentary) bills print.',
    category: 'Printing',
    defaultValue: false,
    since: 'v1.2.6',
  },
  {
    key: 'hideUnpaidBadgeOnReceipt',
    label: 'Do not print the UNPAID / RUNNING band on receipts',
    description: 'The unpaid slip still prints, but without the large UNPAID status band.',
    category: 'Printing',
    defaultValue: false,
    since: 'v1.2.6',
  },

  // ---------- Security ----------
  {
    key: 'requirePasswordForItemRemove',
    label: 'Require a Manager password to remove or void an item',
    description:
      'Removing an item from a bill will require an Admin or Manager password. In the POS cart it applies only to items '
      + 'that have already gone to the kitchen, so cashier speed is unaffected.',
    category: 'Security',
    defaultValue: false,
    since: 'v1.2.6',
  },
];

/** Resolve a feature's effective value for a restaurant. */
export function featureValue(settings: RestaurantSettings | null | undefined, key: string): boolean {
  const def = OPTIONAL_FEATURES.find(f => f.key === key);
  const raw = settings ? (settings as any)[key] : undefined;
  if (raw === undefined || raw === null) return def ? def.defaultValue : false;
  return !!raw;
}

/**
 * v1.10.0 — Set a feature's ON/OFF value, returning a NEW settings object
 * (never mutates the input). Used by Business Type presets and the Module
 * Management panel so both go through one code path with one behaviour.
 */
export function setFeatureValue<T extends RestaurantSettings>(settings: T, key: string, value: boolean): T {
  return { ...settings, [key]: value } as T;
}

/**
 * Is a feature actually active? A sub-option is inactive whenever its
 * parent module is OFF — this is what guarantees a disabled module can
 * never leak any UI into another restaurant's app.
 */
export function featureActive(settings: RestaurantSettings | null | undefined, key: string): boolean {
  const def = OPTIONAL_FEATURES.find(f => f.key === key);
  if (def?.requires && !featureValue(settings, def.requires)) return false;
  return featureValue(settings, key);
}

/** Sidebar page keys that must be hidden for this restaurant right now. */
export function disabledModulePageKeys(settings: RestaurantSettings | null | undefined): string[] {
  const hidden: string[] = [];
  for (const f of OPTIONAL_FEATURES) {
    if (!f.gatesPages?.length) continue;
    if (!featureActive(settings, f.key)) hidden.push(...f.gatesPages);
  }
  return hidden;
}

/** Features grouped for the Settings UI. */
export function featuresByCategory(): Record<FeatureCategory, OptionalFeature[]> {
  const out: Record<FeatureCategory, OptionalFeature[]> = { Module: [], Printing: [], Security: [] };
  for (const f of OPTIONAL_FEATURES) out[f.category].push(f);
  return out;
}
