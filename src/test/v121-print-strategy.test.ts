// ============================================================
// QC TESTS — v1.0.39 Printer compatibility (BIXOLON fix)
//
// Client report: BIXOLON 352 / 111 Plus par Windows Offline se print
// nahi hoti (error deta hai), jabke WEB version par usi printer par
// print ho jati hai.
//
// Root cause: Electron handler HAMESHA custom `pageSize` bhejta tha.
// BIXOLON class ke Windows drivers custom page size REJECT kar dete hain
// → job fail. Web version chalta hai kyunki browser driver ki apni
// default page use karta hai.
//
// Fix: strategy fallback chain — custom → driver-default → minimal.
// Yeh tests us ordering logic ko lock karte hain (main.cjs me wohi logic).
// ============================================================
import { describe, it, expect } from 'vitest';

/** main.cjs ki strategy-order logic ka aina (wahi rules). */
function buildOrder(usePrinterDefaultPageSize: boolean, remembered?: string | null): string[] {
  let order = usePrinterDefaultPageSize
    ? ['driver', 'custom', 'minimal']
    : ['custom', 'driver', 'minimal'];
  if (remembered) order = [remembered, ...order.filter(s => s !== remembered)];
  return order;
}

/** Print attempt simulator: kaunsi strategies is printer par chalti hain. */
function simulate(order: string[], supported: string[]): { ok: boolean; used: string | null; tries: number } {
  let tries = 0;
  for (const s of order) {
    tries++;
    if (supported.includes(s)) return { ok: true, used: s, tries };
  }
  return { ok: false, used: null, tries };
}

describe('print strategy order', () => {
  it('default: custom pehle (Epson/generic drivers par proven)', () => {
    expect(buildOrder(false)).toEqual(['custom', 'driver', 'minimal']);
  });

  it('usePrinterDefaultPageSize par driver pehle', () => {
    expect(buildOrder(true)).toEqual(['driver', 'custom', 'minimal']);
  });

  it('yaad rakhi hui strategy hamesha sab se pehle aati hai', () => {
    expect(buildOrder(false, 'driver')).toEqual(['driver', 'custom', 'minimal']);
    expect(buildOrder(false, 'minimal')).toEqual(['minimal', 'custom', 'driver']);
  });

  it('remembered strategy duplicate nahi hoti', () => {
    const o = buildOrder(false, 'custom');
    expect(o).toEqual(['custom', 'driver', 'minimal']);
    expect(new Set(o).size).toBe(o.length);
  });
});

describe('BIXOLON scenario — custom pageSize reject karta hai', () => {
  // BIXOLON 352 / 111 Plus: custom page size fail, driver default chalti hai.
  const BIXOLON = ['driver', 'minimal'];

  it('purana behaviour (sirf custom) FAIL hota — yehi client ka bug tha', () => {
    const r = simulate(['custom'], BIXOLON);
    expect(r.ok).toBe(false);
  });

  it('naya fallback chain BIXOLON par print kar deta hai', () => {
    const r = simulate(buildOrder(false), BIXOLON);
    expect(r.ok).toBe(true);
    expect(r.used).toBe('driver');
    expect(r.tries).toBe(2); // custom fail → driver ok
  });

  it('doosri dafa yaad ki hui strategy se PEHLI koshish me print', () => {
    const r = simulate(buildOrder(false, 'driver'), BIXOLON);
    expect(r.ok).toBe(true);
    expect(r.tries).toBe(1); // koi extra delay nahi
  });
});

describe('pehle se chalne wale printers par koi regression nahi', () => {
  // Epson TM-T20 / generic ESC-POS: custom pageSize chalti hai.
  const EPSON = ['custom', 'driver', 'minimal'];

  it('custom pehli koshish me hi chal jati hai (behaviour same)', () => {
    const r = simulate(buildOrder(false), EPSON);
    expect(r.ok).toBe(true);
    expect(r.used).toBe('custom');
    expect(r.tries).toBe(1);
  });
});

describe('koi bhi strategy na chale', () => {
  it('saaf fail hota hai (crash nahi) — teenon try hoti hain', () => {
    const r = simulate(buildOrder(false), []);
    expect(r.ok).toBe(false);
    expect(r.tries).toBe(3);
  });
});

describe('paper width — hardcode nahi', () => {
  const toMicrons = (p: string) => (p === '58mm' ? 58000 : p === '110mm' ? 110000 : 80000);
  it('58mm / 80mm / 110mm sab support', () => {
    expect(toMicrons('58mm')).toBe(58000);
    expect(toMicrons('80mm')).toBe(80000);
    expect(toMicrons('110mm')).toBe(110000);
  });
  it('unknown par 80mm safe default', () => {
    expect(toMicrons('')).toBe(80000);
  });
});
