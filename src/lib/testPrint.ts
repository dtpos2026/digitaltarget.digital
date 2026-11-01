// ============================================================
// TEST PRINT — one path used by every "Test Print" button.
//
// Each panel used to roll its own. Two problems came out of that:
//
//   1. The diagnostics page's buttons called electronPrintReceipt() with no
//      slip rendered, which prints the POS's OWN window. Every one of them
//      reported success while feeding a picture of the app (or a blank
//      page) out of the printer, whatever the button said.
//
//   2. The panels that did render a slip put its portal at left:0;top:0
//      with z-index 99999 — a white slip parked over the POS for the
//      duration of the job. That is the white rectangle in the corner the
//      cashier reported.
//
// This builds the slip in an OFF-SCREEN portal and sends it through the
// normal print pipeline, so a test print takes exactly the route a real
// receipt takes — same geometry, same margins, same silent transport — and
// therefore actually tests it.
// ============================================================
import { printNode } from '@/printing';
import type { PaperSize } from '@/printing';

export interface TestSlipOptions {
  /** Heading printed at the top of the slip. */
  title: string;
  /** Body lines. A line of '---' becomes a separator rule. */
  lines?: string[];
  /** Closing line. */
  footer?: string;
  printerName?: string;
  paperSize?: PaperSize;
  /** Margins in mm — defaults to the device's Printer Settings. */
  leftMarginMm?: number;
  rightMarginMm?: number;
  topFeedMm?: number;
  bottomFeedMm?: number;
  /** Calibrated content width (mm). */
  printWidthMm?: number;
  autoCut?: boolean;
  copies?: number;
}

export interface TestPrintResult {
  success: boolean;
  error?: string;
}

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));

function buildSlipHtml(o: TestSlipOptions): string {
  const rule = '<div style="border-top:1px dashed #000;margin:4px 0"></div>';
  const body = (o.lines || []).map(line =>
    line === '---' ? rule : `<div>${escapeHtml(line)}</div>`,
  ).join('');
  return `
    <div style="text-align:center;font-weight:900;font-size:15px">*** DT POS TEST ***</div>
    <div style="text-align:center;font-weight:800;font-size:13px">${escapeHtml(o.title)}</div>
    <div style="text-align:center;font-size:11px">${escapeHtml(new Date().toLocaleString())}</div>
    ${rule}
    ${body}
    ${rule}
    <div style="text-align:center;font-size:12px;font-weight:700">${escapeHtml(o.footer || 'If this slip printed, the printer setup is OK.')}</div>`;
}

/**
 * Print a test slip on the given printer.
 *
 * The portal is created, printed and removed here, so a caller cannot leave
 * one attached to the DOM — that is what used to leave a stray white panel
 * over the POS when a print threw.
 */
export async function printTestSlip(options: TestSlipOptions): Promise<TestPrintResult> {
  const paperSize = (options.paperSize || '80mm') as PaperSize;

  const portal = document.createElement('div');
  portal.className = 'receipt-print-portal';
  portal.setAttribute('aria-hidden', 'true');
  // Off-screen and invisible. The print pipeline neutralises these styles in
  // its own document, so the slip still prints at full size.
  portal.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;';

  const inner = document.createElement('div');
  inner.className = 'print-receipt receipt-root';
  inner.setAttribute('data-paper-size', paperSize);
  inner.style.cssText = "font-family:'Lucida Console','Consolas','Courier New',monospace;font-size:13px;font-weight:700;color:#000;background:#fff;";
  inner.innerHTML = buildSlipHtml(options);

  // Printer-specific calibration, when the printer carries any.
  const mm = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
  const positive = (v?: number) => `${Math.max(0, v ?? 0)}mm`;
  const negative = (v?: number) => `${Math.min(0, v ?? 0)}mm`;
  const left = mm(options.leftMarginMm);
  const right = mm(options.rightMarginMm);
  if (left !== undefined) {
    inner.style.setProperty('--dt-print-padding-left', positive(left));
    inner.style.setProperty('--dt-print-offset-left', negative(left));
  }
  if (right !== undefined) {
    inner.style.setProperty('--dt-print-padding-right', positive(right));
    inner.style.setProperty('--dt-print-offset-right', negative(right));
  }
  if (options.printWidthMm) {
    inner.style.setProperty('--dt-print-content-width', `${options.printWidthMm}mm`);
  }

  portal.appendChild(inner);
  document.body.appendChild(portal);

  try {
    const res = await printNode(portal, {
      paperWidth: paperSize,
      printerName: options.printerName,
      silent: true,
      copies: Math.max(1, options.copies || 1),
      logType: 'test',
      autoCut: options.autoCut !== false,
      marginLeftMm: left,
      marginRightMm: right,
      contentWidthMm: options.printWidthMm,
    });
    return { success: !!res.success, error: res.success ? undefined : (res.error || res.message) };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    // A short delay lets a dialog-based fallback capture the DOM first.
    setTimeout(() => { try { portal.remove(); } catch { /* already gone */ } }, 600);
  }
}
