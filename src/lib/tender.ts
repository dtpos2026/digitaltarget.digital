// ============================================================
// v1.15.0 — CASH TENDER SUGGESTIONS
//
// The payment screen offered a fixed ladder of 500 / 1000 / 2000 / 5000 /
// 10000. Those are sensible Pakistani rupee notes and useless anywhere
// else: a Singapore bill of S$9.45 got four buttons no customer would
// ever hand over, so the cashier typed every amount by hand. The client
// reported this as "quick amounts not showing in the payment screen".
//
// Suggestions are now DERIVED FROM THE BILL, so they are correct in every
// currency without any per-country configuration:
//
//   S$9.45   -> 9.45 · 10 · 20 · 50 · 100
//   S$311.74 -> 311.74 · 315 · 320 · 350 · 400 · 500
//   Rs.1610  -> 1610 · 1650 · 1700 · 2000 · 5000
//
// A restaurant can still pin its own ladder in Settings if it prefers
// fixed buttons (e.g. it only ever deals in 50s and 100s).
// ============================================================

/** Note/coin steps that make sense at a given magnitude. */
function stepsFor(due: number): number[] {
  if (due < 20) return [1, 5, 10, 20, 50];
  if (due < 100) return [5, 10, 20, 50, 100];
  if (due < 1_000) return [10, 50, 100, 500, 1_000];
  if (due < 10_000) return [100, 500, 1_000, 5_000, 10_000];
  return [1_000, 5_000, 10_000, 50_000];
}

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/**
 * Build the tender ladder for a bill.
 *
 * The exact amount always comes first — "customer paid exactly" is the
 * single most common case and must be one tap, never typing.
 */
export function suggestTenderAmounts(due: number, max = 6): number[] {
  const amount = Math.max(0, Number(due) || 0);
  if (amount <= 0) return [];

  const exact = Math.round(amount * 100) / 100;
  const out: number[] = [exact];

  for (const step of stepsFor(amount)) {
    const up = roundUpTo(amount, step);
    // Skip anything that is not actually a bigger, distinct note.
    if (up > exact && !out.includes(up)) out.push(up);
    if (out.length >= max) break;
  }

  return out.slice(0, max);
}

/**
 * Resolve which ladder to show: the restaurant's pinned amounts when it
 * configured any, otherwise the derived suggestions. The exact amount is
 * always prepended so it is never missing.
 */
export function tenderLadder(due: number, configured?: number[], max = 6): number[] {
  const amount = Math.max(0, Number(due) || 0);
  const pinned = (configured || []).filter(n => Number.isFinite(n) && n > 0);
  if (pinned.length === 0) return suggestTenderAmounts(amount, max);

  const exact = Math.round(amount * 100) / 100;
  const out = exact > 0 ? [exact] : [];
  for (const v of [...pinned].sort((a, b) => a - b)) {
    if (v > exact && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

/** Change owed for a tendered amount. Never negative. */
export function changeDue(tendered: number, due: number): number {
  return Math.max(0, Math.round(((Number(tendered) || 0) - (Number(due) || 0)) * 100) / 100);
}
