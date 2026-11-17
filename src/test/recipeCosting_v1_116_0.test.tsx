// v1.116.0 — Recipe costing: ingredient → production cost → gross profit → food cost % → suggested price, per branch; menu engineering.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, within } from '@testing-library/react';
import type { InventoryItem, MenuItem, Order, Recipe } from '@/lib/types';
import { costItem, costMenu, foodCostStatus, ingredientFor, menuEngineering, recipeFor, suggestedPrice, summarize, wasteShare } from '@/lib/recipeCosting';
import { PAGES } from '@/lib/permissions';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const inv = (id: string, name: string, cost: number, extra: Partial<InventoryItem> = {}) => ({ id, name, sku: name.slice(0, 3).toUpperCase(), categoryId: 'c', costPrice: cost, quantity: 100, unit: 'kg', baseUnit: 'kg', salePrice: 0, lowStockThreshold: 1, isActive: true, ...extra }) as unknown as InventoryItem;
const flour = inv('fl', 'Flour', 120), butter = inv('bt', 'Butter', 900), sugar = inv('sg', 'Sugar', 150, { avgCostPrice: 160 });
const croissant = { id: 'cr', name: 'Croissant', categoryId: 'bk', pricingType: 'fixed', price: 250, isActive: true } as unknown as MenuItem;
const rec = (menuItemId: string, components: Recipe['components'], extra: Partial<Recipe> = {}): Recipe => ({ id: menuItemId + (extra.variantKey || ''), menuItemId, components, ...extra });

describe('the cost of one item', () => {
  const r = rec('cr', [{ inventoryItemId: 'fl', quantity: 60, unit: 'g' }, { inventoryItemId: 'bt', quantity: 25, unit: 'g' }], { packagingCost: 5 });
  it('ingredients at their cost per base unit (units converted), plus packaging; profit, margin and food cost follow', () => {
    const c = costItem({ item: croissant, price: 250, recipes: [r], inventory: [flour, butter] });
    // 60 g flour = 0.06 kg × 120 = 7.2 ; 25 g butter = 0.025 kg × 900 = 22.5 ; packaging 5
    expect(c.ingredientCost).toBe(29.7);
    expect(c.productionCost).toBe(34.7);
    expect(c.grossProfit).toBe(215.3);
    expect(c.marginPct).toBe(86.1);
    expect(c.foodCostPct).toBe(13.9);
    expect(c.lines.map(l => [l.name, l.cost, l.sharePct])).toEqual([['Flour', 7.2, 24.2], ['Butter', 22.5, 75.8]]);
  });
  it('a waste allowance raises the cost: quantity ÷ (1 − waste %)', () => {
    const w = rec('cr', [{ inventoryItemId: 'bt', quantity: 25, unit: 'g', wastePct: 20 }]);
    const c = costItem({ item: croissant, price: 250, recipes: [w], inventory: [butter] });
    expect(c.lines[0]).toMatchObject({ wastePct: 20, effectiveQty: 31.25 });
    expect(c.ingredientCost).toBe(28.13);                              // 31.25 g × 0.9
    expect(wasteShare(100)).toBe(0.95);                                // never divides by zero
    expect(wasteShare('x')).toBe(0);
    expect(wasteShare(-5)).toBe(0);
  });
  it('the moving-average cost wins over the cost price; an ingredient with no cost or no longer in stock is warned about', () => {
    const c = costItem({ item: croissant, price: 100, recipes: [rec('cr', [{ inventoryItemId: 'sg', quantity: 1, unit: 'kg' }, { inventoryItemId: 'zz', quantity: 1, unit: 'kg' }, { inventoryItemId: 'nc', quantity: 1, unit: 'kg' }])], inventory: [sugar, inv('nc', 'Saffron', 0)] });
    expect(c.lines.find(l => l.name === 'Sugar')?.unitCost).toBe(160);
    expect(c.warnings).toEqual(['An ingredient is no longer in the stock list', 'Saffron has no cost yet']);
  });
  it('an item without a recipe has no cost, no food cost % and the status "none"', () => {
    const c = costItem({ item: croissant, price: 250, recipes: [], inventory: [flour] });
    expect(c).toMatchObject({ hasRecipe: false, productionCost: 0, foodCostPct: null });
    expect(foodCostStatus(c, 30)).toBe('none');
  });
});

describe('branches', () => {
  const nyFlour = inv('fl2', 'Flour', 140, { branchId: 'b2' }), hqFlour = inv('fl', 'Flour', 120, { branchId: 'b1' });
  const r = rec('cr', [{ inventoryItemId: 'fl', quantity: 1, unit: 'kg' }]);
  it('each branch is costed with its own purchase price, found by SKU then by name; a branch without it falls back', () => {
    expect(ingredientFor(hqFlour, [hqFlour, nyFlour], 'b2').id).toBe('fl2');
    expect(costItem({ item: croissant, price: 500, recipes: [r], inventory: [hqFlour, nyFlour], branchId: 'b2' }).productionCost).toBe(140);
    expect(costItem({ item: croissant, price: 500, recipes: [r], inventory: [hqFlour, nyFlour], branchId: 'b1' }).productionCost).toBe(120);
    expect(costItem({ item: croissant, price: 500, recipes: [r], inventory: [hqFlour], branchId: 'b3' }).productionCost).toBe(120);
  });
});

describe('sizes, prices and the target', () => {
  const pizza = { id: 'pz', name: 'Pizza', categoryId: 'pz', pricingType: 'size', price: 0, isActive: true, sizeVariants: [{ name: 'Small', price: 600 }, { name: 'Large', price: 1200 }] } as unknown as MenuItem;
  it('one row per size, each with its own recipe — or the default one, said so', () => {
    const recipes = [rec('pz', [{ inventoryItemId: 'fl', quantity: 300, unit: 'g' }]), rec('pz', [{ inventoryItemId: 'fl', quantity: 600, unit: 'g' }], { variantKey: 'size:Large' })];
    const rows = costMenu([pizza], recipes, [flour]);
    expect(rows.map(r => [r.variantKey, r.price, r.productionCost, r.usesDefault])).toEqual([['size:Small', 600, 36, true], ['size:Large', 1200, 72, false]]);
    expect(recipeFor(recipes, 'pz', 'size:Large').usesDefault).toBe(false);
  });
  it('status against the target: on target, up to 5 points over is "watch", more is "over"', () => {
    const c = (pct: number) => ({ foodCostPct: pct, hasRecipe: true });
    expect([28, 30, 33, 36].map(p => foodCostStatus(c(p), 30))).toEqual(['healthy', 'healthy', 'watch', 'over']);
  });
  it('the suggested price reaches the target, rounded up to 5, never below the cost', () => {
    expect(suggestedPrice(100, 30)).toBe(335);                          // 333.3 → 335
    expect(suggestedPrice(100, 30, 10)).toBe(340);
    expect(suggestedPrice(0, 30)).toBe(0);
    expect(suggestedPrice(100, 0)).toBe(0);
  });
  it('the summary counts statuses and averages the food cost of the costed items only', () => {
    const rows = [
      costItem({ item: croissant, price: 250, recipes: [rec('cr', [{ inventoryItemId: 'bt', quantity: 100, unit: 'g' }])], inventory: [butter] }),   // 90 / 250 = 36 %
      costItem({ item: { ...croissant, id: 'x', name: 'X' } as MenuItem, price: 100, recipes: [], inventory: [] }),
    ];
    expect(summarize(rows, 30)).toMatchObject({ items: 2, costed: 1, over: 1, none: 1, avgFoodCostPct: 36 });
  });
});

describe('menu engineering', () => {
  const costs = [
    { menuItemId: 'a', name: 'Cake slice', variantKey: '', hasRecipe: true, productionCost: 40 },
    { menuItemId: 'b', name: 'Plain bun', variantKey: '', hasRecipe: true, productionCost: 18 },
    { menuItemId: 'c', name: 'Truffle cake', variantKey: '', hasRecipe: true, productionCost: 300 },
    { menuItemId: 'd', name: 'Old rusk', variantKey: '', hasRecipe: true, productionCost: 30 },
  ] as never;
  const line = (id: string, qty: number, lineTotal: number) => ({ menuItemId: id, quantity: qty, lineTotal, pricingType: 'fixed' });
  const orders = [
    { status: 'paid', items: [line('a', 50, 50 * 200), line('b', 60, 60 * 30), line('c', 4, 4 * 900), line('d', 3, 3 * 35)] },
    { status: 'void', items: [line('c', 100, 90000)] },
  ] as unknown as Order[];
  it('Star, Plowhorse, Puzzle and Dog from popularity and contribution; void bills and weighed lines never count', () => {
    const e = menuEngineering(orders, costs);
    const by = Object.fromEntries(e.rows.map(r => [r.menuItemId, r.cls]));
    expect(by).toEqual({ a: 'star', b: 'plowhorse', c: 'puzzle', d: 'dog' });
    expect(e.rows[0].menuItemId).toBe('a');                              // biggest contribution first
    expect(e.popularityBar).toBe(17.5);                                   // 70 % of an equal quarter
    expect(e.rows.find(r => r.menuItemId === 'a')).toMatchObject({ qty: 50, cmPerUnit: 160, contribution: 8000 });
  });
  it('items without a recipe are left out — a margin cannot be said without a cost', () => {
    const e = menuEngineering([{ status: 'paid', items: [line('zz', 5, 500)] }] as unknown as Order[], costs);
    expect(e.rows).toEqual([]);
  });
});

// ---- the page, with the store replaced
vi.mock('@/lib/store', () => ({
  getMenuItems: () => [{ id: 'cr', name: 'Croissant', categoryId: 'bk', pricingType: 'fixed', price: 250, isActive: true }, { id: 'bn', name: 'Bun', categoryId: 'bk', pricingType: 'fixed', price: 40, isActive: true }],
  getRecipes: () => [{ id: 'cr', menuItemId: 'cr', components: [{ inventoryItemId: 'bt', quantity: 100, unit: 'g' }], packagingCost: 5 }],
  getInventory: () => [{ id: 'bt', name: 'Butter', sku: 'BUT', costPrice: 900, quantity: 10, unit: 'kg', baseUnit: 'kg', isActive: true }],
  getCategories: () => [{ id: 'bk', name: 'Bakery' }],
  getBranches: () => [],
  getOrders: () => [],
  getSettings: () => ({}),
  saveSettings: vi.fn(),
}));
vi.mock('@/lib/cashierScope', () => ({ scopeToBranch: (o: unknown) => o }));

describe('Costing page', () => {
  it('rows with cost, price, profit and food cost; a click opens the panel with the breakdown, the what-if and the suggested price', async () => {
    const { default: Page } = await import('@/pages/RecipeCostingPage');
    render(<Page />);
    const row = within(document.querySelector('[data-cost-row="cr|"]') as HTMLElement);
    expect(row.getByText('Over target')).toBeInTheDocument();             // (90 + 5) / 250 = 38 %
    expect(document.querySelector('[data-cost-row="bn|"]')?.textContent).toContain('No recipe');
    expect(document.querySelector('[data-cost-avg]')?.textContent).toBe('Average food cost 38%');
    fireEvent.click(document.querySelector('[data-cost-row="cr|"]')!);
    expect(document.querySelector('[data-cost-production]')?.textContent).toContain('95');
    expect(document.querySelector('[data-cost-fc]')?.textContent).toBe('38%');
    expect(document.querySelector('[data-cost-suggest]')?.textContent).toContain('320');          // 95 / 0.30 = 316.7 → 320
    fireEvent.change(document.querySelector('[data-cost-whatif]')!, { target: { value: '320' } });
    expect(document.querySelector('[data-cost-fc]')?.textContent).toBe('29.7%');
    expect(document.querySelector('[data-cost-line="bt"]')).not.toBeNull();
  });
  it('an item without a recipe says so in the panel instead of showing a made-up cost', async () => {
    const { default: Page } = await import('@/pages/RecipeCostingPage');
    render(<Page />);
    fireEvent.click(document.querySelector('[data-cost-row="bn|"]')!);
    expect(document.querySelector('[data-cost-norecipe]')).not.toBeNull();
  });
  it('the status chips filter the list', async () => {
    const { default: Page } = await import('@/pages/RecipeCostingPage');
    render(<Page />);
    fireEvent.click(document.querySelector('[data-cost-show="none"]')!);
    expect(document.querySelector('[data-cost-row="cr|"]')).toBeNull();
    expect(document.querySelector('[data-cost-row="bn|"]')).not.toBeNull();
  });
});

describe('where it lives', () => {
  it('a page of the Inventory group for admins and managers, routed and named in every language', () => {
    expect(PAGES.find(p => p.key === 'recipe-costing')).toMatchObject({ path: '/recipe-costing', group: 'Inventory', defaultRoles: ['admin', 'manager'] });
    expect(read('src/App.tsx')).toContain('<Route path="/recipe-costing" element={<RecipeCostingPage />} />');
    expect(read('src/lib/i18nNav.ts').match(/"nav\.recipe-costing"/g)).toHaveLength(3);
  });
  it('the recipe screen takes a waste % per ingredient and a packaging cost, and costs through the same engine', () => {
    const src = read('src/pages/RecipesPage.tsx');
    expect(src).toContain('data-recipe-waste');
    expect(src).toContain('data-recipe-packaging');
    expect(src).toContain("costItem({ item: m, variantKey: t.key, price: t.sale, recipes, inventory }).productionCost");
  });
  it('is built from the shared page frame', () => {
    const src = read('src/pages/RecipeCostingPage.tsx');
    for (const k of ['<PageHeader', '<FilterBar', '<EmptyState', '<MasterDetail', "from '@/components/ui/table'", 'space-y-4 p-4 lg:p-6']) expect(src, k).toContain(k);
    expect(src).not.toContain('<table');
  });
});
