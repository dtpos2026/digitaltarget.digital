// ============================================================
// v1.105.0 — printing from a BROWSER prints the slip as designed.
//
// Reported: the printout is not clean and not as designed; it changes in the browser.
// The thermal stylesheet (desktop app, 203-DPI head) repaints everything black, forces 1 px black borders and fixed table layout on
// every table, forces bold on headings and first columns, greys the logo, fixes the content width, and declares
// `@page { size: 80mm auto }`, which browsers reject (so the whole size rule is dropped).
// In a browser the slip now prints with its own colours, borders, weights and widths, backgrounds forced on, margin 0, and no
// invented page size. The desktop app keeps the thermal rules. The old rendering stays one click away in Settings → Printer.
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { buildPrintCss, buildBrowserPrintCss, injectPrintCss, getBrowserPrintStyle, setBrowserPrintStyle, BROWSER_PRINT_STYLE_KEY } from '@/printing/printCss';

describe('buildBrowserPrintCss — the design, not the thermal rules', () => {
  const css = buildBrowserPrintCss('80mm');
  const thermal = buildPrintCss('80mm');

  it('does not repaint, re-border, re-weight or filter the template', () => {
    expect(css).not.toMatch(/border-width:\s*1px/);
    expect(css).not.toMatch(/table-layout:\s*fixed/);
    expect(css).not.toMatch(/filter:\s*grayscale/);
    expect(css).not.toMatch(/font-weight:\s*(800|900)/);
    expect(css).not.toMatch(/\.print-receipt \*[^{]*\{[^}]*color:\s*#000/);       // descendants keep their own colour
    // …which the thermal stylesheet does (the control: this is what used to change the design)
    expect(thermal).toMatch(/border-width:\s*1px/);
    expect(thermal).toMatch(/table-layout:\s*fixed/);
    expect(thermal).toMatch(/filter:\s*grayscale/);
  });

  it('declares no page size (browsers drop "80mm auto"), a zero margin, and forces backgrounds to print', () => {
    expect(thermal).toMatch(/size:\s*80mm auto/);                                  // the rule browsers reject
    expect(css).not.toMatch(/\bsize\s*:/);
    expect(css).toMatch(/@page\s*\{\s*margin:\s*0/);
    expect(css).toMatch(/print-color-adjust:\s*exact/);
    expect(css).not.toMatch(/-webkit-print-scale|print-scale/);
  });

  it('hides the rest of the application on paper and lays the slip out at paper width', () => {
    expect(css).toMatch(/@media print/);
    expect(css).toMatch(/body\.thermal-printing > \*:not\(\.receipt-print-portal\[data-active-print="true"\]\)\s*\{\s*display:\s*none/);
    expect(css).toMatch(/width:\s*80mm/);
    expect(buildBrowserPrintCss('58mm')).toMatch(/width:\s*58mm/);
  });

  it('Paper Save (compact) is still honoured when the shop switched it on', () => {
    expect(buildBrowserPrintCss('80mm', true).length).toBeGreaterThan(css.length);
  });
});

describe('injectPrintCss chooses by where it runs', () => {
  const style = () => document.getElementById('dt-print-style')?.textContent || '';
  beforeEach(() => { localStorage.clear(); delete (window as any).electronAPI; });
  afterEach(() => { document.getElementById('dt-print-style')?.remove(); delete (window as any).electronAPI; localStorage.clear(); });

  it('a browser prints the design by default', () => {
    expect(getBrowserPrintStyle()).toBe('design');
    const off = injectPrintCss('80mm');
    expect(style()).toBe(buildBrowserPrintCss('80mm'));
    off();
    expect(document.getElementById('dt-print-style')).toBeNull();
  });

  it('a browser can be switched back to the thermal rendering', () => {
    setBrowserPrintStyle('thermal');
    expect(localStorage.getItem(BROWSER_PRINT_STYLE_KEY)).toBe('thermal');
    injectPrintCss('80mm');
    expect(style()).toBe(buildPrintCss('80mm'));
  });

  it('the desktop app always keeps the thermal rules', () => {
    (window as any).electronAPI = {};
    injectPrintCss('80mm');
    expect(style()).toBe(buildPrintCss('80mm'));
  });
});

describe('Settings → Printer: the browser choice', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); delete (window as any).electronAPI; });
  afterEach(() => cleanup());

  it('is offered in a browser, saves the choice, and is not offered in the desktop app', async () => {
    const { default: Tab } = await import('@/components/settings/PrinterSettingsTab');
    const props: any = { settings: {}, setSettings: () => {}, onSave: () => {}, printers: [], receiptSizePresets: [], autoStartEnabled: false, onToggleAutoStart: () => {} };
    const first = render(<Tab {...props} />);
    const group = screen.getByRole('radiogroup', { name: 'Browser print style' });
    expect(group.querySelector('[data-style="design"]')!.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(group.querySelector('[data-style="thermal"]')!);
    expect(getBrowserPrintStyle()).toBe('thermal');
    expect(group.querySelector('[data-style="thermal"]')!.getAttribute('aria-checked')).toBe('true');
    first.unmount();
    (window as any).electronAPI = { getPrinters: async () => [] };
    render(<Tab {...props} />);
    expect(screen.queryByTestId('browser-print-style')).toBeNull();
  });
});
