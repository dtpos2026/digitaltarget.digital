// ============================================================
// Thermal-print CSS — optimized for 203 DPI ESC/POS thermal printers.
//
// Hard rules (applied to every print job):
//   1. Browser scaling 100% — no transform / zoom / scale
//   2. Receipt width fixed (80mm = 576px, 58mm = 384px @ 203 DPI)
//   3. Fonts limited to Arial / Roboto Mono / Courier New
//   4. No canvas resizing — render text as text, not bitmap
//   5. Page + body margin: 0
//   6. Font smoothing tuned for dark, readable thermal text
//   7. Item rows min-height 24px
//   8. Border width 1px only
//   9. Receipt/KOT body text stays bold enough for 203 DPI heads
//  10. Density-friendly: tighter line-height, no anti-alias bleed
// ============================================================
import type { PaperSize } from './printConfig';

// Browser print uses CSS pixels at 96 DPI (1mm = 3.7795 CSS px), NOT the
// printer's 203 DPI. If we lock width in 203-DPI pixels (e.g. 576px for 80mm)
// the browser prints ~152mm wide on 80mm paper — content explodes off the
// roll. Always express width in mm; the printer driver maps mm -> dots.
function widthMm(paper: PaperSize): number {
  if (paper === '58mm') return 58;
  if (paper === '110mm') return 110;
  return 80;
}
// Printable area (subtract head margins). Used only as a CSS-px cap so very
// long words wrap and tables don't overflow the paper.
function printableWidthCssPx(paper: PaperSize): number {
  // 1mm ≈ 3.78 CSS px at 96 DPI
  const printableMm = paper === '58mm' ? 48 : paper === '110mm' ? 100 : 72;
  return Math.round(printableMm * 3.78);
}

export function buildPrintCss(paperWidth: PaperSize, compact: boolean = false): string {
  const mm = widthMm(paperWidth);          // physical paper width (mm)
  const capPx = printableWidthCssPx(paperWidth); // CSS-px cap for on-screen portal
  const compactBlock = compact ? buildCompactOverrides() : '';
  return `
    @page {
      size: ${paperWidth} auto;        /* auto height — dynamic */
      margin: 0 !important;            /* Rule 7: zero printer margins */
    }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      color: #000 !important;
      overflow: visible !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
      /* Rule 5: disable browser shrink-to-fit */
      -webkit-print-scale: 1 !important;
      print-scale: 1 !important;
    }
    body.thermal-printing {
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      overflow: visible !important;
    }
    body.thermal-printing > *:not(.receipt-print-portal[data-active-print="true"]) {
      display: none !important;
    }
    body.thermal-printing .receipt-print-portal {
      display: none !important;
    }
    body.thermal-printing .receipt-print-portal[data-active-print="true"] {
      display: block !important;
      position: fixed !important;
      left: 0 !important;
      top: 0 !important;
      width: ${mm}mm !important;        /* Rule 3: exact 80mm width */
      height: auto !important;
      max-height: none !important;
      min-height: 0 !important;
      overflow: visible !important;
      background: #fff !important;
      z-index: 2147483647 !important;
      opacity: 1 !important;
      visibility: visible !important;
      pointer-events: none !important;
    }
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt {
      /* Rule 3,4: exact width, scale 100%, no transform/zoom */
      width: ${mm}mm !important;
      max-width: ${mm}mm !important;
      min-width: ${mm}mm !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      margin: 0 !important;
      padding: var(--dt-print-padding-top, 0mm) var(--dt-print-padding-right, 4mm) var(--dt-print-padding-bottom, 0mm) var(--dt-print-padding-left, 4mm) !important;
      box-sizing: border-box !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      background: #fff !important;
      color: #000 !important;
      overflow: visible !important;
      word-wrap: break-word !important;
      overflow-wrap: anywhere !important;

      /* Rule 4: scale 100% — disable any transform / zoom */
      transform: none !important;
      zoom: 1 !important;
      -webkit-transform: none !important;

      /* Rule 6: high DPI print rendering */
      -webkit-font-smoothing: antialiased !important;
      -moz-osx-font-smoothing: grayscale !important;
      text-rendering: geometricPrecision !important;
      image-rendering: -webkit-optimize-contrast !important;

      /* WYSIWYG: template ki apni font-family / size / weight hi print hoti hai.
         Yahan koi typography force nahi ki jati — jo preview me dikha wahi chhapta hai. */
    }

    /* Rule 4,8: kill transform/zoom on ALL descendants; force pure black */
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt *,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt *::before,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt *::after {
      transform: none !important;
      zoom: 1 !important;
      -webkit-transform: none !important;
      -webkit-font-smoothing: antialiased !important;
      text-rendering: geometricPrecision !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
      /* Rule 8: black only */
      color: #000 !important;
      border-color: #000 !important;
    }

    /* ===== Inverted header fix (v1.2.3 — "black bar at top" on Black Copper) =====
       KOT/receipt templates use white-on-black header bands (inline
       style color:#fff on a black background). The global color:#000
       override above turned that white text BLACK — invisible inside the
       black band, so the printout showed a solid black strip at the top.
       Preserve white text wherever the template explicitly asked for it.
       React serializes color:'#fff' as color: rgb(255, 255, 255). */
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt [style*="color: rgb(255, 255, 255)"],
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt [style*="color:#fff"],
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt [style*="color: #fff"],
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt [style*="color:#FFF"],
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt [style*="color: white"] {
      color: #fff !important;
    }


    body.thermal-printing .receipt-print-portal[data-active-print="true"] .receipt-print-content {
      width: 100% !important;
      max-width: 100% !important;
      zoom: 1 !important;
      transform: none !important;
    }


    /* Tables — 1px black borders only */
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt table {
      width: 100% !important;
      table-layout: fixed !important;
      border-collapse: collapse !important;
    }


    /* Logos — keep crisp, force black. background:#fff prevents transparent
       PNGs from compositing onto black (another "black at top" cause). */
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt img {
      image-rendering: -webkit-optimize-contrast !important;
      max-width: 100% !important;
      background: #fff !important;
    }

    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt > *:first-child,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .receipt-print-content,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .receipt-print-content > *:first-child {
      margin-top: 0 !important;
      padding-top: 0 !important;
      border-top: 0 !important;
    }

    @media print {
      @page { size: ${paperWidth} auto; margin: 0 !important; }
      html, body {
        width: ${mm}mm !important;
        height: auto !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
        background: #fff !important;
        color: #000 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
        /* Rule 5: disable shrink-to-fit in print engine */
        -webkit-print-scale: 1 !important;
        print-scale: 1 !important;
      }
      .receipt-print-portal { display: none !important; }
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] {
        display: block !important;
        height: auto !important;
        overflow: visible !important;
      }
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt {
        width: ${mm}mm !important;
        max-width: ${mm}mm !important;
        min-width: ${mm}mm !important;
        height: auto !important;
        max-height: none !important;
        min-height: 0 !important;
        overflow: visible !important;
        padding: var(--dt-print-padding-top, 0mm) var(--dt-print-padding-right, 4mm) var(--dt-print-padding-bottom, 0mm) var(--dt-print-padding-left, 4mm) !important;
        margin: 0 !important;
        box-sizing: border-box !important;
        transform: none !important;
        zoom: 1 !important;
        -webkit-transform: none !important;
        -webkit-font-smoothing: antialiased !important;
        text-rendering: geometricPrecision !important;
        color: #000 !important;
        word-wrap: break-word !important;
        overflow-wrap: anywhere !important;
        page-break-after: avoid !important;
        break-after: avoid !important;
      }
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt *,
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt *::before,
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt *::after {
        transform: none !important;
        zoom: 1 !important;
        -webkit-transform: none !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
        color: #000 !important;
        border-color: #000 !important;
      }
      /* Inverted header fix — keep explicit white text white (see above). */
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt [style*="color: rgb(255, 255, 255)"],
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt [style*="color:#fff"],
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt [style*="color: #fff"],
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt [style*="color:#FFF"],
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt [style*="color: white"] {
        color: #fff !important;
      }
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .receipt-print-content {
        width: 100% !important;
        max-width: 100% !important;
        zoom: 1 !important;
        transform: none !important;
      }
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt table {
        width: 100% !important;
        table-layout: fixed !important;
        border-collapse: collapse !important;
      }
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt img {
        image-rendering: -webkit-optimize-contrast !important;
        background: #fff !important;
        }
    }
    ${compactBlock}
  `;
}

// ============================================================
// Compact Thermal Print Mode — Global paper-saving overrides.
// Applied when body has class `thermal-compact`. Tightens font,
// line-height, padding, row height, image size across ALL existing
// receipt + KOT templates. Goal: 30-40% less paper usage.
// ============================================================
function buildCompactOverrides(): string {
  // Both screen (portal) and @media print variants
  const sels = [
    'body.thermal-printing.thermal-compact .receipt-print-portal[data-active-print="true"] .print-receipt',
    'body[data-print-active="true"].thermal-compact .receipt-print-portal[data-active-print="true"] .print-receipt',
  ];
  const star = sels.map(s => `${s} *`).join(',');
  const root = sels.join(',');
  return `
    /* ===== Compact mode — global paper-saving overrides =====
       Font size + line height are driven by CSS variables so user can
       fine-tune from Settings without touching code:
         --dt-compact-font-size   (default 11px)
         --dt-compact-line-height (default 1.15)
       Logo is preserved at its own width/height (set via inline style on
       the <img>) unless body has class thermal-compact-shrink-logo. */
    ${root} {
      font-size: var(--dt-compact-font-size, 11px) !important;
      line-height: var(--dt-compact-line-height, 1.15) !important;
      padding-top: 0 !important;
      padding-bottom: 0 !important;
    }
    ${star} {
      font-size: var(--dt-compact-font-size, 11px) !important;
      line-height: var(--dt-compact-line-height, 1.15) !important;
      letter-spacing: 0 !important;
    }
    ${sels.map(s => `${s} h1`).join(',')} { font-size: calc(var(--dt-compact-font-size, 11px) + 3px) !important; line-height: 1.1 !important; }
    ${sels.map(s => `${s} h2`).join(',')} { font-size: calc(var(--dt-compact-font-size, 11px) + 2px) !important; line-height: 1.1 !important; }
    ${sels.map(s => `${s} h3, ${s} h4, ${s} .grand-total`).join(',')} { font-size: calc(var(--dt-compact-font-size, 11px) + 1px) !important; line-height: 1.1 !important; }
    /* Only shrink images when explicitly requested — by default logo keeps
       its declared width/height so brand identity stays intact. */
    body.thermal-compact-shrink-logo ${sels.map(s => `${s} img`).join(', body.thermal-compact-shrink-logo ')} {
      max-height: 40px !important;
      max-width: 40px !important;
    }
    ${sels.map(s => `${s} tbody tr, ${s} .item-row`).join(',')} {
      min-height: 14px !important;
      line-height: var(--dt-compact-line-height, 1.15) !important;
    }
    ${sels.map(s => `${s} tbody td, ${s} thead th`).join(',')} {
      padding: 1px 3px !important;
      vertical-align: top !important;
    }
    ${sels.map(s => `${s} p`).join(',')} {
      margin: 0 !important;
    }
    ${sels.map(s => `${s} > * + *`).join(',')} {
      margin-top: 1px !important;
    }
    /* Trim big gaps inside templates */
    ${sels.map(s => `${s} [style*="margin-bottom"], ${s} [style*="marginBottom"]`).join(',')} {
      margin-bottom: 2px !important;
    }
    ${sels.map(s => `${s} [style*="padding-top"], ${s} [style*="paddingTop"]`).join(',')} {
      padding-top: 2px !important;
    }
    ${sels.map(s => `${s} [style*="padding-bottom"], ${s} [style*="paddingBottom"]`).join(',')} {
      padding-bottom: 2px !important;
    }
    @media print {
      body.thermal-compact .receipt-print-portal[data-active-print="true"] .print-receipt,
      body[data-print-active="true"].thermal-compact .receipt-print-portal[data-active-print="true"] .print-receipt {
        font-size: 11px !important;
        line-height: 1.15 !important;
      }
    }
  `;
}

const STYLE_ID = 'dt-print-style';

export function injectPrintCss(paperWidth: PaperSize, compact: boolean = false) {
  if (typeof document === 'undefined') return () => {};
  document.getElementById(STYLE_ID)?.remove();
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = buildPrintCss(paperWidth, compact);
  document.head.appendChild(style);
  return () => style.remove();
}
