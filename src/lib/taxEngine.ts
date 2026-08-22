// ============================================================
// v1.5.0 — SERVICE CHARGE + GST/TAX ENGINE
//
// WHY THIS IS A SEPARATE, PURE MODULE
// This is money. Every bill, every report and every tax filing depends
// on it, so the maths lives in one place with no React, no storage and
// no side effects — which makes it fully testable.
//
// THE BUG THIS REPLACES
// The old code used a FLAT `settings.taxAmount` added straight onto the
// subtotal, and service charge was never part of the tax base. So a 9%
// GST was impossible to express, and the client's standard calculation
// was simply wrong.
//
// CLIENT'S SPECIFICATION (implemented exactly)
//
// Exclusive GST — tax is ADDED on top:
//   Item base price        100.00
//   Service charge (10%)    10.00
//   Subtotal               110.00
//   GST (9% of 110.00)       9.90
//   Total                  119.90
//
// Inclusive GST — tax is ALREADY inside the price:
//   Base price = Total / 1.09
//   GST amount = Total × 0.09 / 1.09
//
// ORDER OF OPERATIONS (deliberate, matches the example above):
//   1. discount comes off the item subtotal
//   2. service charge is calculated on the DISCOUNTED subtotal
//   3. GST base = discounted subtotal + service charge
// Discount before tax is the norm — taxing money the customer never
// paid would overstate the liability.
// ============================================================

export type TaxMode = 'exclusive' | 'inclusive' | 'none';

export interface TaxConfig {
  /** How GST relates to menu prices. Default 'none' (unchanged behaviour). */
  taxMode?: TaxMode;
  /** GST / VAT percentage, e.g. 9 for 9%. */
  taxPercent?: number;
  /** Service charge percentage, e.g. 10 for 10%. */
  serviceChargePercent?: number;
  /**
   * v1.12.0 — Temporary Charge (an ad-hoc, per-bill charge that appears
   * on the client's Shift Report sample). Unlike service charge this is a
   * flat amount the cashier enters on the bill itself — packaging, a
   * delivery surcharge, a one-off cover charge. Taxed on the same basis
   * as the service charge so the GST figure stays defensible.
   */
  temporaryCharge?: number;
  /** Is the service charge itself taxable? Default true (client's example). */
  taxOnServiceCharge?: boolean;
  /** Label shown on the receipt, e.g. "GST", "VAT", "Sales Tax". */
  taxLabel?: string;
  /** Legacy flat tax amount. Only used when taxMode is 'none'. */
  legacyFlatTax?: number;
  /** Round the final total to whole currency units. Default false. */
  roundTotal?: boolean;
  /**
   * v1.9.1 — Cash-rounding increment.
   *
   * Singapore withdrew 1c coins, so cash bills settle to the nearest 5
   * cents (0.05). Australia/NZ do the same. Set to 0.05 for Singapore,
   * 0 (default) to disable. Applied AFTER tax so the tax figure filed
   * with the authority stays exact — only the amount the customer hands
   * over moves, and the difference is reported separately as `rounding`
   * so the books still balance.
   */
  roundToNearest?: number;
}

export interface BillTotals {
  /** Sum of line totals as entered. */
  itemsSubtotal: number;
  discount: number;
  /** itemsSubtotal - discount. */
  netSubtotal: number;
  serviceCharge: number;
  serviceChargePercent: number;
  /** v1.12.0 — flat ad-hoc charge on this bill (see TaxConfig). */
  temporaryCharge: number;
  /** Amount the tax percentage was applied to. */
  taxableBase: number;
  taxPercent: number;
  taxAmount: number;
  taxMode: TaxMode;
  taxLabel: string;
  /** What the customer pays. */
  grandTotal: number;
  /**
   * For inclusive mode: the portion of grandTotal that is NOT tax.
   * Receipts must show this so the tax breakdown adds up.
   */
  netOfTax: number;
  /**
   * v1.9.1 — signed cash-rounding difference applied to grandTotal
   * (e.g. -0.02 when 311.74 settles to 311.72 at 5c rounding). Shown on
   * the receipt and summed in reports so takings reconcile exactly.
   */
  roundingAdjustment: number;
}

/** Round to 2 decimals without floating-point drift (0.1+0.2 problems). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Calculate every line of the bill.
 *
 * @param itemsSubtotal sum of item line totals
 * @param discount      total discount already resolved to an amount
 */
export function computeBillTotals(
  itemsSubtotal: number,
  discount: number,
  cfg: TaxConfig = {},
): BillTotals {
  const mode: TaxMode = cfg.taxMode || 'none';
  const taxPercent = Math.max(0, Number(cfg.taxPercent) || 0);
  const scPercent = Math.max(0, Number(cfg.serviceChargePercent) || 0);
  const taxOnSc = cfg.taxOnServiceCharge !== false;
  const label = cfg.taxLabel || 'GST';

  const sub = Math.max(0, round2(Number(itemsSubtotal) || 0));
  const disc = Math.min(sub, Math.max(0, round2(Number(discount) || 0)));
  const netSubtotal = round2(sub - disc);

  // Step 2 — service charge on the discounted subtotal.
  const serviceCharge = round2(netSubtotal * scPercent / 100);
  const temporaryCharge = Math.max(0, round2(Number(cfg.temporaryCharge) || 0));

  // Step 3 — tax base. The temporary charge is consideration for the
  // supply, so it sits inside the taxable base alongside service charge.
  const taxableBase = round2(
    taxOnSc ? netSubtotal + serviceCharge + temporaryCharge : netSubtotal + temporaryCharge,
  );

  let taxAmount = 0;
  let grandTotal = 0;
  let netOfTax = 0;

  if (mode === 'exclusive' && taxPercent > 0) {
    // Tax added on top: GST = base × rate
    taxAmount = round2(taxableBase * taxPercent / 100);
    grandTotal = round2(netSubtotal + serviceCharge + temporaryCharge + taxAmount);
    netOfTax = round2(grandTotal - taxAmount);
  } else if (mode === 'inclusive' && taxPercent > 0) {
    // Tax already inside the prices. Client's formula:
    //   GST = Total × rate / (100 + rate)
    // The customer pays exactly the menu price + service charge.
    const gross = round2(netSubtotal + serviceCharge + temporaryCharge);
    const taxableGross = taxOnSc ? gross : netSubtotal + temporaryCharge;
    taxAmount = round2(taxableGross * taxPercent / (100 + taxPercent));
    grandTotal = gross;
    netOfTax = round2(grandTotal - taxAmount);
  } else {
    // No tax mode configured — preserve the legacy flat amount so existing
    // restaurants see no change until they configure the new settings.
    taxAmount = round2(Math.max(0, Number(cfg.legacyFlatTax) || 0));
    grandTotal = round2(netSubtotal + serviceCharge + temporaryCharge + taxAmount);
    netOfTax = round2(grandTotal - taxAmount);
  }

  // Cash rounding. roundToNearest (e.g. 0.05) takes precedence over the
  // older whole-unit roundTotal flag; both are optional and off by default.
  let roundingAdjustment = 0;
  const step = Number(cfg.roundToNearest) || 0;
  if (step > 0) {
    const rounded = round2(Math.round(grandTotal / step) * step);
    roundingAdjustment = round2(rounded - grandTotal);
    grandTotal = rounded;
    netOfTax = round2(grandTotal - taxAmount);
  } else if (cfg.roundTotal) {
    const rounded = Math.round(grandTotal);
    roundingAdjustment = round2(rounded - grandTotal);
    grandTotal = rounded;
    netOfTax = round2(grandTotal - taxAmount);
  }

  return {
    itemsSubtotal: sub,
    discount: disc,
    netSubtotal,
    serviceCharge,
    serviceChargePercent: scPercent,
    temporaryCharge,
    taxableBase,
    taxPercent: mode === 'none' ? 0 : taxPercent,
    taxAmount,
    taxMode: mode,
    taxLabel: label,
    grandTotal,
    netOfTax,
    roundingAdjustment,
  };
}

/**
 * Reverse calculation for an inclusive price — "what was the pre-GST
 * amount?" Client's formula: Base = Total / (1 + rate/100).
 */
export function extractInclusiveTax(total: number, taxPercent: number): { base: number; tax: number } {
  const rate = Math.max(0, Number(taxPercent) || 0);
  const gross = Math.max(0, Number(total) || 0);
  if (rate === 0) return { base: round2(gross), tax: 0 };
  const tax = round2(gross * rate / (100 + rate));
  return { base: round2(gross - tax), tax };
}

/** Human-readable receipt lines, in the order they should be printed. */
export function taxBreakdownLines(t: BillTotals): { label: string; amount: number }[] {
  const lines: { label: string; amount: number }[] = [];
  if (t.discount > 0) lines.push({ label: 'Discount', amount: -t.discount });
  if (t.serviceCharge > 0) {
    lines.push({ label: `Service Charge (${t.serviceChargePercent}%)`, amount: t.serviceCharge });
  }
  if (t.temporaryCharge > 0) {
    lines.push({ label: 'Temporary Charge', amount: t.temporaryCharge });
  }
  if (t.roundingAdjustment !== 0) {
    lines.push({ label: 'Rounding', amount: t.roundingAdjustment });
  }
  if (t.taxAmount > 0) {
    lines.push({
      label: t.taxMode === 'inclusive'
        ? `${t.taxLabel} ${t.taxPercent}% (inclusive)`
        : `${t.taxLabel} (${t.taxPercent}%)`,
      amount: t.taxMode === 'inclusive' ? 0 : t.taxAmount,
    });
  }
  return lines;
}
