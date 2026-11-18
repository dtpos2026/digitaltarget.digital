// ============================================================================
// Prep recipes and production batches (v1.117.0) — dough → rolls, sauce → pizza, stock → soup; and finished goods made ahead.
//
// A bakery or a central kitchen makes things from raw material BEFORE it sells them. Two ideas, kept apart from the menu:
//   • a PREP RECIPE says how an item that is itself kept in stock is made: "1 kg of dough = 600 g flour + 360 ml water + 20 g yeast".
//     The made item (dough, a sauce, a filling, even a finished croissant) is an ordinary stock item;
//   • a BATCH is the act of making it: the raw materials leave stock, the made item enters stock, at what it really cost.
// A menu recipe then uses the made item as a plain ingredient ("a roll = 80 g dough"), so selling a roll takes dough out of stock — the
// sale path is untouched. The cost of the dough is whatever the batches really cost (moving average, like a purchase).
//
// Pure functions: the stock movements are done by the functions the caller passes in, so every rule here is testable without a store.
// Waste is not a field of a prep recipe: the yield is what really comes out of the bowl, so trim and bake loss are already in it.
// ============================================================================
import type { InventoryItem, RecipeComponent } from '@/lib/types';
import { getBaseUnit, isCompatible, toBaseQty } from '@/lib/units';

export interface PrepRecipe {
  /** one prep recipe per made item: the id of the stock item it makes */
  id: string;
  outputItemId: string;
  /** how much one batch makes, in `yieldUnit` */
  yieldQty: number;
  yieldUnit: string;
  components: RecipeComponent[];
  /** days the made item keeps (shown on the batch; the lots release adds the expiry date from it) */
  shelfLifeDays?: number;
  notes?: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface BatchLine { itemId: string; name: string; baseQty: number; unit: string; available: number; short: number; unitCost: number; cost: number }

export interface BatchPlan {
  prepId: string;
  outputItemId: string;
  outputName: string;
  /** how many times the recipe is made (0.5 = half a batch) */
  batches: number;
  /** what comes out, in the made item's base unit */
  outputBaseQty: number;
  outputUnit: string;
  lines: BatchLine[];
  totalCost: number;
  /** cost per base unit of the made item */
  unitCost: number;
  /** lines whose raw material is not all in stock */
  shortCount: number;
  warnings: string[];
}

export interface ProductionBatch {
  id: string;
  /** YYYY-MM-DD, the restaurant's local day */
  date: string;
  branchId?: string;
  prepId: string;
  outputItemId: string;
  outputName: string;
  batches: number;
  outputBaseQty: number;
  outputUnit: string;
  lines: { itemId: string; name: string; baseQty: number; unit: string; cost: number }[];
  totalCost: number;
  unitCost: number;
  /** raw materials that were short when it was posted (stock is flagged for review) */
  shortOf?: string[];
  expiryDate?: string;
  note?: string;
  by?: string;
  createdAt: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const costOf = (i: Pick<InventoryItem, 'avgCostPrice' | 'costPrice'>): number => num(i.avgCostPrice ?? i.costPrice);

/** Why a prep recipe cannot be used yet (empty = fine). `all` is every prep recipe, to catch a loop (dough needs sponge needs dough). */
export function prepIssues(prep: Pick<PrepRecipe, 'outputItemId' | 'yieldQty' | 'yieldUnit' | 'components'>, inventory: InventoryItem[], all: PrepRecipe[] = []): string[] {
  const out: string[] = [];
  const byId = new Map(inventory.map(i => [i.id, i]));
  const made = byId.get(prep.outputItemId);
  if (!made) out.push('Choose the stock item this makes');
  if (!(num(prep.yieldQty) > 0)) out.push('Say how much one batch makes');
  else if (made && !isCompatible(made, prep.yieldUnit)) out.push(`${prep.yieldUnit} does not fit ${made.name} — use ${getBaseUnit(made)}`);
  const comps = prep.components.filter(c => c.inventoryItemId);
  if (comps.length === 0) out.push('Add at least one ingredient');
  for (const c of comps) {
    if (c.inventoryItemId === prep.outputItemId) { out.push('An item cannot be made from itself'); continue; }
    const ing = byId.get(c.inventoryItemId);
    if (!ing) { out.push('An ingredient is no longer in the stock list'); continue; }
    if (!(num(c.quantity) > 0)) out.push(`Give a quantity for ${ing.name}`);
    else if (!isCompatible(ing, c.unit)) out.push(`${c.unit} does not fit ${ing.name} — use ${getBaseUnit(ing)}`);
  }
  // a loop through other prep recipes: walk what the ingredients are themselves made of
  const preps = new Map(all.filter(p => p.id !== prep.outputItemId).map(p => [p.outputItemId, p]));
  const seen = new Set<string>();
  const loops = (id: string): boolean => {
    if (id === prep.outputItemId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (preps.get(id)?.components ?? []).some(c => loops(c.inventoryItemId));
  };
  if (comps.some(c => c.inventoryItemId !== prep.outputItemId && loops(c.inventoryItemId))) out.push('These recipes make each other in a circle');
  return [...new Set(out)];
}

/** What a batch of this recipe uses, makes and costs — nothing is posted. `batches` may be a fraction. */
export function planBatch(prep: PrepRecipe, batches: number, inventory: InventoryItem[]): BatchPlan {
  const byId = new Map(inventory.map(i => [i.id, i]));
  const made = byId.get(prep.outputItemId);
  const b = num(batches) > 0 ? num(batches) : 0;
  const warnings: string[] = [];
  const lines: BatchLine[] = [];
  for (const c of prep.components) {
    const ing = byId.get(c.inventoryItemId);
    if (!ing) { warnings.push('An ingredient is no longer in the stock list'); continue; }
    const baseQty = toBaseQty(ing, num(c.quantity), c.unit) * b;
    if (baseQty <= 0) continue;
    const available = Math.max(0, num(ing.quantity));
    const unitCost = costOf(ing);
    if (unitCost <= 0) warnings.push(`${ing.name} has no cost yet`);
    lines.push({ itemId: ing.id, name: ing.name, baseQty: r4(baseQty), unit: getBaseUnit(ing), available, short: baseQty > available + 1e-9 ? r4(baseQty - available) : 0, unitCost, cost: baseQty * unitCost });
  }
  const outputBaseQty = made ? toBaseQty(made, num(prep.yieldQty), prep.yieldUnit) * b : 0;
  const totalCost = lines.reduce((s, l) => s + l.cost, 0);
  return {
    prepId: prep.id, outputItemId: prep.outputItemId, outputName: made?.name ?? '', batches: b, outputBaseQty: r4(outputBaseQty), outputUnit: made ? getBaseUnit(made) : '',
    lines: lines.map(l => ({ ...l, cost: r2(l.cost) })), totalCost: r2(totalCost), unitCost: outputBaseQty > 0 ? totalCost / outputBaseQty : 0,
    shortCount: lines.filter(l => l.short > 0).length, warnings: [...new Set(warnings)],
  };
}

/** The cost of ONE unit (in `unit`) of what a prep recipe makes, from today's ingredient costs — before any batch has been made. */
export function prepCostPerUnit(prep: PrepRecipe, inventory: InventoryItem[], unit = prep.yieldUnit): number {
  const p = planBatch(prep, 1, inventory);
  const made = inventory.find(i => i.id === prep.outputItemId);
  if (!made || p.outputBaseQty <= 0) return 0;
  return (p.totalCost / p.outputBaseQty) * toBaseQty(made, 1, unit);
}

/** How many batches make `qty` of `unit` (what the baker types: "I need 5 kg"). */
export function batchesForQty(prep: Pick<PrepRecipe, 'outputItemId' | 'yieldQty' | 'yieldUnit'>, made: InventoryItem | undefined, qty: number, unit: string): number {
  if (!made) return 0;
  const one = toBaseQty(made, num(prep.yieldQty), prep.yieldUnit);
  return one > 0 && num(qty) > 0 ? toBaseQty(made, num(qty), unit) / one : 0;
}

export const batchMovementId = (batchId: string, itemId: string): string => `batch:${batchId}:${itemId}`;

export interface PostDeps {
  /** takes raw material out of stock (a ledger movement with the given id; false/undefined result = it was already posted) */
  consume: (itemId: string, baseQty: number, note: string, movementId: string, batchId: string) => { applied: boolean; needsReview?: boolean } | void;
  /** puts the made item into stock at its cost per base unit (moving average) */
  produce: (itemId: string, baseQty: number, unitCost: number, note: string, movementId: string, batchId: string) => { applied: boolean } | void;
}

export interface PostInput { id: string; date: string; branchId?: string; note?: string; by?: string; now: Date; shelfLifeDays?: number }

/**
 * Posts a planned batch: each raw material leaves stock, the made item enters it. Every movement carries an id built from the batch, so
 * posting the same batch twice (a double tap, a retry) moves stock once. Returns the batch record to save, or null when nothing would be made.
 */
export function postBatch(plan: BatchPlan, input: PostInput, deps: PostDeps): ProductionBatch | null {
  if (plan.batches <= 0 || plan.outputBaseQty <= 0 || plan.lines.length === 0) return null;
  const shortOf: string[] = [];
  const note = `Batch • ${plan.outputName}`;
  for (const l of plan.lines) {
    const res = deps.consume(l.itemId, l.baseQty, `${note} • used`, batchMovementId(input.id, l.itemId), input.id);
    if (res && res.needsReview) shortOf.push(l.name);
  }
  deps.produce(plan.outputItemId, plan.outputBaseQty, plan.unitCost, `${note} • made`, batchMovementId(input.id, plan.outputItemId), input.id);
  let expiryDate: string | undefined;
  if (num(input.shelfLifeDays) > 0) { const d = new Date(input.now); d.setDate(d.getDate() + Math.floor(num(input.shelfLifeDays))); expiryDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  return {
    id: input.id, date: input.date, branchId: input.branchId, prepId: plan.prepId, outputItemId: plan.outputItemId, outputName: plan.outputName,
    batches: plan.batches, outputBaseQty: plan.outputBaseQty, outputUnit: plan.outputUnit,
    lines: plan.lines.map(l => ({ itemId: l.itemId, name: l.name, baseQty: l.baseQty, unit: l.unit, cost: l.cost })),
    totalCost: plan.totalCost, unitCost: r4(plan.unitCost), shortOf: shortOf.length ? shortOf : undefined, expiryDate,
    note: input.note?.trim() || undefined, by: input.by, createdAt: input.now.toISOString(),
  };
}

/** The moving-average cost after `addQty` more units arrive at `addCost` each (a purchase, or a batch). */
export function movingAverage(oldQty: number, oldAvg: number, addQty: number, addCost: number): number {
  const q = Math.max(0, num(oldQty)) + Math.max(0, num(addQty));
  return q > 0 ? (Math.max(0, num(oldQty)) * num(oldAvg) + Math.max(0, num(addQty)) * num(addCost)) / q : num(addCost);
}

/** Newest first; optionally one made item, one branch. */
export function recentBatches(all: ProductionBatch[], opts: { itemId?: string; branchId?: string; limit?: number } = {}): ProductionBatch[] {
  return all
    .filter(b => (!opts.itemId || b.outputItemId === opts.itemId) && (!opts.branchId || b.branchId === opts.branchId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, opts.limit ?? 20);
}
