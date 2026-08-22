import { firestoreUnavailable } from './legacyFirebaseGuard';
// ============================================================
// Restaurant-level printer settings.
// Stored at: tenants/{tid}/meta/printers
// (kept in Firestore so EXE on any machine reads same config; each
//  machine can override with a local "active printer mapping").
// ============================================================
import { doc, getDoc, setDoc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { fbDb, isFirebaseConfigured } from './firebase';
import { getTenantId, getDeviceId } from './tenant';
import type { CloudPrintRole } from './cloudPrintJobs';
import { SYNC_PRINTER_SETTINGS_TO_CLOUD } from './featureFlags';
import { localDb } from './localDb';
import { MAX_TOP_MARGIN_MM } from './thermal-print';

export type PrinterConnection = 'system' | 'lan' | 'bluetooth';

export interface PrinterConfig {
  id: string;
  name: string;                 // friendly label
  connection: PrinterConnection; // system (Windows installed) | lan (network IP) | bluetooth
  printerName: string;          // exact Windows printer device name (for system)
  // LAN / network printer (ESC/POS over TCP — usually port 9100)
  lanHost?: string;             // e.g. 192.168.1.50
  lanPort?: number;             // default 9100
  role: CloudPrintRole;         // counter | kitchen | delivery | display
  paperSize: '58mm' | '80mm';
  printWidthMm?: number;        // optional override
  leftMarginMm: number;
  rightMarginMm: number;
  topFeedMm: number;
  bottomFeedMm: number;
  autoCut: boolean;
  beep: boolean;
  copies: number;
  escposMode: boolean;          // ESC/POS raw mode (forced ON for LAN)
  browserBackup: boolean;       // allow browser fallback when EXE offline
  enabled: boolean;
}

export interface PrinterSettingsDoc {
  printers: PrinterConfig[];
  // device assignment override: deviceId -> which printer to use for each role
  deviceAssignments?: Record<string, Partial<Record<CloudPrintRole, string>>>;
  updatedAt?: any;
}

const EMPTY: PrinterSettingsDoc = { printers: [], deviceAssignments: {} };

// ===== LOCAL-FIRST STORAGE (per-device) =====
// When SYNC_PRINTER_SETTINGS_TO_CLOUD is false (default), printer settings
// are read/written ONLY per-device. Prevents one cashier's printer choice
// from overwriting another's. Cloud paths below remain intact as fallback.
const LOCAL_EVT = 'dtpos-printer-settings-local-changed';
function localKey(): string {
  const tid = getTenantId() || 'anon';
  const did = getDeviceId() || 'dev';
  return `dtpos-printer-settings-${tid}-${did}`;
}
// v1.5.0 self-heal: correct any printer profile that has a runaway top-feed
// value already saved (the historical cause of "too much blank paper before
// the receipt") the moment it's read — the restaurant does not have to find
// and fix the setting manually. See src/lib/thermal-print.ts for the ceiling.
function healTopFeed(doc: PrinterSettingsDoc): PrinterSettingsDoc {
  try {
    let changed = false;
    const printers = (doc.printers || []).map(p => {
      if (typeof p.topFeedMm === 'number' && p.topFeedMm > MAX_TOP_MARGIN_MM) {
        changed = true;
        return { ...p, topFeedMm: MAX_TOP_MARGIN_MM };
      }
      return p;
    });
    if (changed) {
      const healed = { ...doc, printers };
      writeLocalSync(healed);
      console.warn('[printer-settings] self-healed an oversized Top Feed value');
      return healed;
    }
  } catch { /* thermal-print not loadable in this context — skip healing */ }
  return doc;
}

function readLocalSync(): PrinterSettingsDoc {
  try {
    const raw = localStorage.getItem(localKey());
    if (!raw) return EMPTY;
    const data = JSON.parse(raw) as PrinterSettingsDoc;
    return healTopFeed({ printers: data.printers || [], deviceAssignments: data.deviceAssignments || {} });
  } catch { return EMPTY; }
}
function writeLocalSync(data: PrinterSettingsDoc) {
  try {
    localStorage.setItem(localKey(), JSON.stringify(data));
    // Mirror into localDb (best-effort, non-blocking) for durable per-tenant storage.
    try {
      if (getTenantId()) {
        localDb.putRow('settings', {
          id: `printer_settings_${getDeviceId() || 'dev'}`,
          ...data,
          updatedAt: Date.now(),
        } as any).catch(() => {});
      }
    } catch {}
    window.dispatchEvent(new CustomEvent(LOCAL_EVT));
  } catch {}
}

function ref() {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant');
  return doc(fbDb(), 'tenants', tid, 'meta', 'printers');
}

export async function loadPrinterSettings(): Promise<PrinterSettingsDoc> {
  // Local-first path (default). Cloud read below is preserved as fallback.
  if (!SYNC_PRINTER_SETTINGS_TO_CLOUD) {
    return readLocalSync();
  }
  if (!isFirebaseConfigured() || !getTenantId()) return EMPTY;
  const snap = await getDoc(ref());
  if (!snap.exists()) return EMPTY;
  const data = snap.data() as PrinterSettingsDoc;
  return { printers: data.printers || [], deviceAssignments: data.deviceAssignments || {} };
}

export async function savePrinterSettings(data: PrinterSettingsDoc) {
  // Local-first write (default). Cloud write below is preserved as fallback.
  if (!SYNC_PRINTER_SETTINGS_TO_CLOUD) {
    writeLocalSync(data);
    return;
  }
  if (!isFirebaseConfigured() || !getTenantId()) return;
  await setDoc(ref(), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

export function subscribePrinterSettings(
  handler: (data: PrinterSettingsDoc) => void,
): Unsubscribe {
  // Local-first subscription (default). Listens for same-tab writes + cross-tab
  // storage events. Cloud snapshot path below is preserved as fallback.
  if (!SYNC_PRINTER_SETTINGS_TO_CLOUD) {
    handler(readLocalSync());
    const onChange = () => handler(readLocalSync());
    window.addEventListener(LOCAL_EVT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(LOCAL_EVT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }
  // v1.19.7 — printer settings are local-first (SYNC_PRINTER_SETTINGS_TO_CLOUD
  // is false by default), so this cloud subscription is already optional. Make
  // the Supabase case explicit so it settles instead of attaching a listener
  // that can never fire.
  if (firestoreUnavailable() || !isFirebaseConfigured() || !getTenantId()) {
    handler(EMPTY);
    return () => {};
  }
  return onSnapshot(ref(), (snap) => {
    if (!snap.exists()) return handler(EMPTY);
    const data = snap.data() as PrinterSettingsDoc;
    handler({ printers: data.printers || [], deviceAssignments: data.deviceAssignments || {} });
  }, (err) => { console.warn('[printerSettings] snapshot error', err); });
}

export function defaultPrinterConfig(): PrinterConfig {
  return {
    id: `prn_${Date.now().toString(36)}`,
    name: 'New Printer',
    connection: 'system',
    printerName: '',
    lanHost: '',
    lanPort: 9100,
    role: 'counter',
    paperSize: '80mm',
    leftMarginMm: 3,
    rightMarginMm: 10,
    topFeedMm: 0,
    bottomFeedMm: 0,
    autoCut: true,
    beep: false,
    copies: 1,
    escposMode: false,
    browserBackup: true,
    enabled: true,
  };
}

/** Pick the best printer for a given role using device override -> first enabled match. */
export function resolvePrinterForRole(
  settings: PrinterSettingsDoc,
  role: CloudPrintRole,
  deviceId?: string,
): PrinterConfig | undefined {
  const printers = settings.printers.filter((p) => p.enabled);
  if (deviceId) {
    const override = settings.deviceAssignments?.[deviceId]?.[role];
    if (override) {
      const found = printers.find((p) => p.id === override);
      if (found) return found;
    }
  }
  return printers.find((p) => p.role === role) || printers.find((p) => p.role === 'counter');
}

// ===== Local "Print Server" toggle (device-level) =====
// Only the device(s) with this flag will claim & print cloud jobs.
const PRINT_SERVER_KEY = 'dtpos-print-server-enabled';
const PRINT_SERVER_DEFAULTED_KEY = 'dtpos-print-server-defaulted';

export function isPrintServerEnabled(): boolean {
  try {
    // Phase-1: Electron pe default ON (recommended silent-print mode).
    // Sirf pehli baar auto-enable, baad me user explicit toggle kar sake.
    const isElectronEnv = typeof window !== 'undefined' && !!(window as any).electronAPI;
    if (isElectronEnv && !localStorage.getItem(PRINT_SERVER_DEFAULTED_KEY)) {
      localStorage.setItem(PRINT_SERVER_KEY, '1');
      localStorage.setItem(PRINT_SERVER_DEFAULTED_KEY, '1');
    }
    return localStorage.getItem(PRINT_SERVER_KEY) === '1';
  } catch { return false; }
}
export function setPrintServerEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(PRINT_SERVER_KEY, '1');
    else localStorage.removeItem(PRINT_SERVER_KEY);
    localStorage.setItem(PRINT_SERVER_DEFAULTED_KEY, '1');
    window.dispatchEvent(new CustomEvent('dtpos-print-server-changed'));
  } catch {}
}
