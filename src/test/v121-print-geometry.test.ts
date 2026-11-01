// ============================================================
// PRINT GEOMETRY — margin + scaling regression locks.
//
// These pin the two client-visible faults this module was written for:
//
//   1. "Left and right margins are uneven / the right side is cut off."
//      The slip used to be laid out at the full 80mm roll width and then
//      squeezed into the head's 72mm printable area, so the right edge was
//      clipped and every character came out ~10% small and faint.
//
//   2. "Changing the margin setting only moves the preview, not the paper."
//      The margins were applied twice on the raster path (as CSS padding
//      AND as a dot offset) and not at all on the driver path, so the
//      numbers the user typed never matched what came out.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  resolvePrintGeometry,
  paperMmOf,
  printableMmOf,
  printableDotsOf,
} from '@/printing/printGeometry';

describe('paper constants', () => {
  it('separates the roll width from the markable width', () => {
    // An 80mm roll is 80mm of paper but only ~72mm of it can be printed.
    // Confusing the two is what clipped the right edge.
    expect(paperMmOf('80mm')).toBe(80);
    expect(printableMmOf('80mm')).toBe(72);
    expect(paperMmOf('58mm')).toBe(58);
    expect(printableMmOf('58mm')).toBe(48);
  });

  it('keeps 8 dots per mm at 203 DPI on every paper size', () => {
    // escposRasterBytes in electron/main.cjs derives dotsPerMm from exactly
    // this pair. If they drift apart the margins stop landing where asked.
    for (const paper of ['58mm', '80mm', '110mm'] as const) {
      expect(printableDotsOf(paper) / printableMmOf(paper)).toBe(8);
    }
  });
});

describe('content width', () => {
  it('lays the slip out inside the printable area, not the roll', () => {
    const g = resolvePrintGeometry({ paper: '80mm', leftMm: 0, rightMm: 0 });
    expect(g.contentMm).toBe(72);
    expect(g.contentDots).toBe(576);
  });

  it('maps one content millimetre to one printed millimetre', () => {
    // This is what stops the rasteriser from rescaling (and blurring) the
    // render: the captured document is already the exact physical width.
    const g = resolvePrintGeometry({ paper: '80mm', leftMm: 2, rightMm: 2 });
    expect(g.contentDots).toBe(g.contentMm * 8);
  });
});

describe('independent left / right margins', () => {
  it('defaults (2mm, 2mm) leave equal paper on both sides', () => {
    const g = resolvePrintGeometry({ paper: '80mm', leftMm: 2, rightMm: 2 });
    expect(g.leftMm).toBe(2);
    expect(g.rightMm).toBe(2);
    expect(g.contentMm).toBe(68);
    expect(g.leftDots).toBe(16);
  });

  it('moves the content right when only the left margin grows', () => {
    const base = resolvePrintGeometry({ paper: '80mm', leftMm: 2, rightMm: 2 });
    const wide = resolvePrintGeometry({ paper: '80mm', leftMm: 4, rightMm: 1 });
    // 4mm left / 1mm right: content starts 2mm further right than the 2/2
    // default and is 1mm narrower overall (7 - 4 = 3mm of margin vs 4mm).
    expect(wide.leftDots).toBe(32);
    expect(wide.leftDots - base.leftDots).toBe(16); // 2mm at 8 dots/mm
    expect(wide.contentMm).toBe(67);
  });

  it('moves the content left when only the right margin grows', () => {
    const g = resolvePrintGeometry({ paper: '80mm', leftMm: 1, rightMm: 4 });
    expect(g.leftDots).toBe(8);
    expect(g.contentMm).toBe(67);
  });

  it('treats the two sides as genuinely independent, never re-centring', () => {
    // The three cases from the client's margin verification test.
    const a = resolvePrintGeometry({ paper: '80mm', leftMm: 2, rightMm: 2 });
    const b = resolvePrintGeometry({ paper: '80mm', leftMm: 4, rightMm: 1 });
    const c = resolvePrintGeometry({ paper: '80mm', leftMm: 1, rightMm: 4 });
    // Same content width for B and C, but the start position differs — that
    // difference is the whole point of the setting.
    expect(b.contentMm).toBe(c.contentMm);
    expect(b.leftDots).toBeGreaterThan(a.leftDots);
    expect(c.leftDots).toBeLessThan(a.leftDots);
    expect(b.leftDots - c.leftDots).toBe(24); // 3mm apart
  });
});

describe('guard rails', () => {
  it('never shrinks a slip below a readable width', () => {
    const g = resolvePrintGeometry({ paper: '80mm', leftMm: 40, rightMm: 40 });
    expect(g.contentMm).toBeGreaterThanOrEqual(30);
    expect(g.leftMm + g.rightMm + g.contentMm).toBeLessThanOrEqual(72);
  });

  it('keeps the left/right ratio when clamping extreme margins', () => {
    // 30 left / 10 right is 3:1; after clamping it must still lean left.
    const g = resolvePrintGeometry({ paper: '80mm', leftMm: 30, rightMm: 10 });
    expect(g.leftMm).toBeGreaterThan(g.rightMm);
  });

  it('ignores negative and non-numeric margins instead of inverting the slip', () => {
    const g = resolvePrintGeometry({ paper: '80mm', leftMm: -5, rightMm: NaN });
    expect(g.leftMm).toBe(0);
    expect(g.rightMm).toBe(0);
    expect(g.contentMm).toBe(72);
  });

  it('honours a measured calibration width over the margin arithmetic', () => {
    // A shop that measured its own printer gets exactly what it asked for.
    const g = resolvePrintGeometry({ paper: '80mm', leftMm: 2, rightMm: 2, contentWidthMm: 68 });
    expect(g.contentMm).toBe(68);
    expect(g.leftMm).toBe(2);
    expect(g.rightMm).toBe(2);
  });

  it('centres a calibrated width that cannot honour the requested offset', () => {
    const g = resolvePrintGeometry({ paper: '80mm', leftMm: 30, rightMm: 0, contentWidthMm: 70 });
    expect(g.contentMm).toBe(70);
    expect(g.leftMm).toBe(1);
    expect(g.rightMm).toBe(1);
  });
});

describe('58mm paper', () => {
  it('scales the same way on a narrow roll', () => {
    const g = resolvePrintGeometry({ paper: '58mm', leftMm: 2, rightMm: 2 });
    expect(g.contentMm).toBe(44);
    expect(g.contentDots).toBe(352);
    expect(g.leftDots).toBe(16);
  });
});
