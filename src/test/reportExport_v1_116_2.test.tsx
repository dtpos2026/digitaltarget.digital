// v1.116.2 — the report export kit: Print (A4), PDF, POS (thermal receipt) and JPG on every report-like screen, one layout behind them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, waitFor } from '@testing-library/react';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/store', () => ({ getSettings: () => ({ name: 'Butt Bakers', address: 'Main Blvd', phone1: '0300-1', phone2: '0300-2', paperSize: '58mm', receiptScale: 100, marketingFooter: 'Thank you\nSee you soon' }) }));
const pdfSpy = vi.hoisted(() => vi.fn());
const jpgSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/reportExport', async () => {
  const real = await vi.importActual<typeof import('@/lib/reportExport')>('@/lib/reportExport');
  return { ...real, reportPdf: pdfSpy, reportJpg: jpgSpy, downloadBlob: vi.fn() };
});

import { a4Html, brandFrom, esc, posHtml, reportCsv, safeFile, type ReportDoc } from '@/lib/reportExport';
import * as exportKit from '@/lib/reportExport';
import ReportActions from '@/components/ReportActions';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const NOW = new Date('2026-11-18T09:30:00');
const brand = brandFrom({ name: 'Butt Bakers', address: 'Main Blvd', phone1: '0300-1', phone2: '0300-2', logo: 'data:image/png;base64,AAAA' }, '#800020');
const doc: ReportDoc = {
  title: 'Production plan', subtitle: 'Thursday 2026-11-19', meta: [{ label: 'Branch', value: 'DHA' }], filename: 'production-plan-2026-11-19',
  columns: [{ key: 'item', label: 'Item' }, { key: 'make', label: 'Make', align: 'right' }, { key: 'total', label: 'Total', align: 'right' }],
  rows: [{ item: 'Tom & Jerry <b>cake</b>', make: 12, total: 1234 }, { item: 'Croissant, "plain"', make: 48, total: 48 }],
  totals: { make: 60, total: 1282 }, notes: ['Average plus 10%.'],
};

describe('the builders', () => {
  it('text from the data is escaped, so it prints as typed and cannot break the page', () => {
    expect(esc(`<img src=x onerror="a()"> & '`)).toBe('&lt;img src=x onerror=&quot;a()&quot;&gt; &amp; \'');
    const html = a4Html(doc, brand, NOW);
    expect(html).toContain('Tom &amp; Jerry &lt;b&gt;cake&lt;/b&gt;');
    expect(html).not.toContain('<b>cake</b>');
  });
  it('the A4 page carries the restaurant, the title, the period, the table head in the theme colour, the totals and the print time', () => {
    const html = a4Html(doc, brand, NOW);
    expect(html).toContain('Butt Bakers');
    expect(html).toContain('Main Blvd');
    expect(html).toContain('0300-1 | 0300-2');
    expect(html).toContain('Production plan');
    expect(html).toContain('Thursday 2026-11-19');
    expect(html).toContain('<b>Branch:</b> DHA');
    expect(html).toContain('background:#800020');
    expect(html).toMatch(/<td style="text-align:left">Total<\/td>/);                 // the totals row is labelled
    expect(html).toContain('1,282');                                                 // numbers are grouped
    expect(html).toContain('Average plus 10%.');
    expect(html).toContain('Printed');
  });
  it('a logo that is not an image or a web address is dropped, not written into the page', () => {
    const evil = brandFrom({ name: 'X', logo: 'javascript:alert(1)' });
    expect(a4Html(doc, evil, NOW)).not.toContain('javascript:');
    expect(posHtml(doc, evil, {}, NOW)).not.toContain('javascript:');
    expect(a4Html(doc, brand, NOW)).toContain('<img src="data:image/png;base64,AAAA"');
  });
  it('POS is the thermal layout of POS Summary: the paper width from Settings, monospace, one block per row, the marketing footer', () => {
    const html = posHtml(doc, brand, { paperSize: '58mm', receiptScale: 100, marketingFooter: 'Thank you\nSee you soon', receiptMarginLeft: 2, receiptMarginRight: 2 }, NOW);
    expect(html).toContain('@page{size:58mm auto;margin:0}');
    expect(html).toContain('Courier New');
    expect(html).toContain('PRODUCTION PLAN');
    expect(html).toContain('Tom &amp; Jerry');
    expect(html).toContain('Total Make');                                            // totals as "Total <column>" lines
    expect(html).toContain('Thank you<br/>See you soon');
    expect(html).toContain('0mm 2mm 0mm 2mm');                                       // margins come from Settings
  });
  it('POS defaults to 80 mm and keeps the scale inside 50–200 %', () => {
    expect(posHtml(doc, brand, {}, NOW)).toContain('size:80mm auto');
    expect(posHtml(doc, brand, { receiptScale: 5 }, NOW)).toContain('zoom:0.5');
    expect(posHtml(doc, brand, { receiptScale: 900 }, NOW)).toContain('zoom:2');
  });
  it('CSV quotes commas and quotes, ends with the totals, and the file name is safe', () => {
    const lines = reportCsv(doc).split('\n');
    expect(lines[0]).toBe('Item,Make,Total');
    expect(lines[2]).toBe('"Croissant, ""plain""",48,48');
    expect(lines[3]).toBe('Total,60,1282');
    expect(safeFile('Stock count / 2026:11:18')).toBe('Stock-count-2026-11-18');
    expect(safeFile('///')).toBe('report');
  });
});

describe('the four buttons', () => {
  let open: ReturnType<typeof vi.fn>; let write: ReturnType<typeof vi.fn>; let print: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    toast.success.mockClear(); toast.error.mockClear(); pdfSpy.mockReset(); jpgSpy.mockReset();
    write = vi.fn(); print = vi.fn();
    open = vi.fn(() => ({ document: { write, close: vi.fn() }, print }));
    vi.stubGlobal('open', open);
    window.open = open as unknown as typeof window.open;
  });
  afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

  it('Print, PDF, POS and JPG are there, together, in one group', () => {
    render(<ReportActions build={() => doc} />);
    const g = document.querySelector('[data-report-actions]')!;
    for (const k of ['print', 'pdf', 'pos', 'jpg']) expect(g.querySelector(`[data-report-${k}]`)).not.toBeNull();
  });
  it('Print opens the A4 page and prints it; POS opens the thermal page and prints it', () => {
    render(<ReportActions build={() => doc} />);
    fireEvent.click(document.querySelector('[data-report-print]')!);
    expect(open).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toContain('Production plan');
    expect(write.mock.calls[0][0]).toContain('Butt Bakers');
    expect(print).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector('[data-report-pos]')!);
    expect(write.mock.calls[1][0]).toContain('size:58mm auto');                      // the paper size in Settings
    expect(print).toHaveBeenCalledTimes(2);
  });
  it('a blocked pop-up is said out loud, not a silent nothing', () => {
    open.mockReturnValue(null);
    render(<ReportActions build={() => doc} />);
    fireEvent.click(document.querySelector('[data-report-print]')!);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('blocked'));
  });
  it('an empty report prints nothing and says so', () => {
    render(<ReportActions build={() => ({ ...doc, rows: [] })} />);
    for (const k of ['print', 'pos', 'pdf', 'jpg']) fireEvent.click(document.querySelector(`[data-report-${k}]`)!);
    expect(open).not.toHaveBeenCalled();
    expect(pdfSpy).not.toHaveBeenCalled();
    expect(jpgSpy).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Nothing to print yet');
  });
  it('PDF and JPG are made from the same report and saved with its name', async () => {
    pdfSpy.mockResolvedValue(new Blob(['pdf'])); jpgSpy.mockResolvedValue(new Blob(['jpg']));
    render(<ReportActions build={() => doc} />);
    fireEvent.click(document.querySelector('[data-report-pdf]')!);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('PDF saved'));
    expect(pdfSpy.mock.calls[0][0]).toBe(doc);
    expect(vi.mocked(exportKit.downloadBlob).mock.calls[0][1]).toBe('production-plan-2026-11-19.pdf');
    fireEvent.click(document.querySelector('[data-report-jpg]')!);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Image saved'));
    expect(vi.mocked(exportKit.downloadBlob).mock.calls[1][1]).toBe('production-plan-2026-11-19.jpg');
  });
  it('a PDF that cannot be made says so and the buttons come back', async () => {
    pdfSpy.mockRejectedValue(new Error('no canvas'));
    render(<ReportActions build={() => doc} />);
    fireEvent.click(document.querySelector('[data-report-pdf]')!);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not make the PDF on this device'));
    await waitFor(() => expect((document.querySelector('[data-report-pdf]') as HTMLButtonElement).disabled).toBe(false));
  });
  it('a wide grid can leave out POS; disabled disables the lot', () => {
    const { rerender } = render(<ReportActions build={() => doc} pos={false} />);
    expect(document.querySelector('[data-report-pos]')).toBeNull();
    expect(document.querySelector('[data-report-print]')).not.toBeNull();
    rerender(<ReportActions build={() => doc} disabled />);
    for (const k of ['print', 'pdf', 'pos', 'jpg']) expect((document.querySelector(`[data-report-${k}]`) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('every report-like screen carries them', () => {
  const pages: [string, string][] = [
    ['src/pages/ProductionPlanPage.tsx', 'Production plan'], ['src/components/production/ProductionSheetPanel.tsx', 'Production day sheet'],
    ['src/pages/StockCountPage.tsx', 'Stock count'], ['src/pages/RecipeCostingPage.tsx', 'Recipe costing'], ['src/pages/RightsMatrixPage.tsx', 'Staff rights'],
  ];
  for (const [file, title] of pages) {
    it(`${file} builds its report from what is on screen`, () => {
      const src = read(file);
      expect(src).toContain("import ReportActions from '@/components/ReportActions'");
      expect(src).toMatch(/<ReportActions build=\{reportDoc\}/);
      expect(src).toContain(`title: '${title}'`);
    });
  }
  it('the wide Rights grid leaves out the thermal receipt, which has no sensible form for it', () => {
    expect(read('src/pages/RightsMatrixPage.tsx')).toMatch(/<ReportActions build=\{reportDoc\}[^>]*pos=\{false\}/);
  });
  it('the older reports still have their own PDF / POS / print code — nothing was removed to make room', () => {
    expect(read('src/pages/ReportsPage.tsx')).toContain('printPosReport');
    expect(read('src/lib/pdfBrand.ts')).toContain('drawPdfHeader');
  });
});
