// ============================================================================
// Stock Count (v1.115.1) — a physical stock-take with the variance posted to the stock ledger.
//
// What every chain does at the month end (and a bakery every week): someone counts the shelves, the software shows what it
// expected, the difference is valued at cost, and — once a manager agrees — the stock is set to what was counted.
//
//   • The expected figure is read at the moment of posting, so after posting the stock IS the counted figure, whatever was sold
//     while counting. Count when the shop is closed to keep that difference honest.
//   • Each correction is one ledger movement with an id of its own (`count:<session>:<item>`), so a double tap, a retry or a second
//     device can never post the same correction twice — the ledger refuses an id it has seen.
//   • An item that was not counted (left empty) is never touched. A counted figure equal to the expected one posts nothing.
//   • The money is the difference × the item's cost (moving average when there is one). Gains and losses are kept apart.
// Pure functions: the page passes the real `adjustStock` in.
// ============================================================================
import type { InventoryItem } from '@/lib/types';

export const costOf = (i: Pick<InventoryItem, 'avgCostPrice' | 'costPrice'>): number => Number(i.avgCostPrice ?? i.costPrice ?? 0) || 0;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** What was typed: '' / undefined = not counted; otherwise a number zero or above. */
export function parseCounted(raw: unknown): number | null {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? r6(n) : null;
}

export interface CountLine {
  itemId: string; name: string; unit: string;
  expected: number; counted: number | null;
  /** counted − expected, or null when not counted */
  diff: number | null;
  /** diff × cost, or null when not counted */
  value: number | null;
}

export function countLines(items: Pick<InventoryItem, 'id' | 'name' | 'unit' | 'baseUnit' | 'quantity' | 'avgCostPrice' | 'costPrice'>[], counts: Record<string, string | number | undefined>): CountLine[] {
  return items.map(i => {
    const counted = parseCounted(counts[i.id]);
    const expected = r6(Number(i.quantity) || 0);
    const diff = counted === null ? null : r6(counted - expected);
    return { itemId: i.id, name: i.name, unit: i.baseUnit || i.unit || '', expected, counted, diff, value: diff === null ? null : r2(diff * costOf(i)) };
  });
}

export interface CountSummary { counted: number; withDifference: number; gains: number; losses: number; net: number }
export function summarize(lines: CountLine[]): CountSummary {
  let counted = 0, withDifference = 0, gains = 0, losses = 0;
  for (const l of lines) {
    if (l.counted === null) continue;
    counted++;
    if (l.diff && Math.abs(l.diff) > 1e-9) {
      withDifference++;
      if ((l.value ?? 0) >= 0) gains += l.value ?? 0; else losses += l.value ?? 0;
    }
  }
  return { counted, withDifference, gains: r2(gains), losses: r2(losses), net: r2(gains + losses) };
}

export interface Posting { itemId: string; name: string; delta: number; movementId: string; note: string }

/** The corrections to post: one per counted item whose figure differs from the expected one. */
export function postingPlan(lines: CountLine[], sessionId: string, label: string): Posting[] {
  return lines
    .filter(l => l.counted !== null && l.diff !== null && Math.abs(l.diff) > 1e-9)
    .map(l => ({
      itemId: l.itemId, name: l.name, delta: l.diff as number, movementId: `count:${sessionId}:${l.itemId}`,
      note: `Stock count ${label} — counted ${l.counted}, expected ${l.expected}`,
    }));
}

export type Adjust = (itemId: string, qty: number, type: 'adjustment', note: string, opts: { movementId: string; refType: 'adjustment'; refId: string; allowNegative?: boolean }) => { applied: boolean; duplicate: boolean };

/**
 * Posts the plan through the ledger. `items` is read again here and the delta is worked out against what the stock is NOW, so that
 * after posting the stock equals the count. Returns how many corrections were applied and how many the ledger already had.
 */
export function postCount(
  lines: CountLine[], sessionId: string, label: string, currentQty: (itemId: string) => number | null, adjust: Adjust,
): { applied: number; duplicates: number; skipped: number } {
  let applied = 0, duplicates = 0, skipped = 0;
  for (const l of lines) {
    if (l.counted === null) { skipped++; continue; }
    const now = currentQty(l.itemId);
    if (now === null) { skipped++; continue; }
    const delta = r6(l.counted - now);
    if (Math.abs(delta) <= 1e-9) { skipped++; continue; }
    const r = adjust(l.itemId, delta, 'adjustment', `Stock count ${label} — counted ${l.counted}, system ${now}`,
      { movementId: `count:${sessionId}:${l.itemId}`, refType: 'adjustment', refId: sessionId });
    if (r.duplicate) duplicates++; else if (r.applied) applied++; else skipped++;
  }
  return { applied, duplicates, skipped };
}

// ---- the draft: a counter must not lose an hour of work to a refresh ----
const KEY = (scope: string) => `dt-stock-count-draft:${scope}`;
export function loadDraft(scope: string): Record<string, string> {
  try { const v = JSON.parse(localStorage.getItem(KEY(scope)) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
export function saveDraft(scope: string, counts: Record<string, string>): void {
  try { if (Object.keys(counts).length) localStorage.setItem(KEY(scope), JSON.stringify(counts)); else localStorage.removeItem(KEY(scope)); } catch { /* storage blocked: the count simply is not remembered */ }
}
