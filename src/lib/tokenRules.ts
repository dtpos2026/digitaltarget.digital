// ============================================================
// TOKEN RULES — which items on an order get a token printed.
//
// A restaurant decides this two ways, and they work together:
//
//   CATEGORIES  — "everything in Burgers, Pizza, BBQ and Drinks"
//                 as many categories as the shop needs, not one.
//
//   ITEMS       — "and also Zinger Burger specifically"
//                 an individual menu item qualifies on its own, whether or
//                 not its category is selected.
//
// An item matches if EITHER rule matches. Selecting an item never requires
// selecting its category, and selecting a category does not have to be
// undone to exclude something — the two lists are independent.
//
// Storage: two optional arrays on the existing settings object. Nothing is
// added to the database schema; settings are already a JSON blob. The old
// single-category field is still read, so a shop that configured one
// category before this change keeps working untouched until it edits the
// list, at which point the new fields take over.
// ============================================================
import type { Order, CartItem, MenuItem, RestaurantSettings } from './types';

/**
 * The slice of settings these rules read.
 *
 * Callers hold settings in several shapes — the full RestaurantSettings, a
 * partially-built patch, or a plain object in tests — so this names exactly
 * the fields that matter instead of widening to `any`, which would silence
 * the type checker on the rest of the object too.
 */
export type TokenRuleSettings = Partial<Pick<RestaurantSettings,
  'tokenPrintEnabled' | 'tokenCategoryId' | 'tokenCategoryIds' | 'tokenMenuItemIds'
>>;

export interface TokenRules {
  /** Menu categories whose items all get a token. */
  categoryIds: Set<string>;
  /** Individual menu items that get a token regardless of their category. */
  menuItemIds: Set<string>;
  /** True when at least one rule is configured. */
  hasRules: boolean;
}

function toIdSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((v): v is string => typeof v === 'string' && v.length > 0));
}

/**
 * Read the shop's token rules, honouring the legacy single-category field.
 *
 * The legacy value is merged in rather than replaced, so upgrading cannot
 * silently stop a shop's tokens from printing. Once the shop saves a
 * category list the new field carries it and the legacy one is left alone.
 */
export function resolveTokenRules(settings: TokenRuleSettings | null | undefined): TokenRules {
  const s = settings || {};
  const categoryIds = toIdSet(s.tokenCategoryIds);
  // Legacy: a single category id chosen before multi-category support.
  if (typeof s.tokenCategoryId === 'string' && s.tokenCategoryId) {
    categoryIds.add(s.tokenCategoryId);
  }
  const menuItemIds = toIdSet(s.tokenMenuItemIds);
  return {
    categoryIds,
    menuItemIds,
    hasRules: categoryIds.size > 0 || menuItemIds.size > 0,
  };
}

/** Does this specific cart line qualify for a token? */
export function itemMatchesTokenRules(
  item: Pick<CartItem, 'menuItemId'>,
  rules: TokenRules,
  categoryOf: (menuItemId: string) => string | undefined,
): boolean {
  if (!item?.menuItemId) return false;
  // Item rule first: it is the more specific of the two and costs nothing
  // to check, so an individually-selected item never depends on its
  // category being selected as well.
  if (rules.menuItemIds.has(item.menuItemId)) return true;
  const categoryId = categoryOf(item.menuItemId);
  return !!categoryId && rules.categoryIds.has(categoryId);
}

/** Build the menuItemId -> categoryId lookup a match needs. */
export function categoryLookup(menu: MenuItem[] | undefined | null) {
  const byId = new Map<string, string>();
  for (const m of menu || []) {
    if (m?.id) byId.set(m.id, m.categoryId);
  }
  return (menuItemId: string) => byId.get(menuItemId);
}

export interface TokenLine {
  name: string;
  qty: number;
}

/** A token line plus what some slip designs can show: the item's note and its price. */
export interface TokenLineDetail extends TokenLine {
  note?: string;
  amount?: number;
}

/**
 * The lines of an order that should appear on its token slip. Quantities
 * come straight from the order, so the token always reflects what was
 * actually ordered.
 */
export function getTokenLines(
  order: Pick<Order, 'items'> | undefined | null,
  settings: TokenRuleSettings | null | undefined,
  menu: MenuItem[] | undefined | null,
): TokenLine[] {
  const rules = resolveTokenRules(settings);
  if (!rules.hasRules) return [];
  const categoryOf = categoryLookup(menu);
  const out: TokenLine[] = [];
  for (const item of order?.items || []) {
    if ((item.quantity || 0) <= 0) continue;
    if (!itemMatchesTokenRules(item, rules, categoryOf)) continue;
    out.push({ name: item.name, qty: item.quantity });
  }
  return out;
}

/** getTokenLines, with each line's note and amount (for the slip designs that print them). */
export function getTokenLinesDetailed(
  order: Pick<Order, 'items'> | undefined | null,
  settings: TokenRuleSettings | null | undefined,
  menu: MenuItem[] | undefined | null,
): TokenLineDetail[] {
  const rules = resolveTokenRules(settings);
  if (!rules.hasRules) return [];
  const categoryOf = categoryLookup(menu);
  const out: TokenLineDetail[] = [];
  for (const item of order?.items || []) {
    if ((item.quantity || 0) <= 0) continue;
    if (!itemMatchesTokenRules(item, rules, categoryOf)) continue;
    out.push({ name: item.name, qty: item.quantity, note: item.note || undefined, amount: Number(item.lineTotal) || undefined });
  }
  return out;
}

/** Same as getTokenLines, for a cart that is not yet an order. */
export function getTokenLinesFromCart(
  cart: CartItem[] | undefined | null,
  settings: TokenRuleSettings | null | undefined,
  menu: MenuItem[] | undefined | null,
): CartItem[] {
  const rules = resolveTokenRules(settings);
  if (!rules.hasRules) return [];
  const categoryOf = categoryLookup(menu);
  return (cart || []).filter(
    item => (item.quantity || 0) > 0 && itemMatchesTokenRules(item, rules, categoryOf),
  );
}

/** Does this order need a token printed at all? */
export function orderNeedsToken(
  order: Pick<Order, 'items'> | undefined | null,
  settings: TokenRuleSettings | null | undefined,
  menu: MenuItem[] | undefined | null,
): boolean {
  if (!settings?.tokenPrintEnabled) return false;
  return getTokenLines(order, settings, menu).length > 0;
}

/** Total value of the token items — used to keep them out of the sale count. */
export function tokenLinesAmount(
  order: Pick<Order, 'items'> | undefined | null,
  settings: TokenRuleSettings | null | undefined,
  menu: MenuItem[] | undefined | null,
): number {
  const rules = resolveTokenRules(settings);
  if (!rules.hasRules) return 0;
  const categoryOf = categoryLookup(menu);
  let sum = 0;
  for (const item of order?.items || []) {
    if (itemMatchesTokenRules(item, rules, categoryOf)) sum += Number(item.lineTotal || 0);
  }
  return sum;
}

// ------------------------------------------------------------
// Writing rules back to settings
// ------------------------------------------------------------

/**
 * Produce the settings patch for a new rule selection.
 *
 * The legacy single-category field is cleared at the same time: once the
 * shop has an explicit list, leaving the old value behind would silently
 * re-add a category they just removed.
 */
export function tokenRulesPatch(categoryIds: string[], menuItemIds: string[]) {
  return {
    tokenCategoryIds: Array.from(new Set(categoryIds.filter(Boolean))),
    tokenMenuItemIds: Array.from(new Set(menuItemIds.filter(Boolean))),
    tokenCategoryId: undefined as string | undefined,
  };
}
