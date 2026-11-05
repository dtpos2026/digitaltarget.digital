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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

// ------------------------------------------------------------------ v1.105.1 — the root cause on the web: index.css
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('index.css no longer repaints the slip when it prints as designed (v1.105.1)', () => {
  const idx = read('src/index.css');

  it('the blanket "all black on transparent" print rule is for the page, not for the slip', () => {
    // the old behaviour is kept for everything that is not "printed as designed" …
    expect(idx).toMatch(/html:not\(\[data-print-design\]\) body \*\s*\{[^}]*color:\s*#000000 !important;[^}]*background-color:\s*transparent !important/);
    // … and when it is, the portal (the slip) is excluded
    expect(idx).toMatch(/html\[data-print-design\] body \*:not\(\.receipt-print-portal, \.receipt-print-portal \*\)/);
    // no unconditional version is left
    expect(idx).not.toMatch(/\n  body \* \{\s*\n\s*color:\s*#000000 !important/);
  });

  it('the global print block no longer declares a page size browsers reject', () => {
    expect(idx).not.toMatch(/@page\s*\{\s*size:\s*80mm auto/);
  });

  it('injectPrintCss raises the flag while a slip prints as designed, and lowers it afterwards (and never for the thermal rendering)', () => {
    localStorage.clear(); delete (window as any).electronAPI;
    const off = injectPrintCss('80mm');
    expect(document.documentElement.getAttribute('data-print-design')).toBe('true');
    off();
    expect(document.documentElement.hasAttribute('data-print-design')).toBe(false);
    setBrowserPrintStyle('thermal');
    const off2 = injectPrintCss('80mm');
    expect(document.documentElement.hasAttribute('data-print-design')).toBe(false);
    off2(); localStorage.clear();
  });
});

describe('the design stylesheet keeps the desktop geometry', () => {
  it('lays the slip out at the head\'s printable width with equal side padding, like the thermal path', () => {
    const css = buildBrowserPrintCss('80mm');
    expect(css).toMatch(/width:\s*var\(--dt-print-content-width,\s*72mm\)/);
    expect(css).toMatch(/padding:\s*var\(--dt-print-padding-top, 0mm\) var\(--dt-print-padding-right, 2mm\)/);
    expect(css).toMatch(/margin:\s*0 auto !important/);
  });
});

describe('the standard receipt\'s amount columns fit 1,800.00 and 12,500.00', () => {
  it('Rate and Amount are at least 56 px and 64 px (they were 48 and 56, and ran into each other)', () => {
    const src = read('src/components/StandardReceipt.tsx');
    const cols = [...src.matchAll(/<col style=\{\{ width: '(\d+)px' \}\} \/>/g)].map(m => Number(m[1]));
    expect(cols.length).toBe(3);
    expect(cols[1]).toBeGreaterThanOrEqual(56);
    expect(cols[2]).toBeGreaterThanOrEqual(64);
  });
});
