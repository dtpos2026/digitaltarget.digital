// Unit conversion helpers — converts any purchase/recipe unit into the
// inventory item's BASE unit (kg/g/l/ml/pcs) using built-in factors plus
// per-item custom conversions (e.g. 1 Gatta = 20 KG).

import type { InventoryItem, UnitConversion } from './types';

export type BaseUnit = 'kg' | 'g' | 'l' | 'ml' | 'pcs';

export const BASE_UNITS: BaseUnit[] = ['kg', 'g', 'l', 'ml', 'pcs'];

/** Common purchase units shown in dropdowns. Custom ones can be added per item. */
export const PURCHASE_UNITS = ['Gatta', 'Bag', 'Carton', 'Box', 'Pack', 'Dozen', 'kg', 'g', 'l', 'ml', 'pcs'];

/** Units that can be used inside a recipe (must be compatible with item base). */
export const RECIPE_UNITS = ['kg', 'g', 'l', 'ml', 'pcs'];

const norm = (u?: string) => (u || '').trim().toLowerCase();

/** Built-in conversions between SI weight/volume units → base unit. */
function builtInFactor(fromUnit: string, baseUnit: BaseUnit): number | null {
  const u = norm(fromUnit);
  const b = baseUnit;
  if (u === b) return 1;
  // weight
  if (b === 'kg' && (u === 'g' || u === 'gram' || u === 'grams')) return 0.001;
  if (b === 'g' && (u === 'kg' || u === 'kilogram')) return 1000;
  // volume
  if (b === 'l' && (u === 'ml' || u === 'millilitre' || u === 'milliliter')) return 0.001;
  if (b === 'ml' && (u === 'l' || u === 'litre' || u === 'liter')) return 1000;
  // piece synonyms
  if (b === 'pcs' && (u === 'piece' || u === 'pieces' || u === 'pc')) return 1;
  return null;
}

/** How many BASE units equal 1 of `unit` for this item. Returns null if unknown. */
export function unitFactor(item: Pick<InventoryItem, 'unit' | 'baseUnit' | 'conversions'>, unit: string): number | null {
  const base = (item.baseUnit || (item.unit as BaseUnit) || 'pcs') as BaseUnit;
  // 1) custom conversion on item
  const custom = (item.conversions || []).find(c => norm(c.unit) === norm(unit));
  if (custom && custom.factor > 0) return custom.factor;
  // 2) built-in SI conversions
  const bi = builtInFactor(unit, base);
  if (bi !== null) return bi;
  return null;
}

/** Convert a quantity expressed in `unit` to the item's base unit. */
export function toBaseQty(item: Pick<InventoryItem, 'unit' | 'baseUnit' | 'conversions'>, qty: number, unit: string): number {
  const f = unitFactor(item, unit);
  if (f === null) return qty; // unknown → assume already in base
  return qty * f;
}

/** Resolve effective base unit (falls back to legacy `unit` field). */
export function getBaseUnit(item: Pick<InventoryItem, 'unit' | 'baseUnit'>): BaseUnit {
  if (item.baseUnit) return item.baseUnit;
  const u = norm(item.unit);
  if (u === 'kg' || u === 'kilogram') return 'kg';
  if (u === 'g' || u === 'gram' || u === 'grams') return 'g';
  if (u === 'l' || u === 'litre' || u === 'liter') return 'l';
  if (u === 'ml') return 'ml';
  return 'pcs';
}

/** Recipe unit must be compatible (same dimension) with item base. */
export function isCompatible(item: Pick<InventoryItem, 'unit' | 'baseUnit' | 'conversions'>, unit: string): boolean {
  return unitFactor(item, unit) !== null;
}

export type { UnitConversion };
