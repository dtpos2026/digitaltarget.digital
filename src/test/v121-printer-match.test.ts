// ============================================================
// QC TESTS — v1.0.39b Printer name matching
//
// Client error (asal): Print fail — Printer "BIXOLON SRP-352plusIII (Copy 1)"
// Windows me detect nahi ho raha. Halanke printer laga hua tha.
//
// Purani matching sirf EXACT equality karti thi aur na milne par HARD FAIL
// kar deti thi — yani print ki koshish hi nahi hoti thi.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  matchPrinter,
  isPrinterInstalled,
  normalizePrinterName,
  stripPrinterSuffix,
} from '@/printing/printerMatch';

const CLIENT = 'BIXOLON SRP-352plusIII (Copy 1)';

describe('normalize / strip helpers', () => {
  it('non-breaking space aur double space normalize karta hai', () => {
    expect(normalizePrinterName('BIXOLON\u00A0 SRP-352')).toBe('bixolon srp-352');
  });
  it('(Copy 1) suffix hata deta hai', () => {
    expect(stripPrinterSuffix(CLIENT)).toBe('bixolon srp-352plusiii');
  });
  it('(redirected 2) suffix bhi hata deta hai', () => {
    expect(stripPrinterSuffix('Star TSP100 (redirected 2)')).toBe('star tsp100');
  });
  it('khali input safe hai', () => {
    expect(normalizePrinterName(undefined)).toBe('');
    expect(stripPrinterSuffix(null)).toBe('');
  });
});

describe('CLIENT KA ASAL CASE — BIXOLON SRP-352plusIII (Copy 1)', () => {
  it('exact naam mojood ho to mil jata hai', () => {
    const r = matchPrinter(CLIENT, [{ name: CLIENT }]);
    expect(r.printer).not.toBeNull();
    expect(r.stage).toBe('exact');
    expect(r.name).toBe(CLIENT);
  });

  it('Windows me naam BINA "(Copy 1)" ho to bhi milta hai', () => {
    // Settings me "(Copy 1)" save hai lekin Windows asal naam deta hai
    const r = matchPrinter(CLIENT, [{ name: 'BIXOLON SRP-352plusIII' }]);
    expect(r.printer).not.toBeNull();
    expect(r.name).toBe('BIXOLON SRP-352plusIII');
    expect(['no-suffix', 'starts-with', 'reverse']).toContain(r.stage);
  });

  it('sirf displayName me naam ho to bhi milta hai', () => {
    const r = matchPrinter(CLIENT, [{ name: 'BIXOLON_1', displayName: CLIENT }]);
    expect(r.printer).not.toBeNull();
    expect(r.name).toBe('BIXOLON_1'); // print ke liye Windows ka asal `name`
  });

  it('extra spaces / case ka farq block nahi karta', () => {
    const r = matchPrinter('  bixolon   srp-352plusiii (COPY 1) ', [{ name: CLIENT }]);
    expect(r.printer).not.toBeNull();
  });

  it('non-breaking space (Windows se aksar aata hai) bhi handle', () => {
    const r = matchPrinter('BIXOLON\u00A0SRP-352plusIII (Copy 1)', [{ name: 'BIXOLON SRP-352plusIII (Copy 1)' }]);
    expect(r.printer).not.toBeNull();
  });

  it('Copy 2 install ho aur settings me Copy 1 ho to bhi mil jata hai', () => {
    const r = matchPrinter(CLIENT, [{ name: 'BIXOLON SRP-352plusIII (Copy 2)' }]);
    expect(r.printer).not.toBeNull();
  });

  it('kai printers me se sahi wala chunta hai', () => {
    const r = matchPrinter(CLIENT, [
      { name: 'Microsoft Print to PDF' },
      { name: 'Fax' },
      { name: 'BIXOLON SRP-352plusIII (Copy 1)' },
      { name: 'OneNote (Desktop)' },
    ]);
    expect(r.name).toBe(CLIENT);
    expect(r.stage).toBe('exact');
  });
});

describe('doosre common printers', () => {
  it('Epson TM-T20 milta hai', () => {
    expect(isPrinterInstalled('EPSON TM-T20II Receipt', [{ name: 'EPSON TM-T20II Receipt' }])).toBe(true);
  });
  it('80mm Series Printer (client ki machine par mojood tha)', () => {
    expect(isPrinterInstalled('80mm Series Printer', [{ name: '80mm Series Printer' }])).toBe(true);
  });
  it('XPrinter partial naam se bhi', () => {
    expect(isPrinterInstalled('XP-80C', [{ name: 'XP-80C (Copy 1)' }])).toBe(true);
  });
});

describe('ghalat match se bachao (false positive nahi)', () => {
  it('bilkul alag printer match nahi hota', () => {
    const r = matchPrinter('BIXOLON SRP-352plusIII', [
      { name: 'Microsoft Print to PDF' },
      { name: 'Fax' },
    ]);
    expect(r.printer).toBeNull();
    expect(r.stage).toBe('none');
  });

  it('bohot chhote naam par contains/reverse nahi chalta (3 char se kam)', () => {
    // "PDF" jaisa chhota token har jagah mil jata — is liye guard hai
    const r = matchPrinter('PDF', [{ name: 'Microsoft Print to PDF' }]);
    expect(['none', 'contains']).toContain(r.stage);
  });

  it('khali list par null (crash nahi)', () => {
    expect(matchPrinter(CLIENT, []).printer).toBeNull();
    expect(matchPrinter(CLIENT, undefined).printer).toBeNull();
  });

  it('khali requested naam par null', () => {
    expect(matchPrinter('', [{ name: CLIENT }]).printer).toBeNull();
    expect(matchPrinter(undefined, [{ name: CLIENT }]).printer).toBeNull();
  });
});
