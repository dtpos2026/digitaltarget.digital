// ============================================================
// LOCAL, per-device printer settings.
//
// Kyun alag? Firebase me printer settings save karne se ek cashier
// ki printer choice doosre PC pe apply ho jati thi jahan wo printer
// installed hi nahi hota — printing break ho jati thi.
//
// Ab printer selection, margins, silent-print flag etc HAMESHA
// local storage me save hote hain (browser: localStorage,
// Electron/Windows: additionally mirrored to AppData JSON file).
//
// Firebase me sirf restaurant-wide POLICY save hoti hai
// (see printerSettings.ts + Settings.kotUpdateMode).
// ============================================================
import { getTenantId, getDeviceId } from './tenant';

export type LocalPaperSize = '58mm' | '80mm' | 'A4';

export interface LocalPrinterConfig {
  printerName: string;
  paperSize: LocalPaperSize;
  leftMarginMm: number;
  rightMarginMm: number;
  topMarginMm: number;
  bottomMarginMm: number;
  feedLines: number;
  autoCut: boolean;
  copies: number;
  enabled: boolean;
}

export interface LocalPrinterSettings {
  deviceId: string;
  receipt: LocalPrinterConfig;
  kot: LocalPrinterConfig;
  rider?: LocalPrinterConfig;
  silentPrint: boolean;
  updatedAt: number;
}

function defaultCfg(): LocalPrinterConfig {
  return {
    printerName: '',
    paperSize: '80mm',
    leftMarginMm: 3,
    rightMarginMm: 3,
    topMarginMm: 0,
    bottomMarginMm: 0,
    feedLines: 3,
    autoCut: true,
    copies: 1,
    enabled: true,
  };
}

function defaults(): LocalPrinterSettings {
  return {
    deviceId: getDeviceId(),
    receipt: defaultCfg(),
    kot: { ...defaultCfg(), paperSize: '80mm' },
    rider: { ...defaultCfg(), paperSize: '80mm', enabled: false },
    silentPrint: true,
    updatedAt: 0,
  };
}

function storageKey(): string {
  const tid = getTenantId() || 'anon';
  const did = getDeviceId();
  return `dtpos_printer_settings_${tid}_${did}`;
}

const CHANGE_EVT = 'dtpos-local-printer-changed';

export function getLocalPrinterSettings(): LocalPrinterSettings {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalPrinterSettings>;
      // merge with defaults so new fields don't break
      const d = defaults();
      return {
        ...d,
        ...parsed,
        receipt: { ...d.receipt, ...(parsed.receipt || {}) } as LocalPrinterConfig,
        kot: { ...d.kot, ...(parsed.kot || {}) } as LocalPrinterConfig,
        rider: { ...d.rider, ...(parsed.rider || {}) } as LocalPrinterConfig,
      };
    }
  } catch {}
  return defaults();
}

export function saveLocalPrinterSettings(next: LocalPrinterSettings): void {
  const withStamp: LocalPrinterSettings = { ...next, deviceId: getDeviceId(), updatedAt: Date.now() };
  try {
    localStorage.setItem(storageKey(), JSON.stringify(withStamp));
  } catch {}
  // Electron: mirror to AppData JSON file (best-effort; ignore if API missing)
  try {
    const api: any = typeof window !== 'undefined' ? (window as any).electronAPI : null;
    if (api?.writeFile && api?.getDataPath) {
      // Fire-and-forget — file is only a mirror; localStorage is source of truth for UI.
      Promise.resolve(api.getDataPath()).then((base: string) => {
        if (!base) return;
        const path = `${base}/printer-settings.json`;
        api.writeFile(path, JSON.stringify(withStamp, null, 2));
      }).catch(() => {});
    }
  } catch {}
  try { window.dispatchEvent(new CustomEvent(CHANGE_EVT, { detail: withStamp })); } catch {}
}

export function subscribeLocalPrinterSettings(cb: (s: LocalPrinterSettings) => void): () => void {
  const handler = () => cb(getLocalPrinterSettings());
  window.addEventListener(CHANGE_EVT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(CHANGE_EVT, handler);
    window.removeEventListener('storage', handler);
  };
}

/** Fetch installed printers from Electron (empty in browser). */
export async function listInstalledPrinters(): Promise<{ name: string }[]> {
  try {
    const api: any = typeof window !== 'undefined' ? (window as any).electronAPI : null;
    if (api?.getPrinters) {
      const list = await api.getPrinters();
      return Array.isArray(list) ? list : [];
    }
  } catch {}
  return [];
}

/** Resolve local printer for a role. Returns undefined if unset. */
export function resolveLocalPrinterForRole(role: 'receipt' | 'kot' | 'rider'): LocalPrinterConfig | undefined {
  const s = getLocalPrinterSettings();
  const cfg = role === 'receipt' ? s.receipt : role === 'kot' ? s.kot : s.rider;
  if (!cfg || !cfg.enabled || !cfg.printerName) return undefined;
  return cfg;
}

/** True if this device is running inside the Electron desktop app. */
export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI;
}
