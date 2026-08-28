// ============================================================================
// v1.28.4 — retire the seed rows a cloud tenant should never have carried
//
// WHAT WENT WRONG
//
// emptyRuntimeData() was documented as the EMPTY starting shape for a cloud
// tenant, and two of its callers say plainly why it has to be: "Cloud tenants
// must never see default data". It was not empty — it returned seedData(),
// which carries eight default account categories with the FIXED local ids
// 'ac1'..'ac8' and a default admin user 'u-default-admin'.
//
// A fixed local id derives a FIXED cloud uuid (cloudId -> stableUuid hashes the
// id and nothing else), so every restaurant on the platform derived the SAME
// eight primary keys. The first one to sync owned those rows. Every restaurant
// created afterwards upserted onto them: PostgREST sends
// INSERT ... ON CONFLICT (id) DO UPDATE, the conflict fired, and RLS judged the
// update against the other tenant's row —
//
//     new row violates row-level security policy (USING expression)
//     for table "account_categories"
//
// eight at a time, on every 20-second flush, until six attempts each parked
// them in the dead-letter store and the till showed "⚠ Stuck (8)". RLS was
// right and nothing leaked; the rows simply were not this restaurant's to
// write.
//
// WHAT THIS FILE DOES
//
// store.ts no longer ships those rows, and migration 20260828100000 creates
// real per-tenant defaults server-side. Neither of those helps a till that is
// ALREADY carrying the seed rows in its local cache and the eight failures in
// its dead-letter store — it would keep re-queueing them on every refresh.
//
// So, once per restaurant, this drops exactly those seed rows from the local
// cache and forgets their queued and dead-lettered ops. It is deliberately
// narrow:
//
//   * only the ids the seed shipped, never a row the restaurant created;
//   * only when the id is still the seed's own (a renamed category keeps its
//     id, so a row whose NAME was changed is left alone — it is the
//     restaurant's data now, and it will sync under the same broken id, which
//     is a smaller harm than deleting an edit);
//   * only on the cloud backend, where the collision exists at all;
//   * only once per tenant, recorded in localStorage.
//
// Nothing is uploaded and nothing is deleted server-side.
// ============================================================================
import { discardDeferredOpsFor } from './deferredSync';

/** The rows seedData() shipped, by collection. */
export const SHIPPED_SEED_IDS: Readonly<Record<string, readonly string[]>> = {
  accountCategories: ['ac1', 'ac2', 'ac3', 'ac4', 'ac5', 'ac6', 'ac7', 'ac8'],
  users: ['u-default-admin'],
};

/** The seed's own name for each shipped row — an edited row is not touched. */
const SHIPPED_SEED_NAMES: Readonly<Record<string, string>> = {
  ac1: 'Sales', ac2: 'Other Income', ac3: 'Rent', ac4: 'Utilities',
  ac5: 'Salaries', ac6: 'Raw Material', ac7: 'Maintenance', ac8: 'Misc',
  'u-default-admin': 'Administrator',
};

const DONE_KEY = 'dtpos-seed-row-cleanup-v1';

function alreadyDone(tenantId: string): boolean {
  try { return (localStorage.getItem(DONE_KEY) || '').split(',').includes(tenantId); }
  catch { return false; }
}

function markDone(tenantId: string): void {
  try {
    const seen = new Set((localStorage.getItem(DONE_KEY) || '').split(',').filter(Boolean));
    seen.add(tenantId);
    localStorage.setItem(DONE_KEY, Array.from(seen).join(','));
  } catch { /* a repeat run is harmless — it is idempotent */ }
}

/** True when this row is still exactly what the seed shipped. */
export function isUntouchedSeedRow(collection: string, row: any): boolean {
  const ids = SHIPPED_SEED_IDS[collection];
  if (!ids || !row?.id) return false;
  const id = String(row.id);
  if (!ids.includes(id)) return false;
  const seedName = SHIPPED_SEED_NAMES[id];
  const actual = String(row.name ?? '');
  return actual === seedName;
}

export interface SeedCleanupResult {
  /** Rows removed from the local cache, by collection. */
  removed: Record<string, string[]>;
  /** Queued + dead-lettered ops forgotten. */
  opsDropped: number;
}

/**
 * Remove the shipped seed rows from `data` and forget their sync ops.
 *
 * @param data    the tenant's local cache; mutated in place.
 * @param tenantId the restaurant this cache belongs to.
 * @param force   run even if this tenant was already cleaned (support tool).
 * @returns what was removed, or null when there was nothing to do.
 */
export async function cleanupShippedSeedRows(
  data: any, tenantId: string | null, force = false,
): Promise<SeedCleanupResult | null> {
  if (!data || !tenantId) return null;
  if (!force && alreadyDone(tenantId)) return null;

  const removed: Record<string, string[]> = {};
  for (const [collection, ids] of Object.entries(SHIPPED_SEED_IDS)) {
    const rows = data[collection];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const doomed = rows.filter(r => isUntouchedSeedRow(collection, r)).map(r => String(r.id));
    if (doomed.length === 0) continue;
    const doomedSet = new Set(doomed);
    data[collection] = rows.filter((r: any) => !doomedSet.has(String(r?.id)));
    removed[collection] = doomed;
    void ids; // the allow-list is applied by isUntouchedSeedRow
  }

  // The ops outlive the rows, so they are dropped whether or not a row was
  // still present: a till that has already lost the cache can still be
  // carrying the eight dead-lettered failures.
  let opsDropped = 0;
  for (const [collection, ids] of Object.entries(SHIPPED_SEED_IDS)) {
    opsDropped += await discardDeferredOpsFor(collection, ids);
  }

  markDone(tenantId);
  if (opsDropped === 0 && Object.keys(removed).length === 0) return null;
  return { removed, opsDropped };
}
