// v1.117.0 — prep recipes and production batches: dough → rolls. The raw material leaves stock, the made item enters it at its real cost,
// and a menu recipe that uses the made item is costed from that cost. The sale path is untouched.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { InventoryItem, MenuItem, Recipe } from '@/lib/types';
import { batchMovementId, batchesForQty, movingAverage, planBatch, postBatch, prepCostPerUnit, prepIssues, recentBatches, type PrepRecipe, type PostDeps } from '@/lib/prep';
import { costItem } from '@/lib/recipeCosting';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

const inv = (id: string, name: string, baseUnit: string, quantity: number, avg: number, extra: Partial<InventoryItem> = {}) =>
  ({ id, name, sku: id, categoryId: 'c', unit: baseUnit, baseUnit, quantity, costPrice: avg, avgCostPrice: avg, salePrice: 0, lowStockThreshold: 0, isActive: true, ...extra }) as unknown as InventoryItem;
const stock = () => [inv('fl', 'Flour', 'kg', 20, 120), inv('wt', 'Water', 'l', 100, 1), inv('ye', 'Yeast', 'kg', 1, 800), inv('dg', 'Dough', 'kg', 0, 0)];
// 1 kg of dough = 600 g flour + 360 ml water + 20 g yeast
const dough: PrepRecipe = { id: 'dg', outputItemId: 'dg', yieldQty: 1, yieldUnit: 'kg', updatedAt: '', shelfLifeDays: 2, components: [{ inventoryItemId: 'fl', quantity: 600, unit: 'g' }, { inventoryItemId: 'wt', quantity: 360, unit: 'ml' }, { inventoryItemId: 'ye', quantity: 20, unit: 'g' }] };

describe('planning a batch', () => {
  // flour 0.6 kg × 120 = 72 ; water 0.36 l × 1 = 0.36 ; yeast 0.02 kg × 800 = 16  →  88.36 per kg of dough
  it('works out what is used, what comes out and what it costs — in each item’s own base unit', () => {
    const p = planBatch(dough, 2, stock());
    expect(p.outputBaseQty).toBe(2);
    expect(p.outputUnit).toBe('kg');
    expect(Object.fromEntries(p.lines.map(l => [l.itemId, l.baseQty]))).toEqual({ fl: 1.2, wt: 0.72, ye: 0.04 });
    expect(p.totalCost).toBeCloseTo(176.72, 2);
    expect(p.unitCost).toBeCloseTo(88.36, 4);
    expect(p.shortCount).toBe(0);
  });
  it('a fraction of a batch scales every line; "I need 500 g" is half a batch, "5 kg" is five', () => {
    const made = stock()[3];
    expect(batchesForQty(dough, made, 500, 'g')).toBeCloseTo(0.5, 6);
    expect(batchesForQty(dough, made, 5, 'kg')).toBeCloseTo(5, 6);
    expect(planBatch(dough, 0.5, stock()).lines.find(l => l.itemId === 'fl')!.baseQty).toBe(0.3);
    expect(batchesForQty(dough, undefined, 5, 'kg')).toBe(0);
  });
  it('says which raw material is short, and by how much', () => {
    const p = planBatch(dough, 40, stock());       // 24 kg of flour wanted, 20 in stock
    const fl = p.lines.find(l => l.itemId === 'fl')!;
    expect(fl.short).toBe(4);
    expect(p.shortCount).toBe(1);
  });
  it('cost per unit before any batch, in the unit asked for (per kg or per 100 g)', () => {
    expect(prepCostPerUnit(dough, stock())).toBeCloseTo(88.36, 4);
    expect(prepCostPerUnit(dough, stock(), 'g')).toBeCloseTo(0.08836, 6);
  });
  it('an ingredient without a cost is named, not silently free', () => {
    const s = stock(); s[1] = inv('wt', 'Water', 'l', 100, 0);
    expect(planBatch(dough, 1, s).warnings).toContain('Water has no cost yet');
  });
});

describe('what a prep recipe may not be', () => {
  const s = stock();
  it('a good one has no issues', () => expect(prepIssues(dough, s, [dough])).toEqual([]));
  it('needs an item, a yield, ingredients, quantities and compatible units', () => {
    expect(prepIssues({ ...dough, outputItemId: '' }, s)).toContain('Choose the stock item this makes');
    expect(prepIssues({ ...dough, yieldQty: 0 }, s)).toContain('Say how much one batch makes');
    expect(prepIssues({ ...dough, components: [] }, s)).toContain('Add at least one ingredient');
    expect(prepIssues({ ...dough, components: [{ inventoryItemId: 'fl', quantity: 0, unit: 'g' }] }, s)).toContain('Give a quantity for Flour');
    expect(prepIssues({ ...dough, components: [{ inventoryItemId: 'fl', quantity: 5, unit: 'ml' }] }, s)).toContain('ml does not fit Flour — use kg');
    expect(prepIssues({ ...dough, yieldUnit: 'l' }, s)[0]).toContain('does not fit Dough');
  });
  it('an item cannot be made from itself, nor in a circle through another prep recipe', () => {
    expect(prepIssues({ ...dough, components: [{ inventoryItemId: 'dg', quantity: 1, unit: 'kg' }] }, s)).toContain('An item cannot be made from itself');
    const sponge: PrepRecipe = { id: 'sp', outputItemId: 'sp', yieldQty: 1, yieldUnit: 'kg', updatedAt: '', components: [{ inventoryItemId: 'dg', quantity: 100, unit: 'g' }] };
    const withSponge = [...s, inv('sp', 'Sponge', 'kg', 0, 0)];
    const loop = { ...dough, components: [...dough.components, { inventoryItemId: 'sp', quantity: 100, unit: 'g' }] };
    expect(prepIssues(loop, withSponge, [loop, sponge])).toContain('These recipes make each other in a circle');
    // sponge made from dough, dough made from flour: no loop
    expect(prepIssues(sponge, withSponge, [dough, sponge])).toEqual([]);
  });
});

describe('posting a batch', () => {
  const deps = () => {
    const consumed: [string, number, string][] = []; const produced: [string, number, number, string][] = [];
    const d: PostDeps = {
      consume: (id, q, _n, mid) => { consumed.push([id, q, mid]); return { applied: true, needsReview: id === 'ye' }; },
      produce: (id, q, c, _n, mid) => { produced.push([id, q, c, mid]); return { applied: true }; },
    };
    return { d, consumed, produced };
  };
  const input = { id: 'b1', date: '2026-11-18', branchId: 'A', now: new Date('2026-11-18T08:00:00'), by: 'Baker', shelfLifeDays: 2 };
  it('each raw material leaves once and the made item enters once, every movement carrying an id built from the batch', () => {
    const { d, consumed, produced } = deps();
    const rec = postBatch(planBatch(dough, 2, stock()), input, d)!;
    expect(consumed.map(c => c[2]).sort()).toEqual([batchMovementId('b1', 'fl'), batchMovementId('b1', 'wt'), batchMovementId('b1', 'ye')].sort());
    expect(produced).toEqual([['dg', 2, expect.closeTo(88.36, 4), 'batch:b1:dg']]);
    expect(rec.totalCost).toBeCloseTo(176.72, 2);
    expect(rec.unitCost).toBeCloseTo(88.36, 3);
    expect(rec.expiryDate).toBe('2026-11-20');                       // shelf life 2 days
    expect(rec.shortOf).toEqual(['Yeast']);                          // the ledger flagged yeast for review
    expect(rec.by).toBe('Baker');
  });
  it('a plan that makes nothing is not posted', () => {
    const { d, consumed, produced } = deps();
    expect(postBatch(planBatch(dough, 0, stock()), input, d)).toBeNull();
    expect(consumed.length + produced.length).toBe(0);
  });
  it('moving average, like a purchase: 4 kg at 100 plus 2 kg at 130 = 110', () => {
    expect(movingAverage(4, 100, 2, 130)).toBeCloseTo(110, 6);
    expect(movingAverage(0, 0, 3, 50)).toBe(50);
  });
  it('history is newest first and can be limited to one item', () => {
    const mk = (id: string, at: string, item: string) => ({ id, createdAt: at, outputItemId: item } as never);
    expect(recentBatches([mk('a', '2026-11-01', 'x'), mk('b', '2026-11-03', 'y'), mk('c', '2026-11-02', 'x')]).map(b => b.id)).toEqual(['b', 'c', 'a']);
    expect(recentBatches([mk('a', '2026-11-01', 'x'), mk('b', '2026-11-03', 'y')], { itemId: 'x' }).map(b => b.id)).toEqual(['a']);
  });
});

// ---------------------------------------------------------------- through the real store
const STORE_KEY = 'desi-pos-data';
const seed = (extra: Record<string, unknown> = {}) => {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    settings: { name: 'Butt Bakers', currencySymbol: 'Rs ', costTrackingEnabled: true },
    users: [{ id: 'u-admin', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    branches: [], inventory: stock(), stockLogs: [], prepRecipes: [dough], productionBatches: [], recipes: [], menuItems: [], categories: [], orders: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], transactions: [], orderCounter: 1,
    ...extra,
  }));
  localStorage.setItem('pos-user-id', 'u-admin'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-tenant-plan', 'enterprise');
  window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
};

describe('through the real store', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); seed(); });

  it('a batch moves the stock, sets the made item’s cost, and a replay moves nothing', async () => {
    const s = await import('@/lib/store');
    const plan = planBatch(s.getPrepRecipes()[0], 3, s.getInventory());
    const deps: PostDeps = {
      consume: (id, q, n, mid, ref) => s.adjustStock(id, q, 'out', n, { movementId: mid, refType: 'production', refId: ref }),
      produce: (id, q, c, n, mid, ref) => s.receiveProducedStock(id, q, c, n, mid, ref),
    };
    const rec = postBatch(plan, { id: 'bx', date: '2026-11-18', now: new Date(), shelfLifeDays: 2 }, deps)!;
    const get = (id: string) => s.getInventory().find(i => i.id === id)!;
    expect(get('fl').quantity).toBeCloseTo(18.2, 6);                 // 20 − 1.8
    expect(get('ye').quantity).toBeCloseTo(0.94, 6);                 // 1 − 0.06
    expect(get('dg').quantity).toBeCloseTo(3, 6);
    expect(get('dg').avgCostPrice).toBeCloseTo(88.36, 4);
    expect(get('dg').costPrice).toBeCloseTo(88.36, 4);
    s.saveProductionBatch(rec);
    expect(s.getProductionBatches()).toHaveLength(1);

    postBatch(plan, { id: 'bx', date: '2026-11-18', now: new Date() }, deps);   // the same batch again (a double tap)
    expect(get('fl').quantity).toBeCloseTo(18.2, 6);
    expect(get('dg').quantity).toBeCloseTo(3, 6);
  });

  it('a second batch at a different cost averages in; a roll made from the dough is then costed from it', async () => {
    const s = await import('@/lib/store');
    const deps: PostDeps = {
      consume: (id, q, n, mid, ref) => s.adjustStock(id, q, 'out', n, { movementId: mid, refType: 'production', refId: ref }),
      produce: (id, q, c, n, mid, ref) => s.receiveProducedStock(id, q, c, n, mid, ref),
    };
    postBatch(planBatch(dough, 2, s.getInventory()), { id: 'b1', date: 'd', now: new Date() }, deps);       // 2 kg at 88.36
    const flour = s.getInventory().find(i => i.id === 'fl')!; flour.avgCostPrice = 150; s.saveInventoryItem(flour);   // flour gets dearer
    postBatch(planBatch(dough, 2, s.getInventory()), { id: 'b2', date: 'd', now: new Date() }, deps);       // 2 kg at 106.36
    const dg = s.getInventory().find(i => i.id === 'dg')!;
    expect(dg.quantity).toBeCloseTo(4, 6);
    expect(dg.avgCostPrice).toBeCloseTo((88.36 + 106.36) / 2, 3);
    // a roll = 80 g of dough, price 40
    const roll = { id: 'rl', name: 'Roll', price: 40, pricingType: 'fixed', isActive: true } as unknown as MenuItem;
    const rec: Recipe = { id: 'rl', menuItemId: 'rl', components: [{ inventoryItemId: 'dg', quantity: 80, unit: 'g' }] };
    const c = costItem({ item: roll, price: 40, recipes: [rec], inventory: s.getInventory() });
    expect(c.productionCost).toBeCloseTo(0.08 * 97.36, 2);            // 7.79
    expect(c.hasRecipe).toBe(true);
  });
});

describe('a finished item made in batches is costed from its stock', () => {
  it('no recipe, but the menu item is the stock item: its cost is that stock’s cost × units per sale', () => {
    const items = [...stock().slice(0, 3), inv('cr', 'Croissant (ready)', 'pcs', 24, 18)];
    const m = { id: 'm1', name: 'Croissant', price: 60, pricingType: 'fixed', isActive: true, inventoryItemId: 'cr' } as unknown as MenuItem;
    const c = costItem({ item: m, price: 60, recipes: [], inventory: items });
    expect(c.hasRecipe).toBe(true);
    expect(c.fromStock).toBe(true);
    expect(c.productionCost).toBe(18);
    expect(c.foodCostPct).toBe(30);
    const two = costItem({ item: { ...m, stockPerUnit: 2 } as MenuItem, price: 60, recipes: [], inventory: items });
    expect(two.productionCost).toBe(36);
  });
  it('a recipe still wins; a stock item with no cost yet, or a weighed item, is left as "no recipe"', () => {
    const items = [inv('cr', 'Croissant (ready)', 'pcs', 24, 0), inv('fl', 'Flour', 'kg', 5, 120)];
    const m = { id: 'm1', name: 'Croissant', price: 60, pricingType: 'fixed', isActive: true, inventoryItemId: 'cr' } as unknown as MenuItem;
    expect(costItem({ item: m, price: 60, recipes: [], inventory: items }).hasRecipe).toBe(false);
    const rec: Recipe = { id: 'm1', menuItemId: 'm1', components: [{ inventoryItemId: 'fl', quantity: 100, unit: 'g' }] };
    const withRecipe = costItem({ item: m, price: 60, recipes: [rec], inventory: [inv('cr', 'Croissant (ready)', 'pcs', 24, 18), items[1]] });
    expect(withRecipe.fromStock).toBeUndefined();
    expect(withRecipe.productionCost).toBeCloseTo(12, 6);
    expect(costItem({ item: { ...m, pricingType: 'weight' } as MenuItem, price: 60, recipes: [], inventory: [inv('cr', 'x', 'pcs', 1, 18)] }).hasRecipe).toBe(false);
  });
});

describe('the Prep & batches tab', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); seed(); });
  it('lists the prep recipe with its cost; Make a batch shows the plan, flags a shortage, and posting moves the stock', async () => {
    const { default: Panel } = await import('@/components/production/PrepPanel');
    const s = await import('@/lib/store');
    render(<Panel />);
    const row = document.querySelector('[data-prep-row="dg"]') as HTMLElement;
    expect(row.textContent).toContain('Dough');
    expect(row.textContent).toContain('88.36');
    fireEvent.click(document.querySelector('[data-prep-make="dg"]')!);
    fireEvent.change(document.querySelector('[data-prep-qty]')!, { target: { value: '5' } });
    expect(document.querySelector('[data-plan-line="fl"]')!.textContent).toContain('3');          // 3 kg of flour
    expect(document.querySelector('[data-prep-result]')!.textContent).toContain('5 kg');
    // yeast: 5 × 20 g = 0.1 kg of 1 kg — enough; ask for 80 kg → flour short
    fireEvent.change(document.querySelector('[data-prep-qty]')!, { target: { value: '80' } });
    expect(document.querySelector('[data-plan-short]')).not.toBeNull();
    expect(document.querySelector('[data-prep-short-note]')).not.toBeNull();
    fireEvent.change(document.querySelector('[data-prep-qty]')!, { target: { value: '5' } });
    fireEvent.click(document.querySelector('[data-prep-post]')!);
    const get = (id: string) => s.getInventory().find(i => i.id === id)!;
    expect(get('dg').quantity).toBeCloseTo(5, 6);
    expect(get('fl').quantity).toBeCloseTo(17, 6);
    expect(s.getProductionBatches()).toHaveLength(1);
    expect(document.querySelector('[data-batch-row]')).not.toBeNull();                              // the history shows it
  });
  it('is a tab of Production, and editing needs the right to edit production', () => {
    expect(read('src/pages/ProductionPlanPage.tsx')).toMatch(/data-tab-prep/);
    expect(read('src/pages/ProductionPlanPage.tsx')).toContain('<PrepPanel />');
    expect(read('src/components/production/PrepPanel.tsx')).toContain("userHasFeature(me, 'feat.prod.edit')");
  });
  it('the collections are synced documents', () => {
    expect(read('src/lib/supabaseStore.ts')).toContain("'prepRecipes', 'productionBatches'");
    expect(read('src/lib/store.ts')).toContain("scheduleReload('prepRecipes')");
  });
});
