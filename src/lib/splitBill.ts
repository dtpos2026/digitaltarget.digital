// ============================================================
// v1.6.1 — SPLIT BILL ENGINE (client feedback #2, item 4)
//
// Three ways to split, per the client:
//   • EQUAL      — N barabar hisse (rounding ka farq aakhri hisse me)
//   • BY ITEMS   — har item kisi share ko assign; share = uske items ka total
//   • BY AMOUNTS — manually likhe hue amounts (validate: sum == bill)
//
// Pure module — no React, no storage. Money maths lives here so it can be
// tested against hand-checked numbers; the UI only collects choices.
// ============================================================
import { round2 } from './taxEngine';
import type { CartItem } from './types';

export interface SplitShare {
  /** 1-based label shown to staff: "Share 1", "Share 2"... */
  index: number;
  amount: number;
  /** Payment method chosen for this share (cash/card/online/custom). */
  method: string;
  accountId?: string;
  accountName?: string;
}

/**
 * Divide `total` into `n` equal shares.
 * Every share is a clean 2-dp amount; the LAST share absorbs the rounding
 * remainder so the shares always sum to exactly the bill.
 * e.g. 100 / 3 → 33.33, 33.33, 33.34
 */
export function splitEqual(total: number, n: number): number[] {
  const t = Math.max(0, round2(Number(total) || 0));
  const count = Math.max(1, Math.floor(Number(n) || 1));
  if (t === 0) return Array(count).fill(0);
  const base = Math.floor((t / count) * 100) / 100;
  const shares = Array(count).fill(base);
  shares[count - 1] = round2(t - base * (count - 1));
  return shares;
}

/**
 * Split by items: `assignment` maps cart-line id → share index (0-based).
 * Unassigned lines go to share 0. Returns one amount per share, sized to
 * the highest share index used (minimum 1 share).
 * NOTE: item splits divide the ITEM money; whole-bill extras (service
 * charge / tax) are spread proportionally so the shares still sum to the
 * grand total the customer actually owes.
 */
export function splitByItems(
  items: CartItem[],
  assignment: Record<string, number>,
  grandTotal: number,
): number[] {
  const lines = items || [];
  const maxIdx = Math.max(0, ...Object.values(assignment).map(v => Math.max(0, Math.floor(v))));
  const shares = Array(maxIdx + 1).fill(0);
  let itemsSum = 0;
  for (const it of lines) {
    const idx = Math.min(maxIdx, Math.max(0, Math.floor(assignment[it.id] ?? 0)));
    const amt = it.lineTotal || 0;
    shares[idx] += amt;
    itemsSum += amt;
  }
  const target = Math.max(0, round2(Number(grandTotal) || 0));
  if (itemsSum <= 0) {
    // No item money (e.g. all zero-priced) — fall back to equal split.
    return splitEqual(target, shares.length);
  }
  // Scale so extras (service charge/tax/discount) are shared proportionally.
  const scaled = shares.map(s => round2((s / itemsSum) * target));
  // Fix rounding drift on the last non-zero share.
  const drift = round2(target - scaled.reduce((a, b) => a + b, 0));
  if (drift !== 0) {
    for (let i = scaled.length - 1; i >= 0; i--) {
      if (scaled[i] > 0 || i === 0) { scaled[i] = round2(scaled[i] + drift); break; }
    }
  }
  return scaled;
}

/** Validate manual amounts: all > 0 and summing exactly to the bill (±0.01). */
export function validateSplitAmounts(amounts: number[], total: number): {
  ok: boolean;
  sum: number;
  diff: number;   // + means this much short, − means this much over
  error?: string;
} {
  const clean = (amounts || []).map(a => round2(Number(a) || 0));
  const sum = round2(clean.reduce((a, b) => a + b, 0));
  const t = round2(Number(total) || 0);
  const diff = round2(t - sum);
  if (clean.length === 0) return { ok: false, sum, diff, error: 'No shares' };
  if (clean.some(a => a < 0)) return { ok: false, sum, diff, error: 'Amount cannot be negative' };
  if (clean.some(a => a === 0)) return { ok: false, sum, diff, error: 'Every share must be greater than 0' };
  if (Math.abs(diff) > 0.01) {
    return {
      ok: false, sum, diff,
      error: diff > 0 ? `Rs.${diff.toFixed(2)} short` : `Rs.${Math.abs(diff).toFixed(2)} over`,
    };
  }
  return { ok: true, sum, diff: 0 };
}

/** Build the final payment entries a settle flow consumes. */
export function sharesToPayments(shares: SplitShare[]): {
  payments: { method: string; amount: number; accountId?: string; accountName?: string }[];
  /** 'split' when shares use multiple methods, else that single method. */
  primaryMethod: string;
} {
  const payments = shares
    .filter(s => (s.amount || 0) > 0)
    .map(s => ({
      method: s.method || 'cash',
      amount: round2(s.amount),
      ...(s.accountId ? { accountId: s.accountId, accountName: s.accountName } : {}),
    }));
  const methods = new Set(payments.map(p => p.method));
  return { payments, primaryMethod: methods.size === 1 ? payments[0]?.method || 'cash' : 'split' };
}
