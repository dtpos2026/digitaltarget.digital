// ============================================================
// Test Print Card — prints a sample receipt with a single button so that
// silent printing and the configured margins can be verified in one step.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { printNode, isElectronPrintAvailable } from '@/printing';
import { directTestPrint, isDirectPrintAvailable, prewarmDirectPrint } from '@/printing/directPrint';
import { getSettings } from '@/lib/store';
import { loadPrintMargins } from '@/lib/printMargins';
import { columnsOf } from '@/printing/paperProfile';
import { resolvePrintMode } from '@/printing/printMode';
import { loadPrinterSettings, resolvePrinterForRole, type PrinterConfig } from '@/lib/printerSettings';
import { getDeviceId } from '@/lib/tenant';

export default function TestPrintCard() {
  const portalRef = useRef<HTMLDivElement>(null);
  const alignRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [paper, setPaper] = useState<'58mm' | '80mm'>('80mm');

  useEffect(() => { prewarmDirectPrint(); }, []);

  const handleDirectTest = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await directTestPrint(getSettings());
      if (res.success) toast.success(`Direct print sent${res.printerName ? ` to ${res.printerName}` : ''}.`);
      else toast.error('Direct print failed: ' + (res.error || 'unknown error'));
    } finally {
      setTimeout(() => setBusy(false), 500);
    }
  };

  const now = new Date();
  const stamp = now.toLocaleString();
  const m = loadPrintMargins();
  // Characters per line comes from the shared paper profile. This was
  // hard-coded to 42 on 80mm paper where Font A actually fits 48, so the
  // ruler stopped ~6 characters short of the right edge and made a correctly
  // aligned slip look as though it had a wide right margin.
  const cols = columnsOf(paper, 'A');
  const ruler = Array.from({ length: cols }, (_, i) => String((i + 1) % 10)).join('');
  const digits = '1234567890'.repeat(Math.ceil(cols / 10)).slice(0, cols);

  // Apply the configured counter printer's margins to the portal, so the test
  // print comes out with exactly the geometry a real receipt would use.
  const applyCfgMargins = (el: HTMLElement, cfg?: PrinterConfig) => {
    const root = el.querySelector('.print-receipt') as HTMLElement | null;
    if (!root) return;
    const pos = (v?: number) => `${Math.max(0, v || 0)}mm`;
    const neg = (v?: number) => `${Math.min(0, v || 0)}mm`;
    root.style.setProperty('--dt-print-padding-top', pos(m.top)); // topFeed not applied in the HTML path (old-POS geometry)
    root.style.setProperty('--dt-print-padding-right', pos(cfg?.rightMarginMm ?? m.right));
    root.style.setProperty('--dt-print-padding-bottom', pos(Math.min(12, cfg?.bottomFeedMm ?? m.bottom)));
    root.style.setProperty('--dt-print-padding-left', pos(cfg?.leftMarginMm ?? m.left));
    root.style.setProperty('--dt-print-offset-top', neg(m.top));
    root.style.setProperty('--dt-print-offset-left', neg(cfg?.leftMarginMm ?? m.left));
    root.style.setProperty('--dt-print-offset-right', neg(cfg?.rightMarginMm ?? m.right));
    if (cfg?.printWidthMm) root.style.setProperty('--dt-print-content-width', `${cfg.printWidthMm}mm`);
  };

  const handleTest = async (silent: boolean, which: 'receipt' | 'align' = 'receipt') => {
    const el = which === 'align' ? alignRef.current : portalRef.current;
    if (!el || busy) return;
    setBusy(true);
    try {
      // ===== FIX: resolve the saved Counter printer (this was previously missing,
      // so silent print would go to the Windows DEFAULT printer and
      // nothing would come out of the thermal printer) =====
      let counter: PrinterConfig | undefined;
      try {
        const pset = await loadPrinterSettings();
        counter = resolvePrinterForRole(pset, 'counter', getDeviceId());
      } catch {}

      applyCfgMargins(el, counter);

      // ===== LAN printer path (raw ESC/POS over TCP 9100) =====
      const api: any = (window as any).electronAPI;
      if (silent && counter?.connection === 'lan' && counter.lanHost && api?.printLanEscpos) {
        el.setAttribute('data-active-print', 'true');
        try {
          const html = el.outerHTML;
          const { buildEscposFromHtml } = await import('@/printing/escpos');
          const bytes = buildEscposFromHtml(html, {
            paperWidth: (counter.paperSize || paper) as '58mm' | '80mm',
            autoCut: counter.autoCut !== false,
            beep: counter.beep === true,
            topFeedLines: Math.max(0, Math.round((counter.topFeedMm || 0) / 3)),
            bottomFeedLines: Math.max(3, Math.round((counter.bottomFeedMm || 0) / 3) + 3),
          });
          const r = await api.printLanEscpos({ host: counter.lanHost, port: counter.lanPort || 9100, data: bytes });
          if (r?.success) toast.success(`Network test print sent to ${counter.lanHost}.`);
          else toast.error('Network test print failed: ' + (r?.error || 'unknown error'));
          return;
        } finally {
          el.removeAttribute('data-active-print');
        }
      }

      // ===== System (Windows/USB) path — printerName is now passed =====
      const printerName =
        (counter && (counter.connection || 'system') === 'system' && counter.printerName) ||
        localStorage.getItem('pos-default-printer') ||
        undefined;

      if (silent && isElectronPrintAvailable() && !printerName) {
        toast.warning('No Counter printer configured — falling back to the Windows default printer. Add/assign a printer below.');
      }

      const res = await printNode(el, {
        paperWidth: (counter?.paperSize as any) || paper,
        printerName,
        silent,
        preferElectron: silent,
        copies: 1,
        // The test print exists to show what a real slip will look like, so it
        // must be positioned by the SAME numbers a real slip uses. It passed
        // none of them, so it could report one geometry on the slip and print
        // another — which is no use at all when the slip is what you are
        // using to diagnose the geometry.
        printMode: resolvePrintMode({ printerConfig: counter, settings: getSettings() }),
        marginLeftMm: counter?.leftMarginMm ?? m.left,
        marginRightMm: counter?.rightMarginMm ?? m.right,
        contentWidthMm: counter?.printWidthMm || m.contentWidthMm || undefined,
        logType: 'test',
      });
      if (res.success) {
        toast.success(silent
          ? `Silent test print sent${printerName ? ` to ${printerName}` : ' to the default printer'}.`
          : 'The browser print dialog has opened.');
      } else {
        toast.error('Test print failed: ' + (res.error || 'unknown error'));
      }
    } catch (e: any) {
      toast.error('Test print error: ' + (e?.message || String(e)));
    } finally {
      setTimeout(() => setBusy(false), 800);
    }
  };

  return (
    <Card className="p-4 md:p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Printer Test Print</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Prints a sample receipt to verify silent printing, the margins
          (T:{m.top} R:{m.right} B:{m.bottom} L:{m.left} mm) and the printable
          width ({m.contentWidthMm || 'auto'}mm).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Paper:</span>
        {(['58mm','80mm'] as const).map(p => (
          <Button key={p} size="sm" variant={paper === p ? 'default' : 'outline'} onClick={() => setPaper(p)}>{p}</Button>
        ))}
      </div>

      {/* DIRECT PRINTING — bytes seedha printer ko. Sab se tez aur reliable. */}
      <div className="rounded-md border p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Raw ESC/POS Test Mode</div>
            <p className="text-xs text-muted-foreground">
              A plain printer compatibility test only. Normal receipts, KOTs and tokens keep their selected
              design and print silently in the background, with no preview or dialog.
            </p>
          </div>
          <span className="text-xs font-semibold text-muted-foreground">Normal bills keep their selected design</span>
        </div>
        <Button size="sm" variant="secondary" disabled={busy || !isDirectPrintAvailable()} onClick={handleDirectTest}>
          {isDirectPrintAvailable() ? 'Direct Print Test' : 'Direct print needs the desktop app'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => handleTest(true, 'receipt')} disabled={busy}>
          {busy ? 'Printing…' : (isElectronPrintAvailable() ? 'Silent Test Print' : 'Test Print')}
        </Button>
        <Button variant="outline" onClick={() => handleTest(false, 'receipt')} disabled={busy}>
          Browser Print Dialog
        </Button>
        <Button variant="secondary" onClick={() => handleTest(true, 'align')} disabled={busy}>
          Test Alignment Print
        </Button>
      </div>

      {/* Hidden portal — printService activates this element.
          FIX: createPortal(document.body) is required — print CSS hides
          everything except the body's direct children (including #root).
          #root ke andar portal = BLANK print. */}
      {typeof document !== 'undefined' && createPortal(
      <div
        ref={portalRef}
        className="receipt-print-portal"
        aria-hidden="true"
        style={{ position: 'fixed', left: '-10000px', top: 0, width: '80mm', visibility: 'hidden' }}
      >
        <div className="print-receipt">
          <div className="receipt-print-content">
            <h1 style={{ textAlign: 'center', margin: 0 }}>DT POS</h1>
            <h3 style={{ textAlign: 'center', margin: '2px 0' }}>*** TEST PRINT ***</h3>
            <div style={{ textAlign: 'center', fontSize: 12 }}>{stamp}</div>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Sample Item A</span><span>Rs. 250.00</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Sample Item B x2</span><span>Rs. 400.00</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Sample Variant (Large)</span><span>Rs. 550.00</span>
            </div>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            <div className="grand-total" style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
              <span>TOTAL</span><span>Rs. 1,200.00</span>
            </div>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            <div style={{ textAlign: 'center', fontSize: 11 }}>
              Margins T:{m.top} R:{m.right} B:{m.bottom} L:{m.left} mm
            </div>
            <div style={{ textAlign: 'center', fontSize: 11, marginTop: 4 }}>
              If the text on both sides is even, alignment is OK.
            </div>
            <div style={{ textAlign: 'center', fontSize: 11, marginTop: 4 }}>
              — Thank you —
            </div>
          </div>
        </div>
      </div>,
      document.body,
      )}

      {/* Alignment / right-edge test portal — bhi body pe (same reason) */}
      {typeof document !== 'undefined' && createPortal(
      <div
        ref={alignRef}
        className="receipt-print-portal"
        aria-hidden="true"
        style={{ position: 'fixed', left: '-10000px', top: 0, width: paper, visibility: 'hidden' }}
      >
        <div className="print-receipt">
          <div className="receipt-print-content" style={{ fontFamily: 'Courier New, monospace' }}>
            <div style={{ textAlign: 'center', fontWeight: 'bold' }}>ALIGNMENT TEST — {paper}</div>
            <div style={{ borderTop: '1px solid #000', margin: '4px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>LEFT</span><span>CENTER</span><span>RIGHT</span>
            </div>
            <div style={{ borderTop: '1px solid #000', margin: '4px 0' }} />
            <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre', fontFamily: 'inherit' }}>{ruler}</pre>
            <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre', fontFamily: 'inherit' }}>{digits}</pre>
            <div style={{ border: '1px solid #000', padding: 2, marginTop: 4, textAlign: 'center' }}>
              [ {cols} CHARS PER LINE ]
            </div>
            <div style={{ marginTop: 4, fontSize: 11 }}>
              If both ends (L &amp; R) are printing and the box's right border is not being cut off —
              alignment is OK. Otherwise reduce the Printable Width or increase the Right margin.
            </div>
          </div>
        </div>
      </div>,
      document.body,
      )}
    </Card>
  );
}
