// ============================================================
// THE CALIBRATION MUST REACH THE PAPER IN AUTO / RAW FAST MODE.
//
// The shop's machine needs Left 3 / Right 5 to print a centred slip. In
// Windows Driver Only that pair works. In Auto / RAW Fast the same pair did
// not, and changing it did not move the print the way the number said.
//
// The cause was in the raster stage, not in the margin plumbing. The capture
// was cropped to its INK and that crop was then resized back up to the full
// content width — so the slip was stretched to fill whatever room the margins
// left, which undoes them. Worse, the crop is measured per bill: a receipt
// with a long widest line and one with a short widest line got different
// scale factors, so the same shop with the same settings got two widths.
//
// These tests drive the real raster pipeline with a NativeImage-shaped stub
// and assert the DOTS, because dots are what the printer receives. They cover
// the exact margin pairs the shop asked to be tested.
// ============================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { HAS_ENGINE, requireEngine } from './_shellEngine';

const require_ = createRequire(import.meta.url);
const {
  escposRasterBytes, rasterGeometry, paperDotsOf,
  findMeasureRule, cropToMeasureRule,
} = requireEngine('escposRaster.cjs');

/**
 * A NativeImage-shaped stub.
 *
 * `blankRight` is the blank the real capture picks up beside the slip on a
 * Windows machine — the thing that squeezed the receipt when it was scaled in
 * with the content. `rule` adds the measuring hairline the raster stage crops
 * to, which every real raster document now carries.
 */
function slipImage(
  width: number, height: number, inkFrom = 0, inkTo = width - 1,
  opts: { blankRight?: number; rule?: boolean } = {},
) {
  const blankRight = opts.blankRight || 0;
  const withRule = opts.rule !== false;
  const total = width + blankRight;
  const data = Buffer.alloc(total * height * 4, 0xff);
  const ink = (x: number, y: number) => {
    const i = (y * total + x) * 4;
    data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
  };
  // The measuring rule: solid, full document width, two rows tall.
  if (withRule) {
    for (let y = 0; y < 2; y++) for (let x = 0; x < width; x++) ink(x, y);
  }
  // Body rows carry a wide white gutter, because real text does: a receipt
  // line is mostly paper. Without one every row would be as solid as the rule
  // and there would be nothing to tell them apart.
  const gapFrom = inkFrom + Math.floor((inkTo - inkFrom) * 0.35);
  const gapTo = inkFrom + Math.floor((inkTo - inkFrom) * 0.65);
  for (let y = withRule ? 2 : 0; y < height; y++) {
    for (let x = inkFrom; x <= inkTo; x++) {
      if (x >= gapFrom && x <= gapTo) continue;
      ink(x, y);
    }
  }
  width = total;
  const make = (w: number, h: number, buf: Buffer): any => ({
    getSize: () => ({ width: w, height: h }),
    toBitmap: () => buf,
    isEmpty: () => w === 0 || h === 0,
    crop: ({ x, y, width: cw, height: ch }: any) => {
      const out = Buffer.alloc(cw * ch * 4, 0xff);
      for (let row = 0; row < ch; row++) {
        buf.copy(out, row * cw * 4, ((y + row) * w + x) * 4, ((y + row) * w + x + cw) * 4);
      }
      return make(cw, ch, out);
    },
    resize: ({ width: rw, height: rh }: any) => {
      // Nearest-neighbour is enough: these tests measure WHERE the ink lands,
      // not how it is filtered.
      const out = Buffer.alloc(rw * rh * 4, 0xff);
      for (let y = 0; y < rh; y++) {
        const sy = Math.min(h - 1, Math.floor(y * h / rh));
        for (let x = 0; x < rw; x++) {
          const sx = Math.min(w - 1, Math.floor(x * w / rw));
          buf.copy(out, (y * rw + x) * 4, (sy * w + sx) * 4, (sy * w + sx) * 4 + 4);
        }
      }
      return make(rw, rh, out);
    },
  });
  return make(width, height, data);
}

/** Where the ink actually starts and ends, read back out of the raster bytes. */
function inkSpan(bytes: Buffer, paperDots: number) {
  const rowBytes = Math.ceil(paperDots / 8);
  // Skip the init block and the GS v 0 header to reach the dot rows.
  const header = bytes.indexOf(Buffer.from([0x1d, 0x76, 0x30, 0x00]));
  expect(header, 'no raster header in the job').toBeGreaterThan(-1);
  const start = header + 8;
  let first = -1;
  let last = -1;
  for (let x = 0; x < paperDots; x++) {
    const byte = bytes[start + (x >> 3)];
    if (byte === undefined) break;
    if (byte & (0x80 >> (x & 7))) {
      if (first === -1) first = x;
      last = x;
    }
  }
  return { first, last };
}

/** GS L (left margin) and GS W (print area) as the printer will read them. */
function geometryCommands(bytes: Buffer) {
  const at = (a: number, b: number) => bytes.indexOf(Buffer.from([a, b]));
  const gsL = at(0x1d, 0x4c);
  const gsW = at(0x1d, 0x57);
  return {
    leftMargin: bytes[gsL + 2] | (bytes[gsL + 3] << 8),
    printArea: bytes[gsW + 2] | (bytes[gsW + 3] << 8),
  };
}

const DOTS_PER_MM = 8;

describe('the margin pairs the shop asked to be tested', () => {
  // Exactly the matrix from the request.
  const CASES: Array<[number, number]> = [
    [3, 5],   // the machine's own calibration
    [5, 5],
    [5, 3],
    [8, 5],
    [3, 8],
  ];

  for (const [left, right] of CASES) {
    it(`puts the slip at ${left}mm from the head with ${right}mm left over`, () => {
      const bytes = escposRasterBytes(slipImage(800, 60), '80mm', true, {
        marginLeftMm: left, marginRightMm: right,
      });
      const paperDots = paperDotsOf('80mm');
      const span = inkSpan(bytes, paperDots);

      // The ink begins exactly at the configured left margin...
      expect(span.first, `left margin ${left}mm did not reach the dots`).toBe(left * DOTS_PER_MM);
      // ...and stops exactly the configured right margin short of the head.
      expect(paperDots - 1 - span.last, `right margin ${right}mm did not reach the dots`)
        .toBe(right * DOTS_PER_MM);
    });
  }

  it('moves the slip when only the left margin changes', () => {
    // The complaint in one assertion: change the number, the print moves.
    const paperDots = paperDotsOf('80mm');
    const at3 = inkSpan(escposRasterBytes(slipImage(800, 60), '80mm', true,
      { marginLeftMm: 3, marginRightMm: 5 }), paperDots);
    const at8 = inkSpan(escposRasterBytes(slipImage(800, 60), '80mm', true,
      { marginLeftMm: 8, marginRightMm: 5 }), paperDots);

    expect(at8.first - at3.first).toBe(5 * DOTS_PER_MM);
  });

  it('moves it the other way when only the right margin changes', () => {
    const paperDots = paperDotsOf('80mm');
    const at5 = inkSpan(escposRasterBytes(slipImage(800, 60), '80mm', true,
      { marginLeftMm: 3, marginRightMm: 5 }), paperDots);
    const at8 = inkSpan(escposRasterBytes(slipImage(800, 60), '80mm', true,
      { marginLeftMm: 3, marginRightMm: 8 }), paperDots);

    expect(at5.last - at8.last).toBe(3 * DOTS_PER_MM);
    expect(at8.first).toBe(at5.first);
  });
});

describe('finding the slip inside the screenshot', () => {
  const paperDots = paperDotsOf('80mm');

  it('removes the blank the capture picked up beside the slip', () => {
    // THE NARROW-RECEIPT FAULT. The worker window cannot always be sized to
    // the document, so the screenshot can carry blank to its right. Scaling
    // that in with the content shrinks the receipt to fit alongside it — a
    // narrow slip with a wide band down the right edge.
    const withBlank = slipImage(800, 60, 0, 799, { blankRight: 400 });
    const span = inkSpan(escposRasterBytes(withBlank, '80mm', true,
      { marginLeftMm: 3, marginRightMm: 5 }), paperDots);

    expect(span.first).toBe(3 * DOTS_PER_MM);
    expect(paperDots - 1 - span.last).toBe(5 * DOTS_PER_MM);
  });

  it('gives two bills of different widths the SAME margins', () => {
    // Cropping to the INK made this fail: a receipt whose widest line is long
    // and one whose widest line is short were cropped and then scaled
    // differently, so the same shop with the same settings got two widths.
    // The measuring rule is identical on every bill, so the crop is too.
    const wide = slipImage(800, 60, 0, 799, { blankRight: 400 });
    const narrow = slipImage(800, 60, 100, 699, { blankRight: 400 });

    const a = inkSpan(escposRasterBytes(wide, '80mm', true, { marginLeftMm: 3, marginRightMm: 5 }), paperDots);
    const b = inkSpan(escposRasterBytes(narrow, '80mm', true, { marginLeftMm: 3, marginRightMm: 5 }), paperDots);

    // The wide bill reaches both configured margins...
    expect(a.first).toBe(3 * DOTS_PER_MM);
    expect(paperDots - 1 - a.last).toBe(5 * DOTS_PER_MM);
    // ...and the narrow one keeps its own inset rather than being stretched
    // out to match, which is what "the same scale on every bill" means.
    expect(b.first).toBeGreaterThan(a.first);
    expect(b.last).toBeLessThan(a.last);
  });

  it('reads the document width from the rule, not from the content', () => {
    const img = slipImage(800, 40, 200, 599, { blankRight: 300 });
    const rule = findMeasureRule(img.toBitmap(), 1100, 40);
    expect(rule).toBeTruthy();
    expect(rule.first).toBe(0);
    expect(rule.last).toBe(799);      // the document, not the ink at 200..599
    expect(rule.barHeight).toBe(2);
  });

  it('refuses to mistake content for the rule', () => {
    // A rule is SOLID across its span. A first line of text is not, so a
    // document without one is rejected instead of being cropped to a word.
    const noRule = slipImage(800, 40, 100, 699, { rule: false });
    expect(findMeasureRule(noRule.toBitmap(), 800, 40)).toBeNull();

    const gappy = Buffer.alloc(800 * 10 * 4, 0xff);
    for (let y = 0; y < 10; y++) {
      for (const x of [10, 11, 40, 41, 300, 301]) {
        const i = (y * 800 + x) * 4;
        gappy[i] = 0; gappy[i + 1] = 0; gappy[i + 2] = 0; gappy[i + 3] = 255;
      }
    }
    expect(findMeasureRule(gappy, 800, 10)).toBeNull();
  });

  it('falls back to the ink crop when a capture carries no rule', () => {
    // An older document, or a capture that lost its first rows. The blank
    // still has to go, even if the crop then varies with the bill.
    const noRule = slipImage(800, 60, 0, 799, { blankRight: 400, rule: false });
    const span = inkSpan(escposRasterBytes(noRule, '80mm', true,
      { marginLeftMm: 3, marginRightMm: 5 }), paperDots);
    expect(span.first).toBe(3 * DOTS_PER_MM);
    expect(paperDots - 1 - span.last).toBe(5 * DOTS_PER_MM);
  });

  it('never prints the rule itself', () => {
    // It is a measuring mark, not part of the slip.
    const img = slipImage(800, 60, 0, 799);
    const cropped = cropToMeasureRule(img);
    expect(cropped).toBeTruthy();
    expect(cropped.image.getSize().height).toBe(58);
  });
});

describe('the printer is told the full head, and positioned by the dots', () => {
  it('sets GS L to zero and GS W to the whole printable width', () => {
    // The raster already places the slip at the right dot column, so the
    // printer's own margin must be zero or the two offsets add up and push
    // the content off the right edge.
    const bytes = escposRasterBytes(slipImage(800, 60), '80mm', true,
      { marginLeftMm: 3, marginRightMm: 5 });
    const cmd = geometryCommands(bytes);
    expect(cmd.leftMargin).toBe(0);
    expect(cmd.printArea).toBe(paperDotsOf('80mm'));
  });

  it('computes the same geometry on 58mm paper', () => {
    const geom = rasterGeometry('58mm', 3, 5);
    expect(geom.paperDots).toBe(384);
    expect(geom.leftDots).toBe(24);
    expect(geom.rightDots).toBe(40);
    expect(geom.contentDots).toBe(384 - 24 - 40);
  });

  it('never lets an absurd margin leave no slip at all', () => {
    const geom = rasterGeometry('80mm', 60, 60);
    expect(geom.contentDots).toBeGreaterThanOrEqual(32);
    expect(geom.leftDots + geom.contentDots).toBeLessThanOrEqual(geom.paperDots);
  });
});

describe('the rule is recognised only when it really is one', () => {
  it('declines a solid band taller than a hairline could be', () => {
    // A template with a black header band must not have that band cut off
    // the top of every slip. The rule is two CSS pixels and the worker never
    // zooms past 8x, so anything past ~16 rows is somebody's design.
    const width = 800;
    const height = 60;
    const data = Buffer.alloc(width * height * 4, 0xff);
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
      }
    }
    expect(findMeasureRule(data, width, height)).toBeNull();
  });

  it('declines a stray mark that is too narrow to be the document', () => {
    const width = 800;
    const data = Buffer.alloc(width * 20 * 4, 0xff);
    for (let y = 0; y < 2; y++) {
      for (let x = 10; x < 60; x++) {
        const i = (y * width + x) * 4;
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
      }
    }
    expect(findMeasureRule(data, width, 20)).toBeNull();
  });
});
