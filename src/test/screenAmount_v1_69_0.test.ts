// v1.69.0 — the POS panels followed no currency: "PKR" was typed by hand.
// A restaurant set to SAR still saw rupees on its total. screenAmount() follows the
// restaurant's currency — and leaves a PKR install byte-for-byte as it was.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { screenAmount, setActiveCurrency, formatMoney } from '@/lib/currency';

afterEach(() => setActiveCurrency('PKR'));

describe('screenAmount', () => {
  it('PKR keeps the exact wording it always had', () => {
    setActiveCurrency('PKR');
    expect(screenAmount(1952)).toBe('PKR 1,952');
    expect(screenAmount(0)).toBe('PKR 0');
    expect(screenAmount(1234567)).toBe('PKR 1,234,567');
    expect(screenAmount(1952)).toBe(`PKR ${(1952).toLocaleString()}`);   // the old expression, unchanged
  });
  it('another currency uses its own format and never says PKR', () => {
    setActiveCurrency('SAR');
    const out = screenAmount(1952);
    expect(out).not.toContain('PKR');
    expect(out).toBe(formatMoney(1952));
  });
  it('tolerates empty and string input (it is display only)', () => {
    setActiveCurrency('PKR');
    expect(screenAmount(undefined)).toBe('PKR 0');
    expect(screenAmount(null)).toBe('PKR 0');
    expect(screenAmount('250')).toBe('PKR 250');
  });
});

describe('the POS panels use it', () => {
  const src = readFileSync('src/pages/POSScreen.tsx', 'utf8');
  it('no visible amount is built from a hand-typed "PKR" any more', () => {
    // data keys and labels ('pkr' discount mode, "Manual PKR", the "Price (PKR)" placeholder) are not amounts
    const handTyped = src.split('\n').filter(l =>
      /PKR \$\{|PKR \{/.test(l) && !l.trim().startsWith('//'));
    expect(handTyped).toEqual([]);
  });
  it('the cart total goes through screenAmount', () => {
    expect(src).toContain('screenAmount(grandTotal)');
    expect(src).toContain('screenAmount(subtotal)');
  });
});
