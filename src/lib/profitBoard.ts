// v1.150.0 — "Profit & loss" as the design draws it (SW-27): a Summary (Net sales · Food cost · Gross profit · Expenses · Net profit and its margin) beside
// "Margin by item" (Item · Sold · Price · Cost · Margin, "no recipe" where the dish has none). Pure: sums in, words out. The software already knew the
// sales, the recipe-based food cost and the wastage (the old Profitability page); the design adds what the restaurant spent — the entries on Accounts →
// Expenses for the same dates — so the last line is a real profit and loss, not only a margin over the recipes.
import type { Transaction } from './types';

export interface PlInput { revenue: number; foodCost: number; wastage: number; expenses: number; /** sales of dishes that have a recipe (the base of the food-cost percentage) */ recipeRevenue?: number }
export interface PlSummary {
  netSales: number; foodCost: number; grossProfit: number; wastage: number; expenses: number; netProfit: number;
  /** net profit over net sales, one decimal; 0 when there were no sales */
  marginPct: number;
  /** food cost over the sales of dishes that have a recipe, one decimal; 0 when none has */
  foodCostPct: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0);

/** Net sales − food cost = gross profit; − wastage − expenses = net profit. */
export function plSummary(i: PlInput): PlSummary {
  const netSales = round2(num(i.revenue)), foodCost = round2(num(i.foodCost)), wastage = round2(num(i.wastage)), expenses = round2(num(i.expenses));
  const grossProfit = round2(netSales - foodCost);
  const netProfit = round2(grossProfit - wastage - expenses);
  const base = num(i.recipeRevenue ?? netSales);
  return { netSales, foodCost, grossProfit, wastage, expenses, netProfit, marginPct: netSales > 0 ? round1((netProfit / netSales) * 100) : 0, foodCostPct: base > 0 ? round1((foodCost / base) * 100) : 0 };
}

/** What was spent in the window: the expense entries on Accounts whose day falls inside it (an entry carries a day, not a time, so it counts at midday). */
export function expensesIn(txns: Pick<Transaction, 'type' | 'date' | 'amount'>[], startMs: number, endMs: number): number {
  let sum = 0;
  for (const t of txns) {
    if (t.type !== 'expense') continue;
    const day = String(t.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const mid = new Date(`${day}T12:00:00`).getTime();
    if (Number.isFinite(mid) && mid >= startMs && mid < endMs) sum += num(t.amount);
  }
  return round2(sum);
}

export type MarginTone = 'ok' | 'warn' | 'bad';
/** Green from half the price up, amber from a third, red below — the colours the old page used. */
export const marginTone = (pct: number): MarginTone => (pct >= 50 ? 'ok' : pct >= 30 ? 'warn' : 'bad');

export type ItemSort = 'sold' | 'best' | 'low';
export const ITEM_SORTS: { key: ItemSort; label: string }[] = [{ key: 'sold', label: 'Best sellers' }, { key: 'best', label: 'Best margin' }, { key: 'low', label: 'Lowest margin' }];

export interface ItemFigure { name: string; revenue: number; cost: number; qty: number }
export interface ItemRow extends ItemFigure {
  /** average price per unit sold */
  price: number;
  /** recipe cost per unit; null when the dish has no recipe (or no cost) */
  unitCost: number | null;
  /** whole percent; null with no recipe */
  margin: number | null;
}

/** The dishes sold, with the price they actually sold at, what a unit costs and the margin — dishes with no recipe have no cost and no margin and sit last in the margin orders. */
export function itemRows(items: ItemFigure[], sort: ItemSort = 'sold'): ItemRow[] {
  const rows: ItemRow[] = items.map(e => {
    const qty = num(e.qty), revenue = num(e.revenue), cost = num(e.cost);
    return { name: e.name, qty, revenue, cost, price: qty > 0 ? round2(revenue / qty) : 0, unitCost: cost > 0 && qty > 0 ? round2(cost / qty) : null, margin: cost > 0 && revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null };
  });
  const byName = (a: ItemRow, b: ItemRow) => a.name.localeCompare(b.name);
  if (sort === 'sold') return rows.sort((a, b) => b.qty - a.qty || b.revenue - a.revenue || byName(a, b));
  const has = (r: ItemRow) => r.margin != null;
  return rows.sort((a, b) => Number(has(b)) - Number(has(a)) || (sort === 'best' ? (b.margin ?? 0) - (a.margin ?? 0) : (a.margin ?? 0) - (b.margin ?? 0)) || byName(a, b));
}

/** "180" for whole units, "1.5" for a weighed dish. */
export const soldLabel = (qty: number): string => (Number.isInteger(qty) ? String(qty) : String(round1(qty)));

/** The words under the title: "Today", "Yesterday", "Last 7 days · 12 – 18 Nov", "Last 30 days · 20 Oct – 19 Nov", "12 Oct – 18 Nov 2026". */
export function rangeLabel(startMs: number, endMs: number, preset: string): string {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const a = new Date(startMs), b = new Date(endMs - 1);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const span = a.toDateString() === b.toDateString() ? `${b.getDate()} ${M[b.getMonth()]}`
    : sameMonth ? `${a.getDate()} – ${b.getDate()} ${M[b.getMonth()]}` : `${a.getDate()} ${M[a.getMonth()]} – ${b.getDate()} ${M[b.getMonth()]}`;
  if (preset === 'today') return 'Today';
  if (preset === 'yesterday') return 'Yesterday';
  if (preset === 'week') return `Last 7 days · ${span}`;
  if (preset === 'month') return `Last 30 days · ${span}`;
  return `${span} ${b.getFullYear()}`;
}
