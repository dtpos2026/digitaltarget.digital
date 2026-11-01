// ============================================================
// ESC/POS RASTER — the stage that decides where ink lands on the paper.
//
// These pin the two faults the printer simulator found behind the reported
// "excessive right margin" and "unnecessary top/bottom whitespace".
// ============================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { HAS_ENGINE, requireEngine } from './_shellEngine';

const require_ = createRequire(import.meta.url);
const raster = requireEngine('escposRaster.cjs');
const { rasterGeometry, trimBlankRows, inkCoverage, packDots, wrapRasterCommands, escposRasterBytes } = raster;

/** A packed slip: `rows` of 'x'/'.' strings, one char per dot. */
function makePacked(rows: string[], paperDots = 32) {
  const rowBytes = Math.ceil(paperDots / 8);
  const data = Buffer.alloc(rowBytes * rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length && x < paperDots; x++) {
      if (row[x] === 'x') data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  });
  return { rowBytes, height: rows.length, data };
}

describe('rasterGeometry', () => {
  it('places the content between the two margins, in whole dots', () => {
    const g = rasterGeometry('80mm', 2, 2);
    expect(g.paperDots).toBe(576);
    expect(g.dotsPerMm).toBe(8);
    expect(g.leftDots).toBe(16);
    expect(g.rightDots).toBe(16);
    expect(g.contentDots).toBe(544);
  });

  it('keeps left and right independent', () => {
    const wide = rasterGeometry('80mm', 4, 1);
    expect(wide.leftDots).toBe(32);
    expect(wide.rightDots).toBe(8);
    expect(wide.contentDots).toBe(536);
    const other = rasterGeometry('80mm', 1, 4);
    expect(other.leftDots).toBe(8);
    // Same width, different starting point — that is the whole setting.
    expect(other.contentDots).toBe(wide.contentDots);
    expect(other.leftDots).not.toBe(wide.leftDots);
  });

  it('never leaves less than a printable strip', () => {
    const g = rasterGeometry('80mm', 200, 200);
    expect(g.contentDots).toBeGreaterThanOrEqual(32);
    expect(g.leftDots + g.contentDots).toBeLessThanOrEqual(g.paperDots);
  });
});

describe('trimBlankRows', () => {
  it('drops the blank tail a rendered document carries', () => {
    // The measured fault: over 15mm of blank paper fed before the cut,
    // purely from the document's own trailing space.
    const packed = makePacked(['....', 'xx..', '....', '....', '....', '....']);
    const trimmed = trimBlankRows(packed, 0, 0);
    expect(trimmed.height).toBe(1);
  });

  it('keeps a deliberate breathing margin when asked', () => {
    const packed = makePacked(['....', '....', 'xx..', '....', '....', '....']);
    const trimmed = trimBlankRows(packed, 1, 2);
    // 1 blank row kept above the ink, 2 below.
    expect(trimmed.height).toBe(4);
  });

  it('never asks for more margin than the slip has', () => {
    const packed = makePacked(['xx..', '....']);
    const trimmed = trimBlankRows(packed, 10, 10);
    expect(trimmed.height).toBe(2);
  });

  it('leaves a completely blank slip alone for the caller to reject', () => {
    const packed = makePacked(['....', '....']);
    expect(trimBlankRows(packed, 0, 0).height).toBe(2);
  });

  it('does not disturb a slip that has no blank edges', () => {
    const packed = makePacked(['x...', '..x.']);
    expect(trimBlankRows(packed, 0, 0).height).toBe(2);
  });
});

describe('inkCoverage', () => {
  it('reports a full-width slip as covering its content width', () => {
    const packed = makePacked(['xxxxxxxx'], 8);
    expect(inkCoverage(packed, 8)).toBe(1);
  });

  it('reports the squeezed slip that a too-wide capture produces', () => {
    // The reported symptom: a narrow receipt with a wide blank right margin.
    // Two of eight dots inked is the signal the log now warns about.
    const packed = makePacked(['xx......'], 8);
    expect(inkCoverage(packed, 8)).toBe(0.25);
  });

  it('is zero for an empty slip rather than throwing', () => {
    expect(inkCoverage(makePacked(['........'], 8), 8)).toBe(0);
  });
});

describe('packDots', () => {
  it('offsets the content by the left margin, in dots', () => {
    const geom = rasterGeometry('80mm', 2, 2);
    // One black pixel at x=0 must land at dot 16 (2mm at 8 dots/mm).
    const pixels = Buffer.alloc(4, 0);
    pixels[3] = 255; // opaque black
    const packed = packDots(pixels, 1, 1, geom, { darkness: 6 });
    const bit = (packed.data[16 >> 3] >> (7 - (16 & 7))) & 1;
    expect(bit).toBe(1);
    expect(packed.data[0]).toBe(0);
  });

  it('treats white as no ink', () => {
    const geom = rasterGeometry('80mm', 0, 0);
    const pixels = Buffer.from([255, 255, 255, 255]);
    const packed = packDots(pixels, 1, 1, geom, { darkness: 6 });
    expect(packed.data[0]).toBe(0);
  });
});

// ============================================================
// BLANK-PAPER REGRESSION
//
// A shipped build fed and cut blank strips on every job. The trim's margin
// default was written `Number(opts.topMarginDots) ?? 8`, but `??` only
// catches null/undefined — Number(undefined) is NaN, which sails straight
// through. keepTop became NaN, the slice became empty, and the raster header
// claimed zero rows. The printer dutifully fed paper and cut it.
//
// main.cjs does not pass those margin options at all, so this was every
// print, not an edge case. The earlier tests missed it because they always
// passed explicit numbers — exactly the argument shape the caller never uses.
// ============================================================
describe('blank-paper regression', () => {
  /** A slip with a band of ink across the middle. */
  function renderedSlip(contentDots: number, height = 60) {
    const px = Buffer.alloc(contentDots * height * 4, 0xff);
    for (let i = 3; i < px.length; i += 4) px[i] = 255;
    for (let y = 20; y < 40; y++) {
      for (let x = 0; x < contentDots; x++) {
        const o = (y * contentDots + x) * 4;
        px[o] = 0; px[o + 1] = 0; px[o + 2] = 0;
      }
    }
    return px;
  }

  it('keeps the slip when the margin options are absent, as the caller leaves them', () => {
    const geom = rasterGeometry('80mm', 2, 2);
    const packed = packDots(renderedSlip(geom.contentDots), geom.contentDots, 60, geom, { darkness: 6 });
    // undefined is what main.cjs actually passes for these.
    const trimmed = trimBlankRows(packed, undefined as never, undefined as never);
    expect(Number.isFinite(trimmed.height)).toBe(true);
    expect(trimmed.height).toBeGreaterThan(0);
    expect(trimmed.data.length).toBeGreaterThan(0);
  });

  it('survives a NaN margin instead of emptying the slip', () => {
    const geom = rasterGeometry('80mm', 2, 2);
    const packed = packDots(renderedSlip(geom.contentDots), geom.contentDots, 60, geom, { darkness: 6 });
    const trimmed = trimBlankRows(packed, NaN, NaN);
    expect(trimmed.height).toBe(20);
    expect(trimmed.data.length).toBe(trimmed.height * trimmed.rowBytes);
  });

  it('refuses to hand the printer a zero-row raster', () => {
    // This is what reached the printer: an empty buffer and a header saying
    // zero rows. It must throw so the caller falls back to the driver path
    // rather than reporting success over blank paper.
    expect(() => wrapRasterCommands({ rowBytes: 72, height: 0, data: Buffer.alloc(0) }, true, {}))
      .toThrow(/empty/i);
    expect(() => wrapRasterCommands({ rowBytes: 72, height: NaN, data: Buffer.alloc(0) }, true, {}))
      .toThrow(/empty/i);
  });

  it('produces real raster bytes end to end with the caller\'s own options', () => {
    const geom = rasterGeometry('80mm', 2, 2);
    const height = 60;
    const pixels = renderedSlip(geom.contentDots, height);
    // Stand-in for the Electron NativeImage the handler passes in.
    const image = {
      getSize: () => ({ width: geom.contentDots, height }),
      resize: () => image,
      toBitmap: () => pixels,
    };
    const bytes = escposRasterBytes(image, '80mm', true, {
      darkness: 6, bold: false, marginLeftMm: 2, marginRightMm: 2,
    });
    // Header + ink rows + feed + cut. The blank build produced 19 bytes.
    expect(bytes.length).toBeGreaterThan(1000);
    // GS v 0 raster command, with a non-zero row count.
    const idx = bytes.indexOf(Buffer.from([0x1d, 0x76, 0x30, 0x00]));
    expect(idx).toBeGreaterThanOrEqual(0);
    const rows = bytes[idx + 6] | (bytes[idx + 7] << 8);
    expect(rows).toBeGreaterThan(0);
  });
});
