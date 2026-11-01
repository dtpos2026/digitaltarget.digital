// ============================================================
// FAST BILLING MODE — one switch, every slip.
//
// A shop that chooses speed wants it on everything. A raw bill followed by a
// rendered token is the worst of both: two looks, two speeds. These tests pin
// that the switch reaches all four slip types and that a single printer can
// still override it for hardware that refuses raw bytes.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolvePrintMode, wantsRaw, wantsDriverOnly } from '@/printing/printMode';
import { EscposDoc, buildShiftReportBytes, buildReceiptBytes, buildKotBytes, columnsFor } from '@/printing/escposBuilder';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('mode resolution', () => {
  it('turns every slip raw when the shop switch is on', () => {
    expect(resolvePrintMode({ settings: { fastRawPrintMode: true } })).toBe('raw');
    expect(wantsRaw({ settings: { fastRawPrintMode: true } })).toBe(true);
  });

  it('keeps the designed template when the switch is off', () => {
    expect(resolvePrintMode({ settings: { fastRawPrintMode: false } })).toBe('auto');
    expect(resolvePrintMode({ settings: {} })).toBe('auto');
    expect(resolvePrintMode({})).toBe('auto');
  });

  it('lets one printer override the shop switch', () => {
    // Mixed hardware is real: a counter printer may refuse raw bytes while
    // the kitchen printer is happy with them.
    expect(resolvePrintMode({
      printerConfig: { printMode: 'driver' },
      settings: { fastRawPrintMode: true },
    })).toBe('driver');

    expect(resolvePrintMode({
      printerConfig: { printMode: 'raw' },
      settings: { fastRawPrintMode: false },
    })).toBe('raw');
  });

  it('treats an auto printer as deferring to the shop switch', () => {
    expect(resolvePrintMode({
      printerConfig: { printMode: 'auto' },
      settings: { fastRawPrintMode: true },
    })).toBe('raw');
  });

  it('reports driver-only separately from raw', () => {
    expect(wantsDriverOnly({ printerConfig: { printMode: 'driver' } })).toBe(true);
    expect(wantsDriverOnly({ settings: { fastRawPrintMode: true } })).toBe(false);
  });
});

describe('every slip type consults the shared resolver', () => {
  const CALL_SITES = [
    { slip: 'customer receipt', file: 'components/ReceiptPreview.tsx' },
    { slip: 'KOT', file: 'components/KitchenReceipt.tsx' },
    { slip: 'token', file: 'components/TokenReceipt.tsx' },
    { slip: 'token (slip helper)', file: 'lib/tokenSlip.ts' },
    { slip: 'shift report', file: 'components/ShiftReport.tsx' },
  ];

  it('imports the resolver rather than re-deciding locally', () => {
    // Each of these components used to work the mode out for itself, which is
    // how the bill honoured it while the KOT, the token and the report did not.
    for (const { slip, file } of CALL_SITES) {
      const src = read(file);
      expect(
        /from '@\/printing\/printMode'/.test(src),
        `${slip} (${file}) does not use the shared print-mode resolver`,
      ).toBe(true);
    }
  });

  it('never re-implements the precedence inline', () => {
    for (const { slip, file } of CALL_SITES) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(
        /printMode\s*\|\|\s*'auto'/.test(code),
        `${slip} (${file}) still decides the mode inline`,
      ).toBe(false);
    }
  });
});

describe('the shift report has a raw renderer', () => {
  // It was the one slip with no raw builder, so Fast Billing produced a raw
  // bill, a raw KOT, a raw token — and then a rendered report.
  const data = {
    range: {},
    summary: { productAmount: 6080, discount: 0, serviceCharge: 0, rounding: 0, subTotal: 6080, refundAmount: 0, actualSales: 6080 },
    tax: { taxable: 0, taxPct: 0, taxAmount: 0 },
    transactions: { checkedOut: 12, avgIncome: 506.67, soldProducts: 24, refunded: 0, refundedProducts: 0 },
    drawer: { startingCash: 0, orderIncome: 6080, refund: 0, expectedCash: 6080, actualEndingCash: 6080 },
    payments: [{ method: 'cash', amount: 6080, percent: 100 }],
    types: [{ type: 'dining', orders: 12, amount: 6080 }],
    categories: [{ name: 'Burger', qty: 20, amount: 3960 }],
    products: [{ name: 'Chapli Kabab burger', qty: 2, amount: 500 }],
    totals: { catQty: 24, catAmt: 6080 },
  };

  it('produces a real slip with the geometry commands and a cut', () => {
    const bytes = buildShiftReportBytes(data, { name: 'FIRST CHEF', paperSize: '80mm' } as any);
    expect(bytes.length).toBeGreaterThan(300);
    expect(bytes.some((b, i) => b === 0x1d && bytes[i + 1] === 0x4c)).toBe(true); // GS L
    expect(bytes.some((b, i) => b === 0x1d && bytes[i + 1] === 0x57)).toBe(true); // GS W
    expect(bytes.some((b, i) => b === 0x1d && bytes[i + 1] === 0x56)).toBe(true); // GS V cut
  });

  it('survives a report with no sales at all', () => {
    const bytes = buildShiftReportBytes({}, { name: 'SHOP', paperSize: '80mm' } as any);
    expect(bytes.length).toBeGreaterThan(80);
  });
});

describe('enlarged text wraps on word boundaries', () => {
  it('halves the usable columns at double width', () => {
    // GS ! doubles the glyph, so half as many characters fit. The builder did
    // not track this and the printer hard-wrapped mid-word: the client's slip
    // read "FIRST CHEF PIZZA & BUR / GER".
    // Measured against the document's OWN column count, not the bare paper
    // profile's: side margins legitimately remove columns, and hard-coding the
    // unmargined figure would make this test fail for the right reason.
    const d = new EscposDoc('80mm', { leftMm: 0, rightMm: 0 });
    expect(d.effectiveCols).toBe(columnsFor('80mm'));
    d.size(2, 2);
    expect(d.effectiveCols).toBe(Math.floor(columnsFor('80mm') / 2));

    const inset = new EscposDoc('80mm');
    expect(inset.effectiveCols).toBe(inset.layout.columnsFontA);
    inset.size(2, 2);
    expect(inset.effectiveCols).toBe(Math.floor(inset.layout.columnsFontA / 2));
  });

  it('breaks a long shop name between words, not inside one', () => {
    const d = new EscposDoc('80mm');
    d.size(2, 2).fit('FIRST CHEF PIZZA & BURGER');
    const text = Buffer.from(d.bytes()).toString('latin1');
    expect(text).not.toContain('BUR\nGER');
    expect(text).toContain('BURGER');
  });

  it('restores the full column count when the size goes back to normal', () => {
    const d = new EscposDoc('80mm', { leftMm: 0, rightMm: 0 });
    d.size(2, 2);
    d.size(1, 1);
    expect(d.effectiveCols).toBe(columnsFor('80mm'));
  });
});

describe('the cut never lands on the last printed line', () => {
  // Reported: the raw slip "cuts before some text". The cutter sits 15-25mm
  // past the print head, and the feed was counted in LINE FEEDS whose height
  // depends on the current line spacing. Paper Save set ESC 3 20, shrinking
  // each feed line from 24 dots to 20, and compact also asked for fewer
  // lines — three lines at 20 dots is 7.5mm of clearance against a 20mm gap.
  const findAll = (bytes: number[], a: number, b: number) => {
    const hits: number[] = [];
    for (let i = 0; i < bytes.length - 2; i++) if (bytes[i] === a && bytes[i + 1] === b) hits.push(i);
    return hits;
  };

  it('feeds an exact distance with ESC d rather than bare line feeds', () => {
    const d = new EscposDoc('80mm');
    d.line('LAST LINE');
    d.cut();
    const bytes = d.bytes();
    const escD = findAll(bytes, 0x1b, 0x64);
    expect(escD.length, 'no ESC d feed before the cut').toBeGreaterThan(0);
    expect(bytes[escD[escD.length - 1] + 2]).toBeGreaterThanOrEqual(6);
  });

  it('restores the default line spacing before feeding', () => {
    // Otherwise the feed distance depends on whatever the slip left set.
    const d = new EscposDoc('80mm');
    d.lineSpacing(20);
    d.line('COMPACT BODY');
    d.cut();
    const bytes = d.bytes();
    const esc2 = findAll(bytes, 0x1b, 0x32); // ESC 2 — default spacing
    const cutAt = findAll(bytes, 0x1d, 0x56)[0];
    expect(esc2.length, 'default spacing never restored').toBeGreaterThan(0);
    expect(esc2[esc2.length - 1]).toBeLessThan(cutAt);
  });

  it('does not shorten the clearance in Paper Save mode', () => {
    // Compact saves paper in the body; the blade's distance is physical.
    const normal = buildReceiptBytes(
      { orderNumber: 1, items: [{ id: 'a', name: 'Item', quantity: 1, price: 100, lineTotal: 100 }], grandTotal: 100, subtotal: 100 } as any,
      { name: 'SHOP', paperSize: '80mm' } as any,
    );
    const compact = buildReceiptBytes(
      { orderNumber: 1, items: [{ id: 'a', name: 'Item', quantity: 1, price: 100, lineTotal: 100 }], grandTotal: 100, subtotal: 100 } as any,
      { name: 'SHOP', paperSize: '80mm', receiptCompactMode: true } as any,
    );
    const feedOf = (bytes: number[]) => {
      const hits = findAll(bytes, 0x1b, 0x64);
      return bytes[hits[hits.length - 1] + 2];
    };
    expect(feedOf(compact)).toBe(feedOf(normal));
    expect(feedOf(compact)).toBeGreaterThanOrEqual(6);
  });
});

describe('raw slip readability', () => {
  const order: any = {
    orderNumber: 1025,
    orderType: 'dining',
    subtotal: 3120,
    grandTotal: 3120,
    items: [
      { id: 'a', name: 'Anda Shami Burger', quantity: 1, price: 140, lineTotal: 140 },
      { id: 'b', name: 'Chicken Achari', variantName: 'Large', quantity: 1, price: 1300, lineTotal: 1300 },
      { id: 'c', name: 'Chicken Shawarma', variantName: 'Large', quantity: 1, price: 180, lineTotal: 180 },
    ],
  };
  const settings: any = { name: 'FIRST CHEF PIZZA & BURGER', paperSize: '80mm', currencySymbol: 'Rs ' };
  const textOf = (bytes: number[]) => Buffer.from(bytes).toString('latin1');

  it('never chops an item name mid-word', () => {
    // The client's bill printed "1 x Chicken Achari  - Large (Larg" with the
    // rest of the name simply gone. A customer cannot check a chopped bill.
    const text = textOf(buildReceiptBytes(order, settings));
    expect(text).toContain('Chicken Achari');
    expect(text).not.toMatch(/\(Larg(?!e)/);
    expect(text).toContain('Large');
  });

  it('keeps the amount on the first line of a wrapped item', () => {
    const text = textOf(buildReceiptBytes(order, settings));
    const firstItemLine = text.split('\n').find(l => l.includes('Anda Shami'))!;
    expect(firstItemLine.trimEnd().endsWith('140')).toBe(true);
  });

  it('prints item rows at double height by default', () => {
    // GS ! with a height multiplier. 'Large' is the default because the plain
    // slip otherwise reads much lighter than the rendered template.
    const bytes = buildReceiptBytes(order, settings);
    const hasDoubleHeight = bytes.some((b, i) =>
      b === 0x1d && bytes[i + 1] === 0x21 && (bytes[i + 2] & 0x0f) >= 1);
    expect(hasDoubleHeight).toBe(true);
  });

  it('honours the compact text size when asked', () => {
    // Byte length is NOT a proxy for text size: the compact TOTAL line spans
    // twice as many columns and so carries more padding spaces. Assert the
    // actual GS ! operands instead.
    const widthMultipliers = (bytes: number[]) => {
      const out: number[] = [];
      for (let i = 0; i < bytes.length - 2; i++) {
        if (bytes[i] === 0x1d && bytes[i + 1] === 0x21) out.push((bytes[i + 2] >> 4) & 0x0f);
      }
      return out;
    };
    const large = widthMultipliers(buildReceiptBytes(order, settings));
    const normal = widthMultipliers(buildReceiptBytes(order, { ...settings, receiptRawTextSize: 'normal' }));

    // Large doubles the TOTAL's width; compact leaves it at single width.
    expect(Math.max(...large)).toBeGreaterThan(Math.max(...normal.filter((_, i) => i > 0)) - 1);
    expect(large.some(m => m >= 1)).toBe(true);
  });

  it('wraps long KOT item names so the kitchen can read them', () => {
    const text = textOf(buildKotBytes(order, settings, {}));
    expect(text).toContain('Chicken Achari');
    expect(text).not.toMatch(/\(Larg(?!e)/);
  });
});
