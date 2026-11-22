// v1.134.0 — "Count the drawer" (design SW-24): notes by denomination × how many, the total, and what it says about the till.
// Pure. The notes a till holds depend on the country, so the list follows the restaurant's currency (the owner can still type the
// total by hand, or add loose coins under "Other").

const NOTES: Record<string, number[]> = {
  PKR: [5000, 1000, 500, 100, 50, 20, 10],
  INR: [500, 200, 100, 50, 20, 10],
  BDT: [1000, 500, 200, 100, 50, 20, 10],
  AED: [500, 200, 100, 50, 20, 10, 5],
  SAR: [500, 200, 100, 50, 20, 10, 5],
  USD: [100, 50, 20, 10, 5, 1],
  CAD: [100, 50, 20, 10, 5],
  AUD: [100, 50, 20, 10, 5],
  SGD: [100, 50, 10, 5, 2],
  GBP: [50, 20, 10, 5],
  EUR: [200, 100, 50, 20, 10, 5],
};

/** The denominations to count for a currency, largest first. An unknown currency gets the usual decimal run. */
export function denominationsFor(code?: string): number[] {
  return (NOTES[String(code || 'PKR').toUpperCase()] || [1000, 500, 100, 50, 20, 10, 5, 1]).slice();
}

export type DenomCounts = Record<string, string | number | undefined>;

const whole = (v: unknown): number => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

/** One row: the denomination times the whole number typed (a fraction, a negative or text counts as nothing). */
export function lineTotal(denom: number, count: unknown): number { return denom * whole(count); }

/** Everything counted: the notes, plus loose cash typed under Other. */
export function countedTotal(counts: DenomCounts, other?: unknown): number {
  let t = 0;
  for (const [d, c] of Object.entries(counts)) t += lineTotal(Number(d), c);
  const o = Number(other);
  return t + (Number.isFinite(o) && o > 0 ? o : 0);
}

/** True once anything has been typed, so a zero total can still mean "counted: nothing there". */
export function hasCounted(counts: DenomCounts, other?: unknown): boolean {
  return Object.values(counts).some(v => String(v ?? '').trim() !== '') || String(other ?? '').trim() !== '';
}

/** Counted minus expected, rounded to the smallest unit the till deals in. */
export function varianceOf(counted: number, expected: number): number {
  return Math.round((counted - expected) * 100) / 100;
}
