// ============================================================
// LAHORE (Chai Khass, Black Copper) — the fixes from the photographed slips.
//
//  1. Footer cut off and printed on top of the NEXT slip (driver route: the
//     driver trims the blank end and cuts at the last line).
//  2. Prints ~20 s late / printer had to be re-detected: the image route
//     used the exact saved printer name, so after Windows renamed the
//     printer every slip silently fell back to the Windows driver.
//  3. "Too bold": Auto quality forced darkness 7 + a one-dot smear on every
//     stroke, which also closed up white text inside black bars.
// Raw-worker lifecycle (the other half of the delay) is in raw-worker.test.ts.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { HAS_ENGINE, requireEngine, engineSource } from './_shellEngine';

const require_ = createRequire(import.meta.url);
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

// ---------------------------------------------------------------- 1. cut
describe('the footer is fed past the cutter on the Windows-driver route', () => {
  afterEach(() => { delete (window as any).electronAPI; });

  async function build(mode: 'html' | 'raster', extra: Record<string, unknown> = {}) {
    const { buildWorkerDocument } = await import('@/printing/fastPrint');
    return buildWorkerDocument({ html: '<div class="receipt-print-portal"><div class="print-receipt">Printed 01:09 · Powered by Digital Target</div></div>', paperWidth: '80mm', ...extra } as any, mode).html;
  }

  it('driver documents end with an 18 mm clearance and a single dot the driver must print', async () => {
    const html = await build('html');
    expect(html).toMatch(/class="dt-cut-clearance"[^>]*><div style="display:block;height:18mm;"><\/div><div style="display:block;width:1px;height:1px;margin:0 auto;background:#000;"><\/div><\/div><\/div><\/body>/);
  });
  it('the printer\'s "Bottom (mm)" adds to it; no auto-cut means no clearance', async () => {
    expect(await build('html', { extraFeedMm: 7 })).toContain('height:25mm;');
    expect(await build('html', { extraFeedMm: -5 })).toContain('height:18mm;');
    expect(await build('html', { autoCut: false })).not.toContain('dt-cut-clearance');
  });
  it('the image route is unchanged: it feeds its own clearance before the cut', async () => {
    expect(await build('raster')).not.toContain('dt-cut-clearance');
  });
  it('the raster feed grows with "Bottom (mm)" too', async () => {
    const printHtmlEscpos = vi.fn(async () => ({ success: true }));
    (window as any).electronAPI = { printHtmlEscpos, printHtml: vi.fn() };
    const { fastPrintHtml } = await import('@/printing/fastPrint');
    const html = '<div>' + 'Bill line text '.repeat(10) + '</div>';
    await fastPrintHtml({ html, paperWidth: '80mm' } as any);
    await fastPrintHtml({ html, paperWidth: '80mm', extraFeedMm: 8 } as any);
    expect((printHtmlEscpos.mock.calls[0] as any)[0].bottomFeedLines).toBe(6);
    expect((printHtmlEscpos.mock.calls[1] as any)[0].bottomFeedLines).toBe(8);
  });
  it('the KOT passes its printer\'s bottom feed', () => {
    expect(read('src/components/KitchenReceipt.tsx')).toMatch(/extraFeedMm: hoistedKitchenCfg\?\.bottomFeedMm/);
  });
  it.skipIf(!HAS_ENGINE)('the driver keeps its own standard page (custom pages print blank on some drivers)', () => {
    const main = engineSource();
    const handler = main.slice(main.indexOf("handle('printHtml', "), main.indexOf("handle('printHtmlEscpos'"));
    expect(handler).toMatch(/return await runPrintJob\(win\.webContents, options\);/);
    expect(handler).not.toMatch(/pageHeightMicrons: Math\.max/);
  });
});

// ---------------------------------------------------------------- 2. name
describe('the image route finds a renamed printer', () => {
  it.skipIf(!HAS_ENGINE)('print-html-escpos resolves the saved name with the shared matcher and retries after a rename', () => {
    const main = engineSource();
    const handler = main.slice(main.indexOf("handle('printHtmlEscpos'"), main.indexOf("handle('printReceipt'"));
    expect(handler).toMatch(/const target = resolveRawPrinter\(options\.printerName\)/);
    expect(handler).toMatch(/sendRawWithWarmWorker\(resolved\.name, bytes, copies\)/);
    expect(handler).toMatch(/OpenPrinter failed/);
    expect(handler).toMatch(/resolveRawPrinter\(options\.printerName, true\)/);
    // …through the tested resolver (printer-resolve.test.ts), fed by the
    // app's own enumeration and the same matcher the other routes use.
    expect(main).toMatch(/require\('\.\/printerResolve\.cjs'\)\.createPrinterResolver\(\{\s*list: \(\) => listSystemPrinters\(\),\s*match: \(name, printers\) => matchPrinterName\(name, printers\),/);
  });
  it.skipIf(!HAS_ENGINE)('the helper lives in its own tested module; the print window is created at startup', () => {
    const main = engineSource();
    expect(main).toMatch(/require\('\.\/rawWorker\.cjs'\)\.createRawWorker\(/);
    expect(main).toMatch(/setTimeout\(\(\) => \{ try \{ getPrintWorker\(\); \}/);
  });
});

describe('startup detection writes back the exact Windows names the queue uses', () => {
  const listed: any[] = [];
  let shopSettings: any = {};
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    listed.length = 0;
    vi.doMock('@/lib/electron', () => ({ isElectron: () => true, getPrinters: async () => listed }));
    vi.doMock('@/lib/store', () => ({ getSettings: () => shopSettings, saveSettings: (s: any) => { shopSettings = s; } }));
  });
  afterEach(() => { vi.doUnmock('@/lib/electron'); vi.doUnmock('@/lib/store'); });

  it('"BlackCopper 80mm Series" → "BlackCopper 80mm Series (Copy 1)" for bill, KOT and station printers', async () => {
    listed.push({ name: 'BlackCopper 80mm Series (Copy 1)', isDefault: true });
    shopSettings = { defaultPrinter: 'BlackCopper 80mm Series', kotPrinter: 'blackcopper 80mm series', stationPrinters: { bar: 'BlackCopper 80mm Series' } };
    const { autoDetectPrinters } = await import('@/printing/printerAutoDetect');
    const r = await autoDetectPrinters();
    expect(shopSettings.defaultPrinter).toBe('BlackCopper 80mm Series (Copy 1)');
    expect(shopSettings.kotPrinter).toBe('BlackCopper 80mm Series (Copy 1)');
    expect(shopSettings.stationPrinters.bar).toBe('BlackCopper 80mm Series (Copy 1)');
    expect(r.relinked.map(x => x.stage)).toEqual(expect.arrayContaining(['shop setting', 'station bar']));
  });
  it('an exact name is left alone', async () => {
    listed.push({ name: 'BlackCopper 80mm Series', isDefault: true });
    shopSettings = { defaultPrinter: 'BlackCopper 80mm Series', kotPrinter: 'BlackCopper 80mm Series' };
    const { autoDetectPrinters } = await import('@/printing/printerAutoDetect');
    const r = await autoDetectPrinters();
    expect(r.relinked).toEqual([]);
  });
});

// ---------------------------------------------------------------- 3. weight
describe('Standard text weight is the default', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });

  it('Auto = Standard: darkness 6, no smear', async () => {
    const q = await import('@/lib/printQuality');
    expect(q.loadPrintQuality()).toMatchObject({ mode: 'auto', weight: 'standard' });
    expect(q.effectivePrintQuality()).toMatchObject({ darkness: 6, bold: false, weight: 'standard', scale: 2 });
  });
  it('an existing Auto shop moves to Standard; a hand-tuned (Manual) shop keeps its template weights', async () => {
    localStorage.setItem('dtpos-print-quality-v1', JSON.stringify({ mode: 'auto', darkness: 7, bold: true, scale: 2 }));
    let q = await import('@/lib/printQuality');
    expect(q.effectivePrintQuality()).toMatchObject({ darkness: 6, bold: false, weight: 'standard' });
    localStorage.setItem('dtpos-print-quality-v1', JSON.stringify({ mode: 'manual', darkness: 8, bold: true, scale: 3 }));
    vi.resetModules();
    q = await import('@/lib/printQuality');
    expect(q.effectivePrintQuality()).toMatchObject({ mode: 'manual', darkness: 8, bold: true, scale: 3, weight: 'bold' });
  });
  it('Extra bold is the old look, still available', async () => {
    const q = await import('@/lib/printQuality');
    q.savePrintQuality({ ...q.loadPrintQuality(), weight: 'extra' });
    expect(q.effectivePrintQuality()).toMatchObject({ darkness: 7, bold: true, weight: 'extra' });
  });
  it('the chosen weight reaches the print window', async () => {
    const printHtmlEscpos = vi.fn(async () => ({ success: true }));
    (window as any).electronAPI = { printHtmlEscpos, printHtml: vi.fn() };
    const { fastPrintHtml } = await import('@/printing/fastPrint');
    await fastPrintHtml({ html: '<div>' + 'Bill line text '.repeat(10) + '</div>', paperWidth: '80mm' } as any);
    expect((printHtmlEscpos.mock.calls[0] as any)[0]).toMatchObject({ textWeight: 'standard', darkness: 6, boldPrint: false });
    delete (window as any).electronAPI;
  });
  it.skipIf(!HAS_ENGINE)('both print handlers apply it before measuring / printing', () => {
    const main = engineSource();
    expect(main.match(/await applyTextWeight\(win\.webContents, options\.textWeight\);/g)).toHaveLength(2);
  });
});

describe('the Standard weight script', () => {
  const { standardWeight, STANDARD_WEIGHT_JS, applyTextWeight } = requireEngine('textWeight.cjs');

  it('maps 900/800 → 700 and 700/600 → 500, leaves the rest', () => {
    expect([900, 800, 700, 600, 500, 400].map(standardWeight)).toEqual([700, 700, 500, 500, null, null]);
    expect(standardWeight('bold')).toBeNull();
  });
  it('rewrites every weight once — a child that only inherited is not reduced twice', () => {
    // jsdom does not resolve inherited font-weight, so model it the way a
    // browser does: an element's own weight, else its parent's computed one.
    // (The real Chromium result is checked by scripts/simulate-print.mjs.)
    const computed = (el: Element | null): string =>
      !el || !(el instanceof HTMLElement) ? '400' : (el.style.getPropertyValue('font-weight') || computed(el.parentElement));
    vi.stubGlobal('getComputedStyle', (el: Element) => ({ fontWeight: computed(el) }));
    try {
      document.body.innerHTML = `<div class="dt-fast-root"><div id="a" style="font-weight:900"><span id="b">inherits 900</span></div><p id="c" style="font-weight:700">x</p><p id="d" style="font-weight:400">y</p></div>`;
      const n = (0, eval)(STANDARD_WEIGHT_JS);
      const w = (id: string) => (document.getElementById(id) as HTMLElement).style.getPropertyValue('font-weight');
      expect(w('a')).toBe('700');
      expect(w('b')).toBe('700');      // from its original 900, not from the parent's new 700
      expect(w('c')).toBe('500');
      expect(w('d')).toBe('400');      // untouched
      expect(n).toBe(3);
      expect((document.getElementById('a') as HTMLElement).style.getPropertyPriority('font-weight')).toBe('important');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('only Standard runs it', async () => {
    const executeJavaScript = vi.fn(async () => 1);
    await applyTextWeight({ executeJavaScript }, 'bold');
    await applyTextWeight({ executeJavaScript }, 'extra');
    expect(executeJavaScript).not.toHaveBeenCalled();
    await applyTextWeight({ executeJavaScript }, 'standard');
    expect(executeJavaScript).toHaveBeenCalledTimes(1);
  });
});

describe('Extra bold no longer closes white text inside black bars', () => {
  const { packDots, rasterGeometry } = requireEngine('escposRaster.cjs');
  const row = (pattern: string) => {
    const px = Buffer.alloc(pattern.length * 4, 0xff);
    [...pattern].forEach((ch, x) => { if (ch === 'x') { px[x * 4] = px[x * 4 + 1] = px[x * 4 + 2] = 0; } });
    return px;
  };
  const dots = (packed: any, n: number) => Array.from({ length: n }, (_, x) => ((packed.data[x >> 3] >> (7 - (x & 7))) & 1) ? 'x' : '.').join('');
  const geom = rasterGeometry('80mm', 0, 0);

  it('a one-dot white stroke between ink stays white', () => {
    expect(dots(packDots(row('xxx.xxx'), 7, 1, geom, { bold: true }), 7)).toBe('xxx.xxx');
  });
  it('a lone black stroke is still thickened', () => {
    expect(dots(packDots(row('..x....'), 7, 1, geom, { bold: true }), 7)).toBe('..xx...');
  });
  it('a two-dot white gap narrows to one dot but stays open', () => {
    expect(dots(packDots(row('xx..xx'), 6, 1, geom, { bold: true }), 6)).toBe('xxx.xx');
  });
  it('without smear nothing changes', () => {
    expect(dots(packDots(row('..x.x..'), 7, 1, geom, { bold: false }), 7)).toBe('..x.x..');
  });
});

describe('Print Quality card', () => {
  it('offers Standard / Bold / Extra bold in English', () => {
    const card = read('src/components/PrintQualityCard.tsx');
    expect(card).toMatch(/Text weight/);
    expect(card).not.toMatch(/kitni|sabse|Patli|karta/);
    const q = read('src/lib/printQuality.ts');
    expect(q).toMatch(/standard: \{ label: 'Standard'/);
  });
});
