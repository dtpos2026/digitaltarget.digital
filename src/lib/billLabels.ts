// ============================================================
// BILL LABELS — the words a discount (and tax) gets on a slip.
//
// A percentage discount reads "Discount (10%)"; a flat one just "Discount", with
// the amount on the right. A bill that carries its own title ("Eid Discount",
// "Event Discount 10% + Discount 5%") prints that title, with the percentage
// added when the title does not already say it. Every receipt, the raw ESC/POS
// slip, the bill editor and the Customer Display use these, so the same bill
// reads the same everywhere. Only presentation: the amounts come from the order.
// ============================================================

interface DiscountLike {
  discount?: number;
  discountPercent?: number;
  discountTitle?: string;
  subtotal?: number;
}

/**
 * The percentage worth printing next to the discount, or 0.
 *
 * The saved percentage is printed only when it can account for the amount: a
 * bill whose discount was stacked (event + manual) or typed over by a manager
 * keeps an old percentage that no longer describes it, and printing it would
 * make the slip disagree with itself.
 */
export function discountPercentShown(order: DiscountLike): number {
  const pct = Number(order.discountPercent) || 0;
  if (!(pct > 0 && pct <= 100)) return 0;
  const sub = Number(order.subtotal) || 0;
  const amount = Number(order.discount) || 0;
  // A percentage of the discountable part can never be more than the same percentage of the whole bill.
  if (sub > 0 && amount > sub * pct / 100 + 1) return 0;
  return +pct.toFixed(2);
}

/** "Discount (10%)" for a percentage discount, "Discount" for a flat one, or the bill's own title. */
export function discountLabel(order: DiscountLike, base = 'Discount'): string {
  const title = (order.discountTitle || '').trim();
  const pct = discountPercentShown(order);
  if (title) return pct && !title.includes('%') ? `${title} (${pct}%)` : title;
  return pct ? `${base} (${pct}%)` : base;
}

/** The same label; kept for the templates that asked for "the title when there is one". */
export function discountLineTitle(order: DiscountLike): string {
  return discountLabel(order);
}

/** "Tax (16%)" when the shop charges a percentage, plain "Tax" for the old flat amount. */
export function taxLabel(settings: { taxPercent?: number } | null | undefined, base = 'Tax'): string {
  const pct = Number(settings?.taxPercent) || 0;
  return pct > 0 && pct <= 100 ? `${base} (${+pct.toFixed(2)}%)` : base;
}

/**
 * The size to print after an item's name, or '' when the name already says it.
 * The POS names a sized line "Pepperoni Feast - Large" and keeps "Large" as its
 * variant too; printing both read "Pepperoni Feast - Large (Large)".
 */
export function variantNote(item: { name?: string; variantName?: string }): string {
  const v = (item.variantName || '').trim();
  if (!v) return '';
  const name = (item.name || '').trim().toLowerCase();
  return name.endsWith(v.toLowerCase()) ? '' : v;
}
