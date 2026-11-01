// ============================================================
// PRINTER ABSTRACTION — one silent entry point for every printer.
//
// Goal: a print job NEVER opens the Windows print dialog, and the
// caller always gets a clear, human-readable success/failure status.
//
// Transports (chosen automatically):
//   electron-silent : Windows/system driver via webContents.print (silent)
//   lan-escpos      : raw ESC/POS bytes over TCP 9100
//   browser-dialog   : ONLY when the caller explicitly allows it
//                      (web preview / manual "print with dialog")
//
// Every result carries: transport, machine-readable failure code,
// user-facing message, printer used, duration, and attempt trace.
// ============================================================
import { PRINT_CONFIG, paperWidthToMicrons, type PaperSize } from './printConfig';
import { ensurePrintAllowedFast } from '@/licensing/printGuard';
import { appendPrintLog, type PrintLogEntry } from '@/lib/printLog';

export type PrintTransport = 'electron-silent' | 'lan-escpos' | 'browser-dialog' | 'none';

export type PrintFailureCode =
  | 'license_blocked'
  | 'empty_document'
  | 'no_transport'
  | 'printer_not_found'
  | 'printer_offline'
  | 'out_of_paper'
  | 'cancelled'
  | 'driver_error'
  | 'unknown';

export interface PrintResult {
  /** true only when the job was actually handed to a printer. */
  success: boolean;
  transport: PrintTransport;
  /** Machine-readable reason when success === false. */
  code?: PrintFailureCode;
  /** Short, user-facing status line (always present). */
  message: string;
  /** Raw driver/OS text, for the diagnostics log. */
  detail?: string;
  printerName?: string;
  copies: number;
  durationMs: number;
  /** Trace of what was tried, e.g. ["custom:fail", "driver:ok"]. */
  attempts: string[];
  /** Set when the job printed, but not the way it was asked to. */
  warning?: string;
  /** true when a print dialog was shown to the user. */
  usedDialog: boolean;
}

export interface SilentPrintJob {
  printerName?: string;
  paperWidth?: PaperSize;
  copies?: number;
  /** LAN/network thermal printer (raw ESC/POS over TCP). */
  lan?: { host: string; port?: number; autoCut?: boolean; beep?: boolean };
  /** Receipt HTML — required for the LAN transport only. */
  html?: string;
  /** Number of silent retries after the first attempt. */
  retries?: number;
  /** Allow a visible print dialog when no silent transport exists. */
  allowDialogFallback?: boolean;
  /** For the diagnostics log. */
  logType?: PrintLogEntry['printType'];
  billNumber?: string;
}

function api(): any {
  return (window as any).electronAPI;
}

export function isSilentPrintAvailable(): boolean {
  return !!api()?.printReceipt;
}

export function isLanPrintAvailable(): boolean {
  return !!api()?.printLanEscpos;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Map raw driver/OS text to a clear code + message the cashier can act on. */
export function classifyPrintError(raw?: string | null): { code: PrintFailureCode; message: string } {
  const s = String(raw || '').toLowerCase();
  if (!s) return { code: 'unknown', message: 'Print failed — the printer did not respond.' };
  if (/cancel/.test(s)) return { code: 'cancelled', message: 'Print cancelled.' };
  if (/not found|no printers|unknown printer|invalid printer/.test(s))
    return { code: 'printer_not_found', message: 'Printer not found — reconnect it or pick it again in Printer Settings.' };
  if (/offline|econnrefused|ehostunreach|etimedout|timeout|unreachable|not connected|spooler/.test(s))
    return { code: 'printer_offline', message: 'Printer is offline — check power, cable/Wi-Fi and try again.' };
  if (/paper|out of paper/.test(s))
    return { code: 'out_of_paper', message: 'Printer is out of paper — load a roll and reprint.' };
  if (/driver|page ?size|pagesize|device/.test(s))
    return { code: 'driver_error', message: 'Printer driver rejected the job — try the other paper size in Printer Settings.' };
  return { code: 'unknown', message: 'Print failed — see Printer Diagnostics for details.' };
}

function finish(res: PrintResult, job: SilentPrintJob): PrintResult {
  try {
    appendPrintLog({
      printerName: res.printerName,
      billNumber: job.billNumber,
      printType: job.logType || 'other',
      status: res.success ? 'success' : 'failed',
      error: res.success ? res.warning : `${res.code}: ${res.detail || res.message}`,
      ms: res.durationMs,
    });
  } catch {}
  return res;
}

/**
 * Send the currently prepared document to a printer WITHOUT any dialog.
 * The DOM/print CSS must already be prepared by the caller (printService).
 */
export async function silentPrint(job: SilentPrintJob = {}): Promise<PrintResult> {
  const started = Date.now();
  const copies = Math.max(1, job.copies || 1);
  const paperWidth: PaperSize = job.paperWidth || '80mm';
  const attempts: string[] = [];

  const base = (over: Partial<PrintResult>): PrintResult => ({
    success: false,
    transport: 'none',
    message: 'Print failed.',
    copies,
    durationMs: Date.now() - started,
    attempts,
    usedDialog: false,
    printerName: job.printerName,
    ...over,
  });

  // ---- Licence + device binding guard ----
  const guard = await ensurePrintAllowedFast();
  if (!guard.allowed) {
    return finish(base({
      code: 'license_blocked',
      message: guard.message || 'Printing is blocked — license not valid on this device.',
    }), job);
  }

  // ---- LAN / network thermal printer ----
  if (job.lan?.host) {
    if (!isLanPrintAvailable()) {
      return finish(base({
        code: 'no_transport',
        message: 'Network printing needs the desktop app — open DT POS on the PC.',
        transport: 'lan-escpos',
      }), job);
    }
    try {
      const { buildEscposFromHtml } = await import('./escpos');
      const bytes = buildEscposFromHtml(job.html || '', {
        paperWidth: paperWidth === '58mm' ? '58mm' : '80mm',
        autoCut: job.lan.autoCut !== false,
        beep: job.lan.beep === true,
      });
      let last: any = null;
      for (let c = 0; c < copies; c++) {
        last = await api().printLanEscpos({ host: job.lan.host, port: job.lan.port || 9100, data: bytes });
        attempts.push(`lan#${c + 1}:${last?.success ? 'ok' : (last?.error || 'fail')}`);
        if (!last?.success) break;
      }
      if (last?.success) {
        return finish(base({
          success: true,
          transport: 'lan-escpos',
          message: `Printed to ${job.lan.host}:${job.lan.port || 9100}.`,
          printerName: `${job.lan.host}:${job.lan.port || 9100}`,
          durationMs: Date.now() - started,
        }), job);
      }
      const cls = classifyPrintError(last?.error);
      return finish(base({ ...cls, transport: 'lan-escpos', detail: last?.error, durationMs: Date.now() - started }), job);
    } catch (e: any) {
      const cls = classifyPrintError(e?.message || String(e));
      return finish(base({ ...cls, transport: 'lan-escpos', detail: e?.message || String(e), durationMs: Date.now() - started }), job);
    }
  }

  // ---- System printer, silent (no Windows dialog) ----
  if (isSilentPrintAvailable()) {
    const opts: Record<string, any> = {
      ...PRINT_CONFIG.electron,
      silent: true,                       // never show the Windows dialog
      printerName: job.printerName,
      copies,
      pageWidthMicrons: paperWidthToMicrons(paperWidth),
      usePrinterDefaultPageSize: false,
      driverType: 'escpos',
      dpi: 203,
      autoCut: true,
      paperLabel: paperWidth,
    };

    const tries = 1 + Math.max(0, job.retries ?? 0);
    let res: any = null;
    for (let i = 0; i < tries; i++) {
      res = await api().printReceipt(opts);
      attempts.push(`system#${i + 1}:${res?.success ? 'ok' : (res?.error || 'fail')}`);
      if (res?.success) break;
      if (/cancel/i.test(String(res?.error || ''))) break;
      if (i < tries - 1) await sleep(600);
    }

    if (res?.success) {
      return finish(base({
        success: true,
        transport: 'electron-silent',
        message: res.warning
          ? 'Printed (on the Windows default printer).'
          : `Printed${job.printerName ? ` to ${job.printerName}` : ''}.`,
        warning: res.warning,
        durationMs: Date.now() - started,
      }), job);
    }

    let cls = classifyPrintError(res?.error);

    // AUTO RE-DETECT — printer ka Windows naam badal gaya (USB dobara laga,
    // "(Copy 1)" lag gaya) to installed list me se milta-julta printer dhoond
    // kar ek dafa dobara koshish karo. Yeh khamosh hota hai, dialog nahi.
    if (cls.code === 'printer_not_found' && job.printerName) {
      try {
        const [{ getPrinters }, { matchPrinter }] = await Promise.all([
          import('@/lib/electron'),
          import('./printerMatch'),
        ]);
        const list = await getPrinters();
        const hit = matchPrinter(job.printerName, list as any);
        if (hit.printer && hit.name && hit.name !== job.printerName) {
          const retry = await api().printReceipt({ ...opts, printerName: hit.name });
          attempts.push(`redetect(${hit.stage}):${retry?.success ? 'ok' : (retry?.error || 'fail')}`);
          if (retry?.success) {
            return finish(base({
              success: true,
              transport: 'electron-silent',
              printerName: hit.name,
              message: `Printed to ${hit.name}.`,
              warning: `Printer name changed — now using "${hit.name}". Update it in Printer Settings.`,
              durationMs: Date.now() - started,
            }), job);
          }
          cls = classifyPrintError(retry?.error);
          res = retry;
        }
      } catch { /* re-detect is best effort */ }
    }

    return finish(base({ ...cls, transport: 'electron-silent', detail: res?.error, durationMs: Date.now() - started }), job);
  }

  // ---- No silent transport (web browser) ----
  if (!job.allowDialogFallback) {
    return finish(base({
      code: 'no_transport',
      message: 'Silent printing needs the DT POS desktop app on this computer.',
    }), job);
  }

  await browserDialogPrint();
  attempts.push('browser-dialog:shown');
  return finish(base({
    success: true,
    transport: 'browser-dialog',
    usedDialog: true,
    message: 'Sent to the browser print dialog.',
    durationMs: Date.now() - started,
  }), job);
}

export function browserDialogPrint(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { window.removeEventListener('afterprint', done); resolve(); };
    window.addEventListener('afterprint', done, { once: true });
    try { window.print(); } catch { resolve(); }
    setTimeout(done, 4000);
  });
}
