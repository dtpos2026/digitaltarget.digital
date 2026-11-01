// ============================================================
// ESC/POS GEOMETRY — the sticky-setting locks.
//
// `GS L` (left margin) and `GS W` (print area width) live in the printer's
// NVRAM. They survive between jobs AND power cycles, and `ESC @` does not
// clear them on many models. A printer that was ever left with a non-zero
// left margin, or a print-area width below its full dot count, prints every
// later job shifted and short — content tight to the left with a wide blank
// band on the right — no matter what the POS sends.
//
// The builder therefore states both on EVERY job, unconditionally. These
// tests exist so that "optimising away the redundant bytes" cannot silently
// bring the lopsided slip back.
// ============================================================
import { describe, it, expect } from 'vitest';
import { EscposDoc, columnsFor, buildReceiptBytes, buildKotBytes, buildTokenBytes } from '@/printing/escposBuilder';
import { buildAlignmentTestBytes } from '@/printing/alignmentTest';
import { resolveReceiptLayout } from '@/printing/receiptLayout';
import { repairLegacyMargins, DEFAULT_SIDE_MARGIN_MM, defaultPrinterConfig } from '@/lib/printerSettings';
import { equaliseSideMargins, hasUnequalSideMargins, savePrintMargins } from '@/lib/printMargins';

/** Find a command's operands in the byte stream, or null. */
function findCommand(bytes: number[], a: number, b: number): [number, number] | null {
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === a && bytes[i + 1] === b) return [bytes[i + 2], bytes[i + 3]];
  }
  return null;
}
const word = (lo: number, hi: number) => lo | (hi << 8);

describe('sticky printer geometry', () => {
  it('states GS L and GS W on every job', () => {
    for (const paper of ['58mm', '80mm', '110mm'] as const) {
      const bytes = new EscposDoc(paper).bytes();
      expect(findCommand(bytes, 0x1d, 0x4c), `${paper} is missing GS L`).not.toBeNull();
      expect(findCommand(bytes, 0x1d, 0x57), `${paper} is missing GS W`).not.toBeNull();
    }
  });

  it('states the geometry on every job, so a leftover NVRAM margin cannot survive', () => {
    // GS L and GS W persist in the printer between jobs and are not cleared by
    // ESC @ on many models. A printer left with a stale left margin shifts and
    // clips every later job, whatever the POS sends — so both are written
    // unconditionally, never "only when non-zero".
    const bytes = new EscposDoc('80mm', { leftMm: 0, rightMm: 0 }).bytes();
    const gsL = findCommand(bytes, 0x1d, 0x4c)!;
    expect(word(gsL[0], gsL[1])).toBe(0);
    const gsW = findCommand(bytes, 0x1d, 0x57)!;
    expect(word(gsW[0], gsW[1])).toBe(576);

    const narrow = new EscposDoc('58mm', { leftMm: 0, rightMm: 0 }).bytes();
    const gsW58 = findCommand(narrow, 0x1d, 0x57)!;
    expect(word(gsW58[0], gsW58[1])).toBe(384);
  });

  it('insets an unconfigured slip by the paper profile\'s safe margin', () => {
    // The RAW slip was printing clipped on the left. Its left margin was zero,
    // which starts the first column on the head's first markable dot — fine on
    // a perfectly seated roll and not fine on any other. 16 dots is 2mm.
    const bytes = new EscposDoc('80mm').bytes();
    const gsL = findCommand(bytes, 0x1d, 0x4c)!;
    expect(word(gsL[0], gsL[1])).toBe(16);
    const gsW = findCommand(bytes, 0x1d, 0x57)!;
    expect(word(gsW[0], gsW[1])).toBe(576 - 32);
  });

  it('moves the RAW slip by exactly the millimetres the shop set', () => {
    // The user-visible half of the same fault: Printer Settings offered a Left
    // margin, the resolver flattened it away, and the printed slip did not
    // move. These are the bytes that prove it now does.
    const bytes = new EscposDoc('80mm', { leftMm: 3, rightMm: 0 }).bytes();
    const gsL = findCommand(bytes, 0x1d, 0x4c)!;
    expect(word(gsL[0], gsL[1])).toBe(24);      // 3mm x 8 dots/mm
    const gsW = findCommand(bytes, 0x1d, 0x57)!;
    expect(word(gsW[0], gsW[1])).toBe(576 - 24);
  });

  it('translates mm margins into the matching dot values', () => {
    const doc = new EscposDoc('80mm', { leftMm: 2, rightMm: 2 });
    const bytes = doc.bytes();
    const gsL = findCommand(bytes, 0x1d, 0x4c)!;
    const gsW = findCommand(bytes, 0x1d, 0x57)!;
    // 8 dots per mm at 203 DPI.
    expect(word(gsL[0], gsL[1])).toBe(16);
    expect(word(gsW[0], gsW[1])).toBe(576 - 32);
    expect(doc.layout.contentMm).toBe(68);
  });

  it('emits GS L before any text so the margin applies to the whole slip', () => {
    const doc = new EscposDoc('80mm', { leftMm: 2, rightMm: 2 });
    doc.line('ITEM');
    const bytes = doc.bytes();
    const gsLAt = bytes.findIndex((b, i) => b === 0x1d && bytes[i + 1] === 0x4c);
    const textAt = bytes.findIndex(b => b === 'I'.charCodeAt(0));
    expect(gsLAt).toBeGreaterThanOrEqual(0);
    expect(gsLAt).toBeLessThan(textAt);
  });
});

describe('column counts', () => {
  it('reads the shared paper profile rather than a local table', () => {
    // A local copy claimed 64 columns on 110mm where the profile says 69.
    expect(columnsFor('80mm')).toBe(48);
    expect(columnsFor('58mm')).toBe(32);
    expect(columnsFor('110mm')).toBe(69);
  });

  it('narrows the usable columns when margins narrow the content', () => {
    const wide = resolveReceiptLayout({ paper: '80mm', leftMm: 0, rightMm: 0 });
    const tight = resolveReceiptLayout({ paper: '80mm', leftMm: 6, rightMm: 6 });
    expect(tight.columnsFontA).toBeLessThan(wide.columnsFontA);
  });
});

describe('alignment test slip bytes', () => {
  it('carries the geometry commands and a cut', () => {
    const bytes = buildAlignmentTestBytes({ paper: '80mm', leftMm: 2, rightMm: 2 });
    expect(findCommand(bytes, 0x1d, 0x4c)).not.toBeNull();
    expect(findCommand(bytes, 0x1d, 0x57)).not.toBeNull();
    // GS V — cut.
    expect(bytes.some((b, i) => b === 0x1d && bytes[i + 1] === 0x56)).toBe(true);
  });

  it('is not an empty slip', () => {
    expect(buildAlignmentTestBytes({ paper: '80mm' }).length).toBeGreaterThan(200);
  });
});

describe('printer margin defaults', () => {
  it('creates new printers with equal side margins', () => {
    // These shipped as 3mm left against 10mm right — a built-in 7mm
    // asymmetry fed straight into the print path on every bill.
    const cfg = defaultPrinterConfig();
    expect(cfg.leftMarginMm).toBe(DEFAULT_SIDE_MARGIN_MM);
    expect(cfg.rightMarginMm).toBe(DEFAULT_SIDE_MARGIN_MM);
    expect(cfg.leftMarginMm).toBe(cfg.rightMarginMm);
  });

  it('equalises any asymmetric pair, not just the old default', () => {
    // The first version of this repair only matched the exact 3/10 pair, on
    // the assumption that anything else was a deliberate calibration. Real
    // paper disproved it: deployed machines carried all sorts of asymmetric
    // pairs and every one printed lopsided on every slip.
    localStorage.clear();
    const repaired = repairLegacyMargins([
      { ...defaultPrinterConfig(), leftMarginMm: 3, rightMarginMm: 10 },
    ]);
    expect(repaired[0].leftMarginMm).toBe(repaired[0].rightMarginMm);

    localStorage.clear();
    const other = repairLegacyMargins([
      { ...defaultPrinterConfig(), leftMarginMm: 0, rightMarginMm: 3 },
    ]);
    expect(other[0].leftMarginMm).toBe(other[0].rightMarginMm);
  });

  it('never widens a slip while repairing it', () => {
    // Equalising upward would eat printable width. Take the smaller side.
    localStorage.clear();
    const repaired = repairLegacyMargins([
      { ...defaultPrinterConfig(), leftMarginMm: 3, rightMarginMm: 10 },
    ]);
    expect(repaired[0].leftMarginMm).toBe(3);
  });

  it('runs once, then leaves a deliberate calibration alone', () => {
    // After the repair has run, a shop that tunes its printer to 4/1 for its
    // own machine keeps those numbers for good.
    localStorage.clear();
    repairLegacyMargins([{ ...defaultPrinterConfig(), leftMarginMm: 3, rightMarginMm: 10 }]);

    const tuned = { ...defaultPrinterConfig(), leftMarginMm: 4, rightMarginMm: 1 };
    const second = repairLegacyMargins([tuned]);
    expect(second[0].leftMarginMm).toBe(4);
    expect(second[0].rightMarginMm).toBe(1);
  });

  it('leaves already-equal printers untouched', () => {
    localStorage.clear();
    const equal = { ...defaultPrinterConfig(), leftMarginMm: 2, rightMarginMm: 2 };
    const repaired = repairLegacyMargins([equal]);
    expect(repaired[0].leftMarginMm).toBe(2);
    expect(repaired[0].rightMarginMm).toBe(2);
  });
});

describe('device-local margins', () => {
  it('equalises the side margins on demand', () => {
    localStorage.clear();
    savePrintMargins({ top: 0, right: 10, bottom: 0, left: 3, contentWidthMm: 0 });
    expect(hasUnequalSideMargins()).toBe(true);
    const next = equaliseSideMargins(2);
    expect(next.left).toBe(2);
    expect(next.right).toBe(2);
    expect(hasUnequalSideMargins()).toBe(false);
  });

  it('detects the stale asymmetric values that survived the old migration', () => {
    // These device values feed the receipt, the KOT, the token and the shift
    // report alike, which is why a lopsided slip showed up on every one.
    localStorage.clear();
    savePrintMargins({ top: 0, right: 0, bottom: 0, left: 3, contentWidthMm: 0 });
    expect(hasUnequalSideMargins()).toBe(true);
  });
});

// ============================================================
// THE OTHER HALF OF "THE MARGIN SETTING DOES NOTHING"
//
// Fixing the resolver made Printer Settings reach the RENDERED slip. The raw
// builders were still reading one shop-level field and nothing else — not the
// printer's own calibration from Printer Center, not the per-slip margins,
// not the device's. So the same bill moved when printed through the Windows
// driver and refused to move when printed raw, which is exactly what the shop
// kept photographing.
// ============================================================
describe('the raw builders honour the geometry they are given', () => {
  const order: any = {
    id: 'o1', orderNumber: 21, createdAt: new Date().toISOString(),
    items: [{ id: 'i1', name: 'Zinger Burger', quantity: 2, price: 500 }],
    total: 1000, orderType: 'takeaway',
  };

  it('moves a raw receipt by the printer\'s own left margin', () => {
    const bare = buildReceiptBytes(order, { name: 'SHOP' } as any);
    const moved = buildReceiptBytes(order, { name: 'SHOP' } as any, { leftMm: 5, rightMm: 0 });
    expect(word(...findCommand(moved, 0x1d, 0x4c)!.slice(0, 2) as [number, number])).toBe(40); // 5mm
    // And it is genuinely different from the unconfigured slip.
    expect(word(...findCommand(bare, 0x1d, 0x4c)!.slice(0, 2) as [number, number])).not.toBe(40);
  });

  it('moves a raw KOT and a raw token the same way', () => {
    const kot = buildKotBytes(order, { name: 'SHOP' } as any, {}, { leftMm: 4, rightMm: 1 });
    expect(word(...findCommand(kot, 0x1d, 0x4c)!.slice(0, 2) as [number, number])).toBe(32);

    const token = buildTokenBytes(
      { orderNumber: 21, items: [{ name: 'Naan', qty: 3 }] } as any,
      { name: 'SHOP' } as any,
      { leftMm: 4, rightMm: 1 },
    );
    expect(word(...findCommand(token, 0x1d, 0x4c)!.slice(0, 2) as [number, number])).toBe(32);
  });

  it('uses the printer\'s paper size, not the shop\'s', () => {
    // A 58mm kitchen printer under an 80mm shop default used to build its KOT
    // at 576 dots and have the printer wrap every line.
    const bytes = buildKotBytes(order, { name: 'SHOP', paperSize: '80mm' } as any, {}, { paper: '58mm', leftMm: 0, rightMm: 0 });
    expect(word(...findCommand(bytes, 0x1d, 0x57)!.slice(0, 2) as [number, number])).toBe(384);
  });

  it('leaves an unset margin unset, so the safe inset still applies', () => {
    // `|| 0` here would turn every unconfigured slip into an explicit zero and
    // print the first column on the head's very first dot.
    const bytes = buildReceiptBytes(order, { name: 'SHOP' } as any, {});
    expect(word(...findCommand(bytes, 0x1d, 0x4c)!.slice(0, 2) as [number, number])).toBe(16);
  });

  it('respects a printer told not to cut', () => {
    // Another Printer Center switch the raw path never read.
    const cutting = buildReceiptBytes(order, { name: 'SHOP' } as any, { autoCut: true });
    const notCutting = buildReceiptBytes(order, { name: 'SHOP' } as any, { autoCut: false });
    expect(cutting.some((b, i) => b === 0x1d && cutting[i + 1] === 0x56)).toBe(true);
    expect(notCutting.some((b, i) => b === 0x1d && notCutting[i + 1] === 0x56)).toBe(false);
  });

  it('sounds the buzzer only when the printer is set to', () => {
    const quiet = buildReceiptBytes(order, { name: 'SHOP' } as any, {});
    const loud = buildReceiptBytes(order, { name: 'SHOP' } as any, { beep: true });
    const hasBeep = (b: number[]) => b.some((x, i) => x === 0x1b && b[i + 1] === 0x42);
    expect(hasBeep(quiet)).toBe(false);
    expect(hasBeep(loud)).toBe(true);
  });
});
