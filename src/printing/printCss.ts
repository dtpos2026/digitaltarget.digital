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
import { isElectron } from '@/lib/electron';
// ONE source of truth for paper widths. This file used to carry its own copy
// of the numbers, and its 110mm printable width (100mm) disagreed with the
// 104mm every other module used — a 4mm drift that landed straight on the
// right margin of a wide slip.
import { paperMmOf as profilePaperMm, printableMmOf as profilePrintableMm } from './paperProfile';

// Browser print uses CSS pixels at 96 DPI (1mm = 3.7795 CSS px), NOT the
// printer's 203 DPI. If we lock width in 203-DPI pixels (e.g. 576px for 80mm)
// the browser prints ~152mm wide on 80mm paper — content explodes off the
// roll. Always express width in mm; the printer driver maps mm -> dots.
function widthMm(paper: PaperSize): number {
  return profilePaperMm(paper);
}
// Printable area (subtract head margins). Used only as a CSS-px cap so very
// long words wrap and tables don't overflow the paper.
function printableWidthCssPx(paper: PaperSize): number {
  // 1mm ≈ 3.78 CSS px at 96 DPI
  return Math.round(printableMmOf(paper) * 3.78);
}
// Thermal head's actual printable width (less than the paper width — on an
// 80mm roll it's ~72mm, on 58mm it's ~48mm). Sending full paper-width content
// used to cut off ~8mm on the right side (Issue: right margin cut).
function printableMmOf(paper: PaperSize): number {
  return profilePrintableMm(paper);
}

export function buildPrintCss(paperWidth: PaperSize, compact: boolean = false): string {
  const mm = widthMm(paperWidth);          // physical paper width (mm)
  const printableMm = printableMmOf(paperWidth); // width the head can actually mark
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
    body.thermal-printing .receipt-print-portal {
      display: none !important;
    }
    /* ===== Kept from the cloud app (v1.29.4): the screen is left alone =====
       A print session used to hide the whole application on screen and drop the receipt, opaque, at the top-left
       corner at the maximum z-index. A payment runs several sessions back to back (measure, probe, print,
       fallback), so the till blanked out and flashed a receipt on every bill. Hiding the app and revealing the
       receipt belongs in @media print (below). On a monitor the portal only has to be LAID OUT at true paper width,
       because the page height is measured from it — so it sits off-screen, laid out but never looked at. */
    body.thermal-printing .receipt-print-portal[data-active-print="true"] {
      display: block !important;
      position: fixed !important;
      left: -20000px !important;        /* laid out for measurement, never seen */
      top: 0 !important;
      width: ${mm}mm !important;        /* Rule 3: exact 80mm width */
      height: auto !important;
      max-height: none !important;
      min-height: 0 !important;
      overflow: visible !important;
      background: #fff !important;
      z-index: 2147483647 !important;
      opacity: 0 !important;
      visibility: visible !important;   /* visible, so it still lays out to measure */
      pointer-events: none !important;
    }
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt {
      /* Rule 3,4: exact width, scale 100%, no transform/zoom */
      /* OLD-POS PORT: content = FULL paper width (80mm/58mm) + EQUAL padding on
         both sides (below). With explicit pageSize + marginType:none, the
         driver fits the printable area itself — this combo made the old
         software print perfectly on every thermal printer. The calibration
         override (--dt-print-content-width) still works. */
      width: var(--dt-print-content-width, ${printableMm}mm) !important;
      max-width: var(--dt-print-content-width, ${printableMm}mm) !important;
      min-width: 0 !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      position: relative !important;
      top: var(--dt-print-offset-top, 0mm) !important;
      left: calc(var(--dt-print-offset-left, 0mm) - var(--dt-print-offset-right, 0mm)) !important;
      margin: 0 auto !important;
      padding: var(--dt-print-padding-top, 0mm) var(--dt-print-padding-right, 2mm) var(--dt-print-padding-bottom, 0mm) var(--dt-print-padding-left, 2mm) !important; /* equal 2mm L/R, top 0 */
      box-sizing: border-box !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      background: #fff !important;
      color: #000 !important;
      overflow: visible !important;
      word-wrap: break-word !important;
      overflow-wrap: break-word !important;
      word-break: normal !important;

      /* Rule 6: high DPI print rendering */
      -webkit-font-smoothing: antialiased !important;
      -moz-osx-font-smoothing: grayscale !important;
      text-rendering: geometricPrecision !important;
      image-rendering: -webkit-optimize-contrast !important;

      /* Keep the template's configured font, size and line-height. In
         particular, do not replace Jameel Noori/Aseer/Sameer with Arial. */
      letter-spacing: 0 !important;
    }

    /* Rule 4,8: kill transform/zoom on ALL descendants; force pure black */
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt *,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt *::before,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt *::after {
      -webkit-font-smoothing: antialiased !important;
      text-rendering: geometricPrecision !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
      /* Rule 8: black only */
      color: #000 !important;
      border-color: #000 !important;
    }


    /* ===== Reversed blocks (knocked-out text on a solid dark fill) =====
       The blanket "everything is pure black" rule above is what keeps
       thermal output dark and readable, but it also repaints white text
       black — leaving a solid bar with nothing legible on it. Blocks that
       deliberately reverse out opt in with .dt-reverse, which carries one
       extra class of specificity and so wins.
       This is safe on a thermal head: the raster stage marks ink where the
       pixel is dark, so a black fill prints solid and the letters stay as
       bare paper. */
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt .dt-reverse,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt .dt-reverse *,
    body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt .dt-reverse,
    body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt .dt-reverse * {
      color: #fff !important;
      background-color: #000 !important;
      border-color: #000 !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .receipt-print-content {
      width: 100% !important;
      max-width: 100% !important;
    }

    /* ===== Shop text spacing (Settings → Receipt / KOT → Text spacing) =====
       Only on slips that carry the attributes (src/lib/textSpacing.ts); the
       extra attribute outranks the root letter-spacing above and compact
       mode's row line-height. */
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt[data-dt-spacing],
    body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt[data-dt-spacing] {
      word-spacing: var(--dt-word-spacing, normal) !important;
      letter-spacing: var(--dt-letter-spacing, 0) !important;
    }
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt[data-dt-line] *,
    body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt[data-dt-line] * {
      line-height: var(--dt-line-height) !important;
    }

    /* Headings always extra-bold */
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt h1,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt h2,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt h3,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt h4,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt .kot-heading,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt thead th {
      font-weight: 900 !important;
    }

    /* Rule 2: item names bold */
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt .item-name,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt .item-title,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt td.item-name,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt .item-row td:first-child,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt tbody tr td:first-child {
      font-weight: 800 !important;
    }

    /* Tables — 1px black borders only */
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt table {
      width: 100% !important;
      table-layout: fixed !important;
      border-collapse: collapse !important;
    }
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt table,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt th,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt td {
      border-width: 1px !important;
      border-color: #000 !important;
    }

    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt tbody tr,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt .item-row {
      min-height: 24px !important;
      line-height: 1.3 !important;
    }
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt tbody td {
      padding: 4px 4px !important;
      vertical-align: middle !important;
    }

    /* Logos — keep crisp, force black. background:#fff stops a transparent PNG compositing onto black (the other
       cause of a black strip at the top of a slip). */
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt img {
      image-rendering: -webkit-optimize-contrast !important;
      max-width: 100% !important;
      background: #fff !important;
      filter: grayscale(100%) contrast(1.4) brightness(0.9) !important;
    }

    /* Templates draw white-on-black header bands (inline color:#fff on a black fill). The global color:#000 above
       turned that white text black — invisible inside the band, so the slip printed a solid black strip. Keep white
       wherever the template asked for it. React serialises color:'#fff' as color: rgb(255, 255, 255). */
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt [style*="color: rgb(255, 255, 255)"],
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt [style*="color:#fff"],
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt [style*="color: #fff"],
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt [style*="color:#FFF"],
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt [style*="color: white"] {
      color: #fff !important;
    }

    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt > *:first-child,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .receipt-print-content,
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .receipt-print-content > *:first-child {
      margin-top: 0 !important;
      padding-top: 0 !important;
      border-top: 0 !important;
    }

    /* Universal safety: any element explicitly marked as the receipt root
       gets zero top margin/padding so no template can silently inject a
       5–6 inch blank top gap. */
    body.thermal-printing .receipt-root,
    body[data-print-active="true"] .receipt-root,
    .receipt-root {
      margin-top: 0 !important;
      padding-top: 0 !important;
    }

    @media print {
      @page { size: ${paperWidth} auto; margin: 0 !important; }
      /* On paper the application chrome must be gone and the receipt must sit at the page origin, opaque, in
         normal flow (the v1.21.0 rule: content starts right at the top of the page, the same on every driver).
         On a monitor, neither. */
      body.thermal-printing > *:not(.receipt-print-portal[data-active-print="true"]) {
        display: none !important;
      }
      body.thermal-printing[data-print-active="true"] .receipt-print-portal[data-active-print="true"] {
        position: static !important;
        left: 0 !important;
        top: 0 !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
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
      /* ===== FIX v1.0.38 (client: "KOT qty not printing") =====
         Yeh rule pehle "background:#000; color:#fff" tha. KOT qty boxes
         is class ko use karte hain — inline style me "color:#000;
         background:transparent" likha hota hai, lekin stylesheet ka
         !important inline style ko haraa deta hai. Natija: print ke waqt
         qty SAFED ho jati thi → thermal printer par safed = koi ink nahi
         → qty ghayab. Browser preview me background render hota tha is
         liye screen par theek lagta tha (client ne isi liye kaha "online
         software jaisa nahi chhap raha").
         Ab: kaala text + solid border, background transparent — yehi
         inline styles ka asal maqsad tha aur thermal-safe bhi hai. */
      .print-black-box, .print-black-box * {
        background: transparent !important;
        color: #000 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .print-black-box {
        border: 2px solid #000 !important;
        font-weight: 900 !important;
      }
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] {
        display: block !important;
        height: auto !important;
        overflow: visible !important;
      }
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt {
        width: var(--dt-print-content-width, ${printableMm}mm) !important;
        max-width: var(--dt-print-content-width, ${printableMm}mm) !important;
        min-width: 0 !important;
        height: auto !important;
        max-height: none !important;
        min-height: 0 !important;
        overflow: visible !important;
        padding: var(--dt-print-padding-top, 0mm) var(--dt-print-padding-right, 2mm) var(--dt-print-padding-bottom, 0mm) var(--dt-print-padding-left, 2mm) !important; /* equal 2mm L/R, top 0 */
        position: relative !important;
        top: var(--dt-print-offset-top, 0mm) !important;
        left: calc(var(--dt-print-offset-left, 0mm) - var(--dt-print-offset-right, 0mm)) !important;
        margin: 0 auto !important;
        box-sizing: border-box !important;
        -webkit-font-smoothing: antialiased !important;
        text-rendering: geometricPrecision !important;
        /* Preserve the exact configured template typography. */
        color: #000 !important;
        word-wrap: break-word !important;
        overflow-wrap: break-word !important;
        word-break: normal !important;
        page-break-after: avoid !important;
        break-after: avoid !important;
      }
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt *,
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt *::before,
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt *::after {
        max-width: 100% !important;
        box-sizing: border-box !important;
        color: #000 !important;
        border-color: #000 !important;
      }
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt .dt-reverse,
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt .dt-reverse *,
      body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt .dt-reverse,
      body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt .dt-reverse * {
        color: #fff !important;
        background-color: #000 !important;
        border-color: #000 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt .item-name,
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt .item-title,
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt td.item-name,
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt .item-row td:first-child,
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt tbody tr td:first-child {
        font-weight: 800 !important;
      }
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .receipt-print-content {
        width: 100% !important;
        max-width: 100% !important;
      }
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt tbody tr,
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt .item-row {
        min-height: 24px !important;
        line-height: 1.3 !important;
      }
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt table {
        width: 100% !important;
        table-layout: fixed !important;
        border-collapse: collapse !important;
      }
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt table,
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt th,
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt td {
        border-width: 1px !important;
        border-color: #000 !important;
      }
      body[data-print-active="true"] .receipt-print-portal[data-active-print="true"] .print-receipt img {
        image-rendering: -webkit-optimize-contrast !important;
        filter: grayscale(100%) contrast(1.4) brightness(0.9) !important;
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
  const each = (part: string) => sels.map(s => part.replace(/\$S/g, s)).join(',');
  return `
    /* ============================================================
       COMPACT / SAVE-PAPER MODE
       ------------------------------------------------------------
       Target: 30-40% shorter slip than Normal, while staying just as
       readable. The saving comes almost entirely from VERTICAL space,
       not from shrinking the type:

         - blank paragraph/DIV margins collapse to nothing
         - the gap between sections drops from ~6px to 2px
         - item rows lose their 24px minimum height
         - table cells lose their vertical padding
         - separators keep 1px of air instead of 6px
         - dead trailing space at the end of the slip is removed

       Type only steps down one notch (12px vs the 13px normal body) and
       stays at weight 700, so the print is still dark and sharp on a
       203 DPI head. Both are user-tunable from Settings:
         --dt-compact-font-size   (default 12px, floor 10px)
         --dt-compact-line-height (default 1.12)
       Logo keeps its declared size unless the shop opts into
       thermal-compact-shrink-logo.
       ============================================================ */
    ${root} {
      font-size: var(--dt-compact-font-size, 12px) !important;
      line-height: var(--dt-compact-line-height, 1.12) !important;
      /* Kept bold: compact must not read lighter than normal. */
      font-weight: 700 !important;
      padding-top: 0 !important;
      padding-bottom: 0 !important;
    }
    ${star} {
      font-size: var(--dt-compact-font-size, 12px) !important;
      line-height: var(--dt-compact-line-height, 1.12) !important;
      letter-spacing: 0 !important;
    }
    /* Urdu/Nastaleeq needs its descenders — never squeeze these lines. */
    ${each('$S [dir="rtl"], $S .urdu-text')} {
      direction: rtl !important;
      unicode-bidi: plaintext !important;
      word-break: keep-all !important;
      overflow-wrap: normal !important;
      line-height: 1.6 !important;
      font-weight: 700 !important;
    }
    /* Headings stay clearly bigger than the body so the hierarchy survives. */
    ${each('$S h1')} { font-size: calc(var(--dt-compact-font-size, 12px) + 4px) !important; line-height: 1.08 !important; margin: 0 !important; }
    ${each('$S h2')} { font-size: calc(var(--dt-compact-font-size, 12px) + 3px) !important; line-height: 1.08 !important; margin: 0 !important; }
    ${each('$S h3, $S h4')} { font-size: calc(var(--dt-compact-font-size, 12px) + 1px) !important; line-height: 1.08 !important; margin: 0 !important; }
    /* The total is the one line a customer always looks for — it keeps a
       full size step and its own breathing room. */
    ${each('$S .grand-total')} {
      font-size: calc(var(--dt-compact-font-size, 12px) + 3px) !important;
      line-height: 1.15 !important;
      font-weight: 900 !important;
    }
    /* Only shrink images when explicitly requested — by default logo keeps
       its declared width/height so brand identity stays intact. */
    body.thermal-compact-shrink-logo ${each('$S img')} {
      max-height: 40px !important;
      max-width: 40px !important;
    }

    /* ===== Vertical space — this is where the paper is saved ===== */
    ${each('$S tbody tr, $S .item-row')} {
      /* Normal mode holds rows at 24px so they never look cramped; compact
         lets them collapse to the text's own height. On a 12-line bill this
         alone is roughly a centimetre of paper. */
      min-height: 0 !important;
      height: auto !important;
      line-height: var(--dt-compact-line-height, 1.12) !important;
    }
    ${each('$S tbody td, $S thead th')} {
      padding: 0 3px !important;
      vertical-align: top !important;
    }
    ${each('$S p, $S ul, $S ol, $S dl, $S figure, $S blockquote')} {
      margin: 0 !important;
    }
    ${each('$S > * + *')} {
      margin-top: 1px !important;
    }
    ${each('$S div + div')} {
      margin-top: 0 !important;
    }
    /* Dashed/solid separators: 1px of air either side instead of ~6px. */
    ${each('$S hr')} {
      margin: 1px 0 !important;
      border-top-width: 1px !important;
    }
    ${each('$S [style*="border-top"], $S [style*="borderTop"], $S [style*="border-bottom"], $S [style*="borderBottom"]')} {
      margin-top: 1px !important;
      margin-bottom: 1px !important;
    }
    /* Templates carry generous inline spacing for Normal mode. Compact
       clamps those values rather than removing them, so nothing collides. */
    ${each('$S [style*="margin-bottom"], $S [style*="marginBottom"]')} {
      margin-bottom: 1px !important;
    }
    ${each('$S [style*="margin-top"], $S [style*="marginTop"]')} {
      margin-top: 1px !important;
    }
    ${each('$S [style*="padding-top"], $S [style*="paddingTop"]')} {
      padding-top: 1px !important;
    }
    ${each('$S [style*="padding-bottom"], $S [style*="paddingBottom"]')} {
      padding-bottom: 1px !important;
    }
    ${each('$S [style*="padding"]')} {
      padding-top: 1px !important;
      padding-bottom: 1px !important;
    }
    /* No dead paper before the cut. */
    ${each('$S > *:last-child')} {
      margin-bottom: 0 !important;
      padding-bottom: 0 !important;
    }
    ${each('$S br + br')} {
      display: none !important;
    }

    @media print {
      body.thermal-compact .receipt-print-portal[data-active-print="true"] .print-receipt,
      body[data-print-active="true"].thermal-compact .receipt-print-portal[data-active-print="true"] .print-receipt {
        font-size: var(--dt-compact-font-size, 12px) !important;
        line-height: var(--dt-compact-line-height, 1.12) !important;
      }
      /* Normal mode's 24px row floor is set inside @media print too, and it
         is more specific than the compact rule above — without this the
         rows stayed tall and compact saved almost nothing on paper. */
      body.thermal-compact .receipt-print-portal[data-active-print="true"] .print-receipt tbody tr,
      body.thermal-compact .receipt-print-portal[data-active-print="true"] .print-receipt .item-row,
      body[data-print-active="true"].thermal-compact .receipt-print-portal[data-active-print="true"] .print-receipt tbody tr,
      body[data-print-active="true"].thermal-compact .receipt-print-portal[data-active-print="true"] .print-receipt .item-row {
        min-height: 0 !important;
        height: auto !important;
        line-height: var(--dt-compact-line-height, 1.12) !important;
      }
      body.thermal-compact .receipt-print-portal[data-active-print="true"] .print-receipt tbody td,
      body[data-print-active="true"].thermal-compact .receipt-print-portal[data-active-print="true"] .print-receipt tbody td {
        padding: 0 3px !important;
      }
    }
  `;
}

// ============================================================
// v1.105.0 — BROWSER PRINTING PRINTS THE DESIGN, NOT THE THERMAL RULES
//
// Reported: "the printout is not clean and is not as designed — it changes in the browser".
// The stylesheet above is written for a 203-DPI thermal HEAD in the desktop app: it repaints every colour black, forces 1 px black
// borders on every table and cell, forces fixed table layout, bold on first columns and headings, a grey filter on logos and a
// fixed content width, and declares `@page { size: 80mm auto }` — which no browser accepts (a page height may not be `auto` next
// to a length), so the whole `size` rule is dropped. Printed from a browser to an ordinary printer or a PDF, all of that
// changes the slip the shop designed: grid lines appear, greys and colours turn black, the logo darkens.
//
// In a browser (no desktop app) the slip now prints as designed: the template's own colours, borders, weights, widths and fonts;
// backgrounds forced on (so tinted bands and boxes print); no invented `size`; margin 0; everything else on the page hidden.
// The desktop app is untouched. A shop that prints from a browser straight to a thermal head and prefers the all-black rendering
// can switch back in Settings → Printer ("Print for a thermal head").
// ============================================================
export type BrowserPrintStyle = 'design' | 'thermal';
export const BROWSER_PRINT_STYLE_KEY = 'dtpos-browser-print-style';
export function getBrowserPrintStyle(): BrowserPrintStyle {
  try { return localStorage.getItem(BROWSER_PRINT_STYLE_KEY) === 'thermal' ? 'thermal' : 'design'; } catch { return 'design'; }
}
export function setBrowserPrintStyle(v: BrowserPrintStyle): void {
  try { localStorage.setItem(BROWSER_PRINT_STYLE_KEY, v); } catch { /* storage unavailable */ }
}

/** The slip exactly as designed, for a browser's print dialog. */
export function buildBrowserPrintCss(paperWidth: PaperSize, compact: boolean = false): string {
  const mm = widthMm(paperWidth);
  const compactBlock = compact ? buildCompactOverrides() : '';
  return `
    @page { margin: 0 !important; }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      overflow: visible !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body.thermal-printing .receipt-print-portal { display: none !important; }
    /* Laid out at paper width but never seen on a monitor (the till screen is left alone while a slip is prepared). */
    body.thermal-printing .receipt-print-portal[data-active-print="true"] {
      display: block !important;
      position: fixed !important;
      left: -20000px !important;
      top: 0 !important;
      width: ${mm}mm !important;
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      background: #fff !important;
      opacity: 0 !important;
      visibility: visible !important;
      pointer-events: none !important;
    }
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt {
      max-width: 100% !important;
      box-sizing: border-box !important;
      margin-left: auto !important;
      margin-right: auto !important;
      margin-top: 0 !important;
      overflow: visible !important;
    }
    body.thermal-printing .receipt-print-portal[data-active-print="true"] .print-receipt img { max-width: 100% !important; }
    ${compactBlock}
    @media print {
      body.thermal-printing > *:not(.receipt-print-portal[data-active-print="true"]) { display: none !important; }
      body.thermal-printing[data-print-active="true"] .receipt-print-portal[data-active-print="true"],
      body.thermal-printing .receipt-print-portal[data-active-print="true"] {
        position: static !important;
        left: 0 !important;
        top: 0 !important;
        opacity: 1 !important;
        visibility: visible !important;
        display: block !important;
        width: ${mm}mm !important;
      }
      html, body { width: ${mm}mm !important; height: auto !important; }
      /* Colours, tinted bands and boxes print as drawn (browsers drop backgrounds unless asked). */
      body.thermal-printing .receipt-print-portal[data-active-print="true"],
      body.thermal-printing .receipt-print-portal[data-active-print="true"] * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
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
  // The desktop app keeps the thermal-head rules; a browser prints the design (see buildBrowserPrintCss).
  style.textContent = (!isElectron() && getBrowserPrintStyle() === 'design')
    ? buildBrowserPrintCss(paperWidth, compact)
    : buildPrintCss(paperWidth, compact);
  document.head.appendChild(style);
  return () => style.remove();
}
