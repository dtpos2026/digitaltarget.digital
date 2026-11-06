// ============================================================
// Which receipt design a saved setting means (v1.107.0).
//
// FOUND: the setting type lists 'pre-receipt', but no component draws it, so a restaurant whose settings carried that
// value (or any other name the receipt does not know) printed an EMPTY slip — the guard that stops blank prints then
// refused it, and the owner saw nothing come out. A saved name must always lead to a receipt that prints.
//
//   • 'pre-receipt' is the old name of the plain Standard bill.
//   • A name the receipt does not know falls back to Classic, the software's default.
// ============================================================
import { isPremiumTemplateId } from '@/lib/premiumReceiptTemplates';

/** Designs ReceiptPreview draws itself (the premium templates are recognised by isPremiumTemplateId). */
export const BUILT_IN_RECEIPT_DESIGNS = [
  'standard', 'compact-thermal', 'classic', 'modern', 'compact', 'luxury', 'executive', 'royal', 'bistro', 'heritage',
  'metro', 'shahenshah', 'taste-bistro', 'food-palace', 'spice-house', 'taimoor', 'design1-table', 'design2-box',
  'design3-modern', 'design4-compact', 'design5-delivery', 'sero', 'bero', 'kot-style', 'kot-classic',
] as const;

/** Old names that now mean another design. */
export const RECEIPT_DESIGN_ALIASES: Record<string, string> = { 'pre-receipt': 'standard' };

export const DEFAULT_RECEIPT_DESIGN = 'classic';

export function resolveReceiptDesign(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return DEFAULT_RECEIPT_DESIGN;
  const name = RECEIPT_DESIGN_ALIASES[raw] ?? raw;
  if ((BUILT_IN_RECEIPT_DESIGNS as readonly string[]).includes(name)) return name;
  if (isPremiumTemplateId(name)) return name;
  return DEFAULT_RECEIPT_DESIGN;
}
