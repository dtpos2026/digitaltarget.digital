// ============================================================
// LAN / Network ESC/POS printing — SHARED role-based router.
// v1.2.3: Previously only the customer receipt path knew about LAN
// printers. A KOT assigned to a LAN printer had no printerName, so
// the code silently fell back to the DEFAULT (cash/counter) printer —
// kitchen slips came out at the counter. This helper gives every
// print surface the same LAN routing:
//
//   const r = await printPortalViaLan('kitchen', portalEl, paperWidth);
//   if (r.handled) return r;          // LAN printer configured -> done
//   // ...otherwise continue with the system/browser path
//
// r.handled === false  -> no enabled LAN printer for that role on this
//                         device; caller continues with normal printing.
// r.handled === true   -> the job belonged to a LAN printer. success
//                         tells whether bytes reached it. Callers must
//                         NOT fall back to another physical printer on
//                         failure unless the user explicitly enabled a
//                         fallback (wrong-station slips confuse staff).
// ============================================================
import type { CloudPrintRole } from '@/lib/cloudPrintJobs';
import { buildEscposFromHtml } from './escpos';
import type { PaperSize } from './printConfig';
import { recordPrintDiag } from '@/lib/printDiagnostics';

export interface LanPrintResult {
  handled: boolean;
  success: boolean;
  error?: string;
  printerName?: string;
}

export async function printPortalViaLan(
  role: CloudPrintRole,
  portalEl: HTMLElement | null,
  paperWidthDefault: PaperSize = '80mm',
  copiesOverride?: number,
): Promise<LanPrintResult> {
  let printer: any = null;
  try {
    const api: any = (window as any).electronAPI;
    if (!api?.printLanEscpos) return { handled: false, success: false };
    if (!portalEl) return { handled: false, success: false };

    const { loadPrinterSettings, resolvePrinterForRole } = await import('@/lib/printerSettings');
    const { getDeviceId } = await import('@/lib/tenant');
    const pset = await loadPrinterSettings();
    printer = resolvePrinterForRole(pset, role, getDeviceId());

    // Only take over the job when the resolved printer for THIS role is a
    // LAN printer. Anything else (system/bluetooth/none) is not ours.
    if (!printer || printer.connection !== 'lan' || !printer.lanHost) {
      return { handled: false, success: false };
    }
  } catch {
    // Could not even resolve settings — let the normal path print.
    return { handled: false, success: false };
  }

  try {
    const api: any = (window as any).electronAPI;
    const html = portalEl.outerHTML || '';
    const bytes = buildEscposFromHtml(html, {
      paperWidth: (printer.paperSize || paperWidthDefault) as '58mm' | '80mm',
      autoCut: printer.autoCut !== false,
      beep: printer.beep === true,
      topFeedLines: Math.max(0, Math.round((printer.topFeedMm || 0) / 3)),
      bottomFeedLines: Math.max(3, Math.round((printer.bottomFeedMm || 0) / 3) + 3),
    });

    const topFeedLines = Math.max(0, Math.round((printer.topFeedMm || 0) / 3));
    const copies = Math.max(1, copiesOverride ?? printer.copies ?? 1);
    for (let i = 0; i < copies; i++) {
      const r = await api.printLanEscpos({
        host: printer.lanHost,
        port: printer.lanPort || 9100,
        data: bytes,
      });
      if (!r?.success) {
        recordPrintDiag({
          path: 'lan-escpos',
          kind: role === 'kitchen' ? 'kot' : 'receipt',
          paperWidth: printer.paperSize || paperWidthDefault,
          marginTopMm: printer.topFeedMm || 0,
          marginBottomMm: printer.bottomFeedMm || 0,
          topFeedLines,
          printerName: printer.name,
          success: false,
          error: r?.error || 'LAN print failed',
        });
        return { handled: true, success: false, error: r?.error || 'LAN print failed', printerName: printer.name };
      }
    }
    recordPrintDiag({
      path: 'lan-escpos',
      kind: role === 'kitchen' ? 'kot' : 'receipt',
      paperWidth: printer.paperSize || paperWidthDefault,
      marginTopMm: printer.topFeedMm || 0,
      marginBottomMm: printer.bottomFeedMm || 0,
      topFeedLines,
      printerName: printer.name,
      success: true,
    });
    console.log('%c[DT-Print]', 'color:#16a34a;font-weight:700', `LAN ESC/POS printed (${role})`, { host: printer.lanHost, bytes: bytes.length, copies });
    return { handled: true, success: true, printerName: printer.name };
  } catch (e: any) {
    // A blank-content guard or transport error — the job WAS a LAN job.
    return { handled: true, success: false, error: e?.message || String(e), printerName: printer?.name };
  }
}
