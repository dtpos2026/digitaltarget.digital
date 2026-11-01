// ============================================================
// PRINT CSS — regression locks for the rules that decide what the paper
// actually looks like.
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildPrintCss } from '@/printing/printCss';
import { printableMmOf } from '@/printing/printGeometry';

const normal80 = buildPrintCss('80mm', false);
const compact80 = buildPrintCss('80mm', true);

describe('content width', () => {
  it('sizes the content box to the printable area, not the roll', () => {
    // An 80mm content box on an 80mm roll had its right edge clipped by the
    // head, which is the "right side is cut off" report.
    expect(normal80).toContain(`var(--dt-print-content-width, ${printableMmOf('80mm')}mm)`);
    expect(normal80).not.toContain('var(--dt-print-content-width, 80mm)');
  });

  it('does the same on 58mm paper', () => {
    const css = buildPrintCss('58mm', false);
    expect(css).toContain(`var(--dt-print-content-width, ${printableMmOf('58mm')}mm)`);
  });
});

describe('default side margins', () => {
  it('defaults to an equal 2mm a side', () => {
    expect(normal80).toContain('var(--dt-print-padding-left, 2mm)');
    expect(normal80).toContain('var(--dt-print-padding-right, 2mm)');
  });

  it('keeps left and right as separate variables', () => {
    // A single shared variable would make the two settings impossible to
    // set independently, which is the whole requirement.
    const left = (normal80.match(/--dt-print-padding-left/g) || []).length;
    const right = (normal80.match(/--dt-print-padding-right/g) || []).length;
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
  });
});

describe('reversed blocks', () => {
  it('lets knocked-out text stay white on its own dark fill', () => {
    // The blanket `* { color: #000 !important }` that keeps thermal output
    // dark also repainted white text black, leaving a solid bar with
    // nothing readable on it.
    expect(normal80).toContain('.dt-reverse');
    expect(normal80).toMatch(/\.dt-reverse[^{]*\{[^}]*color:\s*#fff\s*!important/);
  });

  it('marks reversed fills as exact so the printer keeps the black', () => {
    expect(normal80).toMatch(/\.dt-reverse[^{]*\{[^}]*print-color-adjust:\s*exact/);
  });
});

describe('compact mode', () => {
  it('is only emitted when compact is requested', () => {
    expect(normal80).not.toContain('--dt-compact-font-size');
    expect(compact80).toContain('--dt-compact-font-size');
  });

  it('keeps the body type readable rather than shrinking it to fit', () => {
    // 11px on an 80mm slip is ~7pt and prints grey on a 203 DPI head.
    expect(compact80).toContain('var(--dt-compact-font-size, 12px)');
    expect(compact80).not.toContain('var(--dt-compact-font-size, 11px)');
  });

  it('keeps compact text bold so it is no lighter than normal mode', () => {
    expect(compact80).toMatch(/font-weight:\s*700\s*!important/);
  });

  it('releases the 24px item-row floor that normal mode holds', () => {
    // This floor is set inside @media print for normal mode and is more
    // specific than the compact rule, so without an explicit compact
    // override in @media print the rows stayed tall and almost no paper
    // was saved on the actual printout.
    expect(normal80).toContain('min-height: 24px !important');
    const printBlock = compact80.slice(compact80.lastIndexOf('@media print'));
    expect(printBlock).toMatch(/thermal-compact[^{]*\.item-row[^{]*\{[^}]*min-height:\s*0\s*!important/s);
  });

  it('saves paper through spacing, not by hiding content', () => {
    // Compact must never drop a section of the bill — the shop still has to
    // show its totals, tax and footer. The one thing it may remove is an
    // empty line: `br + br` collapses a run of blank lines to a single
    // break. Everything else it touches is margin, padding or row height.
    const compactOnly = compact80.slice(compact80.indexOf('COMPACT / SAVE-PAPER MODE'));
    const hidden = [...compactOnly.matchAll(/([^{}]+)\{[^}]*display:\s*none[^}]*\}/g)]
      .map(m => m[1].trim())
      .filter(sel => !/br\s*\+\s*br/.test(sel));
    expect(hidden).toEqual([]);
  });
});
