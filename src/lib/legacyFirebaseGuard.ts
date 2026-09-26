// ============================================================================
// LEGACY FIREBASE GUARD
//
// A number of platform modules — client billing, packages, plans, releases,
// version audit, update safety, support chat, marketing, service calls — still
// read and write Firestore. They have not been ported yet.
//
// On a Supabase session those calls do not fail politely: Firestore answers
// "Missing or insufficient permissions", which surfaces as a red toast on a
// screen the operator did nothing wrong on. Worse, some callers treat the
// rejection as "no data" and render an empty list that looks like data loss.
//
// This guard lets each of those modules answer honestly instead: "not
// available on this backend yet". The panel stays usable, the section is
// visibly empty rather than broken, and nothing pretends to have succeeded.
//
// Every use of this is a deliberate, temporary marker. When a module is ported
// its guard is removed — so the count of remaining guards is an accurate
// measure of what is left to migrate.
// ============================================================================

/**
 * True when the current session is on Supabase, so Firestore is unreachable.
 *
 * ===== v1.58.0 — this disagreed with authProvider, and clients stopped saving
 *
 * REPORTED: "super admin me clien save nhi hota, na he resturan bill wagahesab".
 *
 * v1.25.3 HARD PINNED usingSupabaseAuth() to true, with the note "Firebase is
 * gone. There is exactly one backend, so there is nothing left to resolve and
 * no state that can put a device on the wrong path." This function was not
 * changed with it, and kept consulting the same per-device flag that change
 * had just finished removing:
 *
 *     if (explicit === 'firebase') return false;
 *
 * So on any device still carrying that stale flag — a browser used before the
 * migration, or one a POS login had stamped — every platform module took the
 * FIRESTORE branch: marketing contacts (the client list), client billing,
 * packages, plans, releases, support. Firestore has no identity for a
 * Supabase-authenticated Super Admin, so each write was refused. Both symptoms
 * reported are the same line: the clients tab and the restaurant billing both
 * go through here.
 *
 * Pinned to true for the same reason usingSupabaseAuth() is: there is one
 * backend. A device cannot opt itself back into a system that no longer
 * exists.
 */
export function firestoreUnavailable(): boolean {
  return true;
}

/**
 * Standard empty result for a read that cannot run on this backend.
 * Returns the caller's own empty shape so nothing downstream has to change.
 */
export function legacyRead<T>(empty: T, moduleName: string): T {
  console.info(`[legacy] ${moduleName}: not available on Supabase yet — showing empty`);
  return empty;
}

/**
 * Standard result for a write that cannot run on this backend.
 * Throws, deliberately: a write that silently does nothing is how an operator
 * ends up believing a client was billed, or a release was published, when it
 * was not.
 */
export function legacyWrite(moduleName: string): never {
  throw new Error(
    `${moduleName} is not available on the Supabase backend yet. `
    + 'This feature still runs on the legacy Firebase backend.',
  );
}
