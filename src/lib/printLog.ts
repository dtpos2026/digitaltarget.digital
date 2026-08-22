// ============================================================
// Local Print Log (device-level)
// Stores last N print attempts for diagnostics & support reports.
// ============================================================

export interface PrintLogEntry {
  id: string;
  at: string;             // ISO timestamp
  user?: string;          // staff name / role
  billNumber?: string;
  printerName?: string;
  printType: 'receipt' | 'kitchen' | 'delivery' | 'test' | 'qr' | 'raw' | 'other';
  status: 'success' | 'failed' | 'skipped';
  /** Where in the pipeline this entry was recorded (enqueue / print / queue). */
  stage?: string;
  error?: string;
  ms?: number;
}


const KEY = 'dtpos-print-log';
const MAX = 500;

export function readPrintLog(): PrintLogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PrintLogEntry[];
  } catch { return []; }
}

export function appendPrintLog(entry: Omit<PrintLogEntry, 'id' | 'at'> & { at?: string }) {
  try {
    const log = readPrintLog();
    log.unshift({
      id: `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      at: entry.at || new Date().toISOString(),
      ...entry,
    });
    while (log.length > MAX) log.pop();
    localStorage.setItem(KEY, JSON.stringify(log));
    window.dispatchEvent(new CustomEvent('dtpos-print-log-changed'));
  } catch {}
}

export function clearPrintLog() {
  try { localStorage.removeItem(KEY); window.dispatchEvent(new CustomEvent('dtpos-print-log-changed')); } catch {}
}

export function lastSuccessful(): PrintLogEntry | undefined {
  return readPrintLog().find((e) => e.status === 'success');
}

export function lastFailed(): PrintLogEntry | undefined {
  return readPrintLog().find((e) => e.status === 'failed');
}
