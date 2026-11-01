// ============================================================
// FAST PRINT — one-click, no-wait receipt/KOT printing.
//
// Why this exists:
//   The old path printed the POS's OWN window. That meant switching the
//   whole app into print CSS, laying out the entire UI for the printer and
//   blocking the renderer until the spooler answered — 2-4 seconds during
//   which the cashier could not touch anything.
//
//   Here the slip's HTML is snapshotted (design unchanged) and handed to a
//   hidden print window inside the desktop app. The POS screen never enters
//   print mode, so the next bill can be started the instant Print is tapped.
//
// Falls back silently to the previous path when the desktop app (or the
// hidden-window API) is not available — e.g. the web/browser POS.
// ============================================================
import { buildPrintCss } from './printCss';
import type { PaperSize } from './printConfig';
import { effectivePrintQuality } from '@/lib/printQuality';
import { loadPrintMargins } from '@/lib/printMargins';
import { resolveReceiptLayout, layoutCss, type ReceiptLayout } from './receiptLayout';

function api(): any {
  return (window as any).electronAPI;
}

/** True when the hidden print-window transport is available. */
export function isFastPrintAvailable(): boolean {
  return !!api()?.printHtmlEscpos || !!api()?.printHtml;
}

// The app's stylesheets change only when the app reloads, so collect once.
let cachedAppCss: string | null = null;
function collectAppCss(): string {
  if (cachedAppCss !== null) return cachedAppCss;
  const parts: string[] = [];
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = (sheet as CSSStyleSheet).cssRules;
        if (!rules) continue;
        for (const rule of Array.from(rules)) parts.push(rule.cssText);
      } catch {
        // cross-origin sheet — skip, receipts use inline styles anyway
      }
    }
  } catch {}
  cachedAppCss = parts.join('\n');
  return cachedAppCss;
}

export interface FastPrintArgs {
  /** outerHTML of the receipt/KOT root element. */
  html: string;
  paperWidth: PaperSize;
  compact?: boolean;
  compactFontSize?: number;
  compactLineHeight?: number;
  printerName?: string;
  copies?: number;
  pageWidthMicrons?: number;
  pageHeightMicrons?: number;
  usePrinterDefaultPageSize?: boolean;
  autoCut?: boolean;
  /** Extra CSS variables (margins/offsets) captured from the live element. */
  rootStyle?: string;
  /** Left margin in mm. Overrides the device setting when supplied. */
  marginLeftMm?: number;
  /** Right margin in mm. Overrides the device setting when supplied. */
  marginRightMm?: number;
  /** Calibrated content width (mm); 0/undefined = derive from margins. */
  contentWidthMm?: number;
  /**
   * Skip the raster attempt and print through the Windows driver directly.
   *
   * Still uses the hidden worker window, so the POS screen never enters print
   * mode. This is what "Windows driver only" now means: the driver's own
   * rendering (which the shop confirmed has perfect margins and quality) at
   * the fast path's responsiveness, instead of printing the whole POS window.
   */
  preferDriver?: boolean;
  /**
   * Paper fed past the last line before the cut on the Windows-driver path
   * (mm). Default DRIVER_CUT_CLEARANCE_MM; raise it for a printer whose cutter
   * sits unusually far from the head.
   */
  cutClearanceMm?: number;
  /**
   * Extra paper before the cut, from the printer's "Bottom (mm)" setting —
   * for a cutter that sits unusually far from the head. Adds to the driver
   * clearance and to the raster path's feed lines. Negative values ignored.
   */
  extraFeedMm?: number;
}

/** Default cutter clearance on the Windows-driver path — see buildDocument. */
export const DRIVER_CUT_CLEARANCE_MM = 18;

/** The printer's extra feed (mm), bounded; 0 when unset or negative. */
function extraFeed(args: Pick<FastPrintArgs, 'extraFeedMm'>): number {
  const n = Number(args.extraFeedMm);
  return Number.isFinite(n) ? Math.max(0, Math.min(30, n)) : 0;
}

/**
 * How the slip is positioned on the paper.
 *
 *  'raster' — the worker's render is converted to ESC/POS raster bytes, and
 *             the margins are inserted there as whole printer dots. The
 *             document itself is laid out at the content width with NO side
 *             padding, so one CSS mm is one printed mm.
 *  'html'   — the Windows driver prints the page directly, so there is no
 *             raster stage to offset anything. The margins have to be real
 *             page padding here instead.
 *
 * Exactly one of the two applies them. Applying both (which is what used to
 * happen) doubled every margin and shrank the type.
 */
type DocumentMode = 'raster' | 'html';

// The head (app CSS + print CSS) only depends on paper/compact/geometry, so
// build it once per combination instead of re-collecting + re-serialising
// ~240 KB of CSS on every single print. This is a large part of the old delay.
const headCache = new Map<string, string>();

function buildHead(args: FastPrintArgs, mode: DocumentMode): string {
  const width = args.paperWidth || '80mm';
  // Compact mode stays readable: 11px on an 80mm slip is around 7pt, which
  // prints grey and cramped on a 203 DPI head. 12px is the floor now, and
  // the paper saving comes from spacing (see buildCompactOverrides).
  const compactFontSize = Math.max(10, Math.min(16, Number(args.compactFontSize) || 12));
  const compactLineHeight = Math.max(1, Math.min(2, Number(args.compactLineHeight) || 1.12));
  // ===== EQUAL MARGINS =====
  // Both modes now get their page box and their content offset from the
  // shared layout module, which centres the slip on the printable area
  // instead of letting it sit flush left. See receiptLayout.ts for the
  // measurement that showed this path printing 0mm left against 11.9mm
  // right on an 80mm roll.
  const layout = layoutFor(args);
  const key = `${width}|${mode}|${layout.contentMm}|${layout.leftMm}|${layout.rightMm}|${args.compact ? 1 : 0}|${compactFontSize}|${compactLineHeight}|${args.rootStyle || ''}`;
  const hit = headCache.get(key);
  if (hit) return hit;

  // ===== PREVIEW ≠ PRINT FIX (fonts) =====
  // The worker loads its document from a different directory, so every
  // root-relative url() in the app's CSS resolves to nothing there.
  //
  // Only `/fonts/` used to be rewritten. The bundled webfonts that Vite
  // hashes into `/assets/` — Sora, Manrope, JetBrains Mono — were left
  // pointing at a path that does not exist next to the worker file, so
  // Chromium quietly substituted a fallback face and the printer produced a
  // different typeface from the one on screen. Rewriting EVERY root-relative
  // url() against the app's own base fixes the whole class, not just fonts.
  let appCss = collectAppCss();
  try {
    const appBase = new URL('.', document.baseURI).href;
    appCss = appCss.replace(/url\((["']?)\/(?!\/)/g, `url($1${appBase}`);
  } catch {}

  const head = `<!doctype html><html><head><meta charset="utf-8">
<style>${appCss}</style>
<style>${buildPrintCss(width, !!args.compact)}</style>
<style>
${layoutCss(layout, mode)}
  .dt-fast-root{--dt-compact-font-size:${compactFontSize}px;--dt-compact-line-height:${compactLineHeight};${args.rootStyle || ''}}
  /* ===== GEOMETRY AUTHORITY =====
     The snapshot carries whatever margin variables the live component wrote
     onto its own elements as INLINE styles, and an inline value beats an
     inherited one. Those values were sized for the old geometry, where the
     slip was laid out at the full paper width and padded inwards. Here the
     document is already exactly the content width, so that padding would be
     applied a second time and push the content off the right edge.
     An !important declaration outranks a plain inline one, which is what
     makes these win over the snapshot. */
  .dt-fast-root, .dt-fast-root *{
    --dt-print-padding-left:0mm!important;
    --dt-print-padding-right:0mm!important;
    --dt-print-offset-left:0mm!important;
    --dt-print-offset-right:0mm!important;
    --dt-print-content-width:${layout.contentMm}mm!important;
  }
  /* CRITICAL (blank 1-inch slip fix): the snapshot carries the live slip's own
     .receipt-print-portal wrapper. buildPrintCss hides every portal that is not
     the active one — and that rule outranks a bare .receipt-print-portal
     override, so token slips / shift reports printed a blank strip.
     These selectors are more specific, so nested wrappers stay visible. */
  body.thermal-printing .dt-fast-root,
  body.thermal-printing .dt-fast-root .receipt-print-portal,
  body.thermal-printing .dt-fast-root .print-receipt,
  .receipt-print-portal{display:block!important;}
  /* The live slip lives in an off-screen, hidden portal (position:fixed;
     left:-10000px; visibility:hidden). Those inline styles travel with
     outerHTML and made the worker print a BLANK / clipped 2-inch slip.
     Neutralise them for the snapshot root + any portal wrapper inside. */
  .dt-fast-root > *, .dt-fast-root .receipt-print-portal, .dt-fast-root .print-receipt,
  body.thermal-printing .dt-fast-root > *,
  body.thermal-printing .dt-fast-root .receipt-print-portal,
  body.thermal-printing .dt-fast-root .print-receipt{
    position:static!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;
    visibility:visible!important;opacity:1!important;transform:none!important;
    width:100%!important;max-width:100%!important;height:auto!important;max-height:none!important;
    overflow:visible!important;clip:auto!important;clip-path:none!important;
  }
  .dt-fast-root *{visibility:visible!important;}
  .dt-fast-root [hidden], .dt-fast-root .no-print, .dt-fast-root .print\\:hidden{display:none!important;}
</style>
</head>`;
  headCache.set(key, head);
  return head;
}

function buildDocument(args: FastPrintArgs, mode: DocumentMode): string {
  // Every copied portal must count as "active", otherwise the shared print CSS
  // hides it and the printer feeds a blank strip.
  const body = args.html.replace(
    /class=("|')([^"']*receipt-print-portal[^"']*)\1/g,
    (m) => (/data-active-print/.test(m) ? m : `${m} data-active-print="true"`),
  );
  // ===== THE MEASURING RULE (raster path only) =====
  //
  // The raster path screenshots this document and has to know EXACTLY which
  // columns of that screenshot are the slip. Guessing from the ink does not
  // work: a bill whose widest line is long and one whose widest line is short
  // then get cropped differently and scaled differently, so the same shop
  // with the same settings gets two different widths — and any blank the
  // capture picked up beside the slip gets scaled in with it, squeezing the
  // receipt into part of the roll.
  //
  // So the document states its own width. This is a hairline the full width
  // of the slip, printed at the very top. The raster stage reads row one,
  // takes the first and last inked column as the document's edges, crops to
  // them and then discards the bar itself. It is the same two columns on
  // every bill, so the crop is identical on every bill.
  const rule = mode === 'raster'
    ? '<div class="dt-measure" aria-hidden="true"></div>'
    : '';
  // ===== CUTTER CLEARANCE (Windows-driver path only) =====
  //
  // The cutter sits 15–25 mm above the print head. A thermal driver trims the
  // blank end of the page and cuts straight after the last line it printed,
  // so the last 15–25 mm of the slip were still below the blade: the footer
  // ("Printed …", "Powered by …") came out on top of the NEXT slip — the
  // Lahore report. Blank space alone is trimmed away too, so the clearance
  // ends in a single dot the driver has to print. The raster path feeds its
  // own exact clearance before the cut and gets none of this.
  const clearanceMm = Math.max(0, Math.min(40, Number(args.cutClearanceMm ?? DRIVER_CUT_CLEARANCE_MM) + extraFeed(args)));
  // Nested one level: the direct children of .dt-fast-root are forced to
  // height:auto (see the head), which would collapse a plain spacer.
  const spacer = mode === 'html' && args.autoCut !== false && clearanceMm > 0
    ? `<div class="dt-cut-clearance" aria-hidden="true"><div style="display:block;height:${clearanceMm}mm;"></div><div style="display:block;width:1px;height:1px;margin:0 auto;background:#000;"></div></div>`
    : '';
  return `${buildHead(args, mode)}<body class="thermal-printing${args.compact ? ' thermal-compact' : ''}"><div class="dt-fast-root receipt-print-portal" data-active-print="true">${rule}${body}${spacer}</div></body></html>`;
}

/**
 * Resolve the slip's layout from the call and the device's settings.
 *
 * This is the ONLY place the fast path decides its geometry, and it is the
 * same resolver the ESC/POS builder and the alignment test use. Two resolvers
 * disagreeing about the content width is what let the raster path measure
 * correctly while the driver path printed lopsided.
 */
function layoutFor(args: FastPrintArgs): ReceiptLayout {
  const saved = loadPrintMargins();
  return resolveReceiptLayout({
    paper: (args.paperWidth || '80mm') as PaperSize,
    leftMm: args.marginLeftMm ?? saved.left,
    rightMm: args.marginRightMm ?? saved.right,
    contentWidthMm: args.contentWidthMm ?? saved.contentWidthMm,
  });
}

export interface FastPrintResult {
  success: boolean;
  error?: string;
  warning?: string;
  /** Which route printed: the rendered image as RAW, or the Windows driver. */
  route?: 'raster' | 'driver';
  /** Why the image route was not used (e.g. a blank capture), when it was not. */
  rasterError?: string;
}

/**
 * Print a slip through the hidden print window. Resolves as soon as the
 * spooler has accepted the job; the POS UI is never blocked meanwhile.
 */
export async function fastPrintHtml(args: FastPrintArgs): Promise<FastPrintResult> {
  const bridge = api();
  if (!bridge?.printHtml) return { success: false, error: 'fast print unavailable' };
  const text = args.html.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
  if (text.length < 20) return { success: false, error: 'blank slip — skipped' };
  try {
    // Prevent fallback-font snapshots. Only Urdu/Nastaleeq needs this; Latin
    // slips hand off immediately (this wait was pure delay on every bill).
    const needsComplexFont = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]|aseer|sameer|jameel|nastaleeq|urdu/i.test(args.html);
    if (needsComplexFont && document.fonts?.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise<void>(resolve => window.setTimeout(resolve, 700)),
      ]);
    }
    // Preferred desktop path: Chromium renders the COMPLETE selected template
    // (including logo, compact mode and Urdu shaping) once, then Electron sends
    // that rendered bitmap as one ESC/POS RAW job followed by one cut command.
    // This keeps the visual template intact; the older text-only raw builder did
    // not, and was the source of simplified / short slips.
    const quality = effectivePrintQuality();
    const layout = layoutFor(args);
    const payload = {
      html: buildDocument(args, 'raster'),
      printerName: args.printerName,
      copies: Math.max(1, args.copies || 1),
      silent: true,
      printBackground: true,
      pageWidthMicrons: args.pageWidthMicrons,
      pageHeightMicrons: args.pageHeightMicrons,
      usePrinterDefaultPageSize: args.usePrinterDefaultPageSize === true,
      paperLabel: args.paperWidth,
      autoCut: args.autoCut !== false,
      // Print-quality controls (device-local Printer Settings). These affect
      // only the raster conversion — the template/design is untouched.
      darkness: quality.darkness,
      boldPrint: quality.bold,
      qualityScale: quality.scale,
      // Standard / Bold / Extra bold — applied in the print window.
      textWeight: quality.weight,
      // The raster stage inserts these as whole printer dots. The document
      // above was laid out at exactly layout.contentMm with no side padding,
      // so this is the ONE place the margins are applied on this path.
      marginLeftMm: layout.leftMm,
      marginRightMm: layout.rightMm,
      contentWidthMm: layout.contentMm,
      // Safe distance between the final receipt line and the physical cutter:
      // six default lines (about 25 mm at the usual 1/6" spacing), plus the
      // printer's own extra feed in ~4 mm lines. It does not alter or
      // truncate the selected receipt template.
      bottomFeedLines: 6 + Math.ceil(extraFeed(args) / 4),
    };
    // 'Windows driver only' skips the raster stage but keeps the worker, so
    // the job never touches the POS window.
    const raster = (bridge.printHtmlEscpos && !args.preferDriver)
      ? await bridge.printHtmlEscpos(payload)
      : { success: false, error: args.preferDriver ? 'driver mode requested' : 'rendered ESC/POS unavailable' };
    if (raster?.success) {
      return { success: true, warning: raster.warning, route: 'raster' };
    }

    // Compatibility fallback for a Windows driver which does not accept RAW
    // ESC/POS. It remains silent and prints the same rendered HTML template.
    // The driver prints the page as-is, with no raster stage to offset it, so
    // this document carries the margins as real page padding instead.
    const res = await bridge.printHtml({
      ...payload,
      html: buildDocument(args, 'html'),
    });
    return { success: !!res?.success, error: res?.error, warning: res?.warning, route: 'driver', rasterError: raster?.error };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}

/**
 * Build the exact document the hidden print worker loads.
 *
 * Exported so the printer simulator (scripts/simulate-print.mjs) can render
 * and rasterise the real thing rather than an approximation of it — the
 * whole point of the simulation is that it is not a separate implementation.
 */
export function buildWorkerDocument(args: FastPrintArgs, mode: DocumentMode = 'raster') {
  const layout = layoutFor(args);
  return { html: buildDocument(args, mode), geometry: layout, layout };
}

/** Read the CSS custom properties the receipt root carries (margins/offsets). */
export function inlineRootVars(el: HTMLElement | null): string {
  if (!el) return '';
  try { return el.getAttribute('style') || ''; } catch { return ''; }
}
