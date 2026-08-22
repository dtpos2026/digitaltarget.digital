// ============================================================
// Tests — Page-height strategy switch (v1.5.3, top-blank fix)
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { getPageHeightStrategy, setPageHeightStrategy, resolvePageHeight } from '@/lib/printPageStrategy';

beforeEach(() => localStorage.clear());

describe('strategy storage', () => {
  it('defaults to measured (current behaviour — other restaurants unaffected)', () => {
    expect(getPageHeightStrategy()).toBe('measured');
  });

  it('persists the driver-mode choice per device', () => {
    setPageHeightStrategy('driver');
    expect(getPageHeightStrategy()).toBe('driver');
  });

  it('junk stored values fall back to measured', () => {
    localStorage.setItem('dtpos-page-height-strategy', 'banana');
    expect(getPageHeightStrategy()).toBe('measured');
  });
});

describe('resolvePageHeight — what actually reaches Electron', () => {
  it('measured mode sends the exact height and disables printer default', () => {
    const r = resolvePageHeight(118);
    expect(r.strategy).toBe('measured');
    expect(r.pageHeightMicrons).toBe(118000);
    expect(r.usePrinterDefaultPageSize).toBe(false);
  });

  it('measured mode without a measurement falls back to printer default (never 500mm)', () => {
    const r = resolvePageHeight(undefined);
    expect(r.pageHeightMicrons).toBeUndefined();
    expect(r.usePrinterDefaultPageSize).toBe(true);
  });

  it('driver mode NEVER sends a page height — the fix for driver pre-feed', () => {
    setPageHeightStrategy('driver');
    const r = resolvePageHeight(118);
    expect(r.strategy).toBe('driver');
    expect(r.pageHeightMicrons).toBeUndefined();
    expect(r.usePrinterDefaultPageSize).toBe(true);
  });

  it('rounds fractional millimetres to whole microns', () => {
    const r = resolvePageHeight(103.4);
    expect(r.pageHeightMicrons).toBe(103400);
    expect(Number.isInteger(r.pageHeightMicrons)).toBe(true);
  });
});
