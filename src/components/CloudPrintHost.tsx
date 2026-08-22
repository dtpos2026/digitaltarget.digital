// ============================================================
// CloudPrintHost — invisible background service.
// Runs on the Electron Windows EXE that the restaurant marks as
// "Print Server". Listens to pending cloud printJobs, claims one
// at a time, silently prints to the printer assigned for the job's
// role, and marks printed/failed.
//
// Safety rules:
//  - Only one device per tenant should be enabled as print server
//    (the UI warns; claimJob() is atomic so duplicates still cannot
//     happen even if accidentally enabled on two devices).
//  - Web browser tabs that are NOT print servers do nothing here.
//  - If printer is offline -> markFailed -> reprint button in UI.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import {
  subscribePendingJobs,
  claimJob,
  markCloudJobPrinted,
  markCloudJobFailed,
  isCloudPrintAvailable,
  type CloudPrintJob,
} from '@/lib/cloudPrintJobs';
import {
  subscribePrinterSettings,
  resolvePrinterForRole,
  isPrintServerEnabled,
  type PrinterSettingsDoc,
} from '@/lib/printerSettings';
import { isElectron } from '@/lib/electron';
import { getDeviceId } from '@/lib/tenant';

export default function CloudPrintHost() {
  const [enabled, setEnabled] = useState(false);
  const settingsRef = useRef<PrinterSettingsDoc>({ printers: [], deviceAssignments: {} });
  const busyRef = useRef(false);

  // Watch toggle + electron availability
  useEffect(() => {
    const update = () => setEnabled(isElectron() && isPrintServerEnabled() && isCloudPrintAvailable());
    update();
    window.addEventListener('dtpos-print-server-changed', update);
    return () => window.removeEventListener('dtpos-print-server-changed', update);
  }, []);

  // Live printer settings
  useEffect(() => {
    if (!enabled) return;
    const unsub = subscribePrinterSettings((s) => { settingsRef.current = s; });
    return () => unsub();
  }, [enabled]);

  // Listen to pending jobs
  useEffect(() => {
    if (!enabled) return;
    const unsub = subscribePendingJobs(async (jobs) => {
      if (busyRef.current) return;
      const next = jobs.find((j) => j.status === 'pending' || j.status === 'failed');
      if (!next) return;
      busyRef.current = true;
      try {
        await processJob(next, settingsRef.current);
      } finally {
        busyRef.current = false;
      }
    });
    return () => unsub();
  }, [enabled]);

  return null;
}

async function processJob(job: CloudPrintJob, settings: PrinterSettingsDoc) {
  const claimed = await claimJob(job.id);
  if (!claimed) return; // someone else got it

  const printer = resolvePrinterForRole(settings, job.role, getDeviceId());
  const printerName = printer?.printerName || undefined;
  const copies = Math.max(1, job.copies || printer?.copies || 1);
  const paperWidth = (printer?.paperSize || job.paperSize || '80mm') as '58mm' | '80mm';

  // ===== LAN / Network printer (ESC/POS over TCP) =====
  if (printer?.connection === 'lan' && printer.lanHost) {
    try {
      const api = (window as any).electronAPI;
      if (!api?.printLanEscpos) throw new Error('LAN print not available (Electron required)');
      const { buildEscposFromHtml } = await import('@/printing/escpos');
      const bytes = buildEscposFromHtml(job.html, {
        paperWidth,
        autoCut: printer.autoCut !== false,
        beep: printer.beep === true,
        topFeedLines: Math.max(0, Math.round((printer.topFeedMm || 0) / 3)),
        bottomFeedLines: Math.max(3, Math.round((printer.bottomFeedMm || 0) / 3) + 3),
      });
      for (let i = 0; i < copies; i++) {
        const res = await api.printLanEscpos({
          host: printer.lanHost,
          port: printer.lanPort || 9100,
          data: bytes,
        });
        if (!res.success) throw new Error(res.error || 'LAN print failed');
      }
      await markCloudJobPrinted(job.id);
      return;
    } catch (err: any) {
      await markCloudJobFailed(job.id, err?.message || String(err));
      return;
    }
  }

  // Render HTML into a hidden iframe for printing
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = `${paperWidth === '58mm' ? 58 : 80}mm`;
  iframe.style.height = 'auto';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8">
      <style>
        @page { size: ${paperWidth} auto; margin: 0; }
        html,body { margin:0; padding:0; width:${paperWidth}; font-family: 'Courier New', monospace; font-size: 12px; }
        body { padding-top: ${printer?.topFeedMm || 0}mm; padding-left: ${printer?.leftMarginMm || 0}mm; padding-right: ${printer?.rightMarginMm || 0}mm; padding-bottom: ${printer?.bottomFeedMm || 0}mm; }
      </style></head><body>${job.html}</body></html>`);
    doc.close();

    // Wait for layout / fonts
    await new Promise((r) => setTimeout(r, 500));

    // Print via Electron silent path — through the unified printNode pipeline.
    // The previous approach kept the whole app in layout with visibility:hidden,
    // which pushed the receipt down the page and printed BLANK first pages on
    // several drivers. printNode uses the same display:none session + measured
    // page height as normal receipts, so cloud prints now match local prints.
    const api = (window as any).electronAPI;
    if (api?.printReceipt) {
      iframe.remove();
      const portal = document.createElement('div');
      portal.className = 'receipt-print-portal';
      // Print margins flow through the standard CSS variables.
      portal.style.setProperty('--dt-print-padding-top', `${printer?.topFeedMm || 0}mm`);
      portal.style.setProperty('--dt-print-padding-right', `${printer?.rightMarginMm || 0}mm`);
      portal.style.setProperty('--dt-print-padding-bottom', `${printer?.bottomFeedMm || 0}mm`);
      portal.style.setProperty('--dt-print-padding-left', `${printer?.leftMarginMm || 0}mm`);
      const receipt = document.createElement('div');
      receipt.className = 'print-receipt';
      receipt.style.fontFamily = "'Courier New', monospace";
      receipt.innerHTML = job.html;
      portal.appendChild(receipt);
      document.body.appendChild(portal);
      try {
        const { printNode } = await import('@/printing');
        const result = await printNode(portal, { paperWidth, printerName, copies });
        if (!result.success) throw new Error(result.error || 'Print failed');
      } finally {
        setTimeout(() => portal.remove(), 600);
      }
    } else {
      throw new Error('Electron print API not available');
    }

    await markCloudJobPrinted(job.id);
  } catch (err: any) {
    try { iframe.remove(); } catch {}
    await markCloudJobFailed(job.id, err?.message || String(err));
  }
}
