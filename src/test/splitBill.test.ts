// ============================================================
// Tests — Split Bill engine (v1.6.1, feedback #2 item 4)
// Money maths — every number hand-checked.
// ============================================================
import { describe, it, expect } from 'vitest';
import { splitEqual, splitByItems, validateSplitAmounts, sharesToPayments } from '@/lib/splitBill';
import type { CartItem } from '@/lib/types';

const item = (id: string, lineTotal: number): CartItem => ({
  id, menuItemId: `m-${id}`, name: id, pricingType: 'fixed',
  price: lineTotal, quantity: 1, lineTotal, note: '',
} as CartItem);

describe('splitEqual', () => {
  it('divides evenly when it divides cleanly', () => {
    expect(splitEqual(300, 3)).toEqual([100, 100, 100]);
  });

  it('100 / 3 → 33.33 + 33.33 + 33.34 (last share absorbs the paisa)', () => {
    const s = splitEqual(100, 3);
    expect(s).toEqual([33.33, 33.33, 33.34]);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });

  it('always sums exactly to the bill (rounding never loses money)', () => {
    for (const [total, n] of [[999.99, 7], [1610, 3], [88.4, 6], [5001, 9]] as const) {
      const s = splitEqual(total, n);
      expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(total, 2);
      expect(s).toHaveLength(n);
    }
  });

  it('guards junk input: n<1 becomes 1, negative total becomes 0', () => {
    expect(splitEqual(100, 0)).toEqual([100]);
    expect(splitEqual(-50, 2)).toEqual([0, 0]);
  });
});

describe('splitByItems', () => {
  it('assigns each item to its share', () => {
    const items = [item('a', 280), item('b', 600), item('c', 250)];
    const shares = splitByItems(items, { a: 0, b: 1, c: 0 }, 1130);
    expect(shares).toEqual([530, 600]);
  });

  it('unassigned items land in share 0', () => {
    const items = [item('a', 100), item('b', 200)];
    const shares = splitByItems(items, { b: 1 }, 300);
    expect(shares).toEqual([100, 200]);
  });

  it('spreads service charge + tax proportionally so shares sum to the GRAND total', () => {
    // items 100 + 300 = 400; grand total with SC+GST = 480
    const items = [item('a', 100), item('b', 300)];
    const shares = splitByItems(items, { a: 0, b: 1 }, 480);
    expect(shares[0]).toBeCloseTo(120, 2);   // 100/400 × 480
    expect(shares[1]).toBeCloseTo(360, 2);   // 300/400 × 480
    expect(shares[0] + shares[1]).toBeCloseTo(480, 2);
  });

  it('rounding drift lands on the last non-zero share, total stays exact', () => {
    const items = [item('a', 1), item('b', 1), item('c', 1)];
    const shares = splitByItems(items, { a: 0, b: 1, c: 2 }, 100);
    expect(shares.reduce((x, y) => x + y, 0)).toBeCloseTo(100, 2);
  });

  it('all items in one share = that share carries the whole bill', () => {
    const items = [item('a', 500), item('b', 500)];
    const shares = splitByItems(items, { a: 0, b: 0 }, 1000);
    expect(shares).toEqual([1000]);
  });
});

describe('validateSplitAmounts', () => {
  it('accepts amounts summing exactly to the bill', () => {
    expect(validateSplitAmounts([500, 300, 200], 1000).ok).toBe(true);
  });

  it('rejects a shortfall and says HOW MUCH is missing', () => {
    const v = validateSplitAmounts([500, 300], 1000);
    expect(v.ok).toBe(false);
    expect(v.diff).toBe(200);
    expect(v.error).toContain('200');
  });

  it('rejects overpayment with the excess amount', () => {
    const v = validateSplitAmounts([700, 400], 1000);
    expect(v.ok).toBe(false);
    expect(v.error).toContain('100');
  });

  it('rejects zero or negative shares', () => {
    expect(validateSplitAmounts([1000, 0], 1000).ok).toBe(false);
    expect(validateSplitAmounts([1100, -100], 1000).ok).toBe(false);
  });

  it('tolerates a 1-paisa float artefact', () => {
    expect(validateSplitAmounts([33.33, 33.33, 33.34], 100).ok).toBe(true);
  });
});

describe('sharesToPayments', () => {
  it('multiple methods → primary "split", every entry preserved', () => {
    const r = sharesToPayments([
      { index: 1, amount: 500, method: 'cash' },
      { index: 2, amount: 300, method: 'card' },
      { index: 3, amount: 200, method: 'online', accountId: 'acc1', accountName: 'JazzCash' },
    ]);
    expect(r.primaryMethod).toBe('split');
    expect(r.payments).toHaveLength(3);
    expect(r.payments[2]).toEqual({ method: 'online', amount: 200, accountId: 'acc1', accountName: 'JazzCash' });
  });

  it('single method (all cash shares) → primary stays cash', () => {
    const r = sharesToPayments([
      { index: 1, amount: 50, method: 'cash' },
      { index: 2, amount: 50, method: 'cash' },
    ]);
    expect(r.primaryMethod).toBe('cash');
  });

  it('zero-amount shares are dropped', () => {
    const r = sharesToPayments([
      { index: 1, amount: 100, method: 'cash' },
      { index: 2, amount: 0, method: 'card' },
    ]);
    expect(r.payments).toHaveLength(1);
  });

  it('custom payment type names flow through untouched', () => {
    const r = sharesToPayments([{ index: 1, amount: 100, method: 'NETS' }]);
    expect(r.payments[0].method).toBe('NETS');
    expect(r.primaryMethod).toBe('NETS');
  });
});
