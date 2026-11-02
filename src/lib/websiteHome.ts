// ============================================================
// CUSTOMER WEBSITE — the home page's content rules (v1.98.0, design package WEB-01).
// Pure: which hero to show, the category tiles and their look, how a price reads. The screens are in
// src/components/website/. Nothing here reads or writes data.
// ============================================================
import type { Category, Deal, MenuItem } from './types';

export type HeroKind = 'banner' | 'deal' | 'brand';
export interface Hero {
  kind: HeroKind;
  title: string;
  subtitle?: string;
  image?: string;
  /** The deal this hero sells (kind 'deal'): its id is a menu item, so "Order now" can add it. */
  dealId?: string;
  dealPrice?: number;
}

const isImage = (v: unknown): v is string => typeof v === 'string' && /^(https?:\/\/|data:image\/)/i.test(v.trim());

/**
 * What the first screen leads with, in order: the picture the restaurant uploaded as its website banner (with its
 * tagline), else today's first active deal that can be ordered, else the restaurant's own name and tagline on its colour.
 * Nothing is invented: no "today only" or discount that the restaurant did not set.
 */
export function heroFor(input: { banner?: string; tagline?: string; name: string; deals: Deal[]; items: MenuItem[] }): Hero {
  const name = (input.name || '').trim() || 'Restaurant';
  const tagline = (input.tagline || '').trim() || undefined;
  if (isImage(input.banner)) return { kind: 'banner', title: tagline || name, subtitle: tagline ? name : undefined, image: input.banner.trim() };
  const orderable = new Set(input.items.map(i => i.id));
  const deal = input.deals.find(d => d.isActive && d.items?.length && orderable.has(d.id));
  if (deal) {
    const parts = deal.items.map(di => `${di.quantity}× ${input.items.find(i => i.id === di.menuItemId)?.name || 'item'}`);
    return { kind: 'deal', title: deal.name, subtitle: parts.join(' · '), image: isImage(deal.image) ? deal.image : undefined, dealId: deal.id, dealPrice: deal.price };
  }
  return { kind: 'brand', title: name, subtitle: tagline };
}

export type TileIcon = 'pizza' | 'burger' | 'pot' | 'wrap' | 'sides' | 'drink' | 'dessert' | 'gift' | 'grill' | 'salad' | 'default';

const ICON_RULES: Array<[RegExp, TileIcon]> = [
  [/pizza/i, 'pizza'], [/burger|zinger|smash/i, 'burger'], [/karahi|handi|curry|salan|biryani|pulao|rice/i, 'pot'],
  [/wrap|roll|shawarma|paratha|sandwich|sub\b/i, 'wrap'], [/side|fries|nugget|wings|starter|appetizer|snack/i, 'sides'],
  [/drink|beverage|juice|shake|coffee|tea|soda|mocktail|margarita|lassi|cold/i, 'drink'],
  [/dessert|sweet|cake|ice ?cream|brownie|kulfi|halwa|pastry/i, 'dessert'], [/deal|combo|offer|bundle|family/i, 'gift'],
  [/bbq|grill|tikka|kabab|kebab|steak|tandoor|boti/i, 'grill'], [/salad|healthy|veg/i, 'salad'],
];
export const iconFor = (name: string): TileIcon => ICON_RULES.find(([re]) => re.test(name || ''))?.[1] ?? 'default';

/** Eight gradients, as whole class names so the stylesheet generator can see them. */
export const TONES = [
  'from-amber-500 to-orange-700', 'from-red-500 to-red-800', 'from-emerald-500 to-emerald-800', 'from-violet-500 to-purple-800',
  'from-cyan-500 to-sky-800', 'from-orange-500 to-amber-700', 'from-rose-500 to-pink-800', 'from-teal-500 to-green-800',
] as const;

/** A stable tone per name, so a category keeps its colour between visits and devices. */
export function toneIndex(name: string): number {
  let h = 0;
  for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % TONES.length;
}

export interface CategoryTile { id: string; name: string; count: number; image?: string; icon: TileIcon; tone: number }

/** Only categories that have something to order, in the order the restaurant set. */
export function categoryTiles(categories: Category[], items: MenuItem[]): CategoryTile[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.categoryId, (counts.get(i.categoryId) || 0) + 1);
  return [...categories]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .filter(c => (counts.get(c.id) || 0) > 0)
    .map(c => ({ id: c.id, name: c.name, count: counts.get(c.id)!, image: isImage(c.image) ? c.image : undefined, icon: iconFor(c.name), tone: toneIndex(c.name) }));
}

/** "Rs 1,450" or, for an item with sizes, "From Rs 950". */
export const priceLabel = (money: (n: number) => string, price: number, minVariantPrice?: number): string =>
  minVariantPrice != null ? `From ${money(minVariantPrice)}` : money(price);
