// ============================================================
// PRINTER AUTO-DETECTION — "why is every bill in Pending?"
//
// The shop's morning was: PC on, printer on, POS open, take an order, pay —
// and the bill queued as Pending. Every day, until somebody opened Printer
// Center and pressed Detect and then Save. Nothing in the print path was
// broken; it was simply never told which device to use.
//
// These tests pin the three ways a machine reached that state, and the one
// thing detection must never do: invent a printer that is not there.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

const listed: any[] = [];
const savedSettings: any[] = [];
let shopSettings: any = {};

vi.mock('@/lib/electron', () => ({
  isElectron: () => true,
  getPrinters: async () => listed,
}));

vi.mock('@/lib/store', () => ({
  getSettings: () => shopSettings,
  saveSettings: (s: any) => { shopSettings = s; savedSettings.push(s); },
}));

async function fresh() {
  vi.resetModules();
  return import('@/printing/printerAutoDetect');
}

const PRINTERS_KEY = 'dtpos-printer-settings-v1';

function storedPrinters(): any[] {
  const raw = localStorage.getItem(PRINTERS_KEY);
  return raw ? (JSON.parse(raw).printers || []) : [];
}

function seedPrinter(p: Record<string, unknown>) {
  localStorage.setItem(PRINTERS_KEY, JSON.stringify({
    printers: [{
      id: 'p1', name: 'Counter', connection: 'system', printerName: '',
      role: 'counter', paperSize: '80mm', leftMarginMm: 2, rightMarginMm: 2,
      topFeedMm: 0, bottomFeedMm: 0, autoCut: true, beep: false, copies: 1,
      escposMode: false, browserBackup: true, enabled: true, ...p,
    }],
    deviceAssignments: {},
  }));
  // The margin migrations run on read and would otherwise rewrite the seed.
  localStorage.setItem('dtpos-printer-margins-equalised-v1', '1');
  localStorage.setItem('dtpos-printer-safe-inset-v1', '1');
}

beforeEach(() => {
  localStorage.clear();
  listed.length = 0;
  savedSettings.length = 0;
  shopSettings = {};
});

describe('a fresh machine with nothing configured', () => {
  it('adopts the Windows default printer instead of leaving the queue blind', async () => {
    listed.push(
      { name: 'Microsoft Print to PDF' },
      { name: 'XP-80C', isDefault: true, driverName: 'Xprinter XP-80C' },
    );
    const { autoDetectPrinters } = await fresh();
    const r = await autoDetectPrinters();

    expect(r.created).toBe('XP-80C');
    const saved = storedPrinters();
    expect(saved).toHaveLength(1);
    expect(saved[0].printerName).toBe('XP-80C');
    expect(saved[0].role).toBe('counter');
    // The brand preset that the Add Printer screen would have applied.
    expect(saved[0].paperSize).toBe('80mm');
  });

  it('gives the adopted printer the safe inset for the roll the preset chose', async () => {
    // An 80mm inset carried onto 58mm paper would eat two characters a side.
    listed.push({ name: 'RP58', isDefault: true, driverName: 'RP58 Thermal' });
    const { autoDetectPrinters } = await fresh();
    await autoDetectPrinters();

    const p = storedPrinters()[0];
    const expected = p.paperSize === '58mm' ? 1.5 : 2;
    expect(p.leftMarginMm).toBe(expected);
    expect(p.rightMarginMm).toBe(expected);
  });
});

describe('a printer Windows renamed underneath us', () => {
  it('re-points the saved name at the device that is really installed', async () => {
    // A driver reinstall turns "POS-80" into "POS-80 (Copy 1)". The saved name
    // stops matching, the job goes to a device that is not there, and the bill
    // queues — with a printer sitting right there, powered on.
    seedPrinter({ printerName: 'POS-80' });
    listed.push({ name: 'POS-80 (Copy 1)' });

    const { autoDetectPrinters } = await fresh();
    const r = await autoDetectPrinters();

    expect(r.relinked).toHaveLength(1);
    expect(r.relinked[0]).toMatchObject({ from: 'POS-80', to: 'POS-80 (Copy 1)' });
    expect(storedPrinters()[0].printerName).toBe('POS-80 (Copy 1)');
  });

  it('leaves a name that still matches exactly alone', async () => {
    seedPrinter({ printerName: 'POS-80' });
    listed.push({ name: 'POS-80' });

    const { autoDetectPrinters } = await fresh();
    const r = await autoDetectPrinters();

    expect(r.relinked).toHaveLength(0);
    expect(r.created).toBeUndefined();
  });

  it('does not touch a LAN printer, which has no Windows device name at all', async () => {
    seedPrinter({ connection: 'lan', lanHost: '192.168.1.50', printerName: '' });
    listed.push({ name: 'POS-80', isDefault: true });

    const { autoDetectPrinters } = await fresh();
    await autoDetectPrinters();

    expect(storedPrinters()[0].printerName).toBe('');
    expect(storedPrinters()[0].lanHost).toBe('192.168.1.50');
  });
});

describe('the settings the print queue actually reads', () => {
  it('fills an empty defaultPrinter, which is what left bills in Pending', async () => {
    // Printer Center looked correct and printing still did not happen:
    // printQueue resolves its target from the SHOP settings, not from the
    // printer list, and those were never written.
    seedPrinter({ printerName: 'POS-80' });
    listed.push({ name: 'POS-80' });

    const { autoDetectPrinters } = await fresh();
    const r = await autoDetectPrinters();

    expect(r.filledRoles).toContain('defaultPrinter');
    expect(shopSettings.defaultPrinter).toBe('POS-80');
    expect(shopSettings.kotPrinter).toBe('POS-80');
  });

  it('replaces a target that points at a printer Windows no longer has', async () => {
    seedPrinter({ printerName: 'POS-80' });
    listed.push({ name: 'POS-80' });
    shopSettings = { defaultPrinter: 'Old Printer That Was Removed' };

    const { autoDetectPrinters } = await fresh();
    await autoDetectPrinters();

    expect(shopSettings.defaultPrinter).toBe('POS-80');
  });

  it('keeps a target the shop chose that still resolves', async () => {
    // Two printers installed and the shop picked the second one. Detection has
    // no business overriding that.
    seedPrinter({ printerName: 'POS-80' });
    listed.push({ name: 'POS-80' }, { name: 'Kitchen-58' });
    shopSettings = { defaultPrinter: 'Kitchen-58' };

    const { autoDetectPrinters } = await fresh();
    await autoDetectPrinters();

    expect(shopSettings.defaultPrinter).toBe('Kitchen-58');
  });
});

describe('when there is nothing to detect', () => {
  it('says so and changes nothing, rather than inventing a printer', async () => {
    const { autoDetectPrinters } = await fresh();
    const r = await autoDetectPrinters();

    expect(r.found).toBe(0);
    expect(r.created).toBeUndefined();
    expect(r.message).toMatch(/no printer is installed/i);
    expect(storedPrinters()).toHaveLength(0);
    expect(savedSettings).toHaveLength(0);
  });
});

describe('the startup hook', () => {
  it('runs once per app start and never throws into the boot path', async () => {
    listed.push({ name: 'POS-80', isDefault: true });
    const { autoDetectPrintersOnStartup } = await fresh();

    expect(() => {
      autoDetectPrintersOnStartup();
      autoDetectPrintersOnStartup();
    }).not.toThrow();

    await new Promise(r => setTimeout(r, 20));
    // One adoption, not two: a second pass must not create a duplicate.
    expect(storedPrinters()).toHaveLength(1);
  });
});
