// ============================================================================
// v1.29.4 — printing must not take over the till's screen.
//
// REPORTED: "pay karte hi receipt screen par kuch second ke liye aa jati hai,
// lagta hai app stuck ho gayi — click karo aur seedha print ho."
//
// The injected print stylesheet used to hide the whole application and paint
// the receipt portal at the top-left corner, opaque, at the maximum z-index —
// on SCREEN, not just on paper. A single payment runs four of those sessions
// back to back, so the operator watched the till blank out on every bill.
//
// These assertions read the generated CSS with comments stripped, so they
// describe what the browser will actually apply and cannot be satisfied by the
// prose explaining it.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { buildPrintCss } from '@/printing/printCss';

/** The stylesheet as a browser sees it — no /* ... *​/ commentary. */
function css(paper: '58mm' | '80mm' | '110mm' = '80mm'): string {
  return buildPrintCss(paper).replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Everything inside the first top-level `@media print { ... }` block. */
function printMedia(source: string): string {
  const start = source.indexOf('@media print');
  expect(start).toBeGreaterThan(-1);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error('unterminated @media print block');
}

/** The stylesheet with the print block removed — i.e. what applies on screen. */
function screenOnly(source: string): string {
  return source.replace(printMedia(source), '');
}

/** The declaration body of the first rule whose selector contains `needle`. */
function ruleFor(source: string, needle: string): string {
  const at = source.indexOf(needle);
  expect(at, `no rule matching ${needle}`).toBeGreaterThan(-1);
  const open = source.indexOf('{', at);
  const close = source.indexOf('}', open);
  return source.slice(open + 1, close);
}

describe('the print stylesheet leaves the screen alone', () => {
  it('does not hide the application outside print media', () => {
    const all = css();
    const hideApp = 'body.thermal-printing > *:not(.receipt-print-portal[data-active-print="true"])';

    // It still exists — on paper the POS chrome must not be printed.
    expect(all).toContain(hideApp);
    expect(printMedia(all)).toContain(hideApp);

    // But it must not reach the monitor: that blanked the till on every bill.
    expect(screenOnly(all)).not.toContain(hideApp);
  });

  it('keeps the active receipt portal off-screen while it is measured', () => {
    const rule = ruleFor(
      screenOnly(css()),
      'body.thermal-printing .receipt-print-portal[data-active-print="true"]',
    );

    // Laid out at true paper width — the page height is measured from its
    // scrollHeight, so display:none or visibility:hidden would break printing.
    expect(rule).toContain('display: block');
    expect(rule).toContain('width: 80mm');
    expect(rule).toContain('visibility: visible');

    // ...but parked outside the viewport and fully transparent.
    expect(rule).toMatch(/left:\s*-\d{4,}px/);
    expect(rule).toContain('opacity: 0');
    expect(rule).not.toMatch(/left:\s*0\b/);
  });

  it('puts the receipt back at the page origin, opaque, when printing', () => {
    const inPrint = printMedia(css());
    const rule = ruleFor(
      inPrint,
      'body.thermal-printing[data-print-active="true"] .receipt-print-portal[data-active-print="true"]',
    );

    // Printed output is unchanged from before the fix: origin, top, opaque.
    expect(rule).toMatch(/left:\s*0\s*!important/);
    expect(rule).toMatch(/top:\s*0\s*!important/);
    expect(rule).toMatch(/opacity:\s*1\s*!important/);
    expect(rule).toMatch(/visibility:\s*visible\s*!important/);
  });

  it('overrides the screen position, rather than merely repeating it', () => {
    const all = css();
    // The print override has to win. Both selectors are (0,3,1) and (0,4,1)
    // respectively, and the print one also comes later in the sheet — but the
    // point is that it exists at all, because the screen rule now disagrees.
    const screenRule = ruleFor(
      screenOnly(all),
      'body.thermal-printing .receipt-print-portal[data-active-print="true"]',
    );
    const printRule = ruleFor(
      printMedia(all),
      'body.thermal-printing[data-print-active="true"] .receipt-print-portal[data-active-print="true"]',
    );
    const screenLeft = /left:\s*(-?\d+)px/.exec(screenRule)?.[1];
    const printLeft = /left:\s*(-?\d+)/.exec(printRule)?.[1];
    expect(screenLeft).toBeDefined();
    expect(printLeft).toBe('0');
    expect(Number(screenLeft)).toBeLessThan(-1000);
  });

  it('holds for every paper width the POS ships', () => {
    for (const paper of ['58mm', '80mm', '110mm'] as const) {
      const all = css(paper);
      expect(screenOnly(all)).not.toContain('body.thermal-printing > *:not(');
      const rule = ruleFor(
        screenOnly(all),
        'body.thermal-printing .receipt-print-portal[data-active-print="true"]',
      );
      expect(rule, paper).toMatch(/left:\s*-\d{4,}px/);
    }
  });
});
