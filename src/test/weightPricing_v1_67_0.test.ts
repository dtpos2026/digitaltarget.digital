// v1.67.0 — sold-by-weight arithmetic. The weight branch is the same maths the
// POS screen did inline before; these pin it so the move cannot change a price.
import { describe, it, expect } from 'vitest';
import { toKg, lineFromWeight, lineFromAmount, WEIGHT_QUICK, AMOUNT_QUICK } from '@/lib/weightPricing';

describe('weight entered as a weight', () => {
  it('KG: 1.5 kg at 3,600/kg = 5,400 and 1,500 g', () => {
    const l = lineFromWeight(1.5, 'KG', 3600)!;
    expect(l.price).toBe(5400);
    expect(l.grams).toBe(1500);
    expect(l.note).toBe('1.50 KG');
  });
  it('Gram: 250 g at 3,600/kg = 900', () => {
    const l = lineFromWeight(250, 'Gram', 3600)!;
    expect(l.kg).toBeCloseTo(0.25, 10);
    expect(l.price).toBe(900);
    expect(l.grams).toBe(250);
  });
  it('Pao: 3 pao = 0.75 kg = 750 g', () => {
    expect(toKg(3, 'Pao')).toBeCloseTo(0.75, 10);
    const l = lineFromWeight(3, 'Pao', 2000)!;
    expect(l.grams).toBe(750);
    expect(l.price).toBe(1500);
  });
  it('rounds the price to a whole rupee, like the old inline code', () => {
    // 0.333 kg * 1,250 = 416.25 -> 416
    expect(lineFromWeight(0.333, 'KG', 1250)!.price).toBe(416);
  });
  it('the reference screenshot: Rs. 8 per kg', () => {
    expect(lineFromWeight(136, 'KG', 8)!.price).toBe(1088);   // the "huh ... 136 kg ... 1,088" line
  });
  it.each([0, -1, NaN, Infinity])('rejects a weight of %s', (v) => {
    expect(lineFromWeight(v as number, 'KG', 100)).toBeNull();
  });
});

describe('weight derived from an amount', () => {
  it('500 rupees of a 3,600/kg item = 0.14 kg and the customer pays exactly 500', () => {
    const l = lineFromAmount(500, 3600)!;
    expect(l.price).toBe(500);
    expect(l.kg).toBeCloseTo(500 / 3600, 10);
    expect(l.grams).toBe(139);
    expect(l.note).toBe('0.14 KG');
  });
  it('the customer is never charged more or less than the amount entered', () => {
    for (const [amt, rate] of [[100, 7], [999, 1250], [1, 3], [12345, 999]] as const) {
      expect(lineFromAmount(amt, rate)!.price).toBe(amt);
    }
  });
  it('refuses to divide by a missing rate', () => {
    expect(lineFromAmount(500, 0)).toBeNull();
    expect(lineFromAmount(500, NaN)).toBeNull();
    expect(lineFromAmount(500, -5)).toBeNull();
  });
  it.each([0, -10, NaN])('rejects an amount of %s', (v) => {
    expect(lineFromAmount(v as number, 100)).toBeNull();
  });
});

describe('the two entry modes produce the same cart-line shape', () => {
  it('same fields, so nothing downstream can tell them apart', () => {
    const a = lineFromWeight(1, 'KG', 1000)!;
    const b = lineFromAmount(1000, 1000)!;
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(a).toEqual(b);   // 1 kg at 1,000/kg  ==  Rs. 1,000 at 1,000/kg
  });
});

describe('quick picks', () => {
  it('are all positive and ascending', () => {
    for (const list of [...Object.values(WEIGHT_QUICK), AMOUNT_QUICK]) {
      expect(list.every(n => n > 0)).toBe(true);
      expect([...list].sort((x, y) => x - y)).toEqual(list);
    }
  });
});
