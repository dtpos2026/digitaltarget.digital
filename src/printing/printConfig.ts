// ============================================================
// Centralized Print Configuration — SINGLE source of truth
// ------------------------------------------------------------
// All receipt printing (browser + Electron) reads from this file.
// Do NOT duplicate these values anywhere else.
// ============================================================

export type PaperSize = '58mm' | '80mm' | '110mm';

export const PRINT_CONFIG = {
  // Render & timing — separate delays for Electron (silent) vs Browser (dialog)
  // Electron silent print: DOM already settled, 200ms kafi hai (Phase-1 target: <300ms start)
  // Browser print: dialog opens, fonts/layout ke liye thora zyada chahiye
  electronRenderDelayMs: 200,
  browserRenderDelayMs: 600,
  // Back-compat alias (legacy callers)
  renderDelayMs: 200,
  marginsMm: 0,              // Rule 2,3,4: zero margins everywhere

  // Electron webContents.print options (Rule 8)
  electron: {
    silent: true,
    printBackground: true,
    margins: { marginType: 'none' as const },
    scaleFactor: 100,
    landscape: false,
    pagesPerSheet: 1,
    collate: false,
    duplexMode: 'simplex' as const,
    // Rule 5,6: receipt height must be dynamic — let printer driver handle
    // paper feed using its own default page size instead of a fixed height.
    usePrinterDefaultPageSize: true,
  },

  // Debug toggle — when true, also surface print preview side-by-side
  debug: false as boolean,
};

export function paperWidthToMicrons(p: PaperSize): number {
  if (p === '58mm') return 58000;
  if (p === '110mm') return 110000;
  return 80000;
}

export function paperWidthToMm(p: PaperSize): number {
  if (p === '58mm') return 58;
  if (p === '110mm') return 110;
  return 80;
}
