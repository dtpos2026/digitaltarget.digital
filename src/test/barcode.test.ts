// ============================================================
// Tests — v1.14.0 Barcode & QR (retail)
//
// Checksums decide whether a scanned product is recognised at all, so
// they are asserted against real, published barcodes.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  ean13CheckDigit, isValidEan13, isValidEan8, validateCode,
  generateInternalCode, buildWeightBarcode, parseWeightBarcode,
  expandLabels, labelPageCount, LABEL_SHEET_DEFAULT,
} from '@/lib/barcode';

describe('EAN-13 checksum', () => {
  it('computes the check digit of a real product code', () => {
    // 5901234123457 — the standard EAN-13 worked example.
    expect(ean13CheckDigit('590123412345')).toBe(7);
    expect(isValidEan13('5901234123457')).toBe(true);
  });

  it('rejects a code whose check digit is wrong', () => {
    expect(isValidEan13('5901234123456')).toBe(false);
  });

  it('rejects codes of the wrong length', () => {
    expect(isValidEan13('590123412345')).toBe(false);
    expect(isValidEan13('59012341234578')).toBe(false);
    expect(ean13CheckDigit('123')).toBeNull();
  });

  it('validates EAN-8 separately', () => {
    expect(isValidEan8('96385074')).toBe(true);
    expect(isValidEan8('96385075')).toBe(false);
  });
});

describe('code detection — cashier never picks a format', () => {
  it('detects EAN-13 from a valid 13-digit code', () => {
    const r = validateCode('5901234123457');
    expect(r.ok).toBe(true);
    expect(r.format).toBe('EAN13');
  });

  it('flags a 13-digit code with a bad checksum instead of accepting it', () => {
    const r = validateCode('5901234123456');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/checksum/i);
  });

  it('treats a shop-generated alphanumeric code as CODE128', () => {
    const r = validateCode('DTM4X9Q2');
    expect(r.ok).toBe(true);
    expect(r.format).toBe('CODE128');
  });

  it('accepts a 12-digit UPC', () => {
    expect(validateCode('012345678905').format).toBe('UPC');
  });

  it('rejects empty and absurdly long codes', () => {
    expect(validateCode('').ok).toBe(false);
    expect(validateCode('X'.repeat(60)).ok).toBe(false);
  });

  it('trims surrounding whitespace a scanner may append', () => {
    expect(validateCode('  5901234123457  ').normalized).toBe('5901234123457');
  });
});

describe('internal codes for loose items', () => {
  it('are prefixed so they cannot be mistaken for a real EAN', () => {
    const code = generateInternalCode('DT');
    expect(code.startsWith('DT')).toBe(true);
    expect(isValidEan13(code)).toBe(false);
  });

  it('are unique across rapid generation', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateInternalCode()));
    expect(codes.size).toBe(200);
  });
});

describe('weight-embedded barcodes (scale labels)', () => {
  it('builds a valid EAN-13 carrying the weight', () => {
    const code = buildWeightBarcode('00042', 1250);
    expect(code).toHaveLength(13);
    expect(isValidEan13(code)).toBe(true);
  });

  it('reads the item and weight back out', () => {
    const code = buildWeightBarcode('00042', 1250);
    const parsed = parseWeightBarcode(code);
    expect(parsed.isWeightBarcode).toBe(true);
    expect(parsed.grams).toBe(1250);
    expect(parsed.itemCode).toBe('00042');
  });

  it('round-trips a range of weights exactly', () => {
    for (const grams of [1, 250, 999, 5000, 99999]) {
      const parsed = parseWeightBarcode(buildWeightBarcode('00007', grams));
      expect(parsed.grams).toBe(grams);
    }
  });

  it('does NOT mistake an ordinary product barcode for a weighted one', () => {
    expect(parseWeightBarcode('5901234123457').isWeightBarcode).toBe(false);
  });
});

describe('label printing', () => {
  it('expands copies in print order', () => {
    const out = expandLabels([
      { name: 'Rice', code: 'A', copies: 2 },
      { name: 'Dal', code: 'B', copies: 1 },
    ]);
    expect(out.map(l => l.name)).toEqual(['Rice', 'Rice', 'Dal']);
  });

  it('ignores zero and negative copy counts', () => {
    const out = expandLabels([
      { name: 'A', code: 'a', copies: 0 },
      { name: 'B', code: 'b', copies: -3 },
      { name: 'C', code: 'c', copies: 1 },
    ]);
    expect(out).toHaveLength(1);
  });

  it('reports the page count before printing so no roll is wasted', () => {
    expect(labelPageCount(24, LABEL_SHEET_DEFAULT)).toBe(1);   // 3 x 8 = 24
    expect(labelPageCount(25, LABEL_SHEET_DEFAULT)).toBe(2);
    expect(labelPageCount(0, LABEL_SHEET_DEFAULT)).toBe(0);
  });
});
