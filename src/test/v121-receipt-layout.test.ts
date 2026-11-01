// ============================================================
// RECEIPT LAYOUT — the equal-margin locks.
//
// The fault these pin was reported repeatedly and "fixed" repeatedly,
// because only ONE of the two print paths was ever measured. The raster
// path was symmetric; the driver path laid the slip out at the content
// width inside a full-roll page with no centring, so it printed 0mm on the
// left and 11.9mm on the right of an 80mm roll.
//
// These tests assert the property directly — equal in, equal out, on every
// paper profile and BOTH modes — rather than asserting the CSS text, so a
// future refactor that changes the stylesheet but keeps the geometry still
// passes, and one that quietly re-breaks the centring cannot.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  resolveReceiptLayout,
  expectedMargins,
  computeMarginCorrection,
  pageWidthMmFor,
  contentOffsetMmFor,
  layoutCss,
  type LayoutMode,
} from '@/printing/receiptLayout';
import {
  PAPER_PROFILES,
  assertProfileConsistency,
  columnsOf,
  DOTS_PER_MM,
} from '@/printing/paperProfile';
import { alignmentTestLines } from '@/printing/alignmentTest';

const PROFILES = ['58mm', '80mm', '110mm'] as const;
const MODES: LayoutMode[] = ['raster', 'html'];

describe('paper profiles', () => {
  it('keeps dots and millimetres in step at 203 DPI', () => {
    // escposRaster.cjs derives its dots-per-mm from these numbers. If a
    // profile drifts, every margin on that paper lands somewhere else.
    expect(() => assertProfileConsistency()).not.toThrow();
    for (const p of Object.values(PAPER_PROFILES)) {
      expect(p.dots).toBe(p.printableMm * DOTS_PER_MM);
    }
  });

  it('never claims the roll width as printable', () => {
    // Authoring at the roll width is what makes the driver clip or rescale
    // the slip, and a rescaled slip lands off-centre.
    for (const p of Object.values(PAPER_PROFILES)) {
      expect(p.printableMm).toBeLessThan(p.paperMm);
    }
  });

  it('pins the documented character counts', () => {
    expect(columnsOf('80mm', 'A')).toBe(48);
    expect(columnsOf('80mm', 'B')).toBe(64);
    expect(columnsOf('58mm', 'A')).toBe(32);
    expect(columnsOf('58mm', 'B')).toBe(42);
  });
});

describe('equal margins', () => {
  it('prints the same gap on both edges when left and right are equal', () => {
    for (const paper of PROFILES) {
      for (const mm of [0, 1, 2, 3, 5]) {
        const layout = resolveReceiptLayout({ paper, leftMm: mm, rightMm: mm });
        for (const mode of MODES) {
          const { leftGapMm, rightGapMm } = expectedMargins(layout, mode);
          expect(
            Math.abs(leftGapMm - rightGapMm),
            `${paper} @ ${mm}mm (${mode}) → L ${leftGapMm} / R ${rightGapMm}`,
          ).toBeLessThanOrEqual(0.1);
        }
      }
    }
  });

  it('places the content block so both paper edges get the same blank band', () => {
    // This is the arithmetic the driver path got wrong: it offset the block
    // by the user margin alone and ignored the head's own unprintable inset,
    // so every millimetre of slack piled up on the right.
    for (const paper of PROFILES) {
      const layout = resolveReceiptLayout({ paper, leftMm: 2, rightMm: 2 });
      const pageMm = pageWidthMmFor(layout, 'html');
      const offset = contentOffsetMmFor(layout, 'html');
      const trailing = pageMm - offset - layout.contentMm;
      expect(Math.abs(offset - trailing), `${paper}: left ${offset} vs right ${trailing}`)
        .toBeLessThanOrEqual(0.1);
    }
  });

  it('splits leftover width evenly when a calibrated content width is used', () => {
    // A calibration override used to honour the left margin and dump the
    // remainder on the right.
    const layout = resolveReceiptLayout({ paper: '80mm', contentWidthMm: 60 });
    expect(layout.contentMm).toBe(60);
    expect(layout.leftMm).toBeCloseTo(layout.rightMm, 1);
  });

  it('applies an asymmetric pair exactly as it was set', () => {
    // THE SETTING-DOES-NOTHING BUG.
    //
    // A previous version of this resolver forced the two sides to match by
    // taking the SMALLER of them, to defend against stale lopsided values on
    // deployed machines. It did stop those — and it also silently discarded
    // every margin a shop typed by hand. A cashier who set Left 3 to stop the
    // left edge being clipped got 0 back, the clipping continued, and the
    // margin setting looked broken because it was.
    //
    // Stale values are now the storage migrations' problem, where they belong.
    // This function applies the numbers it is handed.
    const layout = resolveReceiptLayout({ paper: '80mm', leftMm: 3, rightMm: 0 });
    expect(layout.leftMm).toBe(3);
    expect(layout.rightMm).toBe(0);
    expect(layout.leftDots).toBe(24);        // 3mm x 8 dots/mm
    expect(layout.contentMm).toBe(69);       // 72 printable - 3 left

    // And it has to reach the paper, not just the object: the gap measured
    // from the physical edge grows by exactly the 3mm that was asked for.
    const bare = expectedMargins(resolveReceiptLayout({ paper: '80mm', leftMm: 0, rightMm: 0 }), 'raster');
    const moved = expectedMargins(layout, 'raster');
    expect(moved.leftGapMm - bare.leftGapMm).toBeCloseTo(3, 1);
  });

  it('honours the driver-mode pair the shop measured for itself', () => {
    // The 3mm/5mm a client found by trial on their own hardware. Whatever the
    // defaults say, these are measurements and they survive.
    const layout = resolveReceiptLayout({ paper: '80mm', leftMm: 3, rightMm: 5 });
    expect(layout.leftMm).toBe(3);
    expect(layout.rightMm).toBe(5);
    expect(layout.contentMm).toBe(64);
  });

  it('keeps a slip clear of the paper edge when nothing is configured', () => {
    // Zero on both sides was the previous default. It puts the first column on
    // the head's very first markable dot, and on a hand-loaded roll that is at
    // or past the edge of the paper — the left side of the RAW slip came out
    // shaved. An unconfigured machine now gets the profile's safe inset.
    const layout = resolveReceiptLayout({ paper: '80mm' });
    expect(layout.leftMm).toBe(2);
    expect(layout.rightMm).toBe(2);
    expect(layout.leftDots).toBe(16);
    expect(layout.contentMm).toBe(68);

    // Narrow paper gets a narrower inset: on a 48mm head every millimetre is
    // a character of receipt width.
    expect(resolveReceiptLayout({ paper: '58mm' }).leftMm).toBe(1.5);
  });

  it('still fills the whole head when the margins are explicitly zero', () => {
    // The safe inset is a default, not a floor. A shop that wants the full
    // printable width — because their printer is mounted squarely and they
    // measured it — asks for zero and gets zero.
    const layout = resolveReceiptLayout({ paper: '80mm', leftMm: 0, rightMm: 0 });
    expect(layout.contentMm).toBe(72);
    expect(layout.contentDots).toBe(576);
    expect(layout.columnsFontA).toBe(48);
    expect(layout.leftDots).toBe(0);
  });
});

describe('layout CSS', () => {
  it('never emits a fixed pixel width', () => {
    // Chromium maps CSS mm at 96 DPI while the head prints at 203 DPI, so a
    // px width can never line up with the paper.
    for (const paper of PROFILES) {
      const layout = resolveReceiptLayout({ paper, leftMm: 2, rightMm: 2 });
      for (const mode of MODES) {
        expect(layoutCss(layout, mode)).not.toMatch(/width:\s*\d+px/);
      }
    }
  });

  it('carries enough specificity to beat the shared portal rule', () => {
    // printCss.ts styles the active portal at the FULL ROLL width with
    // !important, and the snapshot root carries that class and attribute.
    // A less specific selector loses and the slip is laid out at 80mm again.
    const layout = resolveReceiptLayout({ paper: '80mm', leftMm: 2, rightMm: 2 });
    const css = layoutCss(layout, 'html');
    expect(css).toContain('.dt-fast-root.receipt-print-portal[data-active-print="true"]');
  });

  it('makes tables and rules span the full content width', () => {
    const layout = resolveReceiptLayout({ paper: '80mm', leftMm: 2, rightMm: 2 });
    const css = layoutCss(layout, 'html');
    expect(css).toMatch(/\.dt-fast-root table[\s\S]*?width:\s*100%/);
    expect(css).toContain('box-sizing: border-box !important');
  });

  it('gives the raster mode a page that is exactly the content', () => {
    // One CSS millimetre must be one printed millimetre — nothing to rescale.
    const layout = resolveReceiptLayout({ paper: '80mm', leftMm: 2, rightMm: 2 });
    expect(pageWidthMmFor(layout, 'raster')).toBe(layout.contentMm);
    expect(contentOffsetMmFor(layout, 'raster')).toBe(0);
    expect(pageWidthMmFor(layout, 'html')).toBe(layout.paperMm);
  });
});

describe('alignment test slip', () => {
  it('rules exactly one full line, which must not wrap', () => {
    // If this ever exceeds the column count the ruler wraps on paper and the
    // margins look wrong when they are not. Fix the constant, not the font.
    for (const paper of PROFILES) {
      const layout = resolveReceiptLayout({ paper });
      const lines = alignmentTestLines({ paper });
      const ruler = lines.find(l => /^=+$/.test(l));
      expect(ruler, `${paper} has no ruler line`).toBeTruthy();
      expect(ruler!.length).toBe(layout.columnsFontA);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(layout.columnsFontA);
    }
  });

  it('rules the full head when the margins are zero, and less when they are not', () => {
    // The ruler is the measuring instrument on the calibration slip, so it has
    // to be the width the slip ACTUALLY prints at. Margins genuinely remove
    // characters — 2mm a side on an 80mm head is 32 dots, which is 2 columns
    // of Font A at either end — and a ruler that ignored them would make a
    // correctly-margined slip look short.
    const full = alignmentTestLines({ paper: '80mm', leftMm: 0, rightMm: 0 });
    expect(full.find(l => /^=+$/.test(l))!.length).toBe(48);
    expect(alignmentTestLines({ paper: '58mm', leftMm: 0, rightMm: 0 }).find(l => /^=+$/.test(l))!.length).toBe(32);

    const inset = alignmentTestLines({ paper: '80mm' });
    const insetLayout = resolveReceiptLayout({ paper: '80mm' });
    expect(inset.find(l => /^=+$/.test(l))!.length).toBe(insetLayout.columnsFontA);
    expect(insetLayout.columnsFontA).toBeLessThan(48);
  });

  it('puts LEFT and RIGHT hard against opposite edges', () => {
    const layout = resolveReceiptLayout({ paper: '80mm' });
    const line = alignmentTestLines({ paper: '80mm' }).find(l => l.startsWith('LEFT'))!;
    expect(line.startsWith('LEFT')).toBe(true);
    expect(line.endsWith('RIGHT')).toBe(true);
    expect(line.length).toBe(layout.columnsFontA);
  });

  it('records the profile, dot width and strategy on the slip itself', () => {
    // A photograph of the slip has to be self-describing, or a support call
    // turns into guesswork about which settings produced it.
    const text = alignmentTestLines({ paper: '80mm', strategy: 'raw-escpos' }).join('\n');
    expect(text).toContain('80mm');
    expect(text).toContain('576');
    expect(text).toContain('raw-escpos');
  });
});

// ============================================================
// CALIBRATION FROM A RULER
//
// A client found by trial that Left 3 / Right 5 squared their slip in Windows
// Driver mode. That is a real measurement of a real machine and it is kept —
// but arriving at it took an evening of print, look, adjust, print again, and
// every shop whose roll sits slightly differently has to repeat it.
//
// The measurement has to be theirs. The arithmetic does not.
// ============================================================
describe('turning two ruler measurements into margins', () => {
  it('moves half the difference from the wide edge to the narrow one', () => {
    // Printed with 4/4 but measured 2mm left and 8mm right: 3mm too far left.
    const layout = resolveReceiptLayout({ paper: '80mm', leftMm: 4, rightMm: 4 });
    const fix = computeMarginCorrection(layout, 2, 8);
    expect(fix.offsetMm).toBe(-3);
    expect(fix.leftMm).toBe(7);
    expect(fix.rightMm).toBe(1);
    expect(fix.applicable).toBe(true);

    // What the ruler would read next time. Note this is measured-plus-delta,
    // NOT expectedMargins(): the whole reason a correction is needed is that
    // the machine prints somewhere the configured geometry does not predict,
    // and asserting against the prediction would only re-state the config.
    const nextLeft = 2 + (fix.leftMm - layout.leftMm);
    const nextRight = 8 + (fix.rightMm - layout.rightMm);
    expect(nextLeft).toBeCloseTo(nextRight, 1);
  });

  it('gets as close as it can when one side would have to go negative', () => {
    // Nothing can print left of the paper. A 3mm correction on a 2mm right
    // margin gives back 1mm of the asymmetry, and the shop can run the
    // measurement again rather than being handed an impossible number.
    const layout = resolveReceiptLayout({ paper: '80mm', leftMm: 2, rightMm: 2 });
    const fix = computeMarginCorrection(layout, 2, 8);
    expect(fix.rightMm).toBe(0);
    expect(fix.leftMm).toBe(5);
    const nextLeft = 2 + (fix.leftMm - layout.leftMm);
    const nextRight = 8 + (fix.rightMm - layout.rightMm);
    expect(Math.abs(nextLeft - nextRight)).toBeLessThan(Math.abs(2 - 8));
  });

  it('reproduces the pair the client found by hand', () => {
    // Their slip sat 1mm right of centre on a 3/5 machine; the same sum that
    // took an evening takes one measurement.
    const layout = resolveReceiptLayout({ paper: '80mm', leftMm: 4, rightMm: 4 });
    const fix = computeMarginCorrection(layout, 9, 7);
    expect(fix.leftMm).toBe(3);
    expect(fix.rightMm).toBe(5);
  });

  it('says there is nothing to do when the slip is already centred', () => {
    const layout = resolveReceiptLayout({ paper: '80mm', leftMm: 2, rightMm: 2 });
    expect(computeMarginCorrection(layout, 6, 6).applicable).toBe(false);
    // Half a millimetre is inside what a ruler can honestly resolve.
    expect(computeMarginCorrection(layout, 6, 6.1).applicable).toBe(false);
  });

  it('flags a WIDTH fault instead of hiding it behind a margin change', () => {
    // A slip printing far too narrow leaves much more blank paper than the
    // profile expects. Nudging margins would disguise a wrong paper profile.
    const layout = resolveReceiptLayout({ paper: '80mm', leftMm: 2, rightMm: 2 });
    const fix = computeMarginCorrection(layout, 14, 18);
    expect(fix.widthMismatchMm).toBeGreaterThan(3);
  });

  it('refuses nonsense rather than writing a bad margin', () => {
    const layout = resolveReceiptLayout({ paper: '80mm', leftMm: 2, rightMm: 2 });
    for (const bad of [[-1, 4], [NaN, 4], [4, NaN]] as const) {
      const fix = computeMarginCorrection(layout, bad[0], bad[1]);
      expect(fix.applicable).toBe(false);
      expect(fix.leftMm).toBe(layout.leftMm);
      expect(fix.rightMm).toBe(layout.rightMm);
    }
  });

  it('never produces a margin the resolver would clamp away', () => {
    const layout = resolveReceiptLayout({ paper: '80mm', leftMm: 2, rightMm: 2 });
    const fix = computeMarginCorrection(layout, 0, 40);
    expect(fix.leftMm).toBeGreaterThanOrEqual(0);
    expect(fix.leftMm).toBeLessThanOrEqual(20);
    expect(fix.rightMm).toBeGreaterThanOrEqual(0);
  });
});
