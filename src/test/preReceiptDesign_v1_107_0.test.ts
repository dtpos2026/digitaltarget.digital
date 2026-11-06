// v1.107.0 — a saved receipt design name must always lead to a receipt that prints ("pre-receipt" printed blank).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_RECEIPT_DESIGNS, DEFAULT_RECEIPT_DESIGN, resolveReceiptDesign } from '@/lib/receiptDesign';
import { isPremiumTemplateId } from '@/lib/premiumReceiptTemplates';

describe('resolveReceiptDesign', () => {
  it('pre-receipt (the old name of the plain bill) is the Standard bill', () => {
    expect(resolveReceiptDesign('pre-receipt')).toBe('standard');
  });
  it('an unknown, empty or wrong-typed name falls back to the default, never to nothing', () => {
    for (const v of ['', undefined, null, 42, 'no-such-design', 'PRE-RECEIPT', {}]) {
      expect(resolveReceiptDesign(v)).toBe(DEFAULT_RECEIPT_DESIGN);
    }
  });
  it('keeps every design the receipt really draws', () => {
    for (const d of BUILT_IN_RECEIPT_DESIGNS) expect(resolveReceiptDesign(d)).toBe(d);
  });
  it('keeps the premium templates', () => {
    const ids = [...readFileSync('src/lib/premiumReceiptTemplates.ts', 'utf8').matchAll(/id:\s*'(premium-[a-z-]+)'/g)].map(m => m[1]);
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) {
      expect(isPremiumTemplateId(id)).toBe(true);
      expect(resolveReceiptDesign(id)).toBe(id);
    }
  });
});

describe('every design the app can save is still recognised', () => {
  const idsIn = (file: string) => [...readFileSync(file, 'utf8').matchAll(/\bid:\s*'([a-z0-9-]+)'/g)].map(m => m[1]);
  it('the choices in Settings → Receipt', () => {
    const ids = idsIn('src/components/settings/ReceiptSettingsTab.tsx');
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) expect(resolveReceiptDesign(id), id).toBe(id);
  });
  it('the paper presets in Settings', () => {
    const designs = [...readFileSync('src/pages/SettingsPage.tsx', 'utf8').matchAll(/receiptDesign:\s*'([a-z0-9-]+)'/g)].map(m => m[1]);
    expect(designs.length).toBeGreaterThan(2);
    for (const d of designs) expect(resolveReceiptDesign(d), d).toBe(d);
  });
  it('the printer-setup presets', () => {
    const designs = [...readFileSync('src/components/settings/PrinterSettingsTab.tsx', 'utf8').matchAll(/receiptDesign:\s*'([a-z0-9-]+)'/g)].map(m => m[1]);
    for (const d of designs) expect(resolveReceiptDesign(d), d).toBe(d);
  });
});

describe('the receipt uses it', () => {
  it('ReceiptPreview resolves the saved name before choosing what to draw, and the settings tab marks the same one', () => {
    expect(readFileSync('src/components/ReceiptPreview.tsx', 'utf8')).toContain('const design = resolveReceiptDesign(settings.receiptDesign);');
    expect(readFileSync('src/components/settings/ReceiptSettingsTab.tsx', 'utf8')).toContain('resolveReceiptDesign(settings.receiptDesign) === d.id');
  });
  it('every design name in the settings type is either drawn or an alias', () => {
    const union = readFileSync('src/lib/types.ts', 'utf8').match(/receiptDesign\?:\s*([^;\n]+)/)![1];
    const names = [...union.matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]);
    for (const n of names) {
      const r = resolveReceiptDesign(n);
      expect(r === n || n === 'pre-receipt', n).toBe(true);
    }
  });
});
