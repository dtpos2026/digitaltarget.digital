// ============================================================
// PRINT ALIGNMENT TEST — the calibration slip.
//
// Code cannot settle whether the margins are equal; only paper can. This
// builds a slip whose whole purpose is to make the answer measurable with a
// ruler, in both renderers:
//
//   • a ruler line of exactly `columnsFontA` '=' characters. It must reach
//     both edges AND stay on one line. If it wraps, the characters-per-line
//     constant for that paper profile is wrong — fix the constant in
//     paperProfile.ts, never the font size.
//   • a box spanning the full printable width, so the left and right gaps
//     can be compared directly against the paper edges.
//   • LEFT left-aligned and RIGHT right-aligned on one line, which shows at
//     a glance whether the money column reaches the right edge.
//   • the active profile, printable width in dots and the print strategy,
//     printed at the bottom so a photograph of the slip is self-describing.
//
// Pass condition: left and right gaps equal within ~1mm, ruler unwrapped.
// ============================================================
import { EscposDoc, type Paper } from './escposBuilder';
import { resolveReceiptLayout, expectedMargins } from './receiptLayout';
import type { PaperProfileId } from './paperProfile';

export interface AlignmentTestOptions {
  paper: PaperProfileId;
  leftMm?: number;
  rightMm?: number;
  contentWidthMm?: number;
  /** Which path is printing this slip — recorded on the slip itself. */
  strategy?: string;
  /** Printer this went to, for the footer. */
  printerName?: string;
  /**
   * Where the margin numbers came from: the printer's own configuration or
   * this device's Printer Settings.
   *
   * Printed on the slip because a machine can hold asymmetric margins in
   * either place, and a photograph of a lopsided slip that does not say which
   * one is in force turns the next round of diagnosis into guesswork. It
   * already did once.
   */
  marginSource?: string;
}

/**
 * The lines of the calibration slip, as plain text.
 *
 * Shared by both renderers so the ESC/POS slip and the HTML slip say exactly
 * the same thing — if they disagreed, the test could not tell you which path
 * was misaligned.
 */
export function alignmentTestLines(opts: AlignmentTestOptions): string[] {
  const layout = resolveReceiptLayout({
    paper: opts.paper,
    leftMm: opts.leftMm,
    rightMm: opts.rightMm,
    contentWidthMm: opts.contentWidthMm,
  });
  const cols = layout.columnsFontA;
  const gaps = expectedMargins(layout, 'html');

  // Nothing on a calibration slip may be wider than the slip. A line the
  // printer wraps for us destroys the one measurement this slip exists to
  // make — you cannot tell a wrapped ruler from a mis-set margin on a
  // photograph. Both helpers therefore clip, and the test suite asserts that
  // every line fits, on every profile and at every margin.
  const clip = (s: string) => (s.length > cols ? s.slice(0, cols) : s);
  const centred = (s: string) => {
    const text = clip(s);
    const pad = Math.max(0, Math.floor((cols - text.length) / 2));
    return ' '.repeat(pad) + text;
  };
  const lr = (l: string, r: string) =>
    clip(l + ' '.repeat(Math.max(1, cols - l.length - r.length)) + r);

  return [
    centred('PRINT ALIGNMENT TEST'),
    '',
    // The ruler: exactly one full line, edge to edge.
    '='.repeat(cols),
    // A box at the full printable width. The verticals mark the content edges.
    '+' + '-'.repeat(Math.max(0, cols - 2)) + '+',
    '|' + centred('FULL WIDTH BOX').slice(0, Math.max(0, cols - 2)).padEnd(Math.max(0, cols - 2)) + '|',
    '+' + '-'.repeat(Math.max(0, cols - 2)) + '+',
    lr('LEFT', 'RIGHT'),
    '='.repeat(cols),
    '',
    lr('Paper profile', layout.paper),
    lr('Printable width', `${layout.printableMm} mm`),
    lr('Printable dots', String(layout.printableDots)),
    lr('Content width', `${layout.contentMm} mm`),
    lr('Content dots', String(layout.contentDots)),
    lr('Characters/line', String(cols)),
    lr('Margin left', `${layout.leftMm} mm`),
    lr('Margin right', `${layout.rightMm} mm`),
    lr('Margins from', opts.marginSource || 'device settings'),
    // The single number that decides pass or fail, stated outright so nobody
    // has to subtract two figures off a photograph.
    lr('Margins equal?', Math.abs(layout.leftMm - layout.rightMm) <= 0.05 ? 'YES' : 'NO - FIX THIS'),
    lr('Expected gap L', `${gaps.leftGapMm} mm`),
    lr('Expected gap R', `${gaps.rightGapMm} mm`),
    lr('Print strategy', opts.strategy || 'unknown'),
    ...(opts.printerName ? [lr('Printer', opts.printerName.slice(0, Math.max(8, cols - 10)))] : []),
    '',
    centred('Measure both paper edges.'),
    centred('They must match within 1 mm.'),
    centred('The = line must NOT wrap.'),
  ];
}

/** The calibration slip as raw ESC/POS bytes. */
export function buildAlignmentTestBytes(opts: AlignmentTestOptions): number[] {
  const d = new EscposDoc(opts.paper as Paper, {
    leftMm: opts.leftMm,
    rightMm: opts.rightMm,
    contentWidthMm: opts.contentWidthMm,
  });
  d.bold(true);
  for (const line of alignmentTestLines(opts)) d.line(line);
  d.bold(false);
  d.cut();
  return d.bytes();
}

/**
 * The calibration slip as HTML, for the driver path and the browser preview.
 *
 * Deliberately monospace and pre-wrapped: the point of the slip is that one
 * character is one column, so proportional type would destroy the ruler.
 */
export function buildAlignmentTestHtml(opts: AlignmentTestOptions): string {
  const lines = alignmentTestLines(opts)
    .map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    .join('\n');
  return (
    '<div class="print-receipt" style="font-family:\'Lucida Console\',\'Consolas\',\'Courier New\',monospace;' +
    'font-weight:700;color:#000;background:#fff;white-space:pre;' +
    // Sized so the ruler's character count exactly fills the content width.
    'font-size:' + alignmentFontPx(opts) + 'px;line-height:1.25;">' +
    lines +
    '</div>'
  );
}

/**
 * Font size that makes `columnsFontA` monospace characters span the content
 * width exactly.
 *
 * A monospace glyph advances about 0.6em, so columns * 0.6 * fontPx must
 * equal the content width in CSS px. Getting this wrong is what makes an
 * HTML ruler wrap while the ESC/POS one does not.
 */
export function alignmentFontPx(opts: AlignmentTestOptions): number {
  const layout = resolveReceiptLayout({
    paper: opts.paper,
    leftMm: opts.leftMm,
    rightMm: opts.rightMm,
    contentWidthMm: opts.contentWidthMm,
  });
  const contentPx = layout.contentMm * (96 / 25.4);
  const px = contentPx / (layout.columnsFontA * 0.6);
  return Math.round(px * 100) / 100;
}
