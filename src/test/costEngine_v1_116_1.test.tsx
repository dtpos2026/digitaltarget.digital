// v1.116.1 — one cost engine: the Costing page, the profit and loss (financials), the Profitability page and the Costing Reports
// all work out a recipe's cost with lib/recipeCosting.ts, so waste % and packaging reach every screen and no two screens disagree.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { InventoryItem, MenuItem, Recipe } from '@/lib/types';
import { costItem, costRecipe, recipeCostPerUnit, recipeFor } from '@/lib/recipeCosting';
import { recipeUnitCost } from '@/lib/financials';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const inv = (id: string, name: string, cost: number, extra: Partial<InventoryItem> = {}) => ({ id, name, sku: id, categoryId: 'c', costPrice: cost, quantity: 50, unit: 'kg', baseUnit: 'kg', salePrice: 0, lowStockThreshold: 1, isActive: true, ...extra }) as unknown as InventoryItem;
const stock = [inv('fl', 'Flour', 120), inv('bt', 'Butter', 900, { avgCostPrice: 950 })];
const recipe: Recipe = { id: 'cr', menuItemId: 'cr', components: [{ inventoryItemId: 'fl', quantity: 60, unit: 'g', wastePct: 10 }, { inventoryItemId: 'bt', quantity: 25, unit: 'g' }], packagingCost: 5 };
const item = { id: 'cr', name: 'Croissant', pricingType: 'fixed', price: 250, isActive: true } as unknown as MenuItem;

describe('one number', () => {
  // flour 60 g ÷ 0.9 = 66.67 g × 120/kg = 8.0 ; butter 25 g × 950/kg = 23.75 ; packaging 5  →  36.75
  const expected = 8 + 23.75 + 5;
  it('the Costing page, the profit and loss and the reports give the same cost, to the paisa', () => {
    expect(costItem({ item, price: 250, recipes: [recipe], inventory: stock }).productionCost).toBeCloseTo(expected, 2);
    expect(recipeUnitCost(recipe, new Map(stock.map(i => [i.id, i])))).toBeCloseTo(expected, 6);
    expect(recipeCostPerUnit(recipe, stock)).toBeCloseTo(expected, 6);
    expect(costRecipe(recipe, stock).productionCost).toBeCloseTo(expected, 6);
  });
  it('without waste or packaging it is exactly what the screens added up before — nothing moves for a recipe that has neither', () => {
    const plain: Recipe = { id: 'p', menuItemId: 'p', components: [{ inventoryItemId: 'fl', quantity: 1, unit: 'kg' }, { inventoryItemId: 'bt', quantity: 100, unit: 'g' }] };
    expect(recipeUnitCost(plain, new Map(stock.map(i => [i.id, i])))).toBeCloseTo(120 + 95, 6);    // moving average for the butter, as before
  });
  it('an ingredient that is gone from the stock list is skipped, not a crash', () => {
    const r: Recipe = { id: 'x', menuItemId: 'x', components: [{ inventoryItemId: 'gone', quantity: 1, unit: 'kg' }, { inventoryItemId: 'fl', quantity: 1, unit: 'kg' }] };
    expect(recipeCostPerUnit(r, stock)).toBe(120);
    expect(recipeCostPerUnit(undefined, stock)).toBe(0);
  });
  it('the unit cost is not rounded, so a bill of many portions adds up exactly', () => {
    const r: Recipe = { id: 'y', menuItemId: 'y', components: [{ inventoryItemId: 'fl', quantity: 7, unit: 'g' }] };
    expect(recipeCostPerUnit(r, stock) * 1000).toBeCloseTo(840, 6);                                  // 7 g × 120/kg = 0.84 each
  });
  it('a size takes its own recipe, else the default', () => {
    const recipes: Recipe[] = [recipe, { id: 'cr-L', menuItemId: 'cr', variantKey: 'size:Large', components: [{ inventoryItemId: 'bt', quantity: 100, unit: 'g' }] }];
    expect(recipeFor(recipes, 'cr', 'size:Large').recipe?.id).toBe('cr-L');
    expect(recipeFor(recipes, 'cr', 'size:Small').usesDefault).toBe(true);
  });
});

describe('the screens use the engine', () => {
  it('financials, Profitability and Costing Reports no longer add up recipe lines themselves', () => {
    expect(read('src/lib/financials.ts')).toContain("import { recipeCostPerUnit } from './recipeCosting';");
    expect(read('src/lib/financials.ts')).toContain('return recipeCostPerUnit(recipe, inventory);');
    const prof = read('src/pages/ProfitabilityPage.tsx');
    expect(prof).toContain("import { recipeCostPerUnit, recipeFor } from '@/lib/recipeCosting';");
    expect(prof).toContain('recipeCostPerUnit(recipe, inv) * multiplier');
    expect(prof).not.toContain('toBaseQty');
    const rep = read('src/pages/CostingReportsPage.tsx');
    expect(rep).toContain('recipeCostPerUnit(recipeFor(recipes, menuItemId, variantKey).recipe, inventory)');
    // the food cost of a bill line uses the line's own size
    expect(rep).toContain("menuItemCost(it.menuItemId, it.variantType && it.variantName ? `${it.variantType}:${it.variantName}` : '')");
    // consumption stays what the stock really moves by: the recipe quantity, no waste allowance
    expect(rep).toMatch(/Ingredient Consumption[\s\S]*toBaseQty\(item, c\.quantity, c\.unit\) \* multiplier/);
  });
});
