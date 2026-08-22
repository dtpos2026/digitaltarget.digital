// ============================================================================
// ERROR REPORTING — v1.25.3
//
// This module used to forward every caught runtime error to the Lovable
// editor's telemetry hooks (`window.__lovableEvents.captureException` and
// `window.__lovableReportRuntimeError`), passing along the error message,
// stack trace and an arbitrary context object.
//
// That is a data egress path out of the application, and this build is meant
// to have exactly one external dependency: Supabase. Error payloads from a POS
// can carry order ids, tenant names, table names and occasionally customer
// detail, so it is not a harmless channel to leave attached.
//
// The function is kept — __root.tsx calls it from the router error boundary,
// and an error boundary that itself throws is worse than the error it was
// catching — but it now only writes to the console. Nothing leaves the device.
//
// If a real error tracker is wanted later, this is the single place to wire it
// in, and it should be a service chosen deliberately rather than whatever the
// editor happened to inject onto `window`.
// ============================================================================

export function reportLovableError(
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  try {
    console.error('[dtpos] runtime error', error, context);
  } catch {
    // Reporting must never be the thing that breaks an error boundary.
  }
}

/** Neutral alias, preferred for new call sites. */
export const reportRuntimeError = reportLovableError;
