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

export async function getPrinters(): Promise<{ name: string; isDefault: boolean }[]> {
  if (!isElectron()) return [];
  return api().getPrinters();
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
  if (result.success && result.data) return result.data;
  return null;
}

export async function dbWrite(jsonStr: string): Promise<boolean> {
  if (!isElectron()) return false;
  const result = await api().dbWrite(jsonStr);
  return result.success;
}

export async function getDataPath(): Promise<string> {
  if (!isElectron()) return 'localStorage (browser mode)';
  return api().getDataPath();
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
