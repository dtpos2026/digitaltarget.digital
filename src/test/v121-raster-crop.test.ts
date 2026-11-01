// ============================================================
// RASTER CROP — the "Automatic" narrow-slip lock.
//
// Photographed side by side, the same order printed three ways: Windows
// Driver Only filled the roll with correct margins; Raw ESC/POS filled it;
// and Automatic (rendered template, sent as RAW) came out noticeably narrow
// with a wide band down the right.
//
// Only Automatic goes through a screen capture. The slip is captured from the
// print worker's VIEWPORT, and the viewport is only exactly the slip when
// setContentSize is not clamped, the zoom factor maps as expected, and no
// child overflows. On a real Windows machine any one of those can leave blank
// space beside the content — and because the capture is then downscaled so
// its FULL width fills the printable dots, that blank steals room from the
// receipt.
//
// The fix trims blank columns before the downscale, so the RECEIPT is what
// fills the paper. These tests drive the real cropBlankSides with a
// NativeImage-shaped stub.
// ============================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { HAS_ENGINE, requireEngine } from './_shellEngine';

const require_ = createRequire(import.meta.url);
const { cropBlankSides, inkColumns } = requireEngine('escposRaster.cjs');

/**
 * A NativeImage-shaped stub: `inkFrom`..`inkTo` are dark, the rest is white.
 * Only the three methods escposRasterBytes uses are implemented.
 */
function stubImage(width: number, height: number, inkFrom: number, inkTo: number) {
  const data = Buffer.alloc(width * height * 4, 0xff);
  for (let y = 0; y < height; y++) {
    for (let x = inkFrom; x <= inkTo; x++) {
      const i = (y * width + x) * 4;
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
    }
  }
  const make = (w: number, h: number, buf: Buffer) => ({
    getSize: () => ({ width: w, height: h }),
    toBitmap: () => buf,
    crop: ({ x, y, width: cw, height: ch }: any) => {
      const out = Buffer.alloc(cw * ch * 4);
      for (let row = 0; row < ch; row++) {
        buf.copy(out, row * cw * 4, ((y + row) * w + x) * 4, ((y + row) * w + x + cw) * 4);
      }
      return make(cw, ch, out);
    },
  });
  return make(width, height, data);
}

describe('locating the ink', () => {
  it('finds the first and last inked column', () => {
    const cols = inkColumns(stubImage(200, 20, 30, 150).toBitmap(), 200, 20);
    expect(cols.first).toBe(30);
    expect(cols.last).toBe(150);
  });

  it('reports nothing for a blank capture', () => {
    expect(inkColumns(stubImage(100, 10, 5, 4).toBitmap(), 100, 10)).toBeNull();
  });
});

describe('trimming the blank the capture picked up', () => {
  it('removes a wide band on the right', () => {
    // The observed failure: content on the left, blank to the right, so the
    // downscale squeezed the receipt into part of the roll.
    const img = stubImage(1000, 50, 0, 619);
    const { image, trimmedRight } = cropBlankSides(img);
    expect(trimmedRight).toBe(380);
    expect(image.getSize().width).toBe(620);
  });

  it('restores full-width coverage after the crop', () => {
    const captured = 1000, ink = 620, contentDots = 576;
    const before = (ink / captured) * contentDots / contentDots;
    const { image } = cropBlankSides(stubImage(captured, 50, 0, ink - 1));
    const after = image.getSize().width / image.getSize().width;
    expect(before).toBeLessThan(0.65);   // the narrow slip that was printing
    expect(after).toBe(1);               // now the receipt fills the width
  });

  it('leaves a healthy capture untouched', () => {
    const img = stubImage(600, 40, 0, 599);
    const { image, trimmedLeft, trimmedRight } = cropBlankSides(img);
    expect(trimmedLeft).toBe(0);
    expect(trimmedRight).toBe(0);
    expect(image.getSize().width).toBe(600);
  });

  it('refuses to blow up a genuinely narrow slip', () => {
    // Enlarging ink that covers a small fraction of the capture would be a
    // guess, not a fix, so such a capture is left exactly as it is.
    const img = stubImage(1000, 40, 480, 519); // 4% coverage
    const { image, trimmedLeft } = cropBlankSides(img);
    expect(trimmedLeft).toBe(0);
    expect(image.getSize().width).toBe(1000);
  });

  it('never touches the height', () => {
    const { image } = cropBlankSides(stubImage(1000, 777, 0, 619));
    expect(image.getSize().height).toBe(777);
  });
});
