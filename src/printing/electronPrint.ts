// ============================================================
// Electron print wrapper — builds webContents.print options from
// PRINT_CONFIG. Rule 8 + Rule 9,10 (no feed / form-feed).
// ============================================================
import { PRINT_CONFIG, paperWidthToMicrons, type PaperSize } from './printConfig';

interface ElectronPrintArgs {
  printerName?: string;
  paperWidth?: PaperSize;
  copies?: number;
  /** Optional explicit height override (microns). When omitted, printer
   *  default page size is used (auto height — recommended). */
  pageHeightMicrons?: number;
}

export async function electronPrintReceipt(args: ElectronPrintArgs = {}): Promise<{ success: boolean; error?: string }> {
  const api = (window as any).electronAPI;
  if (!api?.printReceipt) {
    // Fallback for browser: trigger native print dialog
    window.print();
    return { success: true };
  }

  const paperWidth = args.paperWidth || '80mm';
  const widthMicrons = paperWidthToMicrons(paperWidth);

  const opts: Record<string, any> = {
    ...PRINT_CONFIG.electron,
    printerName: args.printerName,
    copies: Math.max(1, args.copies || 1),
    pageWidthMicrons: widthMicrons,
    // Rule 5,6: no fixed height — let printer handle paper feed
    usePrinterDefaultPageSize: true,
    driverType: 'escpos',
    dpi: 203,
    autoCut: true,
  };

  // Only set explicit height if caller really needs it (debug / override)
  if (args.pageHeightMicrons) {
    opts.pageHeightMicrons = args.pageHeightMicrons;
    opts.usePrinterDefaultPageSize = false;
  }

  return api.printReceipt(opts);
}

export function isElectronPrintAvailable(): boolean {
  return !!(window as any).electronAPI?.printReceipt;
}
