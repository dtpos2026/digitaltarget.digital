// ============================================================
// PRINTER NAME MATCHING — shared, robust, testable.
//
// Reported fault: "BIXOLON SRP-352plusIII (Copy 1)" was installed in Windows
// but the app reported it as "not detected" and never even attempted a print.
//
// Why a name fails to match exactly on Windows:
//   • "(Copy 1)" / "(Copy 2)"      — duplicate driver install
//   • "(redirected 2)"             — RDP / session printers
//   • double spaces, non-breaking space (\u00A0), trailing space
//   • `name` vs `displayName`
//   • the printer was renamed after the setting was saved
//
// This module holds the same six-stage logic as electron/main.cjs, so the
// renderer (Settings / Diagnostics) reaches the same verdict as the print
// path and cannot show a spurious "not detected" warning.
// ============================================================

export interface SystemPrinterLike {
  name?: string;
  displayName?: string;
}

/** Collapse whitespace and lowercase. */
export function normalizePrinterName(s: string | undefined | null): string {
  return String(s ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Strip a trailing "(Copy 1)" / "(redirected 2)" suffix. */
export function stripPrinterSuffix(s: string | undefined | null): string {
  return normalizePrinterName(s)
    .replace(/\s*\((?:copy|redirected)\s*\d*\)\s*$/i, '')
    .trim();
}

export type PrinterMatchStage =
  | 'exact' | 'normalized' | 'no-suffix' | 'starts-with' | 'contains' | 'reverse' | 'none';

export interface PrinterMatchResult {
  printer: SystemPrinterLike | null;
  /** The real Windows device name — this is what a print job must be sent to. */
  name: string;
  stage: PrinterMatchStage;
}

/**
 * Look the requested name up among the installed printers, strictest match
 * first. The first stage that matches wins, because it is the most reliable.
 */
export function matchPrinter(
  requested: string | undefined | null,
  printers: SystemPrinterLike[] | undefined | null,
): PrinterMatchResult {
  const list = Array.isArray(printers) ? printers : [];
  const raw = String(requested ?? '').replace(/\u00A0/g, ' ').trim();
  if (!raw || list.length === 0) return { printer: null, name: '', stage: 'none' };

  const reqN = normalizePrinterName(raw);
  const reqS = stripPrinterSuffix(raw);

  const stages: Array<[PrinterMatchStage, (p: SystemPrinterLike) => boolean]> = [
    ['exact', p => String(p.name ?? '') === raw || String(p.displayName ?? '') === raw],
    ['normalized', p => normalizePrinterName(p.name) === reqN || normalizePrinterName(p.displayName) === reqN],
    ['no-suffix', p => stripPrinterSuffix(p.name) === reqS || stripPrinterSuffix(p.displayName) === reqS],
    ['starts-with', p => !!reqS && (normalizePrinterName(p.name).startsWith(reqS) || normalizePrinterName(p.displayName).startsWith(reqS))],
    ['contains', p => reqS.length >= 4 && (normalizePrinterName(p.name).includes(reqS) || normalizePrinterName(p.displayName).includes(reqS))],
    // Reverse: the saved name is shorter than the Windows device name.
    ['reverse', p => {
      if (reqS.length < 4) return false;
      const n = normalizePrinterName(p.name);
      const d = normalizePrinterName(p.displayName);
      return (!!n && reqS.includes(n)) || (!!d && reqS.includes(d));
    }],
  ];

  for (const [stage, fn] of stages) {
    const hit = list.find(fn);
    if (hit) return { printer: hit, name: String(hit.name ?? '') || raw, stage };
  }
  return { printer: null, name: '', stage: 'none' };
}

/** Is this printer present in Windows (using the tolerant matching above)? */
export function isPrinterInstalled(
  requested: string | undefined | null,
  printers: SystemPrinterLike[] | undefined | null,
): boolean {
  return matchPrinter(requested, printers).printer !== null;
}
