// ============================================================
// Ready-made receipt templates.
//
// Teen fixed templates — cashier sirf ek chuntta hai aur bill usi
// shakal me foran nikalta hai. Koi design banane ki zaroorat nahi,
// values khud bill me chali jati hain.
//
//   standard — full professional bill (logo, address, phone, totals)
//   compact  — chhota bill, kam kaghaz (logo off, chhota font)
//   detailed — sab kuch dikhata hai (tax, discount, footer, branding)
//
// The choice is per computer (device level), so one shop can run a
// compact counter printer and a detailed office printer.
// ============================================================

export type ReceiptTemplate = 'standard' | 'compact' | 'detailed';

const KEY = 'dtpos-receipt-template';

export const RECEIPT_TEMPLATES: { id: ReceiptTemplate; name: string; hint: string }[] = [
  { id: 'standard', name: 'Standard', hint: 'Logo, shop details, items and totals — the everyday bill.' },
  { id: 'compact',  name: 'Compact',  hint: 'Shortest bill — no logo, tighter rows, saves paper.' },
  { id: 'detailed', name: 'Detailed', hint: 'Everything on: logo, tax, discount, footer and branding.' },
];

export function getReceiptTemplate(): ReceiptTemplate {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'compact' || v === 'detailed' || v === 'standard') return v;
  } catch { /* storage unavailable */ }
  return 'standard';
}

export function setReceiptTemplate(t: ReceiptTemplate) {
  try {
    localStorage.setItem(KEY, t);
    window.dispatchEvent(new CustomEvent('dtpos-receipt-template-changed'));
  } catch { /* storage unavailable */ }
}

/**
 * Merge the chosen template on top of the shop's settings.
 * Only presentation flags are touched — prices, taxes and totals never change.
 */
export function applyReceiptTemplate<T extends Record<string, any>>(settings: T, template = getReceiptTemplate()): T {
  if (template === 'compact') {
    return {
      ...settings,
      receiptCompactMode: true,
      receiptShowLogo: false,
      receiptShowFooter: false,
      receiptShowPoweredBy: false,
    };
  }
  if (template === 'detailed') {
    return {
      ...settings,
      receiptCompactMode: false,
      receiptShowLogo: settings.receiptShowLogo !== false,
      receiptShowAddress: true,
      receiptShowPhone: true,
      receiptShowDiscount: true,
      receiptShowTax: true,
      receiptShowFooter: true,
      receiptShowPoweredBy: true,
    };
  }
  return settings;
}
