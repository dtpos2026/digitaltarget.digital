// ============================================================================
// SYNC MERGE — how a cloud collection and the local cache are reconciled
//
// This lives in its own module for one reason: it is the rule that decides
// whether a record survives, and it used to exist twice — once in store.ts and
// once copied into the tests, which then policed the copy with string matching
// on the source file. That guards the spelling, not the behaviour. One
// exported function, imported by both, cannot drift.
// ============================================================================

export interface MergeResult {
  /** The reconciled collection. Tombstones are never included. */
  rows: any[];
  /**
   * Local ids that the cloud has never seen and that are NOT already queued.
   * The caller re-enqueues them: a row in this list is one the operator
   * believes is saved and which is, in fact, nowhere but this device.
   */
  requeue: string[];
}

/**
 * Merge one cloud collection into the local cache.
 *
 * ===== The three cases this has to tell apart =====
 *
 * A local row and the cloud can disagree in three ways, and every earlier
 * version of this merge collapsed two of them into one:
 *
 *   1. The cloud holds a TOMBSTONE  -> deleted on another device. Drop it.
 *   2. The cloud holds a newer copy -> take the cloud's. Ties go to the cloud,
 *                                      so clock skew never decides the data.
 *   3. The row is absent entirely   -> it was never pushed. KEEP it, and hand
 *                                      it back for re-queueing.
 *
 * Case 1 did not exist before v1.26.0: eleven tables were hard-DELETEd, so a
 * deletion reached other devices as an ABSENCE — indistinguishable from case 3.
 * The merge had to guess, and either guess was wrong half the time: guess
 * "deleted" and unsynced bills are destroyed; guess "unsynced" and deletions
 * resurrect themselves and get pushed back up. Both were shipped, in that
 * order, and both were reported as data loss.
 *
 * With `deleted_at` tombstones the deletion is a fact carried on the row, so
 * absence can be handled the safe way every time.
 *
 * ===== v1.26.9 — the two sides do not always agree on the id =====
 *
 * Tables without a `data` document (menu items, categories, customers, tables)
 * are keyed in the cloud by a DERIVED uuid: cloudId('mi-1') is a stable uuid,
 * and the original local id cannot travel back. So the device that CREATED a
 * record keeps 'mi-1' while the cloud — and every other device — knows it as
 * that uuid.
 *
 * Comparing raw ids therefore reports the record as "absent from the cloud" on
 * the very device that just pushed it, which had two consequences, both found
 * by the two-browser test:
 *
 *   1. The creating device kept its local copy AND adopted the cloud copy, so
 *      the same menu item appeared TWICE on that till after a refresh.
 *   2. It was re-queued on every refresh, so the sync queue never emptied and
 *      the whole menu was re-pushed forever.
 *
 * `cloudIdOf` lets the merge recognise that 'mi-1' and its uuid are one
 * record. The local id is kept, so anything already referencing it locally
 * stays valid, and the newer of the two copies wins as usual.
 *
 * @param pendingIds keys (`col:id`) already in the durable queue, or null when
 *        the queue could not be read. null means "I do not know", NOT "nothing
 *        is pending" — so nothing is dropped and nothing is re-queued.
 * @param cloudIdOf maps a local id to the id the cloud keys it under. Omit for
 *        collections whose ids already match on both sides.
 */
export function mergeCollection(
  name: string,
  remoteRows: readonly any[],
  localRows: readonly any[],
  pendingIds: Set<string> | null,
  cloudIdOf?: (localId: string) => string,
): MergeResult {
  const byId = new Map<string, any>();
  const tombstoned = new Set<string>();
  for (const r of remoteRows) {
    if (!r?.id) continue;
    if (r.deleted) { tombstoned.add(r.id); continue; }
    byId.set(r.id, r);
  }

  const requeue: string[] = [];
  for (const local of localRows) {
    if (!local?.id) continue;
    // The id this record is keyed under in the cloud, which is not always the
    // id it is keyed under here.
    const cloudKey = cloudIdOf ? cloudIdOf(local.id) : local.id;
    if (tombstoned.has(local.id) || tombstoned.has(cloudKey)) continue;   // (1) deleted elsewhere

    const remote = byId.get(local.id) ?? byId.get(cloudKey);
    if (remote) {                                           // (2) both sides have it
      if (remote.id !== local.id) {
        // One record under two ids. Collapse to a single row, keeping the
        // LOCAL id so anything already pointing at it here stays valid.
        byId.delete(remote.id);
        byId.set(local.id, Number(local._updatedAt || 0) >= Number(remote._updatedAt || 0)
          ? local
          : { ...remote, id: local.id });
      } else if (Number(local._updatedAt || 0) > Number(remote._updatedAt || 0)) {
        byId.set(local.id, local);
      }
      continue;
    }
    // (3) The cloud has never seen this row. Keeping it is the only
    // non-destructive answer — but keeping it SILENTLY is how rows sat on one
    // till forever while the operator believed they were saved. Say so, and
    // put it back on the queue.
    byId.set(local.id, local);
    if (pendingIds && !pendingIds.has(`${name}:${local.id}`)) requeue.push(local.id);
  }
  return { rows: Array.from(byId.values()), requeue };
}
