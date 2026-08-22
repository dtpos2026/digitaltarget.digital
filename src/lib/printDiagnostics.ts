// ============================================================
// v1.5.2 — PRINT DIAGNOSTICS
//
// Why this exists: the "too much blank paper at the top" report has now
// been chased twice without a confirmed root cause, because from the
// source alone we cannot tell WHICH path actually printed:
//
//   • Electron system print (Windows driver decides margins/feed), or
//   • LAN raw ESC/POS (we control every byte, incl. feed lines)
//
// ...nor what page height / margins were used for that specific job.
// Guessing again would waste another release, so every print now records
// exactly what it did. Settings → Printers shows the last few entries,
// which turns "top margin issue aa raha hai" into a precise answer.
//
// Purely local, capped at 20 entries, never synced.
// ============================================================

export interface PrintDiagEntry {
  at: string;
  /** Which pipeline actually sent the job. */
  path: 'electron-system' | 'lan-escpos' | 'browser';
  kind: 'receipt' | 'kot' | 'token' | 'test' | 'other';
  paperWidth?: string;
  /** Page height we asked the driver for (mm). undefined = printer default. */
  pageHeightMm?: number;
  /** Effective CSS padding applied inside the receipt (mm). */
  marginTopMm?: number;
  marginBottomMm?: number;
  /** ESC/POS only: blank line feeds emitted before the content. */
  topFeedLines?: number;
  printerName?: string;
  success: boolean;
  error?: string;
}

const KEY = 'dtpos-print-diagnostics';
const MAX = 20;

export function recordPrintDiag(entry: Omit<PrintDiagEntry, 'at'>): void {
  try {
    const list = getPrintDiags();
    list.unshift({ ...entry, at: new Date().toISOString() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    // Also surface it in the console for remote support sessions.
    console.log(
      '%c[DT-Print-Diag]',
      'color:#2563eb;font-weight:700',
      entry.path,
      {
        kind: entry.kind,
        pageHeightMm: entry.pageHeightMm ?? 'printer-default',
        marginTopMm: entry.marginTopMm,
        topFeedLines: entry.topFeedLines,
        printer: entry.printerName,
        ok: entry.success,
        error: entry.error,
      },
    );
  } catch { /* diagnostics must never break printing */ }
}

export function getPrintDiags(): PrintDiagEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function clearPrintDiags(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** One-line human summary — what support should be told. */
export function summarisePrintDiag(e: PrintDiagEntry): string {
  const parts: string[] = [];
  parts.push(e.path === 'lan-escpos' ? 'LAN ESC/POS' : e.path === 'electron-system' ? 'Windows driver' : 'Browser');
  parts.push(e.kind);
  parts.push(e.pageHeightMm ? `page ${e.pageHeightMm}mm` : 'page auto');
  if (typeof e.marginTopMm === 'number') parts.push(`topMargin ${e.marginTopMm}mm`);
  if (typeof e.topFeedLines === 'number' && e.topFeedLines > 0) parts.push(`feed ${e.topFeedLines} lines`);
  if (!e.success) parts.push(`FAILED: ${e.error || 'unknown'}`);
  return parts.join(' · ');
}
