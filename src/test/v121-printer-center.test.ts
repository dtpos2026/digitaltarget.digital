// ============================================================
// PRINTER CENTER — the navigation, and the routing it exists to expose.
//
// Two complaints, one screen:
//
//   "Printer Center me bohat scrolling hai" — thirteen cards stacked in one
//   column, so every setting was reached by scrolling past the others.
//
//   A printer could be added, detected and test-printed successfully, and
//   every real bill still queued as Pending. The print queue resolves its
//   target from the SHOP settings, and no screen ever wrote them.
//
// These tests pin that the modules stay reachable and that the role mapping
// writes the four fields the queue actually reads. They are source-level
// because the value here is structural: a card quietly dropped from the
// module list would be a card no shop can ever reach again.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const page = read('pages/PrintingCenterPage.tsx');
const roleCard = read('components/PrinterRoleMappingCard.tsx');

describe('module navigation', () => {
  it('reaches every card the single-column page used to stack (cloud: PrintingCenterPage)', () => {
    // The old page rendered these thirteen, in this order. Regrouping them is
    // the point; losing one is not.
    const CARDS = [
      'PrinterHealthCard',
      'FastBillingModeCard',
      'ReceiptTemplateCard',
      'PremiumTemplateGallery',
      'PrintMarginsCard',
      'SlipMarginsCard',
      'PrintAlignmentTestCard',
      'PrintQualityCard',
      'PrinterCalibrationPanel',
      'TestPrintCard',
      'TokenSettingsCard',
      'TokenRulesCard',
      'PrinterSettingsPanel',
    ];
    for (const c of CARDS) {
      expect(page.includes(`<${c} />`), `${c} is no longer reachable from Printer Center`).toBe(true);
    }
  });

  it('shows one module at a time rather than the whole stack', () => {
    // If every module rendered at once this would be the old page with a
    // decorative sidebar, and the scrolling complaint would stand.
    expect(/active\.render\(\)/.test(page)).toBe(true);
    expect(/MODULES\.map/.test(page)).toBe(true);
  });

  it('gives every module a distinct id, so the remembered one resolves', async () => {
    // Cloud: the module table lives in PrintingCenterPage as data, so this checks the real table, not its source text.
    const { MODULES } = await import('@/pages/PrintingCenterPage');
    const ids = MODULES.map(m => m.id);
    expect(ids.length).toBeGreaterThanOrEqual(11);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('survives a stored module id that no longer exists', async () => {
    // A release that renames a module must not leave the page blank.
    const { MODULES, resolveModule } = await import('@/pages/PrintingCenterPage');
    expect(resolveModule(null, 'a-module-from-an-older-release')).toBe(MODULES[0].id);
    expect(resolveModule('not-a-module', null)).toBe(MODULES[0].id);
    expect(resolveModule(null, MODULES[3].id)).toBe(MODULES[3].id);
    expect(resolveModule(MODULES[2].id, MODULES[3].id)).toBe(MODULES[2].id);
  });
});

describe('role mapping writes what the print queue reads', () => {
  it('covers all four role fields', () => {
    // printQueue.resolvePrinter() reads exactly these.
    for (const field of ['defaultPrinter', 'kotPrinter', 'tokenPrinter', 'backupPrinter']) {
      expect(roleCard.includes(field), `role mapping does not offer ${field}`).toBe(true);
    }
  });

  it('persists through saveSettings rather than only into local state', () => {
    expect(/saveSettings\(\{/.test(roleCard)).toBe(true);
  });

  it('keeps a saved name that is no longer installed selectable', () => {
    // Silently re-routing a shop's printing because a printer was switched off
    // would be worse than showing them a name that is currently missing.
    expect(/not installed/.test(roleCard)).toBe(true);
  });

  it('warns when nothing is routed for customer bills', () => {
    // This is the exact state that produced "every bill is Pending".
    expect(/queue as Pending/.test(roleCard)).toBe(true);
  });
});
