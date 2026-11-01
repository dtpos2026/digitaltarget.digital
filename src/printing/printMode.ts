// ============================================================
// PRINT MODE — which path a slip takes, decided in ONE place.
//
// Four components print slips and each used to decide this for itself, which
// is how they drifted: the bill honoured the printer's mode, the KOT and the
// token ignored it, and the shift report had no raw path at all. Turning on
// Fast Billing then produced a raw bill, a raw KOT, a raw token — and a
// rendered report.
//
// Precedence, strictest first:
//   1. The printer's own `printMode`, when it is not 'auto'. Mixed hardware
//      is real: one counter printer may refuse raw bytes while the kitchen
//      printer is happy with them.
//   2. The printer's legacy `escposMode` flag, which meant the same thing
//      before `printMode` existed. See below.
//   3. The shop-wide Fast Billing switch.
//   4. 'auto' — rendered template, sent as one silent RAW job.
//
// The legacy flag
// ---------------
// `escposMode` is an older switch labelled "ESC/POS" in Printer Center that
// said exactly what `printMode: 'raw'` says. Nothing read it, so a shop that
// turned it on got no raw printing and no explanation — a switch that does
// nothing is worse than no switch. The toggle is gone and stored values are
// migrated to `printMode`, but a config can still arrive here carrying it
// (an old cloud copy, a restored backup), so it is honoured rather than
// silently dropped.
// ============================================================

export type ResolvedPrintMode = 'raw' | 'driver' | 'auto';

export interface PrintModeInput {
  /** The resolved printer configuration for this slip, if any. */
  printerConfig?: { printMode?: string; escposMode?: boolean } | null;
  /** The shop settings carrying the global Fast Billing switch. */
  settings?: { fastRawPrintMode?: boolean } | null;
}

/**
 * Decide how a slip should print.
 *
 * Exported and pure so the parity tests can assert that every slip type
 * reaches the same answer from the same inputs.
 */
export function resolvePrintMode(input: PrintModeInput): ResolvedPrintMode {
  const perPrinter = String(input.printerConfig?.printMode || 'auto');
  if (perPrinter === 'raw' || perPrinter === 'driver') return perPrinter;
  // The pre-`printMode` spelling of "raw", honoured for configs that never
  // went through the migration.
  if (input.printerConfig?.escposMode === true) return 'raw';
  if (input.settings?.fastRawPrintMode === true) return 'raw';
  return 'auto';
}

/** True when this slip should be built as raw ESC/POS text. */
export function wantsRaw(input: PrintModeInput): boolean {
  return resolvePrintMode(input) === 'raw';
}

/** True when the rendered fast path must be skipped entirely. */
export function wantsDriverOnly(input: PrintModeInput): boolean {
  return resolvePrintMode(input) === 'driver';
}
