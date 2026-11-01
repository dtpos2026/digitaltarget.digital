// ============================================================
// DEPARTMENT / DETACHABLE TOKENS
//
// A restaurant with separate counters — Sajji, Tandoor, Bar, BBQ — needs
// each counter to keep its own physical proof of what it served, so the
// evening count can be checked against what the POS recorded.
//
// With the mode on, a token prints its normal body and then small tear-off
// stubs, each carrying the order number, the token number and enough
// identity to be traced back to the sale.
//
// HOW THE STUBS ARE SPLIT
// -----------------------
// Three shapes, because "one stub" means different things to different
// counters:
//
//   department — one stub per department        SAJJI · QTY 6
//   item       — one stub per menu line         SAJJI FULL · QTY 6
//   piece      — one stub per unit sold         SAJJI FULL · QTY 1  (×6)
//
// `piece` is what physical reconciliation actually needs: if the system
// says Sajji sold 6, the Sajji counter should be holding six pieces of
// paper to count. The other two are there for shops that only want a
// summary and would rather save paper.
//
// Departments are the shop's EXISTING menu categories — nothing is
// hard-coded, and a shop chooses which of them take part.
// ============================================================
import type { MenuItem, Order, RestaurantSettings } from './types';
import { getCategories, getMenuItems } from './store';
import { categoryLookup, resolveTokenRules, itemMatchesTokenRules } from './tokenRules';

export type TokenStubMode = 'department' | 'item' | 'piece';

export interface DepartmentStub {
  departmentId: string;
  departmentName: string;
  qty: number;
  items: { name: string; qty: number }[];
  /** Item name for item/piece stubs; absent on a department summary stub. */
  itemName?: string;
  /** "3 of 6" on a per-piece stub, so a counter can see none is missing. */
  index?: number;
  ofTotal?: number;
}

/**
 * Most stubs one token may print.
 *
 * Per-piece stubs are what a shop asks for, but an order of 200 rotis would
 * otherwise produce a three-metre token. Past this the split falls back to
 * one stub per item line, which still reconciles — just by line rather than
 * by piece — instead of emptying the roll.
 */
export const MAX_STUBS_PER_TOKEN = 40;

/** Is the shop printing detachable stubs? */
export function isDepartmentTokenMode(settings: RestaurantSettings | any): boolean {
  return !!settings?.tokenDepartmentMode;
}

/** How the shop wants the stubs split. */
export function tokenStubMode(settings: RestaurantSettings | any): TokenStubMode {
  const m = settings?.tokenStubMode;
  return m === 'department' || m === 'item' || m === 'piece' ? m : 'piece';
}

/**
 * Which departments take part.
 *
 * An empty list means "every department that appears on the token", which is
 * the sensible default for a shop that switches the mode on without picking
 * anything yet — otherwise turning it on would appear to do nothing.
 */
export function participatingDepartmentIds(settings: RestaurantSettings | any): Set<string> {
  const ids = (settings?.tokenDepartmentIds ?? []) as unknown;
  return new Set(Array.isArray(ids) ? ids.filter((v): v is string => typeof v === 'string' && !!v) : []);
}

interface TokenLineWithDept {
  departmentId: string;
  departmentName: string;
  name: string;
  qty: number;
}

/** The order's token lines, each tagged with its department. */
function tokenLinesWithDepartments(
  order: Pick<Order, 'items'> | undefined | null,
  settings: RestaurantSettings | any,
  menu: MenuItem[],
): TokenLineWithDept[] {
  const rules = resolveTokenRules(settings);
  if (!rules.hasRules) return [];

  const chosen = participatingDepartmentIds(settings);
  const categoryOf = categoryLookup(menu);
  const names = new Map(safeCategories().map(c => [c.id, c.name]));

  const out: TokenLineWithDept[] = [];
  for (const item of order?.items || []) {
    if ((item.quantity || 0) <= 0) continue;
    // Only items that would get a token in the first place.
    if (!itemMatchesTokenRules(item, rules, categoryOf)) continue;

    const departmentId = categoryOf(item.menuItemId) || 'unassigned';
    // An explicit selection narrows it; an empty selection takes them all.
    if (chosen.size > 0 && !chosen.has(departmentId)) continue;

    out.push({
      departmentId,
      departmentName: names.get(departmentId) || 'Other',
      name: item.name,
      qty: item.quantity || 0,
    });
  }
  return out;
}

/**
 * Build the tear-off stubs for an order, or undefined when the mode is off.
 *
 * Returning undefined (rather than an empty array) keeps the printed slip
 * byte-for-byte what it was before this feature existed when the mode is
 * off — nothing downstream has to know the feature exists.
 */
export function buildDepartmentStubs(
  order: Pick<Order, 'items'> | undefined | null,
  settings: RestaurantSettings | any,
  menu: MenuItem[] = safeMenu(),
): DepartmentStub[] | undefined {
  if (!isDepartmentTokenMode(settings)) return undefined;

  const lines = tokenLinesWithDepartments(order, settings, menu);
  if (!lines.length) return undefined;

  const mode = tokenStubMode(settings);
  const byDepartment = (a: DepartmentStub, b: DepartmentStub) =>
    a.departmentName.localeCompare(b.departmentName) || (a.itemName || '').localeCompare(b.itemName || '');

  if (mode === 'department') {
    const groups = new Map<string, DepartmentStub>();
    for (const l of lines) {
      const row = groups.get(l.departmentId) || {
        departmentId: l.departmentId,
        departmentName: l.departmentName,
        qty: 0,
        items: [],
      };
      row.qty += l.qty;
      row.items.push({ name: l.name, qty: l.qty });
      groups.set(l.departmentId, row);
    }
    return Array.from(groups.values()).sort(byDepartment);
  }

  const itemStubs = (): DepartmentStub[] => lines.map(l => ({
    departmentId: l.departmentId,
    departmentName: l.departmentName,
    itemName: l.name,
    qty: l.qty,
    items: [{ name: l.name, qty: l.qty }],
  })).sort(byDepartment);

  if (mode === 'item') return itemStubs();

  // ---- piece: one stub per unit, so the counter can literally count them.
  const totalPieces = lines.reduce((sum, l) => sum + l.qty, 0);
  if (totalPieces > MAX_STUBS_PER_TOKEN) {
    // Too many to be practical on a roll — fall back to one per line, which
    // still reconciles, rather than printing a metre of paper.
    return itemStubs();
  }

  const stubs: DepartmentStub[] = [];
  for (const l of lines) {
    for (let i = 0; i < l.qty; i++) {
      stubs.push({
        departmentId: l.departmentId,
        departmentName: l.departmentName,
        itemName: l.name,
        qty: 1,
        items: [{ name: l.name, qty: 1 }],
        index: i + 1,
        ofTotal: l.qty,
      });
    }
  }
  return stubs.sort(byDepartment);
}

function safeMenu(): MenuItem[] {
  try { return getMenuItems(); } catch { return []; }
}

function safeCategories(): { id: string; name: string }[] {
  try { return getCategories() as { id: string; name: string }[]; } catch { return []; }
}
