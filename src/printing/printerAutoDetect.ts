// ============================================================
// PRINTER AUTO-DETECTION — the printer is ready before the first bill.
//
// The fault this exists to remove
// -------------------------------
// The expected morning at a shop is: PC on, printer on, POS open, print. What
// happened instead was: PC on, printer on, POS open, take an order, pay — and
// the bill sat in Pending, every day, until somebody opened Printer Center and
// pressed Detect and then Save. Nothing was broken in the print path; the
// print path was simply never told which device to use.
//
// Three separate ways a shop ended up there:
//
//   1. Nothing configured at all. A fresh install has no printer in Printer
//      Center, so every job resolves to no target and fails.
//   2. Configured, but the Windows device name moved. A driver reinstall
//      renames "POS-80" to "POS-80 (Copy 1)"; an RDP session adds
//      "(redirected 2)". The saved name stops matching and the job is sent to
//      a device that is not there.
//   3. Configured in Printer Center, but the shop-level settings that the
//      print QUEUE reads (defaultPrinter / kotPrinter) were still empty, so
//      the queue had no target even though Printer Center looked correct.
//
// All three are detectable at startup from the list Windows already gives us,
// and all three are repaired here without asking anyone. It runs once per app
// start, writes only when something actually changed, and never overrules a
// printer the shop picked by hand: an existing name that still matches an
// installed device is left exactly alone.
//
// What it will NOT do
// -------------------
// Invent hardware. If Windows reports no printers, this reports that it found
// none and changes nothing. A POS that pretends a printer exists is worse than
// one that says there is not.
// ============================================================
import { getPrinters, isElectron } from '@/lib/electron';
import { matchPrinter } from './printerMatch';
import { detectPrinterBrand, applyPreset } from '@/lib/printerPresets';
import {
  loadPrinterSettings,
  savePrinterSettings,
  defaultPrinterConfig,
  safeMarginsFor,
  type PrinterConfig,
} from '@/lib/printerSettings';
import { getSettings, saveSettings } from '@/lib/store';

export interface AutoDetectResult {
  /** Did the pass run at all? False in the browser build. */
  ran: boolean;
  /** Installed printers Windows reported. */
  found: number;
  /** A printer config was created because there was none. */
  created?: string;
  /** Saved names that were re-pointed at their real Windows device. */
  relinked: Array<{ from: string; to: string; stage: string }>;
  /** Shop-level role settings that were filled in. */
  filledRoles: string[];
  /** Human-readable summary, safe to show in a toast. */
  message: string;
}

const EMPTY: AutoDetectResult = {
  ran: false, found: 0, relinked: [], filledRoles: [],
  message: 'Printer detection runs in the desktop app.',
};

/** The printer Windows itself considers default, else the first one listed. */
function preferredDevice<T extends { isDefault?: boolean }>(list: T[]): T | undefined {
  return list.find(p => p.isDefault) || list[0];
}

/**
 * Bring this machine's printer configuration in line with what is actually
 * installed.
 *
 * Safe to call more than once; it is a repair pass, not an installer.
 */
export async function autoDetectPrinters(): Promise<AutoDetectResult> {
  if (!isElectron()) return { ...EMPTY };

  let list: Array<{ name?: string; displayName?: string; isDefault?: boolean; driverName?: string }> = [];
  try {
    list = await getPrinters();
  } catch (e: any) {
    return {
      ran: true, found: 0, relinked: [], filledRoles: [],
      message: `Windows did not answer the printer query: ${e?.message || e}`,
    };
  }

  const result: AutoDetectResult = {
    ran: true, found: list.length, relinked: [], filledRoles: [], message: '',
  };

  if (list.length === 0) {
    result.message = 'No printer is installed in Windows. Install the printer driver, then open Printer Center.';
    return result;
  }

  const doc = await loadPrinterSettings();
  let printers: PrinterConfig[] = Array.isArray(doc.printers) ? [...doc.printers] : [];
  let printersChanged = false;

  // ---- 1. Nothing configured: adopt the Windows default printer ----------
  if (printers.length === 0) {
    const device = preferredDevice(list);
    const name = String(device?.name || '').trim();
    if (name) {
      let cfg = defaultPrinterConfig();
      cfg = {
        ...cfg,
        name: name,
        printerName: name,
        role: 'counter',
        enabled: true,
      };
      // Brand presets carry the paper size and the driver mode that model
      // actually works with — the same detection the Add Printer screen runs,
      // so an auto-added printer is configured exactly as a hand-added one.
      const preset = detectPrinterBrand(name, device?.driverName);
      if (preset) {
        cfg = applyPreset(cfg, preset);
        // Re-base the margins on the roll the preset just chose, or an 80mm
        // inset would be carried onto 58mm paper.
        const safe = safeMarginsFor(cfg.paperSize);
        cfg = { ...cfg, leftMarginMm: safe, rightMarginMm: safe };
      }
      printers = [cfg];
      printersChanged = true;
      result.created = name;
    }
  }

  // ---- 2. Re-point saved names that no longer match exactly ---------------
  printers = printers.map((p) => {
    if ((p.connection || 'system') !== 'system') return p;
    const saved = String(p.printerName || '').trim();

    // Never configured: give it the machine's default printer rather than
    // leaving a config that can only fail.
    if (!saved) {
      const name = String(preferredDevice(list)?.name || '').trim();
      if (!name) return p;
      printersChanged = true;
      result.relinked.push({ from: '(not set)', to: name, stage: 'default' });
      return { ...p, printerName: name };
    }

    const m = matchPrinter(saved, list);
    if (!m.printer) return p;              // genuinely absent — say so elsewhere, do not guess
    if (m.stage === 'exact') return p;     // already correct
    if (!m.name || m.name === saved) return p;

    // A tolerant match found the device under a different spelling. Writing
    // the real name back means the print path stops relying on the fuzzy
    // match every single job.
    printersChanged = true;
    result.relinked.push({ from: saved, to: m.name, stage: m.stage });
    return { ...p, printerName: m.name };
  });

  if (printersChanged) {
    await savePrinterSettings({ ...doc, printers });
  }

  // ---- 3. Fill the shop-level role targets the print QUEUE reads ----------
  // printQueue.resolvePrinter() reads these, not the Printer Center list. A
  // machine with a perfectly good printer configured but an empty
  // defaultPrinter queues every bill and prints none of them.
  const installed = (name: string) => matchPrinter(name, list).printer !== null;
  const counter = printers.find(p => p.role === 'counter' && p.enabled !== false && p.printerName)
    || printers.find(p => p.enabled !== false && p.printerName);
  const kitchen = printers.find(p => p.role === 'kitchen' && p.enabled !== false && p.printerName);

  const settings = getSettings();
  const patch: Record<string, string> = {};
  const wanted: Array<[keyof typeof settings & string, string | undefined]> = [
    ['defaultPrinter', counter?.printerName],
    ['kotPrinter', kitchen?.printerName || counter?.printerName],
  ];
  for (const [key, value] of wanted) {
    if (!value) continue;
    const current = String((settings as any)[key] || '').trim();
    // Fill an empty setting, and replace one that points at a printer Windows
    // no longer has. A setting that still resolves is the shop's choice.
    if (!current || !installed(current)) {
      patch[key] = value;
      result.filledRoles.push(key);
    }
  }
  // A shop-level name that only resolves by a tolerant match ("… (Copy 1)",
  // different spacing or case) is re-pointed at the exact Windows name, the
  // same as the Printer Center list above. Left as it was, every slip that
  // used it depended on the fuzzy match — and the image route did not have
  // one, which is what made shops re-detect their printer again and again.
  const exactName = (name: string): string | null => {
    const m = matchPrinter(name, list);
    return m.printer && m.stage !== 'exact' && m.name && m.name !== name ? m.name : null;
  };
  for (const key of ['defaultPrinter', 'kotPrinter', 'tokenPrinter', 'backupPrinter'] as const) {
    const current = String((patch as any)[key] ?? (settings as any)[key] ?? '').trim();
    const to = current ? exactName(current) : null;
    if (to) {
      patch[key] = to;
      result.relinked.push({ from: current, to, stage: 'shop setting' });
    }
  }
  const stations = (settings as any).stationPrinters as Record<string, string> | undefined;
  let stationPatch: Record<string, string> | null = null;
  for (const [station, name] of Object.entries(stations || {})) {
    const to = name ? exactName(String(name)) : null;
    if (to) {
      stationPatch = { ...(stationPatch || stations), [station]: to };
      result.relinked.push({ from: String(name), to, stage: `station ${station}` });
    }
  }
  if (Object.keys(patch).length || stationPatch) {
    saveSettings({ ...settings, ...patch, ...(stationPatch ? { stationPrinters: stationPatch } : {}) } as typeof settings);
  }

  result.message = describe(result);
  return result;
}

function describe(r: AutoDetectResult): string {
  const parts: string[] = [];
  if (r.created) parts.push(`Added "${r.created}" from Windows`);
  if (r.relinked.length) {
    parts.push(r.relinked.length === 1
      ? `Re-linked "${r.relinked[0].from}" to "${r.relinked[0].to}"`
      : `Re-linked ${r.relinked.length} printers to their current Windows names`);
  }
  if (r.filledRoles.length) parts.push('Set the printer used for billing');
  if (!parts.length) return `${r.found} printer(s) installed — configuration already correct.`;
  return `${parts.join('. ')}. Ready to print.`;
}

// ---- startup hook ---------------------------------------------------------
// Runs once per app start. Deliberately fire-and-forget: a slow or hostile
// Windows spooler must never delay the POS from opening, and the print paths
// all work from the saved configuration regardless of whether this finished.
let started = false;

export function autoDetectPrintersOnStartup(): void {
  if (started) return;
  started = true;
  void autoDetectPrinters()
    .then((r) => {
      if (!r.ran) return;
      try { console.log('%c[DT-Print]', 'color:#0ea5e9;font-weight:700', 'startup detection —', r.message); } catch { /* no console */ }
      if (r.created || r.relinked.length || r.filledRoles.length) {
        try { window.dispatchEvent(new CustomEvent('dtpos-printer-autodetect', { detail: r })); } catch { /* no window */ }
      }
    })
    .catch(() => { /* detection is best-effort; printing still works from saved settings */ });
}

/** Test seam: forget that startup detection already ran. */
export function resetAutoDetectForTests(): void {
  started = false;
}
