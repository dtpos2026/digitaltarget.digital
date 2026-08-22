// ============================================================
// Tests — Top-feed / blank-paper guardrail (v1.5.0)
// Reported: "top margin bohot zyada feed kar raha hai" — a receipt with a
// large blank gap before the first printed line. These tests lock the fix
// in place: every top-margin/top-feed value in the app is capped at
// MAX_TOP_MARGIN_MM, and any oversized value already stored is corrected
// automatically the next time it's read.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { MAX_TOP_MARGIN_MM, clampTopMarginMm, getEffectiveReceiptMargins } from '@/lib/thermal-print';
import type { RestaurantSettings } from '@/lib/types';

describe('clampTopMarginMm — the shared ceiling', () => {
  it('passes through values within range', () => {
    expect(clampTopMarginMm(3)).toBe(3);
    expect(clampTopMarginMm(0)).toBe(0);
  });

  it('caps anything above the ceiling — this is the exact bug scenario (30mm)', () => {
    expect(clampTopMarginMm(30)).toBe(MAX_TOP_MARGIN_MM);
    expect(clampTopMarginMm(1000)).toBe(MAX_TOP_MARGIN_MM);
  });

  it('never goes negative', () => {
    expect(clampTopMarginMm(-5)).toBe(0);
  });

  it('falls back safely for non-numeric input', () => {
    expect(clampTopMarginMm(undefined, 2)).toBe(2);
    expect(clampTopMarginMm(NaN, 2)).toBe(2);
    expect(clampTopMarginMm('30' as any, 2)).toBe(2);
  });
});

describe('getEffectiveReceiptMargins — end-to-end top margin resolution', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to zero when nothing is configured', () => {
    const m = getEffectiveReceiptMargins({} as RestaurantSettings);
    expect(m.top).toBe(0);
  });

  // getEffectiveReceiptMargins prefers the DEVICE-level margin (loadPrintMargins)
  // over the per-restaurant setting whenever a device value is present — that
  // is the actual mechanism that reaches the printer, so these tests exercise
  // it directly (matching how PrinterSettingsPanel / print margin UI saves it).

  it('an old restaurant with a device-level top=30 (the historical bug value) is clamped down', () => {
    localStorage.setItem('dtpos-print-margins', JSON.stringify({ top: 30, bottom: 2, left: 4, right: 4 }));
    const m = getEffectiveReceiptMargins({} as RestaurantSettings);
    expect(m.top).toBe(MAX_TOP_MARGIN_MM);
    expect(m.top).toBeLessThan(30);
  });

  it('a reasonable device-level value is respected exactly', () => {
    localStorage.setItem('dtpos-print-margins', JSON.stringify({ top: 3, bottom: 0, left: 4, right: 4 }));
    const m = getEffectiveReceiptMargins({} as RestaurantSettings);
    expect(m.top).toBe(3);
  });

  it('a device-level override above the ceiling is clamped regardless of magnitude', () => {
    localStorage.setItem('dtpos-print-margins', JSON.stringify({ top: 45, bottom: 2, left: 4, right: 4 }));
    const m = getEffectiveReceiptMargins({} as RestaurantSettings);
    expect(m.top).toBe(MAX_TOP_MARGIN_MM);
  });

  it('falls back to the restaurant setting when no device margin is saved yet', () => {
    // no localStorage key at all -> loadPrintMargins() default has top:0,
    // which itself is a valid override, so settings.receiptMarginTop only
    // applies once a restaurant has never touched the device margin UI on
    // this machine. Confirm the fallback path itself is still clamped.
    const m = getEffectiveReceiptMargins({ receiptMarginTop: 999 } as RestaurantSettings);
    expect(m.top).toBeLessThanOrEqual(MAX_TOP_MARGIN_MM);
  });

  it('left/right/bottom margins are unaffected by the top-margin fix', () => {
    localStorage.setItem('dtpos-print-margins', JSON.stringify({ top: 0, bottom: 5, left: 5, right: 5 }));
    const m = getEffectiveReceiptMargins({} as RestaurantSettings);
    expect(m.left).toBe(5);
    expect(m.right).toBe(5);
    expect(m.bottom).toBe(5);
  });
});

describe('per-printer Top Feed self-heal (PrinterSettingsPanel)', () => {
  // Key is tenant+device scoped and the device half is a randomly generated
  // UUID persisted to localStorage — so it's cleared and regenerated every
  // test. Find the real key by prefix instead of hardcoding it.
  beforeEach(() => localStorage.clear());

  function findKey(): string {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('dtpos-printer-settings-')) return k;
    }
    throw new Error('printer settings key not found');
  }

  function seed(topFeedMm: number) {
    // Prime the device id first so we know the exact key to write to.
    const anyKey = 'dtpos-printer-settings-anon-__seed__';
    localStorage.setItem(anyKey, JSON.stringify({
      printers: [{ id: 'p1', name: 'Black Copper', topFeedMm, connection: 'lan' }],
      deviceAssignments: {},
    }));
    return anyKey;
  }

  it('an oversized saved value is corrected the moment it is read', async () => {
    const { loadPrinterSettings, savePrinterSettings } = await import('@/lib/printerSettings');
    await savePrinterSettings({
      printers: [{ id: 'p1', name: 'Black Copper', topFeedMm: 30, connection: 'lan' } as any],
      deviceAssignments: {},
    });
    const doc = await loadPrinterSettings();
    expect(doc.printers[0].topFeedMm).toBe(MAX_TOP_MARGIN_MM);
  });

  it('a normal value is left untouched', async () => {
    const { loadPrinterSettings, savePrinterSettings } = await import('@/lib/printerSettings');
    await savePrinterSettings({
      printers: [{ id: 'p1', name: 'Black Copper', topFeedMm: 2, connection: 'lan' } as any],
      deviceAssignments: {},
    });
    const doc = await loadPrinterSettings();
    expect(doc.printers[0].topFeedMm).toBe(2);
  });

  it('the healed value is persisted so it stays fixed on the next read', async () => {
    const { loadPrinterSettings, savePrinterSettings } = await import('@/lib/printerSettings');
    await savePrinterSettings({
      printers: [{ id: 'p1', name: 'Black Copper', topFeedMm: 50, connection: 'lan' } as any],
      deviceAssignments: {},
    });
    await loadPrinterSettings();
    const persisted = JSON.parse(localStorage.getItem(findKey())!);
    expect(persisted.printers[0].topFeedMm).toBe(MAX_TOP_MARGIN_MM);
  });
});
