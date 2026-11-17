// ============================================================================
// Recipe costing (v1.116.0) — from a recipe to the production price, the gross profit and the menu's place on the matrix.
//
// The chain every food business (restaurant, café, bakery) uses, bottom up:
//   ingredient cost  = quantity ÷ (1 − waste %) × the ingredient's cost per base unit     (waste % = trim, peel, spill, bake loss)
//   production cost  = Σ ingredient cost + packaging (box, cup, label — the recipe's "packaging" figure)
//   gross profit     = selling price − production cost                          margin % = gross profit ÷ price
//   food cost %      = production cost ÷ selling price                           compared with the restaurant's target (30 % by default)
//   suggested price  = production cost ÷ target food cost %, rounded up to the nearest 5 (never below the cost)
// Costs are at the ingredient's moving-average cost (else its cost price). For one branch, an ingredient that belongs to another
// branch is looked up at that branch by SKU, then by name, so each branch is costed with its own purchase prices.
//
// The waste % and packaging are COSTING allowances: stock still moves by the recipe quantity on each sale, and any extra that was
// really used shows up as a variance when the shelves are counted (Stock Count) — theoretical against actual food cost.
// Menu engineering (Kasavana & Smith): items are split by popularity (share of units sold ≥ 70 % of an equal share) and by
// contribution margin (per unit, against the sales-weighted average) into Star, Plowhorse, Puzzle and Dog.
// Pure functions; the page passes the store's data in.
// ============================================================================
import type { InventoryItem, MenuItem, Order, Recipe } from '@/lib/types';
import { toBaseQty } from '@/lib/units';

export const DEFAULT_TARGET_FOOD_COST_PCT = 30;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Waste % as a share below 95 (a 100 % waste would divide by zero); bad values are no allowance. */
export function wasteShare(pct: unknown): number {
  const n = Number(pct);
  return Number.isFinite(n) && n > 0 ? Math.min(95, n) / 100 : 0;
}

export const costPerBase = (i: Pick<InventoryItem, 'avgCostPrice' | 'costPrice'>): number => Number(i.avgCostPrice ?? i.costPrice ?? 0) || 0;

/**
 * The ingredient to cost with in `branchId`: the recipe's own row when it belongs to that branch (or to none); else the same SKU or
 * the same name in that branch; else the recipe's own row (so a missing mapping never hides a cost).
 */
export function ingredientFor(item: InventoryItem, inventory: InventoryItem[], branchId?: string): InventoryItem {
  if (!branchId || !item.branchId || item.branchId === branchId) return item;
  const there = inventory.filter(i => i.branchId === branchId && i.isActive !== false);
  return (item.sku && there.find(i => i.sku && norm(i.sku) === norm(item.sku))) || there.find(i => norm(i.name) === norm(item.name)) || item;
}

export interface CostLine {
  inventoryItemId: string; name: string; qty: number; unit: string; wastePct: number;
  /** quantity with the waste allowance, in the recipe's unit */
  effectiveQty: number;
  /** per base unit of the ingredient */
  unitCost: number;
  cost: number;
  /** share of the ingredient cost, in percent */
  sharePct: number;
  /** the ingredient has no cost yet (never received, no cost price) */
  noCost: boolean;
}

export interface ItemCost {
  menuItemId: string; name: string; categoryId?: string;
  /** '' for the item itself, "size:Large" / "inch:12 Inch" for a variant */
  variantKey: string; variantLabel: string;
  price: number;
  /** price is per kg (weighed item) */
  perKg: boolean;
  hasRecipe: boolean;
  /** the variant has no recipe of its own and uses the item's default one */
  usesDefault: boolean;
  lines: CostLine[];
  ingredientCost: number; packagingCost: number; productionCost: number;
  grossProfit: number; marginPct: number | null; foodCostPct: number | null;
  /** ingredients missing from the stock list or without a cost: the cost is understated by these */
  warnings: string[];
}

export interface CostInput {
  item: MenuItem;
  variantKey?: string;
  variantLabel?: string;
  price: number;
  recipes: Recipe[];
  inventory: InventoryItem[];
  branchId?: string;
}

/** The recipe used for an item (and variant): the variant's own, else the item's default. */
export function recipeFor(recipes: Recipe[], menuItemId: string, variantKey = ''): { recipe?: Recipe; usesDefault: boolean } {
  const own = variantKey ? recipes.find(r => r.menuItemId === menuItemId && (r.variantKey || '') === variantKey) : undefined;
  if (own) return { recipe: own, usesDefault: false };
  const def = recipes.find(r => r.menuItemId === menuItemId && !(r.variantKey || ''));
  return { recipe: def, usesDefault: !!def && !!variantKey };
}

/** The ingredient lines and totals of one recipe — the arithmetic every cost on every screen goes through. */
export function costRecipe(recipe: Recipe | undefined, inventory: InventoryItem[], branchId?: string): { lines: CostLine[]; ingredientCost: number; packagingCost: number; productionCost: number; warnings: string[] } {
  const byId = new Map(inventory.map(x => [x.id, x]));
  const warnings: string[] = [];
  const raw: Omit<CostLine, 'sharePct'>[] = [];
  for (const c of recipe?.components ?? []) {
    const base = byId.get(c.inventoryItemId);
    if (!base) { warnings.push('An ingredient is no longer in the stock list'); continue; }
    const ing = ingredientFor(base, inventory, branchId);
    const w = wasteShare(c.wastePct);
    const effectiveQty = c.quantity / (1 - w);
    const unitCost = costPerBase(ing);
    const cost = toBaseQty(ing, effectiveQty, c.unit) * unitCost;
    if (unitCost <= 0) warnings.push(`${ing.name} has no cost yet`);
    raw.push({ inventoryItemId: ing.id, name: ing.name, qty: c.quantity, unit: c.unit, wastePct: Math.round(w * 1000) / 10, effectiveQty: Math.round(effectiveQty * 1000) / 1000, unitCost, cost, noCost: unitCost <= 0 });
  }
  const ingredientCost = raw.reduce((s, l) => s + l.cost, 0);
  const lines: CostLine[] = raw.map(l => ({ ...l, cost: r2(l.cost), sharePct: ingredientCost > 0 ? r1((l.cost / ingredientCost) * 100) : 0 }));
  const packagingCost = Math.max(0, Number(recipe?.packagingCost) || 0);
  return { lines, ingredientCost, packagingCost, productionCost: ingredientCost + packagingCost, warnings: [...new Set(warnings)] };
}

/**
 * The production cost of ONE unit (one portion; one kg for a weighed item) of a recipe: ingredients with their waste allowance, plus
 * packaging — unrounded, so a bill's cost adds up exactly. Reports, the profit and loss and the profit page all use this one number.
 */
export function recipeCostPerUnit(recipe: Recipe | undefined, inventory: InventoryItem[] | Map<string, InventoryItem>, branchId?: string): number {
  if (!recipe) return 0;
  return costRecipe(recipe, Array.isArray(inventory) ? inventory : [...inventory.values()], branchId).productionCost;
}

export function costItem(i: CostInput): ItemCost {
  const variantKey = i.variantKey || '';
  const { recipe, usesDefault } = recipeFor(i.recipes, i.item.id, variantKey);
  const c = costRecipe(recipe, i.inventory, i.branchId);
  const hasRecipe = !!recipe && (recipe.components?.length ?? 0) > 0;
  const price = Number(i.price) || 0;
  return {
    menuItemId: i.item.id, name: i.item.name, categoryId: i.item.categoryId, variantKey, variantLabel: i.variantLabel || '',
    price, perKg: i.item.pricingType === 'weight', hasRecipe, usesDefault, lines: c.lines,
    ingredientCost: r2(c.ingredientCost), packagingCost: r2(c.packagingCost), productionCost: r2(c.productionCost),
    grossProfit: r2(price - c.productionCost),
    marginPct: price > 0 ? r1(((price - c.productionCost) / price) * 100) : null,
    foodCostPct: price > 0 && hasRecipe ? r1((c.productionCost / price) * 100) : null,
    warnings: c.warnings,
  };
}

/** Every priced row of the menu: one per variant when an item has sizes / inches, else one for the item. */
export function costMenu(menu: MenuItem[], recipes: Recipe[], inventory: InventoryItem[], branchId?: string): ItemCost[] {
  const out: ItemCost[] = [];
  for (const m of menu) {
    if (m.isActive === false || (m as { deleted?: boolean }).deleted) continue;
    const variants = [
      ...(m.sizeVariants || []).filter(v => v?.name).map(v => ({ key: `size:${v.name}`, label: v.name, price: Number(v.price) || 0 })),
      ...(m.inchVariants || []).filter(v => v?.name).map(v => ({ key: `inch:${v.name}`, label: `${v.name}`, price: Number(v.price) || 0 })),
    ];
    if (variants.length) for (const v of variants) out.push(costItem({ item: m, variantKey: v.key, variantLabel: v.label, price: v.price, recipes, inventory, branchId }));
    else out.push(costItem({ item: m, price: m.pricingType === 'weight' ? Number(m.ratePerKg) || 0 : Number(m.price) || 0, recipes, inventory, branchId }));
  }
  return out;
}

export type FoodCostStatus = 'healthy' | 'watch' | 'over' | 'none';
/** healthy: at or under the target; watch: up to 5 points over; over: more; none: no recipe or no price. */
export function foodCostStatus(c: Pick<ItemCost, 'foodCostPct' | 'hasRecipe'>, targetPct: number): FoodCostStatus {
  if (!c.hasRecipe || c.foodCostPct === null) return 'none';
  if (c.foodCostPct <= targetPct + 1e-9) return 'healthy';
  return c.foodCostPct <= targetPct + 5 ? 'watch' : 'over';
}

/** The price that reaches the target food cost %, rounded up to a multiple of `step` (and never below the cost itself). */
export function suggestedPrice(productionCost: number, targetPct: number, step = 5): number {
  if (!(productionCost > 0) || !(targetPct > 0)) return 0;
  const exact = productionCost / (targetPct / 100);
  const s = Math.max(1, step);
  return Math.max(Math.ceil(productionCost), Math.ceil(exact / s - 1e-9) * s);
}

export interface Summary { items: number; costed: number; avgFoodCostPct: number | null; healthy: number; watch: number; over: number; none: number }
export function summarize(rows: ItemCost[], targetPct: number): Summary {
  const s: Summary = { items: rows.length, costed: 0, avgFoodCostPct: null, healthy: 0, watch: 0, over: 0, none: 0 };
  let cost = 0, price = 0;
  for (const r of rows) {
    const st = foodCostStatus(r, targetPct);
    s[st]++;
    if (st !== 'none') { s.costed++; cost += r.productionCost; price += r.price; }
  }
  s.avgFoodCostPct = price > 0 ? r1((cost / price) * 100) : null;
  return s;
}

// ---------------------------------------------------------------- menu engineering

export type MenuClass = 'star' | 'plowhorse' | 'puzzle' | 'dog';
export const MENU_CLASS_ADVICE: Record<MenuClass, { label: string; advice: string }> = {
  star: { label: 'Star', advice: 'Popular and profitable. Keep it, protect its quality, feature it.' },
  plowhorse: { label: 'Plowhorse', advice: 'Popular but thin. Lift the price a little, trim the portion cost, or pair it with a high-margin side.' },
  puzzle: { label: 'Puzzle', advice: 'Profitable but slow. Give it a better place on the menu, a name, a photo, or a staff recommendation.' },
  dog: { label: 'Dog', advice: 'Neither popular nor profitable. Rework the recipe or price, or take it off.' },
};

export interface EngineeringRow { menuItemId: string; name: string; qty: number; revenue: number; cost: number; contribution: number; cmPerUnit: number; sharePct: number; cls: MenuClass }

const SOLD = new Set(['paid', 'running', 'partial', 'credit_received', 'credit_pending', 'complimentary']);

/**
 * Menu engineering over `orders` (already limited to the period and branch by the caller). Cost per unit is the line's own variant
 * cost where the item has one; items without a recipe are left out — a margin cannot be said without a cost.
 */
export function menuEngineering(orders: Order[], costs: ItemCost[]): { rows: EngineeringRow[]; avgCm: number; popularityBar: number } {
  const costBy = new Map(costs.map(c => [`${c.menuItemId}|${c.variantKey}`, c]));
  const acc = new Map<string, { name: string; qty: number; revenue: number; cost: number }>();
  for (const o of orders) {
    if (!SOLD.has(o.status)) continue;
    for (const l of o.items || []) {
      if (l.pricingType === 'weight') continue;
      const vk = l.variantType && l.variantName ? `${l.variantType}:${l.variantName}` : '';
      const c = costBy.get(`${l.menuItemId}|${vk}`) ?? costBy.get(`${l.menuItemId}|`);
      if (!c || !c.hasRecipe) continue;
      const qty = Number(l.quantity) || 0;
      if (qty <= 0) continue;
      const a = acc.get(l.menuItemId) ?? { name: c.name, qty: 0, revenue: 0, cost: 0 };
      a.qty += qty; a.revenue += Number(l.lineTotal) || 0; a.cost += c.productionCost * qty;
      acc.set(l.menuItemId, a);
    }
  }
  const list = [...acc.entries()].map(([id, a]) => ({ id, ...a, contribution: a.revenue - a.cost }));
  const totalQty = list.reduce((s, a) => s + a.qty, 0);
  const totalContribution = list.reduce((s, a) => s + a.contribution, 0);
  const avgCm = totalQty > 0 ? totalContribution / totalQty : 0;
  const popularityBar = list.length > 0 ? 0.7 * (1 / list.length) : 0;
  const rows: EngineeringRow[] = list.map(a => {
    const share = totalQty > 0 ? a.qty / totalQty : 0;
    const cmPerUnit = a.qty > 0 ? a.contribution / a.qty : 0;
    const popular = share >= popularityBar - 1e-12, profitable = cmPerUnit >= avgCm - 1e-9;
    return {
      menuItemId: a.id, name: a.name, qty: a.qty, revenue: r2(a.revenue), cost: r2(a.cost), contribution: r2(a.contribution),
      cmPerUnit: r2(cmPerUnit), sharePct: r1(share * 100), cls: (popular ? (profitable ? 'star' : 'plowhorse') : (profitable ? 'puzzle' : 'dog')) as MenuClass,
    };
  }).sort((x, y) => y.contribution - x.contribution);
  return { rows, avgCm: r2(avgCm), popularityBar: r1(popularityBar * 100) };
}
