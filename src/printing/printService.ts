// ============================================================
// Print Service — single entry point for all receipt printing.
// Renders DOM -> injects strict CSS -> waits render delay ->
// prints (Electron silent or browser) -> cleans up.
//
// Rules enforced:
//  - No pre-feed / form-feed characters injected (Rule 9, 10)
//  - 500–1000ms render delay (Rule 11)
//  - Browser and Electron use the SAME CSS + DOM (Rule 13)
// ============================================================
import { PRINT_CONFIG, paperWidthToMicrons, type PaperSize } from './printConfig';
import { injectPrintCss } from './printCss';
import { silentPrint, browserDialogPrint, isSilentPrintAvailable, type PrintResult } from './printer';
import { getPrintRetryCount } from '@/lib/printPreferences';
import { fastPrintHtml, isFastPrintAvailable } from './fastPrint';
import { ensurePrintAllowedFast } from '@/licensing/printGuard';


function waitFrames(n = 2) {
  return new Promise<void>((resolve) => {
    let i = 0;
    const tick = () => {
      i += 1;
      if (i >= n) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface PrintNodeOpts {
  paperWidth?: PaperSize;
  printerName?: string;
  silent?: boolean;          // force the silent (no-dialog) path
  copies?: number;
  /** When false, just opens browser print dialog even if the desktop app is available. */
  preferElectron?: boolean;
  /** Allow a visible print dialog when no silent transport exists (web mode). */
  allowDialogFallback?: boolean;
  /** Network thermal printer (raw ESC/POS over TCP). */
  lan?: { host: string; port?: number; autoCut?: boolean; beep?: boolean };
  /** Receipt HTML — needed only for the LAN transport. */
  html?: string;
  billNumber?: string;
  logType?: 'receipt' | 'kitchen' | 'delivery' | 'test' | 'qr' | 'raw' | 'other';
  /** Global Compact Print Mode — tighter rows, saves paper (all slips). */
  compact?: boolean;
  compactFontSize?: number;
  compactLineHeight?: number;
  autoCut?: boolean;
  /** Left margin (mm). Falls back to the device's Printer Settings. */
  marginLeftMm?: number;
  /** Right margin (mm). Falls back to the device's Printer Settings. */
  marginRightMm?: number;
  /** Calibrated content width (mm); 0/undefined = derive from the margins. */
  contentWidthMm?: number;
  /**
   * The target printer's configured print mode.
   *
   * 'driver' means the user has deliberately taken this printer off the RAW
   * path (usually because its driver refuses raw bytes), so the fast window
   * path must be skipped rather than tried and failed on every slip. This
   * setting previously applied to customer receipts only, so a printer set to
   * driver-only still had its KOT, tokens and reports pushed through the RAW
   * path first.
   */
  printMode?: 'auto' | 'raw' | 'driver';
}

export type PrintNodeResult = { success: boolean; error?: string } & Partial<PrintResult>;

/**
 * Print a hidden DOM portal containing the receipt.
 * The portal element MUST have class `receipt-print-portal`. This service
 * toggles `data-active-print="true"` on it and `thermal-printing` on body.
 *
 * All printing goes through the printer abstraction (`silentPrint`), so on the
 * desktop app the Windows print dialog is NEVER shown, and the caller always
 * gets a clear status (`success`, `code`, `message`, `transport`, `durationMs`).
 */
export async function printNode(portalEl: HTMLElement, opts: PrintNodeOpts = {}): Promise<PrintNodeResult> {
  if (!portalEl) return { success: false, error: 'No printer configured for this document.', code: 'unknown', message: 'No document to print.' };

  // Blank-print guard — an empty payload must never reach the printer.
  const payload = (portalEl.textContent || '').replace(/\s+/g, '');
  if (payload.length < 10) {
    return { success: false, error: 'Nothing to print — the document is empty.', code: 'empty_document', message: 'Nothing to print — the document is empty.' };
  }

  const paperWidth = opts.paperWidth || '80mm';

  // ===== FAST PATH =====
  // A hidden print window prints the slip's HTML, so the POS's own window
  // never enters print mode: the screen does not freeze and nothing waits.
  // ===== DRIVER MODE STILL USES THE WORKER =====
  // 'Windows driver only' used to switch the fast path off entirely, which
  // sent the job to `print-receipt` — and that handler prints
  // mainWindow.webContents, i.e. the WHOLE POS WINDOW. Chromium then lays the
  // entire app out for the printer and blocks the renderer until the spooler
  // answers: several seconds per bill, and the screen frozen or stuck
  // meanwhile, with the slip appearing long after the bill was saved.
  //
  // The driver's own rendering is what the shop wants to keep; printing the
  // POS window was never part of it. So the worker stays, and only the raster
  // stage is skipped.
  const wantsFast = opts.preferElectron !== false && (opts.silent ?? true) && !opts.lan?.host;
  if (wantsFast && isFastPrintAvailable()) {
    const guard = await ensurePrintAllowedFast();
    if (!guard.allowed) {
      return { success: false, error: guard.message, code: 'license_blocked', message: guard.message || 'Printing is blocked on this device.', transport: 'none', copies: opts.copies || 1, durationMs: 0, attempts: [], usedDialog: false };
    }
    // Page height must follow the slip's real content, otherwise short slips
    // (e.g. tandoor tokens) come out cut or blank on some drivers. Hidden
    // portals can report 0 from getBoundingClientRect, so take the largest of
    // the available measurements and keep a safety margin at the bottom.
    let pageHeightMicrons: number | undefined;
    try {
      const inner = portalEl.firstElementChild as HTMLElement | null;
      const px = Math.max(
        portalEl.getBoundingClientRect().height || 0,
        portalEl.scrollHeight || 0,
        inner?.scrollHeight || 0,
        inner?.offsetHeight || 0,
      );
      const mm = (px * 25.4) / 96;
      if (mm > 5) pageHeightMicrons = Math.round(Math.min(600, mm + 12) * 1000);
    } catch { /* fall back to printer default */ }
    const fast = await fastPrintHtml({
      html: portalEl.outerHTML,
      paperWidth: paperWidth as any,
      compact: opts.compact,
      compactFontSize: opts.compactFontSize,
      compactLineHeight: opts.compactLineHeight,
      printerName: opts.printerName,
      copies: opts.copies,
      pageWidthMicrons: paperWidthToMicrons(paperWidth as any),
      pageHeightMicrons,
      usePrinterDefaultPageSize: !pageHeightMicrons,
      autoCut: opts.autoCut !== false,
      marginLeftMm: opts.marginLeftMm,
      marginRightMm: opts.marginRightMm,
      contentWidthMm: opts.contentWidthMm,
      preferDriver: opts.printMode === 'driver',
    });
    if (fast.success) {
      // The attempt names the route that printed, so a test print (and the
      // log) can tell "image sent as RAW" from "fell back to the driver".
      const route = fast.route === 'driver'
        ? `fast-window:driver${fast.rasterError ? ` (image route: ${fast.rasterError})` : ''}`
        : 'fast-window:raster';
      return { success: true, transport: 'electron-silent', message: 'Printed.', copies: opts.copies || 1, durationMs: 0, attempts: [route], usedDialog: false, printerName: opts.printerName };
    }
    console.warn('[DT-Print] fast window path unavailable, using window print:', fast.error);
  }

  // ===== SAME OPTIONS OBJECT ON BOTH PATHS =====
  // The fast path above is handed `opts.compact` and honours it. This window
  // path used to call injectPrintCss(paperWidth) with no second argument and
  // never set `thermal-compact` on the body, so Paper Save silently did
  // nothing for every slip that prints through printNode — KOT, tokens, the
  // shift report and test prints. The compact stylesheet was emitted only
  // when the desktop fast path happened to be available, which is exactly
  // the "works in the browser, not in the app" divergence.
  const compact = !!opts.compact;

  // Mark active
  portalEl.setAttribute('data-active-print', 'true');
  document.body.classList.add('thermal-printing');
  if (compact) document.body.classList.add('thermal-compact');
  document.body.dataset.printActive = 'true';

  // Compact tuning travels with the flag, so the window path lays out at the
  // same size as the fast path rather than falling back to the defaults.
  const rootStyle = document.documentElement.style;
  if (compact) {
    if (Number.isFinite(Number(opts.compactFontSize))) {
      rootStyle.setProperty('--dt-compact-font-size', `${Math.max(10, Math.min(16, Number(opts.compactFontSize)))}px`);
    }
    if (Number.isFinite(Number(opts.compactLineHeight))) {
      rootStyle.setProperty('--dt-compact-line-height', `${Math.max(1, Math.min(2, Number(opts.compactLineHeight)))}`);
    }
  }

  const removeStyle = injectPrintCss(paperWidth, compact);

  const cleanup = () => {
    removeStyle();
    portalEl.removeAttribute('data-active-print');
    document.body.classList.remove('thermal-printing');
    document.body.classList.remove('thermal-compact');
    delete document.body.dataset.printActive;
  };

  try {
    // Wait for layout to settle, then a render delay
    await waitFrames(2);
    const wantsSilent = opts.preferElectron !== false && (opts.silent ?? true);
    const silentPath = wantsSilent && (isSilentPrintAvailable() || !!opts.lan?.host);
    const delay = silentPath
      ? Math.max(40, Math.min(300, PRINT_CONFIG.electronRenderDelayMs))
      : Math.max(150, Math.min(800, PRINT_CONFIG.browserRenderDelayMs));
    await sleep(delay);

    if (!wantsSilent) {
      await browserDialogPrint();
      return { success: true, transport: 'browser-dialog', usedDialog: true, message: 'Sent to the browser print dialog.' };
    }

    const result = await silentPrint({
      printerName: opts.printerName,
      paperWidth,
      copies: opts.copies,
      retries: getPrintRetryCount(),
      lan: opts.lan,
      html: opts.html,
      // In the desktop app we never fall back to the Windows dialog.
      allowDialogFallback: opts.allowDialogFallback ?? !isSilentPrintAvailable(),
      logType: opts.logType,
      billNumber: opts.billNumber,
    });

    return { ...result, error: result.success ? undefined : result.message };
  } finally {
    // small delay before cleanup so print dialog can capture DOM
    setTimeout(cleanup, 120);
  }
}
