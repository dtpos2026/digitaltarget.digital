// ============================================================
// v1.10.0 — Business Types + default module presets
//
// Shown once on first setup (or from Settings → Business Type any time
// after). Picking a type auto-enables the modules that business
// normally needs — nothing is locked; every toggle can be changed
// individually afterwards in Module Management.
//
// IMPORTANT — what this can and cannot enable:
// Some requested "modules" (Table Management, Dine-In/Takeaway/Delivery,
// Kitchen Printer, Rider Management, Reports) are CORE features already
// always available — they are not optional-module gated, so there is
// nothing to "enable" for them. This file only lists genuinely optional
// modules that exist in src/lib/optionalModules.ts. Presets reference
// ONLY real, working feature keys — never a placeholder that would
// silently do nothing.
// ============================================================

export type BusinessType =
  | 'restaurant' | 'fast_food' | 'pizza_shop' | 'cafe' | 'bakery'
  | 'dessert_shop' | 'juice_bar' | 'bbq' | 'pakistani_restaurant'
  | 'chinese_restaurant' | 'custom';

export interface BusinessTypeDef {
  key: BusinessType;
  label: string;
  icon: string;
  description: string;
  /** optionalModules.ts keys to switch ON for this type. */
  defaultModules: string[];
}

export const BUSINESS_TYPES: BusinessTypeDef[] = [
  {
    key: 'restaurant', label: 'Restaurant', icon: '🍽️',
    description: 'Full-service dine-in restaurant with table service.',
    defaultModules: ['itemSalesReportEnabled'],
  },
  {
    key: 'fast_food', label: 'Fast Food', icon: '🍔',
    description: 'Quick counter service, mostly takeaway.',
    defaultModules: ['itemSalesReportEnabled', 'tokenModuleEnabled'],
  },
  {
    key: 'pizza_shop', label: 'Pizza Shop', icon: '🍕',
    description: 'Delivery-heavy, phone + counter orders.',
    defaultModules: ['itemSalesReportEnabled'],
  },
  {
    key: 'cafe', label: 'Cafe', icon: '☕',
    description: 'Coffee, light bites, table + counter mix.',
    defaultModules: ['itemSalesReportEnabled'],
  },
  {
    key: 'bakery', label: 'Bakery', icon: '🥐',
    description: 'Counter sales, walk-in customers, retail-style.',
    defaultModules: ['itemSalesReportEnabled', 'barcodeEnabled'],
  },
  {
    key: 'dessert_shop', label: 'Dessert Shop', icon: '🍨',
    description: 'Ice cream / dessert counter, tokens work well here.',
    defaultModules: ['itemSalesReportEnabled', 'tokenModuleEnabled'],
  },
  {
    key: 'juice_bar', label: 'Juice Bar', icon: '🥤',
    description: 'Fast counter turnover, simple menu.',
    defaultModules: ['itemSalesReportEnabled', 'tokenModuleEnabled'],
  },
  {
    key: 'bbq', label: 'BBQ', icon: '🍢',
    description: 'Dine-in + weight/portion-based items common.',
    defaultModules: ['itemSalesReportEnabled'],
  },
  {
    key: 'pakistani_restaurant', label: 'Pakistani Restaurant', icon: '🍛',
    description: 'Dine-in + takeaway + delivery, credit/udhaar common.',
    defaultModules: ['itemSalesReportEnabled', 'customPaymentTypesEnabled'],
  },
  {
    key: 'chinese_restaurant', label: 'Chinese Restaurant', icon: '🥡',
    description: 'Dine-in + heavy takeaway/delivery mix.',
    defaultModules: ['itemSalesReportEnabled'],
  },
  {
    key: 'custom', label: 'Custom Food Business', icon: '🏪',
    description: 'Something else — start plain and enable modules yourself.',
    defaultModules: [],
  },
];

export function getBusinessTypeDef(key: string | undefined | null): BusinessTypeDef | undefined {
  return BUSINESS_TYPES.find(b => b.key === key);
}
