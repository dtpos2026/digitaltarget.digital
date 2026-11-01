// ============================================================
// PRINT GEOMETRY — the single source of truth for how wide a slip is
// and where it sits on the paper.
//
// Why this file exists
// --------------------
// Slip geometry used to be decided in three places at once and they
// disagreed, which is what made margins "cosmetic" and the text small:
//
//   1. printCss.ts padded `.print-receipt` with --dt-print-padding-left/right
//      (defaulting to 3mm a side).
//   2. The hidden worker laid the slip out at the FULL PAPER width (80mm)
//      and the rasteriser then squeezed that render into the printable
//      width (72mm) — every character came out ~10% smaller and lighter
//      than designed.
//   3. escposRasterBytes ALSO shifted the bitmap by the user's left margin
//      and narrowed it by left+right.
//
// So the user's Left/Right settings were applied twice on the raster path
// and not at all on the HTML fallback, on top of a layout that was already
// being scaled down. Changing the numbers moved the preview convincingly
// while the paper barely changed.
//
// The model used here
// -------------------
//   paperMm      physical roll width            (80mm)
//   printableMm  what the head can actually mark (72mm on an 80mm roll)
//   contentMm    printableMm - left - right     (what the slip lays out in)
//
// The slip is rendered at exactly `contentMm`, so one CSS millimetre is one
// printed millimetre — no rescaling, nothing to blur. The margins are then
// applied ONCE, by whichever stage physically positions the content:
// in printer dots on the raster path, as page padding on the HTML path.
// ============================================================
import type { PaperSize } from './printConfig';

/** Physical roll width in mm. */
export function paperMmOf(paper: PaperSize): number {
  if (paper === '58mm') return 58;
  if (paper === '110mm') return 110;
  return 80;
}

/**
 * Width the thermal head can actually mark, in mm. Always less than the
 * roll: an 80mm roll prints ~72mm, a 58mm roll ~48mm. These must stay in
 * step with `escposRasterBytes` in electron/main.cjs, which derives its
 * dots-per-mm from the same pair of numbers.
 */
export function printableMmOf(paper: PaperSize): number {
  if (paper === '58mm') return 48;
  if (paper === '110mm') return 104;
  return 72;
}

/** Printable width in printer dots at 203 DPI (8 dots/mm). */
export function printableDotsOf(paper: PaperSize): number {
  if (paper === '58mm') return 384;
  if (paper === '110mm') return 832;
  return 576;
}

/**
 * Smallest content width we will ever hand a printer. Below this a receipt
 * stops being legible, so absurd margin settings are clamped rather than
 * obeyed. 30mm still fits a short item row on 58mm paper.
 */
const MIN_CONTENT_MM = 30;

export interface PrintGeometryInput {
  paper: PaperSize;
  /** User's left margin in mm (Printer Settings). */
  leftMm?: number;
  /** User's right margin in mm (Printer Settings). */
  rightMm?: number;
  /**
   * Optional hard override of the content width (mm) from printer
   * calibration. When set it wins over the margin arithmetic, because the
   * user measured this against their own printer.
   */
  contentWidthMm?: number;
}

export interface PrintGeometry {
  paper: PaperSize;
  /** Physical roll width (mm). */
  paperMm: number;
  /** Markable width (mm). */
  printableMm: number;
  /** Width the slip lays out in (mm) = printable - left - right. */
  contentMm: number;
  /** Applied left margin (mm) after clamping. */
  leftMm: number;
  /** Applied right margin (mm) after clamping. */
  rightMm: number;
  /** Content width in printer dots. */
  contentDots: number;
  /** Left margin in printer dots. */
  leftDots: number;
}

function toMm(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  // One decimal is as fine as a thermal head can resolve (0.1mm < 1 dot).
  return Math.round(Math.min(40, n) * 10) / 10;
}

/**
 * Work out the real geometry for a slip. Left and right are independent:
 * asking for 4mm left and 1mm right shifts the content right by 4mm and
 * leaves 1mm clear on the right, it does not re-centre.
 */
export function resolvePrintGeometry(input: PrintGeometryInput): PrintGeometry {
  const paper = input.paper || '80mm';
  const paperMm = paperMmOf(paper);
  const printableMm = printableMmOf(paper);
  const dotsPerMm = printableDotsOf(paper) / printableMm;

  let leftMm = toMm(input.leftMm, 0);
  let rightMm = toMm(input.rightMm, 0);

  // Explicit calibration wins, and is centred within whatever room is left.
  const override = Number(input.contentWidthMm);
  if (Number.isFinite(override) && override > 0) {
    const contentMm = Math.max(MIN_CONTENT_MM, Math.min(printableMm, Math.round(override * 10) / 10));
    const spare = Math.max(0, printableMm - contentMm);
    // Honour the requested left offset when it fits, otherwise centre.
    const left = leftMm <= spare ? leftMm : Math.round((spare / 2) * 10) / 10;
    return {
      paper, paperMm, printableMm, contentMm,
      leftMm: left,
      rightMm: Math.round((spare - left) * 10) / 10,
      contentDots: Math.round(contentMm * dotsPerMm),
      leftDots: Math.round(left * dotsPerMm),
    };
  }

  // Margins that would leave an unreadable strip are scaled back together,
  // keeping their ratio so the user's left/right intent is preserved.
  if (printableMm - leftMm - rightMm < MIN_CONTENT_MM) {
    const room = Math.max(0, printableMm - MIN_CONTENT_MM);
    const asked = leftMm + rightMm;
    if (asked > 0 && room > 0) {
      leftMm = Math.round((leftMm / asked) * room * 10) / 10;
      rightMm = Math.round((rightMm / asked) * room * 10) / 10;
    } else {
      leftMm = 0;
      rightMm = 0;
    }
  }

  const contentMm = Math.max(MIN_CONTENT_MM, Math.round((printableMm - leftMm - rightMm) * 10) / 10);
  return {
    paper, paperMm, printableMm, contentMm, leftMm, rightMm,
    contentDots: Math.round(contentMm * dotsPerMm),
    leftDots: Math.round(leftMm * dotsPerMm),
  };
}
