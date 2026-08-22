// ============================================================
// v1.26.0 — STOCK LEDGER (idempotent, deterministic, conflict-safe)
//
// WHY
// Inventory used to be a blind last-write-wins counter: two tills selling
// the same product at the same time could overwrite each other's quantity,
// and a retried/replayed sale could deduct twice. This module turns every
// stock change into an append-only MOVEMENT with a deterministic id.
//
// GUARANTEES
//   1. Every movement carries a unique, deterministic `movementId`
//      (e.g. `sale:<orderId>:<itemId>`). Replaying the same movement is a
//      no-op — no double deduction after a crash, retry or duplicate sync.
//   2. Stock is DERIVABLE: quantity == opening + Σ(signed movements).
//      `recomputeFromLedger()` is deterministic and order-independent.
//   3. Movements are additive rows (stockLogs), so two devices merging
//      their queues ADD their movements instead of overwriting a counter.
//   4. Negative stock is never created silently — it is clamped and the
//      movement is flagged `needsReview` with the shortfall recorded.
//
// COMPATIBILITY
// No schema change. `stockLogs` is already a JSONB document collection and
// `movementId` / `refType` / `refId` / `balanceAfter` are optional fields on
// the document. Legacy logs without them keep working.
// ============================================================

import type { StockLog, InventoryItem } from './types';

export type MovementRef =
  | 'sale' | 'refund' | 'wastage' | 'receiving' | 'adjustment' | 'manual' | 'transfer';

export interface StockMovement extends StockLog {
  /** Deterministic idempotency key. Absent on legacy (pre-v1.26) rows. */
  movementId?: string;
  refType?: MovementRef;
  refId?: string;
  deviceId?: string;
  /** Signed delta actually applied to the item (+in / -out). */
  delta?: number;
  balanceAfter?: number;
  /** Set when the movement would have driven stock below zero. */
  needsReview?: boolean;
  shortfall?: number;
}

/** Deterministic movement id — same inputs always produce the same key. */
export function movementIdFor(
  refType: MovementRef, refId: string, itemId: string, seq: number | string = 0,
): string {
  return `${refType}:${refId}:${itemId}:${seq}`;
}

/** Signed delta for a (type, qty) pair. `out`/`sale` consume, `in` adds. */
export function signedDelta(type: StockLog['type'], qty: number): number {
  const n = Number(qty) || 0;
  if (type === 'in') return Math.abs(n);
  if (type === 'out' || type === 'sale') return -Math.abs(n);
  return n; // 'adjustment' — caller supplies the sign deliberately
}

/** True when this exact movement was already applied. */
export function isDuplicateMovement(logs: StockMovement[], movementId?: string): boolean {
  if (!movementId) return false;
  return logs.some(l => l.movementId === movementId);
}

/**
 * Deterministic balance for one item from its movement ledger.
 * `opening` is the quantity before the first ledger row we know about.
 */
export function recomputeFromLedger(
  itemId: string, logs: StockMovement[], opening = 0,
): number {
  let bal = Number(opening) || 0;
  for (const l of logs) {
    if (l.inventoryItemId !== itemId) continue;
    bal += typeof l.delta === 'number' ? l.delta : signedDelta(l.type, l.quantity);
  }
  return Math.round(bal * 1e6) / 1e6;
}

export interface ApplyResult {
  applied: boolean;
  duplicate: boolean;
  delta: number;
  balanceAfter: number;
  needsReview: boolean;
  shortfall: number;
}

/**
 * Pure calculation of a movement against a current quantity.
 * Kept pure so it is unit-testable and reusable by the store and by any
 * future server-side validator.
 */
export function planMovement(
  current: number, type: StockLog['type'], qty: number, allowNegative = false,
): ApplyResult {
  const delta = signedDelta(type, qty);
  const raw = (Number(current) || 0) + delta;
  if (raw < 0 && !allowNegative) {
    return {
      applied: true, duplicate: false, delta: -(Number(current) || 0),
      balanceAfter: 0, needsReview: true, shortfall: Math.round(-raw * 1e6) / 1e6,
    };
  }
  return {
    applied: true, duplicate: false, delta,
    balanceAfter: Math.round(raw * 1e6) / 1e6, needsReview: false, shortfall: 0,
  };
}

/** Ledger vs stored-quantity drift report (read-only; never auto-corrects). */
export function ledgerHealth(
  inventory: InventoryItem[], logs: StockMovement[],
): { itemId: string; name: string; stored: number; ledger: number; drift: number }[] {
  const out: { itemId: string; name: string; stored: number; ledger: number; drift: number }[] = [];
  for (const item of inventory) {
    const rows = logs.filter(l => l.inventoryItemId === item.id);
    if (!rows.length) continue;
    // Opening = stored quantity minus everything the ledger accounts for.
    const movement = recomputeFromLedger(item.id, rows, 0);
    const stored = Number(item.quantity) || 0;
    out.push({
      itemId: item.id, name: item.name, stored,
      ledger: movement, drift: Math.round((stored - movement) * 1e6) / 1e6,
    });
  }
  return out;
}
