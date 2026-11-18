// What the Inventory panel shows about one item (v1.120.0): its status, what it is worth, how long it will last at the current use,
// where it is used (menu recipes and prep recipes) and its latest movements. Pure functions over what the store already holds.
import type { InventoryItem, MenuItem, Recipe, StockLog } from '@/lib/types';
import type { PrepRecipe } from '@/lib/prep';
import { getBaseUnit } from '@/lib/units';

export type StockStatus = 'out' | 'low' | 'ok';
export const stockStatus = (i: Pick<InventoryItem, 'quantity' | 'lowStockThreshold'>): StockStatus => {
  const q = Number(i.quantity) || 0;
  return q === 0 ? 'out' : q <= (Number(i.lowStockThreshold) || 0) ? 'low' : 'ok';
};

export const costPerBase = (i: Pick<InventoryItem, 'avgCostPrice' | 'costPrice'>): number => Number(i.avgCostPrice ?? i.costPrice ?? 0) || 0;
export const stockValue = (i: Pick<InventoryItem, 'quantity' | 'avgCostPrice' | 'costPrice'>): number => Math.round((Number(i.quantity) || 0) * costPerBase(i) * 100) / 100;

/** Base units used per day over the last `days` days: what left stock by a sale or by a stock-out (a count, a receipt or a batch's output is not use). */
export function usagePerDay(logs: Pick<StockLog, 'inventoryItemId' | 'type' | 'quantity' | 'date'>[], itemId: string, now: Date, days = 14): number {
  const since = now.getTime() - days * 86_400_000;
  let used = 0;
  for (const l of logs) {
    if (l.inventoryItemId !== itemId || (l.type !== 'sale' && l.type !== 'out')) continue;
    const t = new Date(l.date).getTime();
    if (Number.isFinite(t) && t >= since && t <= now.getTime()) used += Math.max(0, Number(l.quantity) || 0);
  }
  return used / Math.max(1, days);
}

/** Days the stock lasts at `perDay`; null when it is not being used (so no promise is made). */
export const coverDays = (quantity: number, perDay: number): number | null => (perDay > 0 && quantity > 0 ? Math.round((quantity / perDay) * 10) / 10 : perDay > 0 ? 0 : null);

export interface WhereUsed { menu: { id: string; name: string; variant?: string; qty: number; unit: string }[]; preps: { id: string; name: string; qty: number; unit: string }[] }

/** The menu items and prep recipes that take this item as an ingredient. */
export function whereUsed(itemId: string, recipes: Recipe[], menu: Pick<MenuItem, 'id' | 'name'>[], preps: PrepRecipe[], inventory: Pick<InventoryItem, 'id' | 'name'>[]): WhereUsed {
  const names = new Map(menu.map(m => [m.id, m.name]));
  const inv = new Map(inventory.map(i => [i.id, i.name]));
  const out: WhereUsed = { menu: [], preps: [] };
  for (const r of recipes) {
    const c = (r.components || []).find(x => x.inventoryItemId === itemId);
    const name = names.get(r.menuItemId);
    if (c && name) out.menu.push({ id: r.menuItemId, name, variant: r.variantKey ? r.variantKey.replace(/^[a-z]+:/, '') : undefined, qty: Number(c.quantity) || 0, unit: c.unit });
  }
  for (const p of preps) {
    const c = (p.components || []).find(x => x.inventoryItemId === itemId);
    if (c) out.preps.push({ id: p.id, name: inv.get(p.outputItemId) ?? 'Prep item', qty: Number(c.quantity) || 0, unit: c.unit });
  }
  out.menu.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export const recentMovements = (logs: StockLog[], itemId: string, n = 8): StockLog[] =>
  logs.filter(l => l.inventoryItemId === itemId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, n);

export const unitOf = (i: Pick<InventoryItem, 'unit' | 'baseUnit'>): string => getBaseUnit(i);
