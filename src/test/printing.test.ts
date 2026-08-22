// ============================================================
// Regression tests — Blank-Receipt Fix v1.2.3
// Covers: content height measurement, blank-content guards,
// HTML -> ESC/POS text extraction, and print-asset waiting.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  measureThermalContentHeightMm,
  getThermalPrintJobHeightMm,
  hasPrintableContent,
  waitForPrintAssets,
} from '@/lib/thermal-print';
import { htmlToPlainText, buildEscposFromHtml, buildEscposFromText } from '@/printing/escpos';
import { buildPrintCss } from '@/printing/printCss';
import type { RestaurantSettings } from '@/lib/types';

const settings = {} as RestaurantSettings;

function makeReceipt(scrollHeightPx: number, text = 'DT POS Test Receipt — Rs. 500'): HTMLElement {
  const portal = document.createElement('div');
  portal.className = 'receipt-print-portal';
  const receipt = document.createElement('div');
  receipt.className = 'print-receipt';
  receipt.textContent = text;
  // jsdom has no layout engine — emulate rendered height
  Object.defineProperty(receipt, 'scrollHeight', { value: scrollHeightPx, configurable: true });
  Object.defineProperty(receipt, 'offsetHeight', { value: scrollHeightPx, configurable: true });
  portal.appendChild(receipt);
  document.body.appendChild(portal);
  return portal;
}

describe('measureThermalContentHeightMm', () => {
  it('converts CSS px to mm with a safety buffer', () => {
    // 378px ≈ 100mm at 96dpi; +4mm buffer => ~104mm
    const portal = makeReceipt(378);
    const mm = measureThermalContentHeightMm(portal, settings);
    expect(mm).toBeGreaterThanOrEqual(103);
    expect(mm).toBeLessThanOrEqual(105);
    portal.remove();
  });

  it('enforces a minimum height so drivers never get a micro page', () => {
    const portal = makeReceipt(20); // ~5mm content
    const mm = measureThermalContentHeightMm(portal, settings);
    expect(mm).toBeGreaterThanOrEqual(25);
    portal.remove();
  });

  it('caps very long receipts at the sane maximum', () => {
    const portal = makeReceipt(999999);
    const mm = measureThermalContentHeightMm(portal, settings);
    expect(mm).toBeLessThanOrEqual(1500);
    portal.remove();
  });

  it('returns undefined when nothing is measurable (falls back to printer default)', () => {
    expect(measureThermalContentHeightMm(null, settings)).toBeUndefined();
    const portal = makeReceipt(0);
    expect(measureThermalContentHeightMm(portal, settings)).toBeUndefined();
    portal.remove();
  });

  it('getThermalPrintJobHeightMm mirrors the measurement (no more forced 500mm pages)', () => {
    const portal = makeReceipt(378);
    expect(getThermalPrintJobHeightMm(portal, settings)).toBe(
      measureThermalContentHeightMm(portal, settings),
    );
    portal.remove();
  });
});

describe('hasPrintableContent (blank-slip guard)', () => {
  it('accepts a real receipt', () => {
    const portal = makeReceipt(200);
    expect(hasPrintableContent(portal)).toBe(true);
    portal.remove();
  });

  it('rejects an empty receipt so a blank slip is never sent to the printer', () => {
    const portal = makeReceipt(200, '   ');
    expect(hasPrintableContent(portal)).toBe(false);
    portal.remove();
  });
});

describe('waitForPrintAssets', () => {
  it('resolves quickly when there are no pending assets', async () => {
    const portal = makeReceipt(100);
    const start = Date.now();
    await waitForPrintAssets(portal, 1500);
    expect(Date.now() - start).toBeLessThan(1000);
    portal.remove();
  });

  it('never hangs on a broken image (timeout guard)', async () => {
    const portal = makeReceipt(100);
    const img = document.createElement('img');
    // never loads in jsdom
    img.src = 'https://invalid.local/logo.png';
    portal.querySelector('.print-receipt')!.appendChild(img);
    const start = Date.now();
    await waitForPrintAssets(portal, 300);
    expect(Date.now() - start).toBeLessThan(2000);
    portal.remove();
  });
});

describe('ESC/POS builder (LAN printing)', () => {
  it('extracts readable text from receipt HTML (not a blank slip)', () => {
    const html = `<div><h2>DT Restaurant</h2><table><tr><td>Zinger Burger</td><td>2</td><td>900</td></tr></table><p>Total: Rs. 900</p></div>`;
    const text = htmlToPlainText(html);
    expect(text).toContain('DT Restaurant');
    expect(text).toContain('Zinger Burger');
    expect(text).toContain('Total: Rs. 900');
  });

  it('refuses to build bytes for blank HTML', () => {
    expect(() => buildEscposFromHtml('<div><style>.a{}</style>   </div>')).toThrow(/blank/i);
  });

  it('appends a cut command by default', () => {
    const bytesArr = buildEscposFromText('HELLO', {});
    const tail = bytesArr.slice(-3);
    expect(tail).toEqual([0x1d, 0x56, 0x00]); // GS V 0 full cut
  });
});

describe('print CSS invariants (the 15 rules)', () => {
  const css = buildPrintCss('80mm');
  it('uses @page auto height with zero margins', () => {
    expect(css).toMatch(/@page\s*{\s*size:\s*80mm auto/);
    expect(css).toContain('margin: 0 !important');
  });
  it('locks receipt width in mm, never fixed px', () => {
    expect(css).toContain('width: 80mm !important');
    expect(css).not.toMatch(/width:\s*576px/);
  });
  it('keeps overflow visible so content is never clipped', () => {
    expect(css).toContain('overflow: visible !important');
  });
});

describe('LAN receipt extraction — realistic receipt markup (1-inch blank fix verification)', () => {
  it('produces a full readable receipt, with label/value rows separated', () => {
    // Representative of the real print portal outerHTML (flex rows + table + QR svg)
    const html = `
      <div class="receipt-print-portal" data-active-print="true">
        <div class="print-receipt">
          <h2 style="text-align:center">AL-MADINA RESTAURANT</h2>
          <div style="display:flex;justify-content:space-between"><span>Order #</span><span>1042</span></div>
          <div style="display:flex;justify-content:space-between"><span>Type</span><span>DINE IN</span></div>
          <table><tbody>
            <tr><td>Zinger Burger</td><td>2</td><td>900</td></tr>
            <tr><td>Fries Large</td><td>1</td><td>350</td></tr>
          </tbody></table>
          <div style="display:flex;justify-content:space-between"><span>PAYMENT</span><span>CASH</span></div>
          <div class="grand-total" style="display:flex;justify-content:space-between"><span>TOTAL</span><span>Rs. 1250</span></div>
          <svg viewBox="0 0 29 29"><path d="M0 0h7v7H0z"></path></svg>
          <p style="text-align:center">Thank You! Please Visit Again</p>
        </div>
      </div>`;
    const text = htmlToPlainText(html);
    expect(text).toContain('AL-MADINA RESTAURANT');
    expect(text).toContain('Zinger Burger');
    expect(text).toContain('Rs. 1250');
    expect(text).toContain('Thank You');
    // spans no longer merge into one word
    expect(text).not.toContain('PAYMENTCASH');
    expect(text).toMatch(/PAYMENT\s+CASH/);
    // extraction yields substantial content — never a near-empty slip
    expect(text.replace(/\s+/g, '').length).toBeGreaterThan(50);
    // and the ESC/POS builder happily accepts it
    expect(() => buildEscposFromHtml(html)).not.toThrow();
  });
});

describe('inverted header preservation (black-bar-at-top fix)', () => {
  it('print CSS keeps explicit white text white inside black header bands', () => {
    const css = buildPrintCss('80mm');
    expect(css).toContain('[style*="color: rgb(255, 255, 255)"]');
    expect(css).toContain('color: #fff !important');
  });
  it('logos get a white background so transparent PNGs never print black', () => {
    const css = buildPrintCss('80mm');
    expect(css).toMatch(/img\s*{[^}]*background:\s*#fff !important/s);
  });
});
