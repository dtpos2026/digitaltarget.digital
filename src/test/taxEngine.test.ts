// ============================================================
// Tests — Service Charge + GST engine (v1.5.0)
// The client supplied worked examples; these encode them exactly.
// If any of these fail, bills are wrong — treat as release-blocking.
// ============================================================
import { describe, it, expect } from 'vitest';
import { computeBillTotals, extractInclusiveTax, round2, taxBreakdownLines } from '@/lib/taxEngine';

describe("client's EXCLUSIVE GST example (must match exactly)", () => {
  // Item Base Price: 100.00
  // Service Charge (10%): 10.00
  // Subtotal: 110.00
  // GST (9% of 110.00): 9.90
  // Total Bill: 119.90
  const t = computeBillTotals(100, 0, {
    taxMode: 'exclusive', taxPercent: 9, serviceChargePercent: 10,
  });

  it('service charge is 10.00', () => expect(t.serviceCharge).toBe(10));
  it('taxable base (subtotal incl. service charge) is 110.00', () => expect(t.taxableBase).toBe(110));
  it('GST is 9.90 — calculated on 110, not on 100', () => expect(t.taxAmount).toBe(9.9));
  it('total bill is 119.90', () => expect(t.grandTotal).toBe(119.9));
  it('the parts add up to the total', () => {
    expect(round2(t.netSubtotal + t.serviceCharge + t.taxAmount)).toBe(t.grandTotal);
  });
});

describe("client's INCLUSIVE GST formulas", () => {
  it('Base Price = Total / 1.09', () => {
    const { base } = extractInclusiveTax(109, 9);
    expect(base).toBe(100);
  });

  it('GST Amount = Total × 0.09 / 1.09', () => {
    const { tax } = extractInclusiveTax(109, 9);
    expect(tax).toBe(9);
    expect(tax).toBe(round2(109 * 0.09 / 1.09));
  });

  it('base + tax always reconstructs the total', () => {
    for (const total of [119.9, 250, 1000, 87.35]) {
      const { base, tax } = extractInclusiveTax(total, 9);
      expect(round2(base + tax)).toBe(round2(total));
    }
  });

  it('inclusive mode never increases what the customer pays', () => {
    const t = computeBillTotals(100, 0, { taxMode: 'inclusive', taxPercent: 9 });
    expect(t.grandTotal).toBe(100);           // price on the menu is final
    expect(t.taxAmount).toBe(round2(100 * 9 / 109));
    expect(round2(t.netOfTax + t.taxAmount)).toBe(100);
  });

  it('inclusive mode still adds service charge on top of menu prices', () => {
    const t = computeBillTotals(100, 0, {
      taxMode: 'inclusive', taxPercent: 9, serviceChargePercent: 10,
    });
    expect(t.serviceCharge).toBe(10);
    expect(t.grandTotal).toBe(110);
    expect(t.taxAmount).toBe(round2(110 * 9 / 109));
  });
});

describe('discount is applied before service charge and tax', () => {
  it('a 100 discount on 200 taxes only the remaining 100', () => {
    const t = computeBillTotals(200, 100, {
      taxMode: 'exclusive', taxPercent: 9, serviceChargePercent: 10,
    });
    expect(t.netSubtotal).toBe(100);
    expect(t.serviceCharge).toBe(10);
    expect(t.taxAmount).toBe(9.9);
    expect(t.grandTotal).toBe(119.9);
  });

  it('discount can never exceed the subtotal', () => {
    const t = computeBillTotals(50, 500, { taxMode: 'exclusive', taxPercent: 9 });
    expect(t.discount).toBe(50);
    expect(t.netSubtotal).toBe(0);
    expect(t.grandTotal).toBe(0);
  });
});

describe('taxOnServiceCharge option', () => {
  it('when OFF, GST is charged on the items only', () => {
    const t = computeBillTotals(100, 0, {
      taxMode: 'exclusive', taxPercent: 9, serviceChargePercent: 10, taxOnServiceCharge: false,
    });
    expect(t.taxableBase).toBe(100);
    expect(t.taxAmount).toBe(9);
    expect(t.grandTotal).toBe(119);
  });
});

describe('backward compatibility — existing restaurants are unaffected', () => {
  it('with no tax settings, behaviour matches the old flat-amount logic', () => {
    const t = computeBillTotals(100, 0, { legacyFlatTax: 15, serviceChargePercent: 10 });
    expect(t.taxMode).toBe('none');
    expect(t.taxAmount).toBe(15);
    expect(t.grandTotal).toBe(125); // 100 + 10 service charge + 15 flat tax
  });

  it('an empty config produces a plain, untaxed bill', () => {
    const t = computeBillTotals(500, 0, {});
    expect(t.taxAmount).toBe(0);
    expect(t.serviceCharge).toBe(0);
    expect(t.grandTotal).toBe(500);
  });
});

describe('rounding and money safety', () => {
  it('avoids floating point drift', () => {
    const t = computeBillTotals(0.1 + 0.2, 0, { taxMode: 'exclusive', taxPercent: 9 });
    expect(t.itemsSubtotal).toBe(0.3);
  });

  it('handles awkward amounts to 2 decimals', () => {
    const t = computeBillTotals(33.33, 0, { taxMode: 'exclusive', taxPercent: 9, serviceChargePercent: 10 });
    expect(t.serviceCharge).toBe(3.33);
    expect(t.taxAmount).toBe(round2(36.66 * 0.09));
    expect(round2(t.netSubtotal + t.serviceCharge + t.taxAmount)).toBe(t.grandTotal);
  });

  it('optional whole-number rounding of the final total', () => {
    const t = computeBillTotals(100, 0, { taxMode: 'exclusive', taxPercent: 9, serviceChargePercent: 10, roundTotal: true });
    expect(t.grandTotal).toBe(120);
    expect(Number.isInteger(t.grandTotal)).toBe(true);
  });

  it('negative and junk inputs never produce a negative bill', () => {
    const t = computeBillTotals(-50, -10, { taxMode: 'exclusive', taxPercent: 9 });
    expect(t.grandTotal).toBeGreaterThanOrEqual(0);
    expect(t.discount).toBeGreaterThanOrEqual(0);
  });

  it('a 0% rate behaves like no tax', () => {
    const t = computeBillTotals(100, 0, { taxMode: 'exclusive', taxPercent: 0 });
    expect(t.taxAmount).toBe(0);
    expect(t.grandTotal).toBe(100);
  });
});

describe('receipt breakdown lines', () => {
  it('lists discount, service charge and tax in printing order', () => {
    const t = computeBillTotals(200, 50, {
      taxMode: 'exclusive', taxPercent: 9, serviceChargePercent: 10, taxLabel: 'GST',
    });
    const lines = taxBreakdownLines(t);
    expect(lines.map(l => l.label)[0]).toContain('Discount');
    expect(lines.some(l => l.label.includes('Service Charge (10%)'))).toBe(true);
    expect(lines.some(l => l.label.includes('GST (9%)'))).toBe(true);
  });

  it('marks inclusive tax clearly so staff do not add it again', () => {
    const t = computeBillTotals(100, 0, { taxMode: 'inclusive', taxPercent: 9 });
    expect(taxBreakdownLines(t).some(l => l.label.includes('inclusive'))).toBe(true);
  });
});
