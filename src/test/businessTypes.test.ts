// ============================================================
// Tests — v1.10.0 Business Types + Module Management
// ============================================================
import { describe, it, expect } from 'vitest';
import { BUSINESS_TYPES, getBusinessTypeDef } from '@/lib/businessTypes';
import { OPTIONAL_FEATURES, featureValue, setFeatureValue } from '@/lib/optionalModules';
import type { RestaurantSettings } from '@/lib/types';

describe('Business Types', () => {
  it('lists exactly the 11 types requested', () => {
    expect(BUSINESS_TYPES).toHaveLength(11);
    const keys = BUSINESS_TYPES.map(b => b.key);
    expect(keys).toEqual(expect.arrayContaining([
      'restaurant', 'fast_food', 'pizza_shop', 'cafe', 'bakery',
      'dessert_shop', 'juice_bar', 'bbq', 'pakistani_restaurant',
      'chinese_restaurant', 'custom',
    ]));
  });

  it('every default module reference is a REAL, existing feature key', () => {
    // Guards against a preset silently doing nothing because of a typo'd key.
    const validKeys = new Set<string>(OPTIONAL_FEATURES.map(f => f.key as string));
    for (const b of BUSINESS_TYPES) {
      for (const m of b.defaultModules) {
        expect(validKeys.has(m)).toBe(true);
      }
    }
  });

  it('"custom" business type enables nothing by default', () => {
    const custom = getBusinessTypeDef('custom');
    expect(custom?.defaultModules).toEqual([]);
  });

  it('getBusinessTypeDef returns undefined for an unknown/empty type', () => {
    expect(getBusinessTypeDef(undefined)).toBeUndefined();
    expect(getBusinessTypeDef('made_up')).toBeUndefined();
  });
});

describe('setFeatureValue — used by both the setup screen and Module Management', () => {
  it('sets a feature ON without mutating the input object', () => {
    const before = {} as RestaurantSettings;
    const after = setFeatureValue(before, 'tokenModuleEnabled', true);
    expect((before as any).tokenModuleEnabled).toBeUndefined();
    expect((after as any).tokenModuleEnabled).toBe(true);
    expect(featureValue(after, 'tokenModuleEnabled')).toBe(true);
  });

  it('can be chained to enable several modules (business-type preset flow)', () => {
    let s = {} as RestaurantSettings;
    s = setFeatureValue(s, 'itemSalesReportEnabled', true);
    s = setFeatureValue(s, 'tokenModuleEnabled', true);
    expect(featureValue(s, 'itemSalesReportEnabled')).toBe(true);
    expect(featureValue(s, 'tokenModuleEnabled')).toBe(true);
    // untouched features still default OFF
    expect(featureValue(s, 'barcodeEnabled')).toBe(false);
  });

  it('applying a preset is idempotent — running it twice changes nothing further', () => {
    const rest = getBusinessTypeDef('fast_food')!;
    let s = {} as RestaurantSettings;
    for (const k of rest.defaultModules) s = setFeatureValue(s, k, true);
    const once = { ...s };
    for (const k of rest.defaultModules) s = setFeatureValue(s, k, true);
    expect(s).toEqual(once);
  });
});

describe('multi-tenant safety — presets never touch other restaurants', () => {
  it('applying a preset to one settings object leaves a fresh one at defaults', () => {
    let restaurantA = {} as RestaurantSettings;
    for (const k of getBusinessTypeDef('bakery')!.defaultModules) {
      restaurantA = setFeatureValue(restaurantA, k, true);
    }
    const restaurantB = {} as RestaurantSettings;
    expect(featureValue(restaurantA, 'barcodeEnabled')).toBe(true);
    expect(featureValue(restaurantB, 'barcodeEnabled')).toBe(false);
  });
});
