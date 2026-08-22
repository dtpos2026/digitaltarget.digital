// ============================================================
// Tests — v1.9.1 cash rounding + ordering
//
// Singapore withdrew 1c and 2c coins, so a cash bill settles to the
// nearest 5c. The tax filed with IRAS must NOT move — only the amount
// the customer hands over. These tests lock that separation.
// ============================================================
import { describe, it, expect } from 'vitest';
import { computeBillTotals, round2 } from '@/lib/taxEngine';

const SG = { taxMode: 'exclusive' as const, taxPercent: 9, serviceChargePercent: 10 };

describe('nearest-0.05 rounding (Singapore)', () => {
  it('the receipt in the field: 260 → SC 26 → GST 25.74 → 311.74', () => {
    const t = computeBillTotals(260, 0, SG);
    expect(t.serviceCharge).toBe(26);
    expect(t.taxAmount).toBe(25.74);
    expect(t.grandTotal).toBe(311.74);          // unrounded baseline
  });

  it('with 5c rounding that same bill settles to 311.75', () => {
    const t = computeBillTotals(260, 0, { ...SG, roundToNearest: 0.05 });
    expect(t.grandTotal).toBe(311.75);
    expect(t.roundingAdjustment).toBeCloseTo(0.01, 2);
  });

  it('rounds DOWN when nearer the lower 5c', () => {
    // 100 → SC 10 → GST 9.90 → 119.90 is already a 5c multiple
    expect(computeBillTotals(100, 0, { ...SG, roundToNearest: 0.05 }).grandTotal).toBe(119.9);
    // craft a total ending .72 → nearest 5c is .70
    const t = computeBillTotals(0, 0, { taxMode: 'none', roundToNearest: 0.05, legacyFlatTax: 10.72 });
    expect(t.grandTotal).toBe(10.7);
    expect(t.roundingAdjustment).toBeCloseTo(-0.02, 2);
  });

  it('TAX IS NEVER CHANGED by cash rounding — only the payable total moves', () => {
    const plain = computeBillTotals(260, 0, SG);
    const rounded = computeBillTotals(260, 0, { ...SG, roundToNearest: 0.05 });
    expect(rounded.taxAmount).toBe(plain.taxAmount);        // filed figure intact
    expect(rounded.serviceCharge).toBe(plain.serviceCharge);
    expect(rounded.grandTotal).not.toBe(plain.grandTotal);
  });

  it('every rounded total is an exact multiple of 5 cents', () => {
    for (const sub of [13.31, 47.77, 99.99, 250.03, 1610.44]) {
      const t = computeBillTotals(sub, 0, { ...SG, roundToNearest: 0.05 });
      const cents = Math.round(t.grandTotal * 100);
      expect(cents % 5).toBe(0);
    }
  });

  it('the adjustment always reconciles the books', () => {
    for (const sub of [13.31, 47.77, 99.99, 250.03]) {
      const plain = computeBillTotals(sub, 0, SG);
      const rounded = computeBillTotals(sub, 0, { ...SG, roundToNearest: 0.05 });
      expect(round2(plain.grandTotal + rounded.roundingAdjustment)).toBe(rounded.grandTotal);
    }
  });

  it('never rounds by more than half the increment', () => {
    for (const sub of [13.31, 47.77, 99.99, 250.03, 7.07]) {
      const t = computeBillTotals(sub, 0, { ...SG, roundToNearest: 0.05 });
      expect(Math.abs(t.roundingAdjustment)).toBeLessThanOrEqual(0.025 + 0.0001);
    }
  });

  it('is OFF by default — no existing restaurant is affected', () => {
    const t = computeBillTotals(311.74, 0, {});
    expect(t.grandTotal).toBe(311.74);
    expect(t.roundingAdjustment).toBe(0);
  });

  it('supports other increments (0.10 and whole units)', () => {
    expect(computeBillTotals(0, 0, { taxMode: 'none', legacyFlatTax: 10.74, roundToNearest: 0.10 }).grandTotal).toBe(10.7);
    expect(computeBillTotals(0, 0, { taxMode: 'none', legacyFlatTax: 10.74, roundToNearest: 1 }).grandTotal).toBe(11);
  });

  it('a rounding line appears on the receipt breakdown only when non-zero', () => {
    const noRound = computeBillTotals(100, 0, SG);
    expect(noRound.roundingAdjustment).toBe(0);
    const withRound = computeBillTotals(260, 0, { ...SG, roundToNearest: 0.05 });
    expect(withRound.roundingAdjustment).not.toBe(0);
  });
});

describe('display ordering', () => {
  // Mirrors the comparator now used by getCategories()/getMenuItems().
  const bySortOrder = <T extends { name: string; sortOrder?: number }>(list: T[]) =>
    [...list].sort((a, b) => {
      const ao = Number.isFinite(a.sortOrder as number) ? (a.sortOrder as number) : 9999;
      const bo = Number.isFinite(b.sortOrder as number) ? (b.sortOrder as number) : 9999;
      return ao !== bo ? ao - bo : String(a.name).localeCompare(String(b.name));
    });

  it('manual order wins over insertion order', () => {
    const out = bySortOrder([
      { name: 'Drinks', sortOrder: 3 },
      { name: 'Starters', sortOrder: 1 },
      { name: 'Mains', sortOrder: 2 },
    ]);
    expect(out.map(c => c.name)).toEqual(['Starters', 'Mains', 'Drinks']);
  });

  it('un-ordered legacy rows fall to the end, alphabetically', () => {
    const out = bySortOrder([
      { name: 'Zebra' },
      { name: 'Apple' },
      { name: 'Ordered', sortOrder: 1 },
    ]);
    expect(out.map(c => c.name)).toEqual(['Ordered', 'Apple', 'Zebra']);
  });

  it('ties break alphabetically so the order is never random', () => {
    const out = bySortOrder([
      { name: 'Beta', sortOrder: 1 },
      { name: 'Alpha', sortOrder: 1 },
    ]);
    expect(out.map(c => c.name)).toEqual(['Alpha', 'Beta']);
  });
});
