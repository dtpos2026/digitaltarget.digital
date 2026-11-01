// ============================================================
// RECEIPT QR & BARCODE — Settings → Receipt → QR & Barcode.
//
// The printed codes were also decoded from the simulator's printer dots with
// ZXing and jsQR on all 41 receipt designs (every position, mode, size and
// format); these tests pin the pieces that makes work.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRequire } from 'node:module';
import { encodeCode128, encodeCode39, code128Values, sanitizeForFormat } from '@/lib/linearBarcode';
import {
  readReceiptCodes, receiptRef, parseReceiptRef, findOrderByRef, qrValueFor, barcodeValueFor,
  receiptPayload, receiptText, fromBase64Url, normalizeLink, safeHttpUrl, qrCaption, DEFAULT_SCAN_PAGE,
} from '@/lib/receiptCodes';
import { barcodeLayout, qrLayout } from '@/components/ReceiptCodes';
import { barcodeDots, qrByteBudget } from '@/lib/codeGeometry';
import ReceiptPreview from '@/components/ReceiptPreview';
import ReceiptCodesCard from '@/components/settings/ReceiptCodesCard';
import { buildSampleOrder } from '@/lib/sampleOrder';
import { HAS_ENGINE, requireEngine } from './_shellEngine';

const require_ = createRequire(import.meta.url);
const { packDots, mapRegions, rasterGeometry } = requireEngine('escposRaster.cjs');

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
const order = { ...buildSampleOrder(), createdAt: '2026-09-24T10:53:00', paidAt: '2026-09-24T10:53:00' } as any;
const shop: any = { name: 'Chai Corner', phone1: '0300-0000000', currencySymbol: 'Rs ', paperSize: '80mm', receiptDesign: 'classic' };
const withCodes = (codes: any) => ({ ...shop, receiptCodes: codes });

beforeEach(() => localStorage.clear());

describe('barcode encoders', () => {
  it('Code 128 packs digit runs two per symbol and checks out (mod 103)', () => {
    // Start B, "R", Code C, 26 09 24 10 42, checksum
    const v = code128Values('R2609241042');
    expect(v.slice(0, 3)).toEqual([104, 50, 99]);
    expect(v.slice(3, 8)).toEqual([26, 9, 24, 10, 42]);
    const sum = v.slice(0, -1).reduce((a, x, i) => a + (i === 0 ? x : x * i), 0);
    expect(v[v.length - 1]).toBe(sum % 103);
    // every symbol is 11 modules, the stop 13
    expect(encodeCode128('R2609241042').modules).toBe(9 * 11 + 13);
  });
  it('Code 39 upper-cases and frames with *', () => {
    const b = encodeCode39('abc-1');
    expect(b.text).toBe('ABC-1');
    expect(b.widths.length).toBe(7 * 10 - 1); // 7 chars × (9 + gap) − last gap
  });
  it('custom text keeps only what the format can carry', () => {
    expect(sanitizeForFormat('code39', 'Chai*Khass #1!')).toBe('CHAIKHASS 1');
    expect(sanitizeForFormat('code128', 'Wi-Fi: پاس 123')).toBe('Wi-Fi:  123');
  });
});

describe('what the codes carry', () => {
  it('the receipt reference is R + date + bill number, optionally prefixed, and reads back', () => {
    expect(receiptRef(order)).toBe('R2609241042');
    expect(receiptRef(order, 'lhr-1')).toBe('LHR1-R2609241042');
    expect(parseReceiptRef('lhr1-r2609241042')).toEqual({ prefix: 'LHR1', yy: 26, mm: 9, dd: 24, orderNumber: 1042 });
    expect(parseReceiptRef('8961234567890')).toBeNull(); // an item barcode
    const other = { ...order, orderNumber: 1042, createdAt: '2026-09-23T10:00:00' };
    expect(findOrderByRef([other, order], 'R2609241042')).toBe(order);
    expect(findOrderByRef([other], 'R2609241042')).toBeNull();
  });
  it('the automatic QR (receipt-page view) carries the bill — and never the customer', () => {
    const cfg = readReceiptCodes(withCodes({ v: 2, qr: { enabled: true, mode: 'auto', autoView: 'page' } }));
    const url = qrValueFor(order, shop, cfg)!;
    expect(url.startsWith(`${DEFAULT_SCAN_PAGE}#r=`)).toBe(true);
    const data = JSON.parse(fromBase64Url(url.split('#r=')[1]));
    expect(data).toMatchObject({ v: 1, s: 'Chai Corner', n: '1042', t: '2026-09-24 10:53', p: 'paid', T: 1827, r: 'R2609241042' });
    expect(data.i).toEqual([['Chicken Biryani', 2, 900], ['Zinger Burger (Large)', 1, 550], ['Cold Drink 500ml', 2, 240]]);
    const raw = JSON.stringify(data);
    expect(raw).not.toContain('Ahmed');
    expect(raw).not.toContain('0300-1234567');
    expect(raw).not.toContain('Main Boulevard');
  });
  it('a long bill lists the first items and counts the rest', () => {
    const big = { ...order, items: Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, name: `Special Family Platter ${i}`, pricingType: 'fixed', price: 1000, quantity: 1, lineTotal: 1000 })) };
    const p = receiptPayload(big, shop);
    expect((p.i as unknown[]).length).toBeLessThan(40);
    expect((p.i as unknown[]).length + Number(p['+'])).toBe(40);
    expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThanOrEqual(300);
  });
  it('text view (the default): the bill as plain text any phone shows, no internet', () => {
    const t = receiptText(order, shop);
    expect(t.split('\n')).toEqual([
      'Chai Corner',
      'Bill #1042 | 24-09-2026 10:53',
      '2 x Chicken Biryani = 900',
      '1 x Zinger Burger = 550',
      '2 x Cold Drink 500ml = 240',
      'Discount -100 | Tax 152 | Service (5%) 85',
      'TOTAL Rs 1,827',
      'PAID (CASH)',
    ]);
    expect(t).not.toContain('Ahmed');
    const big = { ...order, items: Array.from({ length: 30 }, (_, i) => ({ id: `i${i}`, name: `Family Platter ${i}`, pricingType: 'fixed', price: 999, quantity: 1, lineTotal: 999 })) };
    const long = receiptText(big as any, shop);
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(260);
    expect(long).toMatch(/\+ \d+ more item\(s\)\nDiscount/);
  });
  it('multi-link: valid links only, in order; WhatsApp numbers become wa.me', () => {
    const links = [
      { id: 'a', type: 'google', url: 'https://g.page/r/abc/review' },
      { id: 'b', type: 'whatsapp', url: '0300 1234567', label: 'Order now' },
      { id: 'c', type: 'website', url: 'javascript:alert(1)' },
    ];
    // Default: the links as text — any phone shows them, nothing to publish.
    const cfg = readReceiptCodes(withCodes({ qr: { enabled: true, mode: 'multi', links } }));
    expect(cfg.qr.multiView).toBe('text');
    expect(qrValueFor(order, shop, cfg)!.split('\n')).toEqual([
      'Chai Corner',
      'Google Reviews: https://g.page/r/abc/review',
      'Order now: https://wa.me/923001234567',
    ]);
    // The links page, once scan.html is published.
    const page = readReceiptCodes(withCodes({ qr: { enabled: true, mode: 'multi', multiView: 'page', links } }));
    const data = JSON.parse(fromBase64Url(qrValueFor(order, shop, page)!.split('#l=')[1]));
    expect(data.k).toEqual([['google', 'https://g.page/r/abc/review'], ['whatsapp', 'https://wa.me/923001234567', 'Order now']]);
  });
  it('single: a link opens directly; any other text is shown on the phone', () => {
    const on = (url: string) => readReceiptCodes(withCodes({ qr: { enabled: true, mode: 'single', singleUrl: url } }));
    expect(qrValueFor(order, shop, on('facebook.com/chaicorner'))).toBe('https://facebook.com/chaicorner');
    expect(qrValueFor(order, shop, on('0300 1234567'))).toBe('https://wa.me/923001234567');
    expect(qrValueFor(order, shop, on('Wi-Fi: ChaiKhass / 12345678'))).toBe('Wi-Fi: ChaiKhass / 12345678');
    expect(qrValueFor(order, shop, on('   '))).toBeNull();
    expect(qrCaption(on('https://instagram.com/x'))).toBe('Scan to follow us on Instagram');
    expect(qrCaption(on('Wi-Fi: ChaiKhass'))).toBe('Scan for details');
  });
  it('the barcode carries the bill in words by default — and the POS still finds the bill', () => {
    const cfg = readReceiptCodes(withCodes({ barcode: { enabled: true } }));
    expect(cfg.barcode.content).toBe('info');
    expect(cfg.barcode.size).toBe('medium');
    // Medium bars (3 dots) fit 12 characters on 80mm: the most readable text that fits.
    expect(barcodeValueFor(order, cfg, shop)).toBe('#1042 Rs1827');
    expect(barcodeValueFor({ ...order, grandTotal: 1827.5 }, cfg, shop)).toBe('Bill 1042');
    expect(barcodeValueFor(order, cfg, { ...shop, paperSize: '58mm' })).toBe('#1042');
    expect(barcodeValueFor(order, readReceiptCodes(withCodes({ barcode: { enabled: true, prefix: 'LHR1' } })), shop)).toBe('LHR1 #1042');
    // Small bars (2 dots) fit 20: the bill in words.
    const small = readReceiptCodes(withCodes({ barcode: { enabled: true, size: 'small' } }));
    expect(barcodeValueFor(order, small, shop)).toBe('Bill 1042 Rs 1827');
    expect(barcodeValueFor({ ...order, grandTotal: 1827.5 }, small, shop)).toBe('Bill 1042 Rs 1827.50');
    expect(barcodeValueFor(order, small, { ...shop, paperSize: '58mm' })).toBe('#1042 Rs1827');
    // Code 39 has no "#".
    expect(barcodeValueFor(order, readReceiptCodes(withCodes({ barcode: { enabled: true, format: 'code39' } })), shop)).toBe('Bill 1042');
    // Every value prints at the bar width it was chosen for.
    expect(barcodeLayout('code128', '#1042 Rs1827', 'medium', 64)!.dotsPerModule).toBe(3);
    expect(barcodeLayout('code128', 'Bill 1042 Rs 1827', 'small', 64)!.dotsPerModule).toBe(2);
    expect(parseReceiptRef('Bill 1042 Rs 1827')).toEqual({ prefix: '', orderNumber: 1042, amount: 1827 });
    expect(parseReceiptRef('#1042 Rs1827')).toEqual({ prefix: '', orderNumber: 1042, amount: 1827 });
    expect(parseReceiptRef('LHR1 #1042')).toEqual({ prefix: 'LHR1', orderNumber: 1042 });
    expect(parseReceiptRef('LHR1 Bill 1042')).toEqual({ prefix: 'LHR1', orderNumber: 1042 });
    const older = { ...order, id: 'old', grandTotal: 500, createdAt: '2025-01-01T10:00:00' };
    expect(findOrderByRef([older, order], 'Bill 1042 Rs 1827')).toBe(order);
    expect(findOrderByRef([older], 'Bill 1042 Rs 1827')).toBe(older);  // amount is a hint, the number decides
    expect(findOrderByRef([order], 'Bill 999')).toBeNull();
  });
  it('settings saved by 1.14.0 move to the new defaults; choices saved since are kept', () => {
    const old = readReceiptCodes(withCodes({ qr: { enabled: true, autoView: 'page', sizeMm: 32 }, barcode: { enabled: true, content: 'receipt' } }));
    expect(old.qr.autoView).toBe('text');
    expect(old.qr.sizeMm).toBe(40);
    expect(old.barcode.content).toBe('info');
    const kept = readReceiptCodes(withCodes({ v: 2, qr: { enabled: true, autoView: 'page', sizeMm: 32 }, barcode: { enabled: true, content: 'receipt' } }));
    expect([kept.qr.autoView, kept.qr.sizeMm, kept.barcode.content]).toEqual(['page', 32, 'receipt']);
  });
  it('links are refused unless they are http(s) — and a phone number is not a website', () => {
    expect(safeHttpUrl('data:text/html,hi')).toBeNull();
    expect(safeHttpUrl('https://03001234567')).toBeNull();
    expect(normalizeLink('website', 'example.com/menu')).toBe('https://example.com/menu');
  });
  it('switched off, nothing is generated', () => {
    const cfg = readReceiptCodes(shop);
    expect(cfg.qr.enabled).toBe(false);
    expect(cfg.barcode.enabled).toBe(false);
    expect(qrValueFor(order, shop, cfg)).toBeNull();
    expect(barcodeValueFor(order, cfg)).toBeNull();
  });
});

describe('printed sizes are whole printer dots', () => {
  it('QR modules are 2+ dots and the code fits the slip', () => {
    const l = qrLayout('https://example.com/scan.html#r=abc', 32, 64)!;
    expect(Number.isInteger(l.dotsPerModule)).toBe(true);
    expect(l.dotsPerModule).toBeGreaterThanOrEqual(2);
    expect(l.widthMm * 8).toBe(l.modules * l.dotsPerModule);
    expect(l.widthMm).toBeLessThanOrEqual(64);
  });
  it('the bill text in a QR fits its size with every module 5 dots wide', () => {
    expect(qrByteBudget(40, 64)).toBe(213);
    expect(qrByteBudget(36, 64)).toBe(180);
    expect(qrByteBudget(44, 64)).toBe(287);
    expect(qrByteBudget(24, 64)).toBe(62);
    // The sample bill (3 items) is whole in the default QR, at 5 dots a module.
    const cfg = readReceiptCodes(withCodes({ v: 2, qr: { enabled: true } }));
    expect(cfg.qr.sizeMm).toBe(40);
    const whole = qrValueFor(order, shop, cfg)!;
    expect(whole).toContain('2 x Cold Drink 500ml = 240');
    expect(whole).not.toContain('more item');
    expect(qrLayout(whole, 40, 64)!.dotsPerModule).toBe(5);
    const big = { ...order, items: Array.from({ length: 30 }, (_, i) => ({ id: `i${i}`, name: `Family Platter ${i}`, pricingType: 'fixed', price: 999, quantity: 1, lineTotal: 999 })) };
    const settings = withCodes({ v: 2, qr: { enabled: true } });
    const value = qrValueFor(big as any, settings, readReceiptCodes(settings))!;
    expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(213);
    expect(value).toMatch(/\+ \d+ more item\(s\)/);
    expect(qrLayout(value, 40, 64)!.dotsPerModule).toBeGreaterThanOrEqual(5);
  });
  it('ink spread: dark QR areas lose a dot on their right and lower edge, nothing inside', () => {
    const l = qrLayout('Chai Corner\nBill #1042', 36, 64)!;
    const d = l.dotsPerModule;
    expect(d).toBeGreaterThanOrEqual(4);
    expect(l.trimDots).toBe(1);
    const at = (r: number, c: number, dx: number, dy: number) => l.ink((c + l.quiet) * d + dx, (r + l.quiet) * d + dy);
    // Finder pattern: the top row of 7 dark modules is one bar, trimmed only at its right end and below.
    for (let c = 0; c < 7; c++) for (let dx = 0; dx < d; dx++) {
      expect(at(0, c, dx, 0)).toBe(!(c === 6 && dx === d - 1));
      expect(at(0, c, dx, d - 1)).toBe(c === 0 || (c === 6 && dx < d - 1)); // modules below are light except the sides
    }
    // Light modules stay light; small codes are not trimmed at all.
    for (let dx = 0; dx < d; dx++) expect(at(1, 1, dx, 1)).toBe(false);
    const small = qrLayout('x'.repeat(150), 20, 64)!;
    expect(small.dotsPerModule).toBeLessThan(4);
    expect(small.trimDots).toBe(0);
    // The drawn path carries the same trims (module units, whole dots).
    expect(l.path).toContain(`h${Math.round((7 - 1 / d) * 1000) / 1000}v${Math.round((1 - 1 / d) * 1000) / 1000}`);
  });
  it('ink spread: from 3-dot bars up every bar is a dot narrower and every space a dot wider', () => {
    const c128 = encodeCode128('#1042 Rs1827');
    expect(barcodeDots(c128, 2)).toEqual(c128.widths.map(w => w * 2));
    expect(barcodeDots(c128, 3)).toEqual(c128.widths.map((w, i) => w * 3 + (i % 2 === 0 ? -1 : 1)));
    const c39 = encodeCode39('BILL 1042');
    expect(barcodeDots(c39, 3).slice(0, 9)).toEqual(c39.widths.slice(0, 9).map((w, i) => (w === 1 ? 3 : 7) + (i % 2 === 0 ? -1 : 1)));
  });
  it('barcode bars narrow to fit, and Code 39 too wide for the paper falls back to Code 128', () => {
    const medium = barcodeLayout('code128', 'R2609241042', 'medium', 64)!;
    expect(medium.dotsPerModule).toBe(3);
    const c39 = barcodeLayout('code39', 'LHR1-R2609241042', 'small', 64)!;
    expect(c39.fellBack).toBe(true);
    expect(c39.barcode.format).toBe('code128');
    expect(c39.widthDots).toBeLessThanOrEqual(64 * 8);
  });
});

describe('on the bill', () => {
  const codesAt = (position: string) => ({ qr: { enabled: true, mode: 'auto', position }, barcode: { enabled: true, position } });
  it.each(['above', 'footer', 'below'])('%s: one QR and one barcode on the printed node', (position) => {
    render(<ReceiptPreview order={order} settings={withCodes(codesAt(position))} showPrintButton={false} />);
    const print = document.querySelector('.receipt-print-portal .print-receipt') as HTMLElement;
    const blocks = print.querySelectorAll(`.dt-receipt-codes[data-position="${position}"]`);
    expect(blocks).toHaveLength(1);
    expect(print.querySelectorAll('.dt-receipt-codes svg[aria-label="QR code"]')).toHaveLength(1);
    expect(print.querySelector('.dt-receipt-codes svg[aria-label="Barcode #1042 Rs1827"]')).not.toBeNull();
  });
  it('the new QR replaces the old automatic one; switched off, the bill is exactly as before', () => {
    render(<ReceiptPreview order={order} settings={withCodes(codesAt('footer'))} showPrintButton={false} />);
    const print = document.querySelector('.receipt-print-portal .print-receipt') as HTMLElement;
    expect(print.querySelectorAll('svg').length).toBe(2); // new QR + barcode, no legacy QR
  });
  it('the old automatic QR no longer carries the customer', () => {
    const src = require_('node:fs').readFileSync(require_('node:path').resolve(__dirname, '../components/ReceiptPreview.tsx'), 'utf8');
    const block = src.slice(src.indexOf('const qrData = JSON.stringify({'), src.indexOf('});', src.indexOf('const qrData = JSON.stringify({')));
    expect(block).not.toMatch(/customer/);
  });
});

describe('the image route prints codes dot-exact', () => {
  // A 3-dot module whose edges fall mid-dot: half-covered edge dots.
  function strip(offsetHalf: boolean) {
    const width = 16, height = 1;
    const px = Buffer.alloc(width * height * 4, 255);
    const paint = (x: number, v: number) => { px[x * 4] = v; px[x * 4 + 1] = v; px[x * 4 + 2] = v; px[x * 4 + 3] = 255; };
    if (offsetHalf) { paint(4, 128); paint(5, 0); paint(6, 0); paint(7, 128); } // dark module 4.5..7.5
    else { paint(4, 0); paint(5, 0); paint(6, 0); }
    return { px, width, height };
  }
  const dots = (packed: any, n: number) => Array.from({ length: n }, (_, x) => (packed.data[x >> 3] >> (7 - (x & 7))) & 1).join('');
  const geom = { ...rasterGeometry('80mm', 0, 0), leftDots: 0 };
  it('text rule: a half-covered edge dot prints on BOTH sides (the 4/2 fault)', () => {
    const { px, width, height } = strip(true);
    expect(dots(packDots(px, width, height, geom, { darkness: 6 }), 10)).toBe('0000111100');
  });
  it('inside a code region the module keeps its 3 dots', () => {
    const { px, width, height } = strip(true);
    const exactRegions = [{ x0: 0, x1: width, y0: 0, y1: height }];
    expect(dots(packDots(px, width, height, geom, { darkness: 6, exactRegions }), 10)).toBe('0000111000');
    const aligned = strip(false);
    expect(dots(packDots(aligned.px, width, height, geom, { darkness: 6, exactRegions }), 10)).toBe('0000111000');
  });
  it('regions follow the crop and resize the capture goes through', () => {
    expect(mapRegions([{ x: 110, y: 20, width: 100, height: 50 }], { x: 10, y: 10, width: 200, height: 100 }, 100, 50))
      .toEqual([{ x0: 49, x1: 100, y0: 4, y1: 31 }]);
  });
});

describe('the settings card', () => {
  function Harness() {
    const [s, setS] = useState<any>({ ...shop });
    return (
      <>
        <ReceiptCodesCard settings={s} setSettings={setS} onSave={() => {}} sampleOrder={order} />
        <output data-testid="saved">{JSON.stringify(s.receiptCodes || null)}</output>
      </>
    );
  }
  const saved = () => JSON.parse(screen.getByTestId('saved').textContent || 'null');
  it('switches, modes, links and position write the settings; the preview shows the codes', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('switch', { name: 'QR code on receipts' }));
    expect(saved().qr.enabled).toBe(true);
    fireEvent.click(screen.getByText('Multi-link QR'));
    fireEvent.click(screen.getByRole('button', { name: /Add link/ }));
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: 'https://g.page/r/abc/review' } });
    expect(saved().qr.mode).toBe('multi');
    expect(saved().qr.links[0]).toMatchObject({ type: 'google', url: 'https://g.page/r/abc/review' });
    fireEvent.click(screen.getByRole('switch', { name: 'Barcode on receipts' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Below receipt' })[1]);
    expect(saved().barcode).toMatchObject({ enabled: true, position: 'below', format: 'code128', content: 'info' });
    expect(saved().v).toBe(2);
    // the live preview carries both codes
    expect(document.querySelectorAll('.receipt-print-portal .dt-receipt-codes svg').length).toBeGreaterThanOrEqual(2);
  });
});

describe('Fast Billing / Raw text bills print the codes too', () => {
  // The raw bill is ESC/POS text — the QR "never generated" there. It now
  // carries both codes as GS v 0 images; with both off it is unchanged.
  const GSV0 = [0x1d, 0x76, 0x30, 0x00];
  const images = (bytes: number[]) => {
    const found: { at: number; rowBytes: number; rows: number; data: number[] }[] = [];
    for (let i = 0; i + 8 < bytes.length; i++) {
      if (GSV0.every((b, k) => bytes[i + k] === b)) {
        const rowBytes = bytes[i + 4] | (bytes[i + 5] << 8);
        const rows = bytes[i + 6] | (bytes[i + 7] << 8);
        found.push({ at: i, rowBytes, rows, data: bytes.slice(i + 8, i + 8 + rowBytes * rows) });
        i += 8 + rowBytes * rows - 1;
      }
    }
    return found;
  };
  const indexOfText = (bytes: number[], t: string) => {
    const want = Array.from(new TextEncoder().encode(t));
    for (let i = 0; i < bytes.length; i++) if (want.every((b, k) => bytes[i + k] === b)) return i;
    return -1;
  };

  it('off: no image in the raw bill', async () => {
    const { buildReceiptBytes } = await import('@/printing/escposBuilder');
    expect(images(buildReceiptBytes(order, shop))).toHaveLength(0);
  });

  it('on: the QR prints dot-for-dot, the barcode as bars, in 128-row bands', async () => {
    const { buildReceiptBytes } = await import('@/printing/escposBuilder');
    const settings = withCodes({ v: 2, qr: { enabled: true }, barcode: { enabled: true } });
    const bytes = buildReceiptBytes(order, { ...settings, thankYouText: 'Thank You!' });
    const imgs = images(bytes);
    expect(imgs.length).toBeGreaterThanOrEqual(3); // QR in 128-row bands + barcode
    expect(Math.max(...imgs.map(i => i.rows))).toBeLessThanOrEqual(128);
    // Rebuild the QR from its bands and compare with the QR it should be.
    const { qrValueFor: value } = await import('@/lib/receiptCodes');
    const layout = qrLayout(value(order, settings, readReceiptCodes(settings))!, 40, 64)!;
    const side = layout.modules * layout.dotsPerModule;
    const qrBands = imgs.filter(i => i.rows <= 128);
    const rowBytes = qrBands[0].rowBytes;
    const rows: number[][] = [];
    for (const b of qrBands) for (let y = 0; y < b.rows; y++) rows.push(b.data.slice(y * rowBytes, (y + 1) * rowBytes));
    const dot = (x: number, y: number) => (rows[y][x >> 3] >> (7 - (x & 7))) & 1;
    const x0 = Math.floor((Math.max(rowBytes * 8, side) - side) / 2); // centred in the print area
    let mismatches = 0;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) if (!!dot(x0 + x, y) !== layout.ink(x, y)) mismatches++;
    expect(mismatches).toBe(0);
    // ...and every module centre is the module it should be.
    const d = layout.dotsPerModule;
    for (let r = 0; r < layout.size; r++) for (let c = 0; c < layout.size; c++) {
      if (!!dot(x0 + (c + layout.quiet) * d + (d >> 1), (r + layout.quiet) * d + (d >> 1)) !== layout.dark(r, c)) mismatches++;
    }
    expect(mismatches).toBe(0);
    // Human-readable line and captions follow as text.
    expect(indexOfText(bytes, '#1042 Rs1827')).toBeGreaterThan(-1);
    expect(indexOfText(bytes, 'Scan for your receipt details')).toBeGreaterThan(-1);
  });

  it('positions: above the shop name, after the thank-you, or at the very end', async () => {
    const { buildReceiptBytes } = await import('@/printing/escposBuilder');
    const at = (position: string) => {
      const bytes = buildReceiptBytes(order, { ...withCodes({ v: 2, barcode: { enabled: true, position } }), thankYouText: 'Thank You!', marketingFooter: 'DIGITAL TARGET' });
      return { img: images(bytes)[0].at, name: indexOfText(bytes, 'Chai Corner'), thanks: indexOfText(bytes, 'Thank You!'), credit: indexOfText(bytes, 'DIGITAL TARGET') };
    };
    const above = at('above'); expect(above.img).toBeLessThan(above.name);
    const footer = at('footer'); expect(footer.img).toBeGreaterThan(footer.thanks); expect(footer.img).toBeLessThan(footer.credit);
    const below = at('below'); expect(below.img).toBeGreaterThan(below.credit);
  });
});
