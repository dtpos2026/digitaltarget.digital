// ============================================================
// EVERY PRINTER SWITCH DOES SOMETHING, OR IT IS NOT THERE.
//
// Printer Center showed five toggles. Two of them were read by nothing:
//
//   "ESC/POS"        said exactly what Print Mode -> Raw says. A shop that
//                    turned it on got no raw printing and no explanation.
//   "Browser Backup" would have restored a fallback that was deliberately
//                    removed — at an unattended counter it put a modal print
//                    dialog in front of the cashier and reported the job as
//                    successful, so a dead printer froze the till AND hid the
//                    failure.
//
// "Auto Cut" and "Beep" were in the same state until this release: stored,
// shown, and never read by the raw path.
//
// A setting that looks like it works is worse than no setting, because the
// shop spends their evening turning it on and off. This file is the lock:
// a toggle in Printer Center must be reachable from a print path, and a
// removed one must not take the shop's intent with it.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolvePrintMode } from '@/printing/printMode';
import { foldLegacyEscposMode, defaultPrinterConfig } from '@/lib/printerSettings';
import { buildReceiptBytes } from '@/printing/escposBuilder';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const panel = read('components/PrinterSettingsPanel.tsx');
/** Comments explain why a switch was removed; they are not the switch. */
const stripComments = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const panelCode = stripComments(panel);
const PRINTERS_KEY = 'dtpos-printer-settings-v1';

const order: any = {
  id: 'o1', orderNumber: 5, createdAt: new Date().toISOString(),
  items: [{ id: 'i1', name: 'Tea', quantity: 1, price: 80 }], orderType: 'takeaway',
};

describe('the toggles that remain are read by a print path', () => {
  it('shows only Enabled, Auto Cut and Beep', () => {
    const toggles = Array.from(panelCode.matchAll(/<ToggleRow label="([^"]+)"/g)).map(m => m[1]);
    expect(toggles.sort()).toEqual(['Auto Cut', 'Beep', 'Enabled']);
  });

  it('Auto Cut reaches the bytes', () => {
    const cut = buildReceiptBytes(order, { name: 'S' } as any, { autoCut: true });
    const nocut = buildReceiptBytes(order, { name: 'S' } as any, { autoCut: false });
    expect(cut.some((b, i) => b === 0x1d && cut[i + 1] === 0x56)).toBe(true);
    expect(nocut.some((b, i) => b === 0x1d && nocut[i + 1] === 0x56)).toBe(false);
  });

  it('Beep reaches the bytes', () => {
    const on = buildReceiptBytes(order, { name: 'S' } as any, { beep: true });
    const off = buildReceiptBytes(order, { name: 'S' } as any, { beep: false });
    const has = (b: number[]) => b.some((x, i) => x === 0x1b && b[i + 1] === 0x42);
    expect(has(on)).toBe(true);
    expect(has(off)).toBe(false);
  });

  it('Enabled is honoured when a role is resolved', () => {
    // A disabled printer must not be picked up by role mapping or detection.
    const roleCard = read('components/PrinterRoleMappingCard.tsx');
    expect(roleCard).toContain('enabled !== false');
    expect(read('printing/printerAutoDetect.ts')).toContain('enabled !== false');
  });
});

describe('removing the ESC/POS toggle did not delete anyone\'s intent', () => {
  beforeEach(() => localStorage.clear());

  it('folds a stored escposMode into Print Mode -> Raw', () => {
    const p = { ...defaultPrinterConfig(), escposMode: true, printMode: 'auto' as const };
    const [folded] = foldLegacyEscposMode([p]);
    expect(folded.printMode).toBe('raw');
  });

  it('leaves an explicit mode alone — that choice is newer and more specific', () => {
    const p = { ...defaultPrinterConfig(), escposMode: true, printMode: 'driver' as const };
    expect(foldLegacyEscposMode([p])[0].printMode).toBe('driver');
  });

  it('runs once, so a shop that later picks Auto keeps it', () => {
    const p = { ...defaultPrinterConfig(), escposMode: true, printMode: 'auto' as const };
    localStorage.setItem(PRINTERS_KEY, JSON.stringify({ printers: [p], deviceAssignments: {} }));
    expect(foldLegacyEscposMode([p])[0].printMode).toBe('raw');
    // Second pass: the shop has since chosen Auto again and must keep it.
    const after = { ...p, printMode: 'auto' as const };
    expect(foldLegacyEscposMode([after])[0].printMode).toBe('auto');
  });

  it('still honours the flag on a config that never met the migration', () => {
    // An old cloud copy or a restored backup can arrive carrying it.
    expect(resolvePrintMode({ printerConfig: { escposMode: true } })).toBe('raw');
    expect(resolvePrintMode({ printerConfig: { escposMode: true, printMode: 'driver' } })).toBe('driver');
    expect(resolvePrintMode({ printerConfig: { escposMode: false } })).toBe('auto');
  });
});

describe('Browser Backup stays gone', () => {
  it('is not offered as a switch', () => {
    expect(/Browser Backup/.test(panelCode)).toBe(false);
    expect(/browserBackup/.test(panelCode)).toBe(false);
  });

  it('and the silent path still refuses to open a dialog at the counter', () => {
    // The fallback it would have restored froze the till and reported success.
    const preview = read('components/ReceiptPreview.tsx');
    expect(preview).toContain('return { success: false, error: result.error');
    expect(/browserBackup/.test(stripComments(preview))).toBe(false);
  });
});
