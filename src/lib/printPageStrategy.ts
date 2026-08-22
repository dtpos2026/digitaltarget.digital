// ============================================================
// v1.5.3 — WINDOWS PRINT PAGE-HEIGHT STRATEGY (per device)
//
// THE TOP-BLANK PROBLEM, HONESTLY STATED
// Our pipeline sends zero top margin (Print Diagnostics proves it per
// job). The blank paper BEFORE the receipt is added by the Windows
// thermal driver's paper handling when it receives our custom page
// height: several Black Copper / clone drivers align a new custom-height
// page by feeding first, or carry over the remainder of the previous
// job's page. Other drivers do the opposite and need the explicit
// height. This is driver firmware behaviour — it cannot be detected
// from code, and guessing has already failed twice.
//
// So instead of a fourth guess, the strategy is now a PER-DEVICE switch
// the operator can flip and immediately verify with a test print:
//
//   'measured' (default) — send the exact measured content height.
//                          Current behaviour; best for drivers that
//                          respect custom pages (no clipping, no feed).
//   'driver'             — send NO page height at all; the driver's own
//                          "80mm x Receipt" roll setting decides. This is
//                          the mode that eliminates the pre-feed on the
//                          drivers that misbehave with custom heights.
//
// Default stays 'measured' so every other restaurant is untouched.
// ============================================================

export type PageHeightStrategy = 'measured' | 'driver';

const KEY = 'dtpos-page-height-strategy';

export function getPageHeightStrategy(): PageHeightStrategy {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'driver' ? 'driver' : 'measured';
  } catch {
    return 'measured';
  }
}

export function setPageHeightStrategy(s: PageHeightStrategy): void {
  try { localStorage.setItem(KEY, s); } catch { /* ignore */ }
}

/**
 * Resolve what a print call should actually send to Electron.
 * One place, used by receipt/KOT/token/test prints, so every path
 * behaves identically under whichever strategy the device is on.
 */
export function resolvePageHeight(measuredHeightMm: number | undefined): {
  pageHeightMicrons: number | undefined;
  usePrinterDefaultPageSize: boolean;
  strategy: PageHeightStrategy;
} {
  const strategy = getPageHeightStrategy();
  if (strategy === 'driver') {
    return { pageHeightMicrons: undefined, usePrinterDefaultPageSize: true, strategy };
  }
  return {
    pageHeightMicrons: measuredHeightMm ? Math.round(measuredHeightMm * 1000) : undefined,
    usePrinterDefaultPageSize: measuredHeightMm ? false : true,
    strategy,
  };
}
