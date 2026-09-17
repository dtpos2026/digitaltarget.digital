// ============================================================================
// v1.56.3 — one place that decides what a failed cloud write MEANS
//
// Two callers needed the same answer and only one of them had it.
//
//   store.ts     cloudFail()  — already classified failures as "permanent"
//                               since v1.22.0, to choose the toast wording.
//   deferredSync flushDeferredOps() — did not ask, so an op the code already
//                               knew was hopeless still burned six attempts on
//                               a backoff stretching to five minutes.
//
// It lives here rather than in store.ts because deferredSync is imported BY
// store.ts; importing it back would be a cycle.
// ============================================================================

/** Is this a failure that retrying can never fix? */
export function isPermanentSyncError(e: any): boolean {
  const msg = String(e?.message || '');
  const code = String(e?.code || '');
  return /does not exist|could not find (the )?(table|column|function)|schema cache|violates|invalid input|not-null|constraint|permission denied|row-level security|invalid jwt/i
    .test(msg)
    || /^(PGRST2|23|42|42501)/.test(code);
}

/**
 * Say what the database meant, in the operator's language.
 *
 * REPORTED, as a toast on the till mid-service:
 *
 *     Sync rejected (save branches/mqpll26zktfpb1): new row violates
 *     row-level security policy (USING expression) for table "branches"
 *
 * Accurate, and unusable. What it means here is specific and worth saying
 * plainly: PostgREST upserts as INSERT ... ON CONFLICT (id) DO UPDATE, and the
 * cloud id is derived from the LOCAL id alone — so a record carried over from
 * another restaurant lands on THAT restaurant's row, and RLS refuses it.
 *
 * Confirmed against the live database: local id `mqpll26zktfpb1` derives to
 * eb03f551-c836-5f50-a2f9-2c931ea522b2, a branch belonging to a different
 * tenant. Isolation is working exactly as designed. The record is simply not
 * this restaurant's to save, and retrying cannot change that.
 */
export function explainSyncError(msg: string, code = ''): string {
  if (/row-level security/i.test(msg) || code === '42501') {
    if (/USING expression/i.test(msg)) {
      return 'this record belongs to a different restaurant, so it cannot be '
        + 'saved here. Nothing was changed in either restaurant, and it has '
        + 'been set aside — see Admin → Data Integrity.';
    }
    return 'this restaurant is not allowed to write that record. '
      + 'Sign in again, or ask the owner to check your access.';
  }
  if (/duplicate key|already exists/i.test(msg)) {
    return 'another device already saved a record with the same identity.';
  }
  if (/not-null|violates not-null/i.test(msg)) {
    return 'a required field is empty on this record.';
  }
  return msg.slice(0, 120);
}
