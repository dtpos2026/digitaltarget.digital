// ============================================================
// THIS MACHINE'S SETUP, IN ONE FILE.
//
// A counter's settings are deliberately device-local: printer margins, the
// role each printer plays, print mode, paper profile, display templates, the
// announcement voice and output, the alignment calibration. That is correct —
// one till's paper and cutter are not another's, and these must never sync
// between machines.
//
// It is also why a dead PC costs a day. Every one of those numbers was found
// by somebody standing at a printer with a ruler, and none of it lives
// anywhere else. Re-deriving Left 3 / Right 5 on a replacement machine is an
// evening the shop should not have to spend twice.
//
// So: one JSON file that carries the lot, exported from Settings and imported
// on the new machine.
//
// What it deliberately does NOT carry
// -----------------------------------
// Sales, orders, customers, staff, licence keys. This is the machine's
// SETUP, not the shop's data — those have their own backup, and mixing them
// would make a settings file something you cannot safely hand to anybody.
// ============================================================

/**
 * The device-local keys that make up a machine's setup.
 *
 * Listed explicitly rather than swept up by prefix. A prefix match would
 * quietly start exporting whatever a future release happens to store under
 * the same naming — including something that should not leave the machine.
 * Adding a key here is a decision, which is the point.
 */
export const SETUP_KEYS: Array<{ key: string; what: string }> = [
  // --- printing geometry, the expensive part to re-derive ---
  { key: 'dtpos-print-margins', what: 'This device’s print margins' },
  { key: 'dtpos-slip-margins-v1', what: 'Per-slip margins (receipt, KOT, token, report)' },
  { key: 'dtpos-printer-settings-v1', what: 'Printers: names, roles, paper, margins, mode' },
  { key: 'dtpos-print-quality', what: 'Print darkness and boldness' },
  { key: 'dtpos-printer-calibration', what: 'Printer calibration' },
  { key: 'pos-default-printer', what: 'Fallback printer name' },

  // --- the screens ---
  { key: 'dtpos-customer-display-v1', what: 'Customer Display: design, split, banners, voice' },
  { key: 'dtpos-kitchen-display-v1', what: 'Kitchen Display: design and columns' },
  { key: 'dtpos-announce-output-v1', what: 'Which output the announcement chime uses' },
  { key: 'dtpos-screen-layouts', what: 'POS layout saved for each screen size' },

  // --- small conveniences worth keeping ---
  { key: 'dtpos-print-server-enabled', what: 'Print server role for this device' },
  { key: 'dtpos-printer-center-module', what: 'Last Printer Center module' },
  { key: 'desi-pos-zoom', what: 'Screen zoom' },
  { key: 'pos-sidebar-collapsed', what: 'Sidebar state' },
];

/**
 * Migration flags.
 *
 * Carried so an imported machine is not re-migrated on top of settings that
 * are already correct — a safe-inset top-up running again over a shop's own
 * calibration would undo the very thing this file exists to preserve.
 */
const FLAG_KEYS = [
  'dtpos-print-geometry-v5',
  'dtpos-print-safe-inset-v6',
  'dtpos-printer-margins-equalised-v1',
  'dtpos-printer-safe-inset-v1',
  'dtpos-printer-escpos-folded-v1',
];

export const SETUP_FORMAT = 'dtpos-machine-setup';
export const SETUP_VERSION = 1;

export interface MachineSetup {
  format: typeof SETUP_FORMAT;
  version: number;
  exportedAt: string;
  appVersion?: string;
  /** Free text the shop can put on it, e.g. "Counter 1 — FIT FP-1100". */
  note?: string;
  values: Record<string, string>;
  flags: Record<string, string>;
}

export function exportMachineSetup(note?: string, appVersion?: string): MachineSetup {
  const values: Record<string, string> = {};
  for (const { key } of SETUP_KEYS) {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) values[key] = v;
    } catch { /* a key we cannot read is a key we do not export */ }
  }
  const flags: Record<string, string> = {};
  for (const key of FLAG_KEYS) {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) flags[key] = v;
    } catch { /* same */ }
  }
  return {
    format: SETUP_FORMAT,
    version: SETUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    note,
    values,
    flags,
  };
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  /** Settings actually written. */
  applied: string[];
  /** Keys in the file this build does not know about. */
  skipped: string[];
}

/**
 * Apply a setup file to this machine.
 *
 * Only the keys this build knows are written. An unknown key is reported
 * rather than stored: a file from a newer release may carry settings this one
 * would misread, and half-applying it is how a machine ends up in a state
 * nobody can reason about.
 */
export function importMachineSetup(raw: unknown): ImportResult {
  let doc: MachineSetup;
  try {
    doc = (typeof raw === 'string' ? JSON.parse(raw) : raw) as MachineSetup;
  } catch (e: any) {
    return { ok: false, error: 'That file is not readable JSON.', applied: [], skipped: [] };
  }
  if (!doc || doc.format !== SETUP_FORMAT) {
    return { ok: false, error: 'That is not a DT POS machine setup file.', applied: [], skipped: [] };
  }
  if (Number(doc.version) > SETUP_VERSION) {
    return {
      ok: false,
      applied: [], skipped: [],
      error: `That file was written by a newer version of DT POS (setup v${doc.version}). Update this machine first.`,
    };
  }

  const known = new Set(SETUP_KEYS.map(k => k.key));
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const [key, value] of Object.entries(doc.values || {})) {
    if (!known.has(key)) { skipped.push(key); continue; }
    try {
      localStorage.setItem(key, String(value));
      applied.push(key);
    } catch (e: any) {
      return {
        ok: false,
        applied, skipped,
        error: `Could not write ${key}: ${e?.message || e}. Some settings were applied; re-run the import after freeing storage.`,
      };
    }
  }

  // Flags last: if a write above failed we do not want the machine marked as
  // migrated over settings that never landed.
  for (const [key, value] of Object.entries(doc.flags || {})) {
    if (!FLAG_KEYS.includes(key)) continue;
    try { localStorage.setItem(key, String(value)); } catch { /* not fatal */ }
  }

  // Everything that listens for a settings change should re-read now.
  for (const evt of ['dtpos-printer-settings-changed', 'dtpos-print-margins-changed',
                     'dtpos-customer-display-changed', 'dtpos-kitchen-display-changed']) {
    try { window.dispatchEvent(new CustomEvent(evt)); } catch { /* no window */ }
  }

  return { ok: true, applied, skipped };
}

/** A filename a shop can recognise a year later. */
export function setupFileName(shopName?: string): string {
  const shop = String(shopName || 'DT-POS').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const day = new Date().toISOString().slice(0, 10);
  return `${shop}-machine-setup-${day}.json`;
}
