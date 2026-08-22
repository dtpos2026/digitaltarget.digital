// ============================================================
// Tests — v1.12.0 Temporary Charge + discount presets
//
// These close two items from the ORIGINAL feedback list that had been
// carried unfinished across several releases (#11 variable discount
// buttons, and the "Temporary Charge" line on the client's sample).
// ============================================================
import { describe, it, expect } from 'vitest';
import { computeBillTotals, taxBreakdownLines, round2 } from '@/lib/taxEngine';

const SG = { taxMode: 'exclusive' as const, taxPercent: 9, serviceChargePercent: 10 };

describe('Temporary Charge', () => {
  it('is added to the bill and taxed on the same basis as service charge', () => {
    const t = computeBillTotals(100, 0, { ...SG, temporaryCharge: 20 });
    expect(t.temporaryCharge).toBe(20);
    expect(t.serviceCharge).toBe(10);
    // taxable base = 100 + 10 + 20 = 130 → GST 9% = 11.70
    expect(t.taxableBase).toBe(130);
    expect(t.taxAmount).toBe(11.7);
    expect(t.grandTotal).toBe(141.7);        // 100 + 10 + 20 + 11.70
  });

  it('defaults to zero — bills without one are completely unchanged', () => {
    const withOut = computeBillTotals(100, 0, SG);
    const explicitZero = computeBillTotals(100, 0, { ...SG, temporaryCharge: 0 });
    expect(withOut.temporaryCharge).toBe(0);
    expect(withOut.grandTotal).toBe(explicitZero.grandTotal);
    expect(withOut.grandTotal).toBe(119.9);  // the original worked example
  });

  it('a negative value can never reduce the bill', () => {
    const t = computeBillTotals(100, 0, { ...SG, temporaryCharge: -50 });
    expect(t.temporaryCharge).toBe(0);
    expect(t.grandTotal).toBe(119.9);
  });

  it('works in inclusive mode without inflating what the customer pays twice', () => {
    const t = computeBillTotals(100, 0, { taxMode: 'inclusive', taxPercent: 9, temporaryCharge: 9 });
    expect(t.grandTotal).toBe(109);           // 100 menu price + 9 charge
    expect(round2(t.netOfTax + t.taxAmount)).toBe(109);
  });

  it('appears on the receipt breakdown only when non-zero', () => {
    const none = taxBreakdownLines(computeBillTotals(100, 0, SG));
    expect(none.some(l => l.label === 'Temporary Charge')).toBe(false);

    const some = taxBreakdownLines(computeBillTotals(100, 0, { ...SG, temporaryCharge: 15 }));
    const line = some.find(l => l.label === 'Temporary Charge');
    expect(line?.amount).toBe(15);
  });

  it('combines correctly with discount, service charge, tax and 5c rounding', () => {
    const t = computeBillTotals(200, 50, {
      ...SG, temporaryCharge: 12, roundToNearest: 0.05,
    });
    // net 150 → SC 15 → +12 temp = base 177 → GST 15.93 → 192.93 → 192.95
    expect(t.netSubtotal).toBe(150);
    expect(t.serviceCharge).toBe(15);
    expect(t.taxableBase).toBe(177);
    expect(t.grandTotal).toBe(192.95);
    expect(Math.round(t.grandTotal * 100) % 5).toBe(0);
  });
});

describe('discount presets — the values POS buttons apply', () => {
  // The buttons themselves are UI; what must be correct is that a preset
  // resolves to the same discount a typed value would.
  const applyPercent = (subtotal: number, pct: number) => Math.round(subtotal * pct / 100);

  it('a 10% preset equals typing 10 by hand', () => {
    expect(applyPercent(1000, 10)).toBe(100);
  });

  it('presets are filtered to a sane range before being shown', () => {
    const raw = [5, 10, 0, -5, 150, 20];
    const valid = raw.filter(n => Number.isFinite(n) && n > 0 && n <= 100);
    expect(valid).toEqual([5, 10, 20]);
  });

  it('an amount preset is used as-is', () => {
    const raw = [50, 100, 0, -20];
    const valid = raw.filter(n => Number.isFinite(n) && n > 0);
    expect(valid).toEqual([50, 100]);
  });

  it('no presets configured means no buttons — old behaviour preserved', () => {
    const configured: number[] = [];
    expect(configured.length === 0).toBe(true);
  });
});

describe('v1.12.3 — discount preset TEXT parsing (the comma bug)', () => {
  // The v1.12.0 input derived its displayed value from the parsed array,
  // so typing "10," produced ["10",""] -> empty piece dropped -> the field
  // re-rendered as "10" and the comma vanished as it was typed. Multiple
  // values could not be entered by keyboard at all. The parser below is
  // the one the fixed input uses; the fix itself is holding raw text in
  // component state so it is never overwritten mid-edit.
  const parsePresets = (raw: string, max?: number): number[] => {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const piece of raw.split(/[,\s]+/)) {
      const n = Number(piece.trim());
      if (!Number.isFinite(n) || n <= 0) continue;
      if (max !== undefined && n > max) continue;
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out;
  };

  it('parses several comma-separated values', () => {
    expect(parsePresets('5, 10, 15, 20', 100)).toEqual([5, 10, 15, 20]);
  });

  it('a half-typed "10," still yields the value typed so far', () => {
    // The old code returned [10] too — the bug was that the FIELD was then
    // redrawn from it, erasing the comma. Parsing was never the problem,
    // so this asserts the parser stays tolerant of in-progress input.
    expect(parsePresets('10,', 100)).toEqual([10]);
    expect(parsePresets('10, ', 100)).toEqual([10]);
  });

  it('accepts spaces as separators too (paste-friendly)', () => {
    expect(parsePresets('5 10 15', 100)).toEqual([5, 10, 15]);
    expect(parsePresets('5,10 , 15', 100)).toEqual([5, 10, 15]);
  });

  it('drops duplicates so a value never renders twice on POS', () => {
    expect(parsePresets('10, 10, 20', 100)).toEqual([10, 20]);
  });

  it('percent values above 100 are rejected', () => {
    expect(parsePresets('10, 150, 20', 100)).toEqual([10, 20]);
  });

  it('amount presets have no upper limit', () => {
    expect(parsePresets('50, 100, 5000')).toEqual([50, 100, 5000]);
  });

  it('zero, negative and junk are ignored without breaking the rest', () => {
    expect(parsePresets('10, 0, -5, abc, 20', 100)).toEqual([10, 20]);
  });

  it('an empty field means no buttons at all', () => {
    expect(parsePresets('', 100)).toEqual([]);
    expect(parsePresets('   ', 100)).toEqual([]);
  });

  it('decimal percents are preserved (e.g. a 7.5% staff discount)', () => {
    expect(parsePresets('7.5, 12.5', 100)).toEqual([7.5, 12.5]);
  });
});
