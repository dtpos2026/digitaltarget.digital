// ============================================================================
// ORDER NUMBERING — one number, one bill, never out of order
//
// The old path minted the number from a LOCAL counter on every till. Two
// counters on one branch mean two #42s: the database now refuses the second
// one (unique index per tenant+branch), so the number must come from a single
// authority instead.
//
//   Online  → `next_order_number(tenant, branch)` on the server. Atomic.
//   Offline → the caller falls back to its local counter and marks the bill
//             provisional; on sync a collision is resolved by re-allocating
//             a fresh server number (see resolveOrderNumberCollision).
//
// Billing NEVER blocks on this: the server call races a short timeout.
// ============================================================================

import { sb, isSupabaseConfigured } from './supabase';
import { authTenantId, authBranchId } from './authProvider';

/** How long billing is willing to wait for the authoritative number. */
const ALLOCATE_TIMEOUT_MS = 1500;

/** True when a server-side counter is reachable right now. */
export function canAllocateFromServer(): boolean {
  if (!isSupabaseConfigured()) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return !!authTenantId() && !!authBranchId();
}

/** Ask the server for the next number. Returns null if unavailable/slow. */
export async function allocateServerOrderNumber(): Promise<number | null> {
  if (!canAllocateFromServer()) return null;
  const tenant = authTenantId();
  const branch = authBranchId();

  const call = (async (): Promise<number | null> => {
    try {
      const { data, error } = await sb().rpc('next_order_number', {
        p_tenant: tenant, p_branch: branch,
      });
      if (error) throw error;
      const n = Number(data);
      return Number.isInteger(n) && n > 0 ? n : null;
    } catch (e) {
      console.warn('[orderNumbers] server allocation failed, using local counter', e);
      return null;
    }
  })();

  return Promise.race<number | null>([
    call,
    new Promise<null>((res) => setTimeout(() => res(null), ALLOCATE_TIMEOUT_MS)),
  ]);
}

/** Postgres unique-violation on the per-branch order number index. */
export function isOrderNumberCollision(e: any): boolean {
  const code = String(e?.code ?? '');
  const msg = String(e?.message ?? '');
  return code === '23505' && /orders_unique_number_per_branch|order_number/i.test(msg);
}

// ---------------------------------------------------------------------------
// Renumber notification — the store subscribes so the local copy, the receipt
// and the reports all show the number the cloud actually settled on.
// ---------------------------------------------------------------------------

type RenumberListener = (orderId: string, newNumber: number, oldNumber?: number) => void;
let _listener: RenumberListener | null = null;

export function onOrderRenumbered(fn: RenumberListener): void { _listener = fn; }

export function emitOrderRenumbered(orderId: string, newNumber: number, oldNumber?: number): void {
  try { _listener?.(orderId, newNumber, oldNumber); } catch { /* never break a sync */ }
}
