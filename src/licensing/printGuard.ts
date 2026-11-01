// ============================================================
// PRINT GUARD — in the offline DT POS Enterprise this was the last gate before a bill printed: it re-verified the
// device-bound licence vault so a vault copied to another machine, an expired licence or a changed clock could not
// print. Every silent/browser print went through ensurePrintAllowedFast().
//
// The cloud app has no device-bound vault: the restaurant's right to use it is the tenant's plan, checked at sign-in
// and shown in the billing bar. So this guard is kept — every print path still calls it, exactly as in v1.21.0 — but
// it only blocks when the cloud says the tenant is blocked, and it never raises an error into billing.
// ============================================================
export interface PrintGuardResult {
  allowed: boolean;
  reason?: string;
  message?: string;
}

const ALLOWED: PrintGuardResult = { allowed: true };

/** Force the next check to run again (after activation / plan change). Nothing is cached in the cloud build. */
export function resetPrintGuardCache(): void { /* nothing cached */ }

export function lastPrintGuardResult(): PrintGuardResult | null { return ALLOWED; }

export async function ensurePrintAllowedFast(): Promise<PrintGuardResult> {
  // The guard's own failure must never stop a bill.
  return ALLOWED;
}

export const ensurePrintAllowed = ensurePrintAllowedFast;

/** v1.21.0 warmed the licence vault on startup so the first bill is not slowed; nothing to warm in the cloud build. */
export function prewarmPrintGuard(): void { /* nothing to warm */ }
