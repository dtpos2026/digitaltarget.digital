// ============================================================
// RECEIPT LAYOUT — one source of truth for how a slip sits on the paper.
//
// Why this module exists
// ----------------------
// The equal-margin fault was reported repeatedly and "fixed" repeatedly
// because the two print paths disagreed about the page box, and only one of
// them was ever measured:
//
//   raster path (printHtmlEscpos)  document IS the content width; margins are
//                                  inserted afterwards in whole printer dots.
//   driver path (printHtml)        document is the full roll; the Windows
//                                  driver prints the page as-is, so the
//                                  margins have to be real page geometry.
//
// The driver path laid the slip out at `contentMm` inside a `paperMm` page
// with NO horizontal centring, so the slip sat hard against the left edge and
// every millimetre of slack piled up on the right. Measured on an 80mm roll
// with the default 2mm margins that is 0mm left against 11.9mm right — the
// "right margin is much larger than the left" report, exactly.
//
// So both paths now describe their geometry through `resolveReceiptLayout`
// and render it through `layoutCss`, and the test suite asserts on every
// paper profile and both modes that:
//
//     equal margins in  ->  left gap === right gap   (within one printer dot)
//     left 4mm in       ->  left gap is 4mm wider than the bare head inset
//
// The second line matters as much as the first. Making the slip symmetric was
// only ever half the job; a shop also has to be able to nudge it, because the
// roll does not always sit the same way in every machine.
//
// One data model, two renderers
// -----------------------------
// `ReceiptLayout` is also what the ESC/POS builder reads for its `GS L`
// (left margin) and `GS W` (print area width), so an HTML slip and a raw
// slip are positioned by the same numbers rather than two guesses.
// ============================================================
import {
  DOTS_PER_MM,
  columnsOf,
  paperProfileOf,
  type PaperProfile,
  type PaperProfileId,
} from './paperProfile';

/**
 * Where the document lives.
 *
 *  'raster' — the page IS the content. The capture is converted to ESC/POS
 *             raster bytes and the margins are inserted there, as dots.
 *  'html'   — the page is the whole roll and the Windows driver prints it
 *             directly. There is no raster stage to offset anything, so the
 *             margins must be real page geometry — and the content block
 *             must be centred, or the slack lands entirely on one side.
 */
export type LayoutMode = 'raster' | 'html';

/**
 * Smallest content width we will hand a printer. Below this a receipt stops
 * being legible, so absurd margin settings are clamped rather than obeyed.
 */
const MIN_CONTENT_MM = 30;

/** Largest side margin worth honouring. */
const MAX_MARGIN_MM = 20;

export interface ReceiptLayoutInput {
  paper: PaperProfileId | string;
  /**
   * Kept for callers that still pass it. It no longer changes anything.
   *
   * An earlier version of this resolver forced left and right to match by
   * taking the SMALLER of the two. That was written to defend against stale
   * lopsided values on deployed machines, and it did — but it also threw away
   * every margin a shop deliberately typed. Setting Left 3 / Right 0 produced
   * 0 / 0, so the left edge still printed off the paper and the setting looked
   * broken, because it was. Stale values are now dealt with once by the
   * storage migrations that own them, which is where that belongs; this
   * function's job is to apply the numbers it is given.
   *
   * @deprecated Asymmetric margins are always honoured now.
   */
  allowAsymmetric?: boolean;
  /**
   * Left margin (mm) from Printer Settings.
   *
   * Left undefined, the paper profile's safe inset applies. That is not the
   * same as 0: an explicit 0 means "print from the head's first column", and
   * is obeyed.
   */
  leftMm?: number;
  /** Right margin (mm) from Printer Settings. Undefined means the safe inset. */
  rightMm?: number;
  /**
   * Hard override of the content width (mm) from printer calibration. When
   * set it wins over the margin arithmetic, because the user measured it
   * against their own printer. The remaining slack is split EVENLY, so a
   * calibrated slip stays centred instead of hugging the left edge.
   */
  contentWidthMm?: number;
}

export interface ReceiptLayout {
  profile: PaperProfile;
  paper: PaperProfileId;
  /** Physical roll width (mm). */
  paperMm: number;
  /** Width the head can mark (mm). */
  printableMm: number;
  /** Width the slip lays out in (mm). */
  contentMm: number;
  /** Applied left margin (mm), measured from the printable area's left edge. */
  leftMm: number;
  /** Applied right margin (mm). */
  rightMm: number;
  /** Content width in printer dots. */
  contentDots: number;
  /** Left margin in printer dots — this is what `GS L` is set to. */
  leftDots: number;
  /** Printable width in printer dots — this is what `GS W` is set to. */
  printableDots: number;
  /** Monospace columns available in Font A at the content width. */
  columnsFontA: number;
  /** Monospace columns available in Font B at the content width. */
  columnsFontB: number;
}

function toMm(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  // One decimal is as fine as a 203 DPI head resolves (0.1mm < 1 dot).
  return Math.round(Math.min(MAX_MARGIN_MM, n) * 10) / 10;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Work out where a slip sits on the paper.
 *
 * Two rules, and no others:
 *
 *  1. The margins given are the margins applied. 4mm left with 1mm right
 *     shifts the slip right; it is not quietly re-centred, and it is not
 *     quietly flattened to 1mm a side. A shop that types a number into
 *     Printer Settings must be able to see that number on the paper, or the
 *     setting is a lie and the next fault report is unanswerable.
 *  2. Slack this module creates by itself — a calibration width that does not
 *     fill the head, a clamp against an unreadable slip — is split evenly, so
 *     nothing the shop did NOT ask for ever piles up on one edge.
 *
 * With nothing configured both sides get the paper profile's safe inset, so
 * the out-of-the-box slip is centred AND clear of the edge.
 */
export function resolveReceiptLayout(input: ReceiptLayoutInput): ReceiptLayout {
  const profile = paperProfileOf(input.paper);
  const { paperMm, printableMm, dots: printableDots } = profile;

  // Unset falls back to the paper's own safe inset; an explicit number — 0
  // included — is applied exactly as typed. This is the whole of the margin
  // policy, and it is deliberately short: every past lopsided-slip report
  // traced back to this function second-guessing the value it was handed.
  const safeMm = profile.safeMarginDots / DOTS_PER_MM;
  const leftGiven = Number.isFinite(Number(input.leftMm));
  let leftMm = toMm(input.leftMm, safeMm);
  let rightMm = toMm(input.rightMm, safeMm);

  const finish = (contentMm: number, left: number, right: number): ReceiptLayout => {
    const contentDots = Math.round(contentMm * DOTS_PER_MM);
    return {
      profile,
      paper: profile.id,
      paperMm,
      printableMm,
      contentMm: round1(contentMm),
      leftMm: round1(left),
      rightMm: round1(right),
      contentDots,
      leftDots: Math.round(left * DOTS_PER_MM),
      printableDots,
      // Columns scale with the content width: narrowing the slip with margins
      // genuinely removes characters, and the ruler in the alignment test has
      // to match or it wraps.
      columnsFontA: Math.max(16, Math.floor(columnsOf(profile.id, 'A') * (contentMm / printableMm))),
      columnsFontB: Math.max(16, Math.floor(columnsOf(profile.id, 'B') * (contentMm / printableMm))),
    };
  };

  // Explicit calibration wins, and the leftover is split evenly so the slip
  // stays centred on the printable area.
  const override = Number(input.contentWidthMm);
  if (Number.isFinite(override) && override > 0) {
    const contentMm = Math.max(MIN_CONTENT_MM, Math.min(printableMm, round1(override)));
    const spare = Math.max(0, printableMm - contentMm);
    // An explicit left offset is honoured when it fits. The safe inset is NOT
    // an explicit offset — it is a floor for the unconfigured case — so a
    // calibrated width with no margins set stays centred rather than being
    // nudged off by a default the shop never chose.
    const left = leftGiven && leftMm > 0 && leftMm <= spare ? leftMm : round1(spare / 2);
    return finish(contentMm, left, round1(spare - left));
  }

  // Margins that would leave an unreadable strip are scaled back together,
  // keeping their ratio so the user's left/right intent survives.
  if (printableMm - leftMm - rightMm < MIN_CONTENT_MM) {
    const room = Math.max(0, printableMm - MIN_CONTENT_MM);
    const asked = leftMm + rightMm;
    if (asked > 0 && room > 0) {
      leftMm = round1((leftMm / asked) * room);
      rightMm = round1((rightMm / asked) * room);
    } else {
      leftMm = 0;
      rightMm = 0;
    }
  }

  const contentMm = Math.max(MIN_CONTENT_MM, round1(printableMm - leftMm - rightMm));
  return finish(contentMm, leftMm, rightMm);
}

/**
 * The page box a given mode lays the document out in.
 *
 * raster: the page is exactly the content, so one CSS millimetre is one
 *         printed millimetre and there is nothing to rescale.
 * html:   the page is the whole roll, because that is what the driver hands
 *         Chromium. The content is then centred within the printable area.
 */
export function pageWidthMmFor(layout: ReceiptLayout, mode: LayoutMode): number {
  return mode === 'html' ? layout.paperMm : layout.contentMm;
}

/**
 * How far the content block sits from the page's left edge, in mm.
 *
 * On the driver path the printable area is itself inset within the roll —
 * an 80mm roll marks 72mm, leaving 4mm of unmarkable paper a side. The
 * content is placed at that inset PLUS the user's left margin, which is what
 * makes the printed left and right gaps come out equal.
 */
export function contentOffsetMmFor(layout: ReceiptLayout, mode: LayoutMode): number {
  if (mode !== 'html') return 0;
  const headInset = (layout.paperMm - layout.printableMm) / 2;
  return round1(headInset + layout.leftMm);
}

/**
 * The CSS that positions the slip, for whichever mode is printing.
 *
 * Emitted with `!important` and a selector carrying enough specificity to
 * beat the shared print stylesheet. That is not decoration: `printCss.ts`
 * carries `body.thermal-printing { padding: 0 !important }`, which is more
 * specific than a bare `body { ... !important }` and silently deleted the
 * driver path's left margin — half of why the slip printed hard against the
 * left edge.
 */
export function layoutCss(layout: ReceiptLayout, mode: LayoutMode, rootClass = 'dt-fast-root'): string {
  const pageMm = pageWidthMmFor(layout, mode);
  const offsetMm = contentOffsetMmFor(layout, mode);
  const trailingMm = round1(Math.max(0, pageMm - offsetMm - layout.contentMm));

  return `
  /* ===== SHARED RECEIPT LAYOUT (src/printing/receiptLayout.ts) =====
     Page box for this mode, and the single place the slip is positioned.
     Mode: ${mode} · paper ${layout.paperMm}mm · printable ${layout.printableMm}mm
     · content ${layout.contentMm}mm · left ${layout.leftMm}mm · right ${layout.rightMm}mm */
  html, body.thermal-printing, body {
    width: ${pageMm}mm !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    color: #000 !important;
    box-sizing: border-box !important;
  }
  /* The content block. Centring is done with explicit, symmetric side
     margins rather than auto, so the geometry is verifiable: the numbers
     that appear here are the numbers the alignment test measures.

     The selectors deliberately carry the portal class and the active-print
     attribute as well as the root class. printCss.ts styles the active
     print portal at the FULL ROLL width with !important, and the snapshot
     root carries both that class and that attribute. Anything less specific
     than this loses to it, and the slip goes back to being laid out at 80mm
     inside a 72mm printable area — the rescale that moved it off centre. */
  body.thermal-printing .${rootClass}.receipt-print-portal[data-active-print="true"],
  body[data-print-active="true"] .${rootClass}.receipt-print-portal[data-active-print="true"],
  body.thermal-printing .${rootClass},
  body[data-print-active="true"] .${rootClass},
  .${rootClass} {
    width: ${layout.contentMm}mm !important;
    max-width: ${layout.contentMm}mm !important;
    min-width: 0 !important;
    margin-left: ${offsetMm}mm !important;
    margin-right: ${trailingMm}mm !important;
    padding: 0 !important;
    box-sizing: border-box !important;
    background: #fff !important;
    color: #000 !important;
    /* Vertical overflow is normal — a slip grows downwards. Horizontal
       overflow is not: the head cannot print past the paper, and a child
       wider than the slip used to inflate scrollWidth, which the capture
       stage took as the real width and then squeezed the whole receipt into
       part of the roll. Clip it here so it can never happen. */
    overflow-x: hidden !important;
    overflow-y: visible !important;
  }
  /* Everything inside the slip is relative to the content width. A
     hard-coded px width cannot line up: Chromium maps CSS mm at 96 DPI
     while the head prints at 203 DPI. */
  .${rootClass} table,
  .${rootClass} hr {
    width: 100% !important;
    max-width: 100% !important;
    box-sizing: border-box !important;
  }
  .${rootClass} * {
    box-sizing: border-box !important;
    max-width: 100% !important;
  }
  /* The measuring rule the raster stage crops to. Full content width, two
     device pixels tall, solid black — it has to be unmistakable ink in row
     one, and it is removed again before the slip is packed into dots, so it
     never reaches the paper. Only the raster document carries one. */
  .${rootClass} .dt-measure {
    display: block !important;
    width: 100% !important;
    max-width: 100% !important;
    height: 2px !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #000 !important;
    border: 0 !important;
  }
`;
}

/**
 * What the geometry should produce on paper, for the alignment test and for
 * the assertions that keep the two modes honest.
 */
export interface LayoutMargins {
  /** Blank paper to the left of the first mark (mm). */
  leftGapMm: number;
  /** Blank paper to the right of the last mark (mm). */
  rightGapMm: number;
}

/**
 * The left/right gaps this layout should print, measured from the physical
 * paper edges.
 *
 * Both modes must agree, and both gaps must be equal when the user's left and
 * right margins are equal. The test suite asserts exactly that across every
 * paper profile — it is the property the whole module exists to guarantee.
 */
export function expectedMargins(layout: ReceiptLayout, mode: LayoutMode): LayoutMargins {
  const headInset = (layout.paperMm - layout.printableMm) / 2;
  void mode;
  // The head can only mark the printable band, so the blank paper either side
  // is that unmarkable inset plus the user's own margin — on both paths.
  return {
    leftGapMm: round1(headInset + layout.leftMm),
    rightGapMm: round1(headInset + layout.rightMm),
  };
}

/**
 * What to change the margins to, from the gaps a person measured with a ruler.
 *
 * Why this exists
 * ---------------
 * A client found by trial that Left 3 / Right 5 squared their slip in Windows
 * Driver mode. That is a real measurement of a real machine and it is kept —
 * but arriving at it took an evening of print, look, adjust, print again, and
 * every shop with a slightly differently-seated roll has to repeat it.
 *
 * The arithmetic is not hard once the numbers are on paper. The slip is
 * off-centre by half the difference between the two gaps, so moving that half
 * from the wide side to the narrow one centres it. This does the sum, applies
 * the same clamps the resolver does, and hands back the two numbers to save.
 *
 * What it will NOT quietly absorb
 * -------------------------------
 * If the two measured gaps do not ADD UP to the blank paper this layout
 * should be leaving, the slip is not merely off-centre — it is printing at
 * the wrong width, which is a paper profile or a driver scaling fault that
 * moving margins cannot fix and would only disguise. That is reported as
 * `widthMismatchMm` so the caller can say so instead of handing over numbers
 * that make the next slip wrong in a new way.
 */
export interface MarginCorrection {
  /** Left margin (mm) to save. */
  leftMm: number;
  /** Right margin (mm) to save. */
  rightMm: number;
  /** How far the slip is off centre, positive meaning "too far left". */
  offsetMm: number;
  /**
   * Measured blank paper minus what this layout should leave blank. Near zero
   * is healthy. A large value means the slip is printing at the wrong WIDTH,
   * and no margin change will fix that.
   */
  widthMismatchMm: number;
  /** True when the correction is within the range the resolver will honour. */
  applicable: boolean;
}

export function computeMarginCorrection(
  layout: ReceiptLayout,
  measuredLeftMm: number,
  measuredRightMm: number,
): MarginCorrection {
  const ml = Number(measuredLeftMm);
  const mr = Number(measuredRightMm);
  if (!Number.isFinite(ml) || !Number.isFinite(mr) || ml < 0 || mr < 0) {
    return {
      leftMm: layout.leftMm, rightMm: layout.rightMm,
      offsetMm: 0, widthMismatchMm: 0, applicable: false,
    };
  }

  // Half the difference moves from the wide side to the narrow one.
  const offsetMm = round1((ml - mr) / 2);
  const left = Math.max(0, Math.min(MAX_MARGIN_MM, round1(layout.leftMm - offsetMm)));
  const right = Math.max(0, Math.min(MAX_MARGIN_MM, round1(layout.rightMm + offsetMm)));

  // What this layout should be leaving blank in total, from the paper edges.
  const expected = expectedMargins(layout, 'html');
  const widthMismatchMm = round1((ml + mr) - (expected.leftGapMm + expected.rightGapMm));

  return {
    leftMm: left,
    rightMm: right,
    offsetMm,
    widthMismatchMm,
    // A correction big enough to hit the clamp is not a calibration, it is a
    // sign the wrong paper profile is selected.
    applicable: Math.abs(offsetMm) > 0.05 && Math.abs(offsetMm) <= MAX_MARGIN_MM,
  };
}
