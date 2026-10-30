// ============================================================================
// Items sold by weight — the arithmetic, in one place
//
// This is the calculation POSScreen.applyNumpadValue() already did inline,
// moved out unchanged so the new weight panel and the tests share it:
//
//     kg     = value (KG) | value / 1000 (Gram) | value * 0.25 (Pao)
//     grams  = round(kg * 1000)
//     price  = round(kg * ratePerKg)         whole rupees, as before
//
// New: "by amount". The customer says "give me 500 rupees of mutton" instead
// of a weight, so the weight is derived from the money:
//
//     kg     = amount / ratePerKg
//     price  = round(amount)                 the customer pays what they asked
//     grams  = round(kg * 1000)
//
// The cart line that results has exactly the same shape either way
// (pricingType 'weight', quantity 1, weightGrams, lineTotal = price, and the
// note "<kg to 2 dp> KG" that receipts and KOTs already read), so nothing
// downstream — tax, discounts, stock, reports, printing — can tell which way
// the weight was entered.
// ============================================================================

export type WeightUnit = 'KG' | 'Gram' | 'Pao';

export interface WeightLine {
  /** Exact weight in kilograms (not rounded). */
  kg: number;
  /** Whole grams, as stored on the cart line (`weightGrams`). */
  grams: number;
  /** Whole-rupee line price. */
  price: number;
  /** The note the cart line carries, e.g. "0.50 KG". */
  note: string;
}

/** Convert an entered weight to kilograms. */
export function toKg(value: number, unit: WeightUnit): number {
  if (unit === 'Gram') return value / 1000;
  if (unit === 'Pao') return value * 0.25;
  return value;
}

const usable = (n: number) => Number.isFinite(n) && n > 0;

/** A line from a weight the customer asked for. Null if the weight is not a positive number. */
export function lineFromWeight(value: number, unit: WeightUnit, ratePerKg: number): WeightLine | null {
  if (!usable(value)) return null;
  const kg = toKg(value, unit);
  return {
    kg,
    grams: Math.round(kg * 1000),
    price: Math.round(kg * (Number(ratePerKg) || 0)),
    note: `${kg.toFixed(2)} KG`,
  };
}

/**
 * A line from an amount of money the customer asked for. Null if the amount is
 * not positive, or if the item has no usable rate (a weight cannot be derived
 * from money by dividing by zero).
 */
export function lineFromAmount(amount: number, ratePerKg: number): WeightLine | null {
  if (!usable(amount) || !usable(Number(ratePerKg))) return null;
  const kg = amount / Number(ratePerKg);
  return {
    kg,
    grams: Math.round(kg * 1000),
    price: Math.round(amount),
    note: `${kg.toFixed(2)} KG`,
  };
}

/** Quick-pick values shown above the keypad, per entry mode and unit. */
export const WEIGHT_QUICK: Record<WeightUnit, number[]> = {
  KG: [0.25, 0.5, 1, 1.5, 2, 5],
  Gram: [100, 250, 500, 750, 1000],
  Pao: [1, 2, 3, 4],
};
export const AMOUNT_QUICK: number[] = [100, 200, 500, 1000, 2000];

/** Longest entry the keypad accepts — keeps a stray key-hold from building an absurd number. */
const MAX_LEN = 8;

/** Apply one keypad key (a digit, '.', or 'DEL') to the entry string. Pure, so it can be tested. */
export function applyWeightKey(prev: string, key: string): string {
  if (key === 'DEL') return prev.slice(0, -1);
  if (key === '.') return prev.includes('.') ? prev : (prev === '' ? '0.' : prev + '.');
  if (!/^\d$/.test(key)) return prev;
  if (prev.length >= MAX_LEN) return prev;
  if (prev === '0') return key;
  return prev + key;
}

