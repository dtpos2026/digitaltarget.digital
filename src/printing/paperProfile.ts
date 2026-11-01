// ============================================================
// PAPER PROFILES — the one place a paper size is described.
//
// Every print path (HTML preview, Electron driver print, ESC/POS raster and
// ESC/POS raw text) reads its widths from here. Before this module the same
// four numbers were written out separately in printGeometry.ts, printCss.ts,
// escposBuilder.ts and electron/escposRaster.cjs, and they disagreed — which
// is how a slip could be laid out at one width and printed at another.
//
// The numbers
// -----------
//   paperMm      physical roll width
//   printableMm  the width the thermal head can actually mark. ALWAYS less
//                than the roll: an 80mm roll marks ~72mm, a 58mm roll ~48mm.
//                Authoring a template at the ROLL width is what makes the
//                driver clip or rescale it, and a rescaled slip lands
//                off-centre. Author at the printable width.
//   dots         printableMm at 203 DPI (8 dots/mm) — what `GS W` is set to
//                and what the raster stage packs into.
//   charsFontA   monospace columns in Font A (12x24 dots)
//   charsFontB   monospace columns in Font B (9x17 dots)
//
// The character counts are not decoration: the alignment-test ruler is
// exactly `charsFontA` characters wide, so if a ruler wraps to a second line
// on real paper the constant here is wrong — fix the constant, never the
// font size.
// ============================================================

export type PaperProfileId = '58mm' | '80mm' | '110mm';

export interface PaperProfile {
  id: PaperProfileId;
  /** Human label for Printer Settings. */
  label: string;
  /** Physical roll width (mm). */
  paperMm: number;
  /** Width the head can mark (mm). */
  printableMm: number;
  /** Printable width in printer dots at 203 DPI. */
  dots: number;
  /** Monospace columns in Font A. */
  charsFontA: number;
  /** Monospace columns in Font B. */
  charsFontB: number;
  /**
   * Blank dots the slip is pushed in from the head's first markable column,
   * expressed in DOTS so it stays exact at 203 DPI.
   *
   * Why this is not zero
   * --------------------
   * `printableMm` is what the head CAN mark, measured from its own dot 0.
   * Where dot 0 falls on the paper depends on how the roll sits in the
   * mechanism, and on a hand-loaded 80mm roll that is never perfect. Printing
   * from dot 0 puts the first character on the very first markable column,
   * so any misalignment at all shaves the left edge off — the reported
   * "RAW print ka left side cut ho raha hai".
   *
   * A small inset absorbs that. It is derived, not guessed: one sixteenth of
   * the head's width, floored to whole dots, which is 2.0mm on 80mm, 1.5mm on
   * 58mm and 2.6mm on 110mm — the same relative safety on every roll. A shop
   * that measures its own printer still overrides it in Printer Settings.
   */
  safeMarginDots: number;
}

/**
 * 203 DPI thermal heads mark 8 dots per millimetre. Every profile below
 * satisfies `dots === printableMm * DOTS_PER_MM`; `assertProfileConsistency`
 * holds that true and the test suite pins it.
 */
export const DOTS_PER_MM = 8;

export const PAPER_PROFILES: Record<PaperProfileId, PaperProfile> = {
  '58mm': {
    id: '58mm',
    label: '58 mm (compact)',
    paperMm: 58,
    printableMm: 48,
    dots: 384,
    charsFontA: 32,
    charsFontB: 42,
    // 12 dots = 1.5mm. Narrower than the 80mm inset on purpose: on a 48mm
    // head every millimetre is a character of receipt width.
    safeMarginDots: 12,
  },
  '80mm': {
    id: '80mm',
    label: '80 mm (standard)',
    paperMm: 80,
    printableMm: 72,
    dots: 576,
    charsFontA: 48,
    charsFontB: 64,
    // 16 dots = 2.0mm, the value measured on the FIT FP-1100 and the
    // BIXOLON SRP-352plusIII: enough to survive a hand-loaded roll, small
    // enough that the slip still fills the paper.
    safeMarginDots: 16,
  },
  '110mm': {
    id: '110mm',
    label: '110 mm (wide)',
    paperMm: 110,
    printableMm: 104,
    dots: 832,
    charsFontA: 69,
    charsFontB: 92,
    // 20 dots = 2.5mm. A wide roll wanders more in the mechanism and has
    // width to spare.
    safeMarginDots: 20,
  },
};

/** Every profile a user may pick in Printer Settings. */
export const PAPER_PROFILE_LIST: PaperProfile[] = [
  PAPER_PROFILES['80mm'],
  PAPER_PROFILES['58mm'],
  PAPER_PROFILES['110mm'],
];

/** Resolve a stored/unknown value to a real profile, defaulting to 80mm. */
export function paperProfileOf(value: unknown): PaperProfile {
  const id = String(value ?? '') as PaperProfileId;
  return PAPER_PROFILES[id] ?? PAPER_PROFILES['80mm'];
}

/** Physical roll width (mm). */
export function paperMmOf(value: unknown): number {
  return paperProfileOf(value).paperMm;
}

/** Markable width (mm) — always narrower than the roll. */
export function printableMmOf(value: unknown): number {
  return paperProfileOf(value).printableMm;
}

/** Printable width in printer dots at 203 DPI. */
export function printableDotsOf(value: unknown): number {
  return paperProfileOf(value).dots;
}

/**
 * Default blank inset (mm) at each edge for this paper.
 *
 * This is the number Printer Settings starts a new printer at and the number
 * the layout falls back to when nothing has been configured. It comes from
 * the paper profile rather than from a constant in the layout code, which is
 * what makes it a printer/paper calculation instead of a magic number: change
 * the head and the safe margin changes with it.
 */
export function safeMarginMmOf(value: unknown): number {
  return paperProfileOf(value).safeMarginDots / DOTS_PER_MM;
}

/** The same value in printer dots, for the ESC/POS paths. */
export function safeMarginDotsOf(value: unknown): number {
  return paperProfileOf(value).safeMarginDots;
}

/** Monospace columns for the chosen ESC/POS font. */
export function columnsOf(value: unknown, font: 'A' | 'B' = 'A'): number {
  const p = paperProfileOf(value);
  return font === 'B' ? p.charsFontB : p.charsFontA;
}

/**
 * Guard the invariant the whole pipeline rests on. Called by the tests and
 * cheap enough to call at startup: a profile whose dots and millimetres
 * disagree silently shifts every margin on that paper size.
 */
export function assertProfileConsistency(): void {
  for (const p of Object.values(PAPER_PROFILES)) {
    if (p.dots !== p.printableMm * DOTS_PER_MM) {
      throw new Error(
        `Paper profile ${p.id} is inconsistent: ${p.printableMm}mm x ${DOTS_PER_MM} != ${p.dots} dots`,
      );
    }
    if (p.printableMm >= p.paperMm) {
      throw new Error(
        `Paper profile ${p.id} claims a printable width (${p.printableMm}mm) that is not narrower than the roll (${p.paperMm}mm)`,
      );
    }
    // A safe inset is meant to absorb a loading error, not to narrow the
    // slip. Beyond a sixteenth of the head it stops being a safety margin
    // and starts being a layout decision the shop did not make.
    if (p.safeMarginDots < 0 || p.safeMarginDots > p.dots / 16) {
      throw new Error(
        `Paper profile ${p.id} has an unreasonable safe margin: ${p.safeMarginDots} dots of ${p.dots}`,
      );
    }
  }
}
