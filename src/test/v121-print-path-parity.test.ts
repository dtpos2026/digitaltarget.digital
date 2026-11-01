// ============================================================
// PRINT PATH PARITY — every slip type must behave the same.
//
// The POS prints four kinds of slip: the customer receipt, the KOT, the
// token and the shift report. They are built by four different components,
// and each one wires up its own print call — which is exactly how they
// drifted apart:
//
//   • printService dropped the compact flag on its window path, so Paper
//     Save worked for receipts (which call fastPrintHtml directly) but did
//     nothing for tokens, reports and test prints.
//   • The per-printer print mode was read only by the receipt path, so a
//     printer set to "Windows driver only" still had its KOT and tokens
//     pushed at the RAW path first on every single order.
//   • The shift report passed neither compact nor the printer's margins.
//
// These tests read the source of each call site and assert the options are
// actually passed. That is deliberate: the bug was never in the print
// engine, it was in four call sites forgetting to hand it the same options.
// A unit test of the engine alone would have stayed green throughout.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/** The call sites that print a slip, and the component each one lives in. */
const SLIP_CALL_SITES = [
  { slip: 'customer receipt', file: 'components/ReceiptPreview.tsx' },
  { slip: 'KOT', file: 'components/KitchenReceipt.tsx' },
  { slip: 'token', file: 'components/TokenReceipt.tsx' },
  { slip: 'token (slip helper)', file: 'lib/tokenSlip.ts' },
  { slip: 'shift report', file: 'components/ShiftReport.tsx' },
];

describe('every slip reaches the fast path', () => {
  it('uses a fast transport rather than only window.print()', () => {
    // fastPrintHtml is the rendered RAW path; printNode tries it internally.
    for (const { slip, file } of SLIP_CALL_SITES) {
      const src = read(file);
      const hasFast = /fastPrintHtml|printNode/.test(src);
      expect(hasFast, `${slip} (${file}) has no fast print path`).toBe(true);
    }
  });

  it('passes Paper Save through on every slip', () => {
    // Compact is a global setting. A shop that turns Paper Save on and gets a
    // compact receipt, a compact KOT and a full-length report has been told
    // the setting is global and found that it is not.
    for (const { slip, file } of SLIP_CALL_SITES) {
      const src = read(file);
      expect(/compact:/.test(src), `${slip} (${file}) never passes compact`).toBe(true);
    }
  });

  it('honours the printer print mode on every slip', () => {
    for (const { slip, file } of SLIP_CALL_SITES) {
      const src = read(file);
      expect(
        /printMode/.test(src),
        `${slip} (${file}) ignores the printer's print mode`,
      ).toBe(true);
    }
  });

  it('passes the printer geometry on every slip', () => {
    // A slip that does not carry the printer's own left/right margins is
    // positioned by different numbers from the rest, which is how one slip
    // type ends up looking off-centre while the others look right.
    for (const { slip, file } of SLIP_CALL_SITES) {
      const src = read(file);
      expect(
        /marginLeftMm/.test(src) && /marginRightMm/.test(src),
        `${slip} (${file}) does not pass the printer margins`,
      ).toBe(true);
    }
  });
});

describe('raw ESC/POS is reachable for each slip the builder supports', () => {
  it('wires printDirect for receipt, KOT and token', () => {
    // printDirect can build all three, but for a long time nothing called it:
    // the whole direct layer was dead code outside the test card.
    const wired = [
      'components/ReceiptPreview.tsx',
      'components/KitchenReceipt.tsx',
      'components/TokenReceipt.tsx',
    ];
    for (const file of wired) {
      expect(/printDirect\(/.test(read(file)), `${file} never calls printDirect`).toBe(true);
    }
  });

  it('always falls back rather than hard-failing when raw is unavailable', () => {
    // Never hard-fail before the fallback chain has run — a recurring trap in
    // this codebase. Each raw attempt must be wrapped and must continue.
    for (const file of ['components/ReceiptPreview.tsx', 'components/KitchenReceipt.tsx', 'components/TokenReceipt.tsx']) {
      const src = read(file);
      expect(
        /falling back to the rendered path/.test(src),
        `${file} does not fall back when the raw path fails`,
      ).toBe(true);
    }
  });
});

describe('the print service honours the mode it is given', () => {
  it('keeps the hidden worker even in driver-only mode', () => {
    // Driver-only used to switch the fast path off entirely, which sent the
    // job to `print-receipt` — and that handler prints mainWindow.webContents,
    // i.e. the WHOLE POS WINDOW. Chromium laid the entire app out for the
    // printer and blocked the renderer until the spooler answered: several
    // seconds per bill with the screen stuck, and the slip appearing long
    // after the bill was saved. The driver's RENDERING is what the shop
    // wants; printing the POS window was never part of it.
    const code = read('printing/printService.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/printMode !== 'driver'/);
    expect(code).toMatch(/preferDriver:\s*opts\.printMode === 'driver'/);
  });

  it('routes driver mode past the raster stage, not past the worker', () => {
    const src = read('printing/fastPrint.ts');
    expect(src).toMatch(/!args\.preferDriver/);
    // It must still reach printHtml, which is the worker's driver render.
    expect(src).toMatch(/bridge\.printHtml\(/);
  });

  it('applies the same routing on the receipt and the KOT', () => {
    for (const file of ['components/ReceiptPreview.tsx', 'components/KitchenReceipt.tsx']) {
      expect(/preferDriver:/.test(read(file)), `${file} does not pass preferDriver`).toBe(true);
    }
  });

  it('passes compact into the stylesheet on the window path', () => {
    // Calling injectPrintCss with only the paper width is the original bug.
    // Comments are stripped first: this file explains that bug in prose, and
    // matching the prose instead of the code would make the test meaningless.
    const code = read('printing/printService.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).toMatch(/injectPrintCss\(paperWidth,\s*compact\)/);
    expect(code).not.toMatch(/injectPrintCss\(\s*paperWidth\s*\)/);
  });
});

// ============================================================
// THE MEASURING RULE BELONGS TO THE RASTER DOCUMENT ALONE.
//
// It exists so the raster stage can tell which columns of its screenshot are
// the slip. The Windows driver prints the page as it is, so a rule there
// would be a black line across the top of every receipt.
// ============================================================
describe('the measuring rule', () => {
  const args = {
    html: '<div class="print-receipt"><div>FIRST CHEF</div><div>Total 1000</div></div>',
    paperWidth: '80mm' as const,
    marginLeftMm: 3,
    marginRightMm: 5,
  };

  it('is present in the document the raster stage captures', async () => {
    const { buildWorkerDocument } = await import('@/printing/fastPrint');
    expect(buildWorkerDocument(args as any, 'raster').html).toContain('dt-measure');
  });

  it('is absent from the document the Windows driver prints', async () => {
    // Otherwise it is a black line across the top of every slip.
    const { buildWorkerDocument } = await import('@/printing/fastPrint');
    expect(buildWorkerDocument(args as any, 'html').html).not.toContain('<div class="dt-measure"');
  });

  it('is styled to the full content width, or it measures nothing', async () => {
    const { resolveReceiptLayout, layoutCss } = await import('@/printing/receiptLayout');
    const css = layoutCss(resolveReceiptLayout({ paper: '80mm', leftMm: 3, rightMm: 5 }), 'raster');
    expect(css).toContain('.dt-measure');
    expect(css).toMatch(/\.dt-measure\s*\{[^}]*width:\s*100%/);
  });
});
