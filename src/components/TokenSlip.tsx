// ============================================================
// v1.3.0 — TOKEN SLIP (thermal)
//
// Reuses the SAME hardened print pipeline as receipts/KOT: measured
// content height, font/image waiting, blank-content guard, idempotent
// session cleanup with watchdog, and LAN ESC/POS routing. Nothing about
// printing is re-invented here — only the slip layout is new.
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import type { Order, RestaurantSettings } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { isElectron, printReceiptNative } from '@/lib/electron';
import {
  beginThermalPrintDomSession,
  getThermalPaperWidthMicrons,
  getThermalPrintJobHeightMm,
  shouldUsePrinterDefaultPageSize,
  waitForThermalPrintLayout,
  waitForPrintAssets,
  hasPrintableContent,
} from '@/lib/thermal-print';
import { resolvePageHeight } from '@/lib/printPageStrategy';

interface Props {
  order: Order;
  settings: RestaurantSettings;
  autoPrint?: boolean;
  showPrintButton?: boolean;
  onPrintComplete?: (r: { success: boolean; error?: string }) => void;
}

export default function TokenSlip({
  order,
  settings,
  autoPrint = false,
  showPrintButton = true,
  onPrintComplete,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const firedRef = useRef(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const paperWidth = (settings.paperSize || '80mm') as '58mm' | '80mm';
  const usePrinterDefaultPageSize = shouldUsePrinterDefaultPageSize(settings);

  const created = useMemo(() => new Date(order.createdAt), [order.createdAt]);
  const dateStr = created.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = created.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const totalQty = (order.items || []).reduce((s, i) => s + (i.quantity || 0), 0);

  const handlePrint = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    const measureEl = printRef.current || previewRef.current;
    const measureSession = beginThermalPrintDomSession(measureEl, paperWidth, undefined, settings);
    let heightMm: number | undefined;
    try {
      await waitForThermalPrintLayout();
      await waitForPrintAssets(measureEl);
      await waitForThermalPrintLayout();
      if (!hasPrintableContent(measureEl)) {
        return { success: false, error: 'Token slip empty — print skipped' };
      }
      heightMm = getThermalPrintJobHeightMm(measureEl, settings);
    } finally {
      measureSession();
    }

    // LAN printer for the counter role (shared router — same as receipts)
    try {
      const { printPortalViaLan } = await import('@/printing/lanPrint');
      const session = beginThermalPrintDomSession(measureEl, paperWidth, heightMm, settings);
      let lan: { handled: boolean; success: boolean; error?: string };
      try {
        await waitForThermalPrintLayout();
        lan = await printPortalViaLan('counter', measureEl, paperWidth);
      } finally {
        session();
      }
      if (lan.handled && lan.success) return { success: true };
      if (lan.handled) console.warn('[DT-Print] token LAN print failed, falling back:', lan.error);
    } catch (e) {
      console.warn('[DT-Print] token LAN routing skipped:', e);
    }

    if (isElectron() && settings.silentPrint !== false) {
      const session = beginThermalPrintDomSession(measureEl, paperWidth, heightMm, settings);
      try {
        await waitForThermalPrintLayout();
        const pageStrategy = resolvePageHeight(heightMm);
        const result = await printReceiptNative({
          printerName: settings.defaultPrinter || localStorage.getItem('pos-default-printer') || undefined,
          silent: true,
          pageWidthMicrons: getThermalPaperWidthMicrons(paperWidth),
          pageHeightMicrons: pageStrategy.pageHeightMicrons,
          usePrinterDefaultPageSize: pageStrategy.usePrinterDefaultPageSize,
          autoCut: settings.autoCut !== false,
          cutMode: settings.cutMode || 'full',
          driverType: settings.printerDriverType || 'escpos',
          dpi: 203,
        });
        if (result.success) return result;
      } finally {
        session();
      }
    }

    // Browser fallback
    const session = beginThermalPrintDomSession(measureEl, paperWidth, heightMm, settings);
    try {
      await waitForThermalPrintLayout();
      window.print();
    } finally {
      setTimeout(() => session(), 500);
    }
    return { success: true };
  }, [paperWidth, settings, usePrinterDefaultPageSize]);

  useEffect(() => {
    if (!autoPrint || firedRef.current) return;
    firedRef.current = true;
    const t = window.setTimeout(() => {
      handlePrint()
        .then(r => onPrintComplete?.(r))
        .catch(e => onPrintComplete?.({ success: false, error: e?.message || String(e) }));
    }, 250);
    return () => window.clearTimeout(t);
  }, [autoPrint, handlePrint, onPrintComplete]);

  const tokenNo = order.tokenLabel || order.tokenNumber || '—';
  const title = (settings as any).tokenSlipTitle || 'TANDOOR TOKEN';
  const footerText = (settings as any).tokenSlipFooter || 'Please hand over to the tandoor counter';
  const showLogo = (settings as any).tokenSlipLogo !== false && !!settings.logo;
  const template = ((settings as any).tokenTemplate || 'classic') as 'classic' | 'stars' | 'boxed' | 'compact';
  const dash = '1px dashed #000';

  const Logo = showLogo ? (
    <div style={{ textAlign: 'center' }}>
      <img src={settings.logo} alt="" style={{ maxWidth: 70, maxHeight: 70, margin: '0 auto 2px', display: 'block' }} />
    </div>
  ) : null;

  /** Top border band — date + time, printed on every template. */
  const DateTimeBar = (
    <div style={{
      borderTop: '2px solid #000', borderBottom: '1px solid #000',
      display: 'flex', justifyContent: 'space-between',
      fontSize: '11px', fontWeight: 800, padding: '2px 2px', margin: '0 0 4px',
    }}>
      <span>{dateStr}</span>
      <span>{timeStr}</span>
    </div>
  );

  const ItemRows = (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
      <tbody>
        {(order.items || []).map(it => (
          <tr key={it.id}>
            <td style={{ padding: '2px 0', fontWeight: 700 }}>{it.name}</td>
            <td style={{ padding: '2px 0', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{it.quantity}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const Meta = (
    <div style={{ fontSize: '11px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Items</span><span>{totalQty}</span></div>
      {order.cashierName && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Cashier</span><span>{order.cashierName}</span></div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Bill No</span><span>#{order.orderNumber}</span></div>
    </div>
  );

  const Qr = settings.tokenSlipQr ? (
    <div style={{ textAlign: 'center', marginTop: '8px' }}>
      <QRCodeSVG value={String(tokenNo)} size={90} level="M" />
    </div>
  ) : null;

  let body: ReactNode;

  if (template === 'compact') {
    // 2 — Minimal counter slip: big token number, item list, date line.
    body = (
      <>
        {DateTimeBar}
        <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '15px', letterSpacing: '2px' }}>TOKEN</div>
        <div style={{ textAlign: 'center', fontSize: '30px', fontWeight: 900, lineHeight: 1.1 }}>{tokenNo}</div>
        <div style={{ borderTop: dash, margin: '4px 0' }} />
        {ItemRows}
        <div style={{ borderTop: dash, margin: '4px 0' }} />
        <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700 }}>{dateStr}, {timeStr}</div>
      </>
    );
  } else if (template === 'boxed') {
    // 3 — Boxed (table lines): bordered item table + boxed token number.
    body = (
      <>
        {DateTimeBar}
        {Logo}
        <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '15px', letterSpacing: '1px' }}>*** {title} ***</div>
        <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, marginBottom: 4 }}>
          Order #{order.orderNumber} · {dateStr}, {timeStr}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', border: '1px solid #000' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid #000', textAlign: 'left', padding: '2px 4px' }}>Item</th>
              <th style={{ border: '1px solid #000', textAlign: 'right', padding: '2px 4px', width: 40 }}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {(order.items || []).map(it => (
              <tr key={it.id}>
                <td style={{ border: '1px solid #000', padding: '3px 4px', fontWeight: 800 }}>{it.name}</td>
                <td style={{ border: '1px solid #000', padding: '3px 4px', textAlign: 'right', fontWeight: 800 }}>{it.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ border: '2px solid #000', borderRadius: 4, textAlign: 'center', padding: '5px 0', margin: '6px 0 3px', fontSize: '17px', fontWeight: 900, letterSpacing: '3px' }}>
          T O K E N &nbsp;{tokenNo}
        </div>
        <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700 }}>{footerText}</div>
        {Qr}
      </>
    );
  } else if (template === 'stars') {
    // 4 — Star header with rounded token capsule.
    body = (
      <>
        {DateTimeBar}
        {Logo}
        <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '15px', letterSpacing: '1px' }}>*** {title} ***</div>
        <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 800 }}>Order #{order.orderNumber} · {dateStr}, {timeStr}</div>
        <div style={{ borderTop: dash, margin: '5px 0' }} />
        {ItemRows}
        <div style={{ borderTop: dash, margin: '5px 0' }} />
        <div style={{ border: '2px solid #000', borderRadius: 14, textAlign: 'center', padding: '5px 0', fontSize: '17px', fontWeight: 900, letterSpacing: '4px' }}>
          T O K E N &nbsp;{tokenNo}
        </div>
        <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, marginTop: 4 }}>{footerText}</div>
        {Qr}
      </>
    );
  } else {
    // 1 — Classic: restaurant header, giant token number, item list, meta.
    body = (
      <>
        <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '16px', letterSpacing: '1px' }}>
          {settings.name || 'RESTAURANT'}
        </div>
        {settings.address && <div style={{ textAlign: 'center', fontSize: '10px' }}>{settings.address}</div>}
        {DateTimeBar}
        {Logo}
        <div style={{ textAlign: 'center', fontSize: '12px', fontWeight: 700, letterSpacing: '3px' }}>{title}</div>
        <div style={{ textAlign: 'center', fontSize: '54px', lineHeight: 1.05, fontWeight: 900, letterSpacing: '2px', margin: '2px 0 6px' }}>
          {tokenNo}
        </div>
        <div style={{ borderTop: dash, margin: '6px 0' }} />
        {ItemRows}
        <div style={{ borderTop: dash, margin: '6px 0' }} />
        {Meta}
        {Qr}
        <div style={{ borderTop: dash, margin: '8px 0 4px' }} />
        <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700 }}>— Thank You —</div>
        <div style={{ textAlign: 'center', fontSize: '10px' }}>{footerText}</div>
      </>
    );
  }

  const slip = (
    <div className="print-receipt" style={{ fontFamily: "'Courier New', monospace", color: '#000', background: '#fff', width: '100%' }}>
      {body}
    </div>
  );

  return (
    <div>
      {showPrintButton && (
        <div className="flex justify-end mb-2 no-print">
          <Button size="sm" onClick={() => void handlePrint()}>
            <Printer className="h-4 w-4 mr-1" /> Print Token
          </Button>
        </div>
      )}

      {/* On-screen preview */}
      <div ref={previewRef} className="mx-auto bg-white text-black p-3 rounded" style={{ width: paperWidth === '58mm' ? 210 : 300 }}>
        {slip}
      </div>

      {/* Hidden print portal — mounted directly under <body> like other slips */}
      {mounted && createPortal(
        <div ref={printRef} className="receipt-print-portal" aria-hidden="true">
          {slip}
        </div>,
        document.body,
      )}
    </div>
  );
}
