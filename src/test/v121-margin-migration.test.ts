// ============================================================
// MARGIN MIGRATION — the case that reached the client's paper.
//
// The equal-margin release corrected the printer-config default but still
// printed lopsided on real hardware, on the receipt, the KOT, the token and
// the shift report alike. The reason was a migration that could not run:
//
//   `dtpos-print-geometry-v3` is written on FIRST RUN of any build carrying
//   it. A client already running a v3 build therefore had the flag set with
//   whatever asymmetric values happened to be in storage at that moment. The
//   guard then saw the flag and skipped the reset forever, so every later
//   release inherited those numbers — and loadPrintMargins() feeds all four
//   slip types.
//
// The test that would have caught it is the one nobody wrote: not "does a
// fresh machine get equal margins" (it always did), but "does a machine that
// ALREADY has the old flag and bad values get repaired". That is what this
// file pins.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

const KEY = 'dtpos-print-margins';
const V3 = 'dtpos-print-geometry-v3';
const V4 = 'dtpos-print-geometry-v4';
const V5 = 'dtpos-print-geometry-v5';

/** Load printMargins.ts fresh so its module-level migration runs again. */
async function importFresh() {
  vi.resetModules();
  return import('@/lib/printMargins');
}

describe('a machine that already ran a v3 build', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is repaired even though the old flag is already set', async () => {
    // Exactly the client's machine: v3 flag present, lopsided values stored.
    localStorage.setItem(V3, '1');
    localStorage.setItem(KEY, JSON.stringify({ top: 0, right: 0, bottom: 0, left: 3, contentWidthMm: 0 }));

    const { loadPrintMargins } = await importFresh();

    const m = loadPrintMargins();
    expect(m.left, 'left margin was not repaired').toBe(m.right);
    expect(localStorage.getItem(V5)).toBe('1');
  });

  it('repairs the wide-right-band values too', async () => {
    localStorage.setItem(V3, '1');
    localStorage.setItem(KEY, JSON.stringify({ top: 0, right: 10, bottom: 0, left: 3, contentWidthMm: 0 }));

    const { loadPrintMargins } = await importFresh();
    expect(loadPrintMargins().left).toBe(loadPrintMargins().right);
  });

  it('clears every superseded flag so a downgrade and upgrade migrates again', async () => {
    // A machine that rolls back and forward must not be skipped a second time.
    localStorage.setItem(V3, '1');
    localStorage.setItem(KEY, JSON.stringify({ top: 0, right: 0, bottom: 0, left: 3, contentWidthMm: 0 }));

    await importFresh();
    expect(localStorage.getItem(V3)).toBeNull();
    expect(localStorage.getItem(V4)).toBeNull();
  });
});

describe('once migrated', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('does not overwrite margins the shop set afterwards', async () => {
    // The migration is a one-time repair of a bad default, not a standing
    // override. A shop compensating for its own printer keeps its numbers.
    const { savePrintMargins } = await importFresh();
    expect(localStorage.getItem(V5)).toBe('1');

    savePrintMargins({ top: 0, right: 1, bottom: 0, left: 4, contentWidthMm: 0 });

    const { loadPrintMargins } = await importFresh();
    const m = loadPrintMargins();
    expect(m.left).toBe(4);
    expect(m.right).toBe(1);
  });
});

describe('equalise action', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('never widens the slip while equalising', async () => {
    // Taking the larger side would eat printable width on both edges.
    const { savePrintMargins, equaliseSideMargins } = await importFresh();
    savePrintMargins({ top: 0, right: 10, bottom: 0, left: 3, contentWidthMm: 0 });

    const next = equaliseSideMargins(3);
    expect(next.left).toBe(3);
    expect(next.right).toBe(3);
  });

  it('keeps the top, bottom and calibrated width', async () => {
    const { savePrintMargins, equaliseSideMargins } = await importFresh();
    savePrintMargins({ top: 2, right: 10, bottom: 4, left: 3, contentWidthMm: 68 });

    const next = equaliseSideMargins(2);
    expect(next.top).toBe(2);
    expect(next.bottom).toBe(4);
    expect(next.contentWidthMm).toBe(68);
  });
});

describe('the repair must survive the read that follows it', () => {
  // This is the defect that let the wide right margin reach the client's
  // paper a SECOND time, after it had supposedly been fixed. The repair ran
  // on read, marked itself done, and returned the corrected list in memory
  // without writing it back. The very next read saw the flag, skipped the
  // repair, and handed out the original lopsided values again — so the fix
  // held for exactly one read and then undid itself.
  //
  // Reproduced before the fix as: "expected 10 to be 3".
  beforeEach(() => localStorage.clear());

  const seed = async (left: number, right: number) => {
    const { defaultPrinterConfig } = await import('@/lib/printerSettings');
    localStorage.setItem('dtpos-printer-settings-v1', JSON.stringify({
      printers: [{ ...defaultPrinterConfig(), leftMarginMm: left, rightMarginMm: right }],
      deviceAssignments: {},
    }));
  };

  it('stays repaired across repeated reads', async () => {
    const { loadPrinterSettings } = await import('@/lib/printerSettings');
    await seed(3, 10);

    for (let read = 1; read <= 3; read++) {
      const s = await loadPrinterSettings();
      expect(s.printers[0].leftMarginMm, `read ${read} left`).toBe(3);
      expect(s.printers[0].rightMarginMm, `read ${read} right`).toBe(3);
    }
  });

  it('writes the corrected values to storage, not just to memory', async () => {
    const { loadPrinterSettings } = await import('@/lib/printerSettings');
    await seed(3, 10);
    await loadPrinterSettings();

    const onDisk = JSON.parse(localStorage.getItem('dtpos-printer-settings-v1') || '{}');
    expect(onDisk.printers[0].rightMarginMm, 'storage still holds the old value').toBe(3);
  });
});
