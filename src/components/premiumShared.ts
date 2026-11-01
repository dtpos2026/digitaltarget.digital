// ============================================================
// Shared by the two premium receipt renderers (PremiumReceipt and
// DtRetailReceipt). Kept in its own file so neither imports the other.
// ============================================================
import type { PremiumCustomization } from '@/lib/premiumReceiptTemplates';

/**
 * Typeface stacks.
 *
 * Every family here ships with Windows, which is the point: the print worker
 * renders its document from a different directory, and a webfont that fails
 * to resolve there is silently swapped for a fallback — the receipt then
 * prints in a face the preview never showed. System faces cannot fail to
 * load, so preview and paper rasterise identically.
 */
export const FONT_STACKS: Record<PremiumCustomization['fontFamily'], string> = {
  sans: "'Segoe UI', Arial, Helvetica, sans-serif",
  // Condensed: fits noticeably more characters per 80mm line without
  // dropping the point size, which is how the busier references stay legible.
  grotesk: "'Arial Narrow', 'Tahoma', 'Segoe UI', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
  slab: "Cambria, Georgia, 'Times New Roman', serif",
  mono: "'Consolas', 'Lucida Console', 'Courier New', monospace",
};

/**
 * Money and quantity columns must never break mid-number — "450.00" split
 * across two lines as "450.0" / "0" is worse than useless on a bill.
 *
 * The shared print CSS forces `table-layout: fixed` on every receipt table,
 * which splits the width by percentage regardless of content, so the money
 * columns were too narrow for four-figure totals while the item name kept
 * space it did not need. These rules switch the premium tables back to
 * content-driven sizing: the numeric columns take exactly what they need,
 * the item name absorbs the rest and wraps like prose.
 *
 * The selector deliberately mirrors the print CSS's own specificity chain
 * plus one class, so it wins in both the preview and the print worker.
 */
export const ITEM_TABLE_CSS = `
.premium-receipt table.premium-items { table-layout: auto; }
.premium-receipt .premium-num { white-space: nowrap; }
body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt table.premium-items,
body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt table.premium-items {
  table-layout: auto !important;
  width: 100% !important;
}
body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt .premium-num,
body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt .premium-num {
  white-space: nowrap !important;
}
`;
