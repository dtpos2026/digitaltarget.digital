// v1.153.0 — "Deals & combos" as the design draws it (SW-15): "4 active deals", a card per deal — a coloured banner, the name with an on / off switch, the combo price
// "Rs 3,290" beside the regular price struck through "Rs 3,980" and a green "Save Rs 690", and the ticked list "2 × Pizza (M)". Pure: deals and the menu in, numbers and
// words out. The regular price is what the same things cost bought one by one — a size or an inch variant at its own price; a weighed dish has no price per piece, so a deal
// with one has no regular price to compare against and says nothing about saving.
import type { Deal, DealItem, MenuItem } from './types';

const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** What one unit of a deal line costs on the menu; null when it cannot be told (the dish is gone, or it is sold by weight). */
export function lineUnitPrice(di: Pick<DealItem, 'menuItemId' | 'variantName' | 'variantType'>, items: Pick<MenuItem, 'id' | 'price' | 'pricingType' | 'sizeVariants' | 'inchVariants'>[]): number | null {
  const it = items.find(x => x.id === di.menuItemId);
  if (!it) return null;
  if (di.variantName) {
    const pools = di.variantType === 'inch' ? [it.inchVariants, it.sizeVariants] : [it.sizeVariants, it.inchVariants];
    for (const pool of pools) { const v = (pool || []).find(p => p && p.name === di.variantName); if (v) return num(v.price); }
    return null;
  }
  if (it.pricingType === 'weight') return null;
  return num(it.price);
}

/** The deal's lines priced one by one; null when any line cannot be priced. */
export function regularPrice(deal: Pick<Deal, 'items'>, items: Pick<MenuItem, 'id' | 'price' | 'pricingType' | 'sizeVariants' | 'inchVariants'>[]): number | null {
  if (!deal.items.length) return null;
  let sum = 0;
  for (const di of deal.items) {
    const unit = lineUnitPrice(di, items);
    if (unit == null) return null;
    sum += unit * Math.max(1, num(di.quantity));
  }
  return round2(sum);
}

/** What the customer saves: the regular price less the combo price; nothing (null) when there is no regular price or the combo is not cheaper. */
export function saving(deal: Pick<Deal, 'items' | 'price'>, items: Pick<MenuItem, 'id' | 'price' | 'pricingType' | 'sizeVariants' | 'inchVariants'>[]): { regular: number; save: number } | null {
  const regular = regularPrice(deal, items);
  if (regular == null) return null;
  const save = round2(regular - num(deal.price));
  return save > 0 ? { regular, save } : null;
}

/** "4 active deals" / "1 active deal" / "No deals yet"; the ones switched off are counted apart ("· 2 off"). */
export function dealsSubtitle(deals: Pick<Deal, 'isActive'>[]): string {
  if (!deals.length) return 'No deals yet';
  const on = deals.filter(d => d.isActive).length, off = deals.length - on;
  return `${on} active ${on === 1 ? 'deal' : 'deals'}${off ? ` · ${off} off` : ''}`;
}

/** "2 × Pizza (M)" — the quantity, a multiplication sign, the dish and its size in brackets. A dish that is gone from the menu stays on the list as "—". */
export function dealLine(di: Pick<DealItem, 'menuItemId' | 'quantity' | 'variantName'>, nameOf: (id: string) => string): string {
  const name = nameOf(di.menuItemId) || '—';
  return `${Math.max(1, num(di.quantity))} × ${name}${di.variantName ? ` (${di.variantName})` : ''}`;
}

/** The banner colours, round and round: red, green, purple, orange, teal, blue. */
export const BANNER_TONES = ['red', 'green', 'purple', 'orange', 'teal', 'blue'] as const;
export const bannerTone = (index: number): (typeof BANNER_TONES)[number] => BANNER_TONES[((index % BANNER_TONES.length) + BANNER_TONES.length) % BANNER_TONES.length];
