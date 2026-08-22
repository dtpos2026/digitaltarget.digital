// ============================================================
// v1.26.0 — SYNC RECONCILIATION (read-only, never overwrites)
//
// Answers one question honestly: "is what this till believes the same as
// what the cloud believes?" It NEVER silently repairs a mismatch — it
// reports it, so an operator decides. Everything here is additive: the
// deferred queue, dead-letter store and apply_sync_batch are untouched.
// ============================================================

import { deferredPendingCount, getDeferredOps, getDeadLetterOps, isFlushing } from './deferredSync';

export type SyncState =
  | 'synced' | 'pending' | 'syncing' | 'failed' | 'conflict' | 'needsReview';

export interface SyncHealth {
  state: SyncState;
  online: boolean;
  pending: number;
  failing: number;
  deadLettered: number;
  oldestPendingMs: number;
  lastError?: string;
}

/** Overall device sync state derived from the existing queue — no new state. */
export async function getSyncHealth(): Promise<SyncHealth> {
  const ops = getDeferredOps();
  const dead = await getDeadLetterOps();
  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  const failing = ops.filter(o => (o.attempts || 0) > 0).length;
  const oldest = ops.length ? Date.now() - Math.min(...ops.map(o => o.firstEnqueuedAt)) : 0;
  const lastError = ops.find(o => o.lastError)?.lastError || dead[0]?.lastError;

  let state: SyncState = 'synced';
  if (dead.length) state = 'needsReview';
  else if (failing) state = 'failed';
  else if (isFlushing() && ops.length) state = 'syncing';
  else if (ops.length) state = 'pending';

  return {
    state, online,
    pending: deferredPendingCount(),
    failing,
    deadLettered: dead.length,
    oldestPendingMs: oldest,
    lastError,
  };
}

export interface OrderMismatch {
  orderId: string;
  orderNumber?: number;
  kind: 'missing_in_cloud' | 'missing_locally' | 'total_mismatch' | 'status_mismatch' | 'duplicate_number';
  local?: { total: number; status: string; orderNumber?: number };
  cloud?: { total: number; status: string; orderNumber?: number };
}

interface Cmp { id: string; orderNumber?: number; total: number; status: string }

/**
 * Pure comparison so it is deterministic and unit-testable. The caller
 * supplies the local rows and the cloud rows (from pull_orders_delta).
 * Result is a REPORT — no writes happen anywhere.
 */
export function compareOrders(local: Cmp[], cloud: Cmp[]): OrderMismatch[] {
  const out: OrderMismatch[] = [];
  const cloudById = new Map(cloud.map(o => [o.id, o]));
  const localById = new Map(local.map(o => [o.id, o]));

  for (const l of local) {
    const c = cloudById.get(l.id);
    if (!c) { out.push({ orderId: l.id, orderNumber: l.orderNumber, kind: 'missing_in_cloud', local: l }); continue; }
    if (Math.abs((l.total || 0) - (c.total || 0)) > 0.009) {
      out.push({ orderId: l.id, orderNumber: l.orderNumber, kind: 'total_mismatch', local: l, cloud: c });
    } else if (l.status !== c.status) {
      out.push({ orderId: l.id, orderNumber: l.orderNumber, kind: 'status_mismatch', local: l, cloud: c });
    }
  }
  for (const c of cloud) {
    if (!localById.has(c.id)) {
      out.push({ orderId: c.id, orderNumber: c.orderNumber, kind: 'missing_locally', cloud: c });
    }
  }
  // Two different bills carrying the same printed number is a finance issue.
  const byNumber = new Map<number, string[]>();
  for (const o of [...local, ...cloud]) {
    if (typeof o.orderNumber !== 'number') continue;
    const arr = byNumber.get(o.orderNumber) || [];
    if (!arr.includes(o.id)) arr.push(o.id);
    byNumber.set(o.orderNumber, arr);
  }
  for (const [num, ids] of byNumber) {
    if (ids.length > 1) {
      for (const id of ids) out.push({ orderId: id, orderNumber: num, kind: 'duplicate_number' });
    }
  }
  return out;
}

/** Human label for the badge/UI. */
export function syncStateLabel(s: SyncState): string {
  switch (s) {
    case 'synced': return 'Synced';
    case 'pending': return 'Pending';
    case 'syncing': return 'Syncing';
    case 'failed': return 'Failed';
    case 'conflict': return 'Conflict';
    case 'needsReview': return 'Needs Review';
  }
}
