// Electron environment detection and native API wrappers

export function isElectron(): boolean {
  return !!(window as any).electronAPI;
}

function api(): any {
  return (window as any).electronAPI;
}

/** Native installed version from package.json (Electron only). */
export async function getNativeAppVersion(): Promise<string | null> {
  if (!isElectron()) return null;
  try {
    const v = await api().getAppVersion?.();
    return (v && typeof v === 'string') ? v : null;
  } catch { return null; }
}

// ===== Printing =====

export interface SystemPrinterInfo {
  name: string;
  displayName?: string;
  description?: string;
  status?: number;
  isDefault?: boolean;
  /** Windows driver name (e.g. "Generic / Text Only", "EPSON TM-T82 Receipt"). */
  driverName?: string;
  /** Windows port name (e.g. "USB001", "TCP/IP", "COM1", "IP_192.168.1.50"). */
  portName?: string;
  options?: Record<string, string>;
}

export async function getPrinters(): Promise<SystemPrinterInfo[]> {
  if (!isElectron()) return [];
  const list = await api().getPrinters();
  // Normalize keys from Electron's PrinterInfo (options.system_driverinfo etc.)
  return (list || []).map((p: any): SystemPrinterInfo => ({
    name: p.name,
    displayName: p.displayName,
    description: p.description,
    status: p.status,
    isDefault: p.isDefault,
    driverName: p.options?.['printer-make-and-model'] || p.options?.['system_driverinfo'] || p.driverName,
    portName: p.options?.['device-uri'] || p.options?.['printer-location'] || p.portName,
    options: p.options,
  }));
}

export interface PickedMediaFile {
  success: boolean;
  canceled?: boolean;
  error?: string;
  /** Absolute path on this machine. */
  path?: string;
  name?: string;
  sizeBytes?: number;
  /** file:// URL, which is what a <video src> needs. */
  url?: string;
}

/**
 * Ask Windows for a video (or image) file.
 *
 * Returns `{ success: false }` outside the desktop app, where the caller
 * falls back to asking for an address instead.
 */
export async function pickMediaFile(kind: 'video' | 'image' = 'video'): Promise<PickedMediaFile> {
  if (!isElectron() || !api()?.pickMediaFile) return { success: false, error: 'not-desktop' };
  try {
    return await api().pickMediaFile(kind);
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}

export async function printReceiptNative(options?: {
  printerName?: string;
  silent?: boolean;
  pageWidthMicrons?: number;
  pageHeightMicrons?: number;
  usePrinterDefaultPageSize?: boolean;
  autoCut?: boolean;
  cutMode?: 'full' | 'partial';
  driverType?: 'windows' | 'escpos';
  dpi?: number;
  // Log-only metadata (forwarded verbatim into DT-POS/logs/app.log so
  // production issues can be diagnosed without a rebuild).
  paperLabel?: '58mm' | '80mm' | '110mm';
  topFeedMm?: number;
  bottomFeedMm?: number;
  leftMarginMm?: number;
  rightMarginMm?: number;
}): Promise<{ success: boolean; error?: string }> {
  if (!isElectron()) {
    window.print();
    return { success: true };
  }
  return api().printReceipt(options || {});
}

// ===== File Dialogs =====

export async function nativeExportBackup(jsonData: string, defaultName: string): Promise<boolean> {
  if (!isElectron()) return false;
  const result = await api().showSaveDialog(defaultName);
  if (result.canceled || !result.filePath) return false;
  const writeResult = await api().writeFile(result.filePath, jsonData);
  return writeResult.success;
}

export async function nativeImportBackup(): Promise<string | null> {
  if (!isElectron()) return null;
  const result = await api().showOpenDialog();
  if (result.canceled || !result.filePaths?.length) return null;
  const readResult = await api().readFile(result.filePaths[0]);
  if (!readResult.success) return null;
  return readResult.data;
}

// ===== JSON File DB =====

export async function dbRead(): Promise<string | null> {
  if (!isElectron()) return null;
  const result = await api().dbRead();
  if (result?.success && result.data) return result.data;
  return null;
}

export async function dbWrite(jsonStr: string): Promise<boolean> {
  if (!isElectron()) return false;
  const result = await api().dbWrite(jsonStr);
  return !!result?.success;
}

export async function dbBackup(jsonStr: string, label?: string): Promise<{ success: boolean; path?: string }> {
  if (!isElectron()) return { success: false };
  try { return await api().dbBackup(jsonStr, label); } catch { return { success: false }; }
}

export async function dbListBackups(): Promise<{ name: string; path: string; size: number; mtime: number }[]> {
  if (!isElectron()) return [];
  try {
    const r = await api().dbListBackups();
    return r?.files || [];
  } catch { return []; }
}

export async function dbLog(level: 'INFO' | 'WARN' | 'ERROR', event: string, detail?: string): Promise<void> {
  if (!isElectron()) return;
  try { await api().dbLog?.(level, event, detail || ''); } catch {}
}

export async function dbReadLog(): Promise<string> {
  if (!isElectron()) return '';
  try {
    const r = await api().dbReadLog?.();
    return r?.data || '';
  } catch { return ''; }
}

export async function getDataPath(): Promise<string> {
  if (!isElectron()) return 'localStorage (browser mode)';
  return api().getDataPath();
}

export async function getDataPaths(): Promise<{ root: string; dataFile: string; backupDir: string; logDir: string; logFile: string } | null> {
  if (!isElectron()) return null;
  try { return await api().getDataPaths?.(); } catch { return null; }
}

export async function openDataFolder(which: 'data' | 'backups' | 'logs' = 'data'): Promise<void> {
  if (!isElectron()) return;
  try { await api().openDataFolder?.(which); } catch {}
}

// ===== Auto-start on boot =====
export async function getAutoStart(): Promise<boolean> {
  if (!isElectron()) return false;
  try {
    const r = await api().getAutoStart();
    return !!r?.enabled;
  } catch { return false; }
}

export async function setAutoStart(enabled: boolean): Promise<boolean> {
  if (!isElectron()) return false;
  try {
    const r = await api().setAutoStart(enabled);
    return !!r?.success;
  } catch { return false; }
}

// ===== Auto-update / external links =====
export function openExternal(url: string): void {
  if (isElectron()) {
    try { api().openExternal?.(url); return; } catch {}
  }
  try { window.open(url, '_blank', 'noopener'); } catch {}
}

export async function downloadAndRunInstaller(url: string): Promise<{ success: boolean; error?: string }> {
  if (!isElectron()) {
    openExternal(url);
    return { success: true };
  }
  try {
    return await api().downloadAndRunInstaller(url);
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}

export function onUpdateProgress(cb: (pct: number) => void): () => void {
  if (!isElectron()) return () => {};
  try {
    return api().onUpdateProgress?.(cb) || (() => {});
  } catch { return () => {}; }
}
