import { useCallback, useEffect, useRef } from 'react';
import { money } from '@/lib/currency';
import { createPortal } from 'react-dom';
import { Order, RestaurantSettings, ReceiptTextStyle } from '@/lib/types';
import { KitchenReceiptBody } from '@/components/KitchenReceipt';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { praVerifyUrl } from '@/lib/praEims';
import { isElectron, printReceiptNative } from '@/lib/electron';
import { resolveLocalPrinterForRole, getLocalPrinterSettings } from '@/lib/localPrinterSettings';
import { beginThermalPrintDomSession, getEffectiveReceiptMargins, getThermalPaperWidthMicrons, getThermalPrintJobHeightMm, shouldUsePrinterDefaultPageSize, waitForThermalPrintLayout, waitForPrintAssets, hasPrintableContent } from '@/lib/thermal-print';
import { StandardInfoGrid, StandardInfoRows, getOrderTypeLabel } from '@/lib/standardOrderInfo';
import { recordPrintDiag } from '@/lib/printDiagnostics';
import { resolvePageHeight } from '@/lib/printPageStrategy';
import StandardReceipt from '@/components/StandardReceipt';

const defaultStyle: ReceiptTextStyle = { font: 'default', size: 12, align: 'center', bold: true };
const URDU_FONTS = ['Aseer Unicode', 'AA Sameer Armaa', 'Jameel Noori Nastaleeq', 'Jameel Noori Nastaleeq Regular'];

function getReceiptZoom(settings: RestaurantSettings) {
  return Math.max(50, Math.min(200, settings.receiptScale || 100));
}

function BrandFooter({ settings, rs }: { settings: RestaurantSettings; rs: any }) {
  if (!settings.marketingFooter?.trim()) return null;
  return (
    <div style={{ borderTop: '1px dashed black', marginTop: '4px', paddingTop: '4px' }}>
      <p style={{ ...getStyleCSS(rs.marketingFooter, { size: 11, align: 'center', bold: true }), whiteSpace: 'pre-line', lineHeight: 1.35, margin: 0 }}>
        {settings.marketingFooter}
      </p>
    </div>
  );
}

function VisitAgainBlock({ rs, settings }: { rs: any; settings?: RestaurantSettings }) {
  const thankYou = settings?.thankYouText ?? 'Thank You!';
  const visitAgain = settings?.visitAgainText ?? 'Please Visit Again';
  if (!thankYou && !visitAgain) return null;
  return (
    <div style={{ textAlign: 'center', padding: '5px 0' }}>
      {thankYou && <p style={{ fontSize: '14px', fontWeight: 800, margin: 0 }}>{thankYou}</p>}
      {visitAgain && <p style={{ ...getStyleCSS(rs.visitAgain, { size: 11, align: 'center', bold: true }), margin: '2px 0 0', color: '#333' }}>{visitAgain}</p>}
    </div>
  );
}

/**
 * v1.9.0 — PRA fiscal block.
 *
 * Printed only once PRA has actually returned a Fiscal Invoice Number.
 * We never print a placeholder or a "pending" number: a receipt carrying
 * an unverifiable invoice number would be worse for the taxpayer than a
 * receipt carrying none, because the customer's PRA app lookup fails.
 * The QR encodes PRA's own verification URL for that invoice number.
 */
function PraFiscalBlock({ order, settings }: { order: Order; settings?: RestaurantSettings }) {
  const cfg = (settings as any)?.praConfig;
  const enabled = !!(settings as any)?.praEimsEnabled && cfg?.enabled !== false;
  const printOn = cfg?.printOnReceipt !== false;
  const num = (order as any).praInvoiceNumber as string | undefined;
  if (!enabled || !printOn || !num) return null;
  return (
    <div style={{ textAlign: 'center', padding: '6px 0', borderTop: '1px dashed #000', marginTop: '4px' }}>
      <p style={{ fontSize: '10px', fontWeight: 700, margin: 0 }}>PRA Invoice Number</p>
      <p style={{ fontSize: '11px', fontWeight: 800, margin: '1px 0 3px', fontFamily: 'monospace' }}>{num}</p>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <QRCodeSVG value={praVerifyUrl(num)} size={90} level="M" />
      </div>
      <p style={{ fontSize: '8px', margin: '3px 0 0', color: '#333' }}>
        Verify at e.pra.punjab.gov.pk
      </p>
    </div>
  );
}

/**
 * v1.14.1 — label for one payment line.
 *
 * The old code read only `p.accountName`, so a restaurant-defined type
 * (NETS, PayNow, GrabPay, CDC Voucher) — which has no bank account
 * attached — fell through to the literal word "ONLINE". Reports showed
 * the real name while the customer's receipt said ONLINE, which is what
 * the client reported. The method itself is now the source of truth.
 */
function paymentEntryLabel(p: any): string {
  const method = String(p?.method || '').toLowerCase();
  if (method === 'cash') return 'CASH';
  if (method === 'card') return 'CARD';
  if (method === 'credit') return 'CREDIT';
  // A named bank/wallet account wins for the built-in 'online' method.
  if (method === 'online') return String(p?.accountName || 'ONLINE').toUpperCase();
  // Custom type: print exactly what the restaurant called it.
  return String(p?.accountName || p?.method || 'PAYMENT').toUpperCase();
}

function PaymentBlock({ order }: { order: Order }) {
  const method = (order as any).paymentMethod as string | undefined;
  const accName = (order as any).paymentAccountName as string | undefined;
  const isCash = !method || method === 'cash';
  const hasCash = !!(order.cashReceived && order.cashReceived > 0);
  const payments = (order as any).payments as Array<any> | undefined;
  const amountPaid = Number((order as any).amountPaid || 0);
  const due = Math.max(0, (order.grandTotal || 0) - amountPaid);
  const isPartial = order.status === 'partial' || (amountPaid > 0 && due > 0);
  if (!payments?.length && !hasCash && isCash && !accName && !isPartial) return null;
  const change = Math.max(0, (order.cashReceived || 0) - order.grandTotal);
  const methodLabel = paymentEntryLabel({ method, accountName: accName });
  return (
    <div style={{ borderTop: '1px dashed black', borderBottom: '1px dashed black', padding: '4px 2px', margin: '3px 0', fontSize: '12px', fontWeight: 800, fontFamily: "'Lucida Console','Consolas','Courier New',monospace", color: '#000' }}>
      {payments?.length ? (
        <>
          <div style={{ textAlign: 'center', borderBottom: '1px dotted #555', paddingBottom: '2px', marginBottom: '2px' }}>PAYMENT BREAKDOWN</div>
          {payments.map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{paymentEntryLabel(p)}</span>
              <span>{money(Number(p.amount || 0).toFixed(2))}</span>
            </div>
          ))}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>PAYMENT</span><span>{methodLabel}</span></div>
          {accName && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>ACCOUNT</span><span>{accName}</span></div>
          )}
          {hasCash && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>CASH RECEIVED</span><span>{money(order.cashReceived!.toFixed(2))}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>CHANGE RETURNED</span><span>{money(change.toFixed(2))}</span></div>
            </>
          )}
        </>
      )}
      {isPartial && (
        <div style={{ marginTop: '3px', paddingTop: '3px', borderTop: '1px dashed #000' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>AMOUNT PAID</span><span>{money(amountPaid.toFixed(2))}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}><span>** BALANCE DUE **</span><span>{money(due.toFixed(2))}</span></div>
        </div>
      )}
    </div>
  );
}

function getStyleCSS(style: ReceiptTextStyle | undefined, fallback?: Partial<ReceiptTextStyle>): React.CSSProperties {
  const s = { ...defaultStyle, ...fallback, ...style };
  const isUrdu = URDU_FONTS.includes(s.font);
  return {
    fontFamily: s.font !== 'default' ? `'${s.font}', ${isUrdu ? 'serif' : 'sans-serif'}` : "'Lucida Console', 'Consolas', 'Courier New', monospace",
    fontSize: `${s.size}px`,
    fontWeight: s.bold ? 800 : 400,
    textAlign: s.align,
    direction: isUrdu ? 'rtl' : 'ltr',
    color: '#000',
  };
}

interface Props {
  order: Order;
  settings: RestaurantSettings;
  showPrintButton?: boolean;
  autoPrint?: boolean;
  /** Fired after an autoPrint attempt finishes (native callback / dialog closed). */
  onAutoPrintComplete?: (result: { success: boolean; error?: string }) => void;
}

export default function ReceiptPreview({ order, settings, showPrintButton = true, autoPrint = false, onAutoPrintComplete }: Props) {
  const autoPrintTriggeredRef = useRef(false);
  const previewReceiptRef = useRef<HTMLDivElement | null>(null);
  const printReceiptRef = useRef<HTMLDivElement | null>(null);
  const paperWidth = settings.paperSize || '80mm';
  const scalePercent = getReceiptZoom(settings);
  const scaleFactor = scalePercent / 100;
  const design = settings.receiptDesign || 'classic';
  const margins = getEffectiveReceiptMargins(settings);
  const usePrinterDefaultPageSize = shouldUsePrinterDefaultPageSize(settings);

  const handlePrint = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    const measureEl = printReceiptRef.current || previewReceiptRef.current;
    const measureSessionCleanup = beginThermalPrintDomSession(printReceiptRef.current || measureEl, paperWidth, undefined, settings);
    await waitForThermalPrintLayout();
    // Blank-Receipt Fix: fonts (Urdu Nastaleeq) + logo must be painted BEFORE
    // we measure or rasterize, otherwise the printer gets an empty/short page.
    await waitForPrintAssets(measureEl);
    await waitForThermalPrintLayout();

    // Guard: never send an empty slip to the printer.
    if (!hasPrintableContent(measureEl)) {
      measureSessionCleanup();
      console.warn('[DT-Print] Receipt content empty — print skipped');
      return { success: false, error: 'Receipt content empty — print skipped' };
    }

    const estimatedHeightMm = getThermalPrintJobHeightMm(measureEl, settings);
    const pageWidthMicrons = getThermalPaperWidthMicrons(paperWidth);
    // v1.5.3: per-device strategy decides whether we send the measured page
    // height or let the Windows driver's own roll setting decide (the switch
    // that eliminates driver-side pre-feed on affected Black Copper units).
    const pageStrategy = resolvePageHeight(estimatedHeightMm);
    const pageHeightMicrons = pageStrategy.pageHeightMicrons;
    measureSessionCleanup();

    const triggerBrowserPrint = () => {
      const cleanup = beginThermalPrintDomSession(printReceiptRef.current || measureEl, paperWidth, estimatedHeightMm, settings);

      const cleanupAfterPrint = () => {
        cleanup();
        window.removeEventListener('afterprint', cleanupAfterPrint);
      };

      window.addEventListener('afterprint', cleanupAfterPrint, { once: true });
      window.print();
    };

    // ===== LAN / Network printer support (shared role router, v1.2.3) =====
    // 'counter' role -> customer receipt. If the resolved counter printer is
    // a LAN printer, raw ESC/POS goes over TCP. On LAN failure the receipt
    // still falls back to the system/browser path (same physical station).
    try {
      const { printPortalViaLan } = await import('@/printing/lanPrint');
      const portalEl = (printReceiptRef.current || measureEl) as HTMLElement | null;
      const cleanup = beginThermalPrintDomSession(portalEl, paperWidth, estimatedHeightMm, settings);
      let lanResult: { handled: boolean; success: boolean; error?: string };
      try {
        await waitForThermalPrintLayout();
        lanResult = await printPortalViaLan('counter', portalEl, paperWidth as any);
      } finally {
        cleanup();
      }
      if (lanResult.handled && lanResult.success) return { success: true };
      if (lanResult.handled && !lanResult.success) {
        console.warn('[DT-Print] Receipt LAN print failed, falling back to system path:', lanResult.error);
      }
    } catch (e: any) {
      console.warn('[DT-Print] LAN path failed, falling back:', e?.message || e);
      // fall through to system / browser print below
    }

    // Prefer LOCAL per-device receipt printer over cloud setting.
    const localReceipt = resolveLocalPrinterForRole('receipt');
    const localSilent = getLocalPrinterSettings().silentPrint;
    if (isElectron() && (localSilent || settings.silentPrint)) {
      const nativePrintCleanup = beginThermalPrintDomSession(printReceiptRef.current || measureEl, paperWidth, estimatedHeightMm, settings);
      let result: { success: boolean; error?: string };
      try {
        // Blank-Receipt Fix: let the print session's CSS actually apply before
        // Electron rasterizes the page (previously fired on unsettled layout).
        await waitForThermalPrintLayout();
        const printerName = localReceipt?.printerName || settings.defaultPrinter || localStorage.getItem('pos-default-printer') || undefined;
        result = await printReceiptNative({
          printerName,
          silent: true,
          pageWidthMicrons,
          pageHeightMicrons,
          usePrinterDefaultPageSize: pageStrategy.usePrinterDefaultPageSize,
          autoCut: settings.autoCut !== false,
          cutMode: settings.cutMode || 'full',
          driverType: settings.printerDriverType || 'escpos',
          dpi: 203,
        });
      } finally {
        // WHITE-SCREEN FIX: cleanup runs even if the IPC/print throws.
        nativePrintCleanup();
      }
      try {
        const m = getEffectiveReceiptMargins(settings);
        recordPrintDiag({
          path: 'electron-system',
          kind: 'receipt',
          paperWidth,
          pageHeightMm: pageStrategy.usePrinterDefaultPageSize ? undefined : estimatedHeightMm,
          marginTopMm: m.top,
          marginBottomMm: m.bottom,
          printerName: localReceipt?.printerName || settings.defaultPrinter || undefined,
          success: !!result?.success,
          error: result?.error,
        });
      } catch { /* diagnostics must never break printing */ }
      if (!result.success) {
        triggerBrowserPrint();
        return { success: true };
      }
      return result;
    } else {
      triggerBrowserPrint();
      return { success: true };
    }
  }, [paperWidth, settings, usePrinterDefaultPageSize]);


  useEffect(() => {
    if (!autoPrint || autoPrintTriggeredRef.current) return;
    autoPrintTriggeredRef.current = true;

    const timeout = window.setTimeout(() => {
      handlePrint()
        .then((result) => onAutoPrintComplete?.(result || { success: true }))
        .catch((err) => onAutoPrintComplete?.({ success: false, error: err?.message || String(err) }));
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [autoPrint, handlePrint, onAutoPrintComplete]);

  const wrapperStyle: React.CSSProperties = {
    width: paperWidth,
    maxWidth: paperWidth,
    fontFamily: "Arial, 'Roboto Mono', 'Courier New', sans-serif",
    fontSize: '13px',
    fontWeight: 700,
    lineHeight: 1.28,
    WebkitPrintColorAdjust: 'exact',
    printColorAdjust: 'exact',
    color: '#000',
    background: '#fff',
    height: 'auto',
    minHeight: 0,
    overflow: 'visible',
    boxSizing: 'border-box',
    paddingTop: `${margins.top}mm`,
    paddingBottom: `${margins.bottom}mm`,
    paddingLeft: `${margins.left}mm`,
    paddingRight: `${margins.right}mm`,
  };

  const contentStyle: React.CSSProperties = {
    width: `${100 / scaleFactor}%`,
    zoom: scaleFactor,
    transformOrigin: 'top left',
  };

  const showCombinedKot = settings.autoKitchenPrint && settings.kotCombinedPrint;

  const renderReceiptBody = () => (
    <div className="receipt-print-content" style={contentStyle}>
      {design === 'standard' && <StandardReceipt order={order} settings={settings} />}
      {design === 'compact-thermal' && <StandardReceipt order={order} settings={{ ...settings, receiptCompactMode: true } as any} />}
      {design === 'pre-receipt' && <PreReceiptTemplate order={order} settings={settings} />}
      {design === 'classic' && <ClassicReceipt order={order} settings={settings} />}
      {design === 'modern' && <ModernReceipt order={order} settings={settings} />}
      {design === 'compact' && <CompactReceipt order={order} settings={settings} />}
      {design === 'luxury' && <LuxuryReceipt order={order} settings={settings} />}
      {design === 'executive' && <ExecutiveReceipt order={order} settings={settings} />}
      {design === 'royal' && <RoyalReceipt order={order} settings={settings} />}
      {design === 'bistro' && <BistroReceipt order={order} settings={settings} />}
      {design === 'heritage' && <HeritageReceipt order={order} settings={settings} />}
      {design === 'metro' && <MetroReceipt order={order} settings={settings} />}
      {design === 'shahenshah' && <ShahenshahReceipt order={order} settings={settings} />}
      {design === 'taste-bistro' && <TasteBistroReceipt order={order} settings={settings} />}
      {design === 'food-palace' && <FoodPalaceReceipt order={order} settings={settings} />}
      {design === 'spice-house' && <SpiceHouseReceipt order={order} settings={settings} />}
      {design === 'taimoor' && <TaimoorReceipt order={order} settings={settings} />}
      {design === 'design1-table' && <Design1TableReceipt order={order} settings={settings} />}
      {design === 'design2-box' && <Design2BoxReceipt order={order} settings={settings} />}
      {design === 'design3-modern' && <Design3ModernReceipt order={order} settings={settings} />}
      {design === 'design4-compact' && <Design4CompactReceipt order={order} settings={settings} />}
      {design === 'design5-delivery' && <Design5DeliveryReceipt order={order} settings={settings} />}
      {design === 'sero' && <SeroReceipt order={order} settings={settings} />}
      {design === 'bero' && <BeroReceipt order={order} settings={settings} />}
      {design === 'kot-style' && <KotStyleReceipt order={order} settings={settings} />}
      {design === 'kot-classic' && <KotClassicReceipt order={order} settings={settings} />}
      {/* KOT is printed as a separate auto-cut job — not injected into receipt */}
    </div>
  );

  const renderReceiptNode = (printOnly = false) => (
    <div
        ref={node => {
          if (printOnly) printReceiptRef.current = node;
          else previewReceiptRef.current = node;
        }}
      className={printOnly ? 'receipt-paper print-receipt bg-white text-black' : 'receipt-paper bg-white text-black'}
      data-paper-size={paperWidth}
      style={wrapperStyle}
      data-scale={scalePercent}
    >
      {renderReceiptBody()}
    </div>
  );

  return (
    <>
      <div className="space-y-2">
        <div className="receipt-preview-shell mx-auto w-fit max-w-full rounded-lg border bg-white p-3 shadow-sm">
          {renderReceiptNode()}
        </div>
        {showPrintButton && (
          <Button onClick={handlePrint} variant="outline" className="w-full text-xs">
            <Printer className="h-3 w-3 mr-1" /> Print Receipt
          </Button>
        )}
      </div>
      {typeof document !== 'undefined' && createPortal(
        <div className="receipt-print-portal" aria-hidden="true">
          {renderReceiptNode(true)}
        </div>,
        document.body,
      )}
    </>
  );
}

// ===== SHARED HELPERS =====
function useReceiptData(order: Order, settings: RestaurantSettings) {
  const rs = settings.receiptStyles || {};
  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
  const dateStr = new Date(order.createdAt).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = new Date(order.createdAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const logoW = settings.logoWidth || 60;
  const logoH = settings.logoHeight || 60;
  const hasCustomerDetails = order.customer?.name || order.customer?.phone || order.customer?.address;
  const qrData = JSON.stringify({
    id: order.id, no: order.orderNumber, date: order.createdAt, type: order.orderType,
    total: order.grandTotal,
    ...(order.customer?.name ? { name: order.customer.name } : {}),
    ...(order.customer?.phone ? { phone: order.customer.phone } : {}),
  });
  return { rs, totalQty, dateStr, timeStr, logoW, logoH, hasCustomerDetails, qrData };
}

const cellStyle = { border: '1px solid black', padding: '3px 5px', color: '#000' } as const;

function StatusBadge({ status }: { status: string }) {
  return status === 'paid' ? <>★ PAID ★</> : <>⚠ UNPAID ⚠</>;
}

function PaymentStatusBlock({ order, settings }: { order: Order; settings?: RestaurantSettings }) {
  const paid = order.status === 'paid' && order.paymentMethod !== 'credit';
  // v1.2.5: admin option — unpaid/running band ko slip par chhupa do.
  // Default OFF, to purana behaviour bilkul same rehta hai.
  if (!paid && settings?.hideUnpaidBadgeOnReceipt) return null;
  const statusLabel = (() => {
    if (order.status === 'paid') return order.paymentMethod === 'credit' ? 'CREDIT / UDHAAR' : 'PAID';
    if (order.status === 'running') return 'RUNNING (UNPAID)';
    if (order.status === 'hold') return 'ON HOLD (UNPAID)';
    if (order.status === 'void') return 'VOID';
    if (order.status === 'cancelled') return 'CANCELLED';
    if (order.status === 'complimentary') return 'COMPLIMENTARY';
    if (order.status === 'credit_pending') return 'CREDIT PENDING (UNPAID)';
    return String(order.status || 'UNPAID').toUpperCase();
  })();
  return (
    <div style={{
      textAlign: 'center',
      padding: '6px 4px',
      margin: '4px 0',
      border: paid ? '2px solid #000' : '3px double #000',
      fontSize: '14px',
      fontWeight: 900,
      letterSpacing: '2px',
      background: paid ? '#fff' : '#000',
      color: paid ? '#000' : '#fff',
    }}>
      {paid ? `★ ${statusLabel} ★` : `⚠ ${statusLabel} ⚠`}
    </div>
  );
}


function OrderTypeHeader({ order }: { order: Order; dateStr?: string; timeStr?: string }) {
  return (
    <div style={{ padding: '2px 0', marginBottom: '2px' }}>
      <StandardInfoGrid order={order} fontSize={11} labelWidth={70} />
    </div>
  );
}

function QRSection({ settings, qrData }: { settings: RestaurantSettings; qrData: string }) {
  // Master QR toggle — when explicitly false, never render QR on any receipt
  if (settings.qrEnabled === false) return null;
  const qrW = settings.customQrWidth || 80;
  const qrH = settings.customQrHeight || 80;
  const autoSize = settings.customQrWidth || 80;
  return (
    <div style={{ textAlign: 'center', padding: '5px 0' }}>
      {settings.qrMode === 'custom' && settings.customQrImage && (
        <>
          <p style={{ fontSize: '12px', fontWeight: 800, marginBottom: '2px' }}>Scan to Pay</p>
          {settings.bankName && <p style={{ fontSize: '11px', fontWeight: 700, marginBottom: '3px' }}>{settings.bankName}</p>}
        </>
      )}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        {settings.qrMode === 'custom' && settings.customQrImage
          ? <img src={settings.customQrImage} alt="QR" style={{ width: `${qrW}px`, height: `${qrH}px`, objectFit: 'contain' }} />
          : <QRCodeSVG value={qrData} size={autoSize} level="M" />}
      </div>
    </div>
  );
}

function CustomerDetailsSection({ order, rs }: { order: Order; rs: any }) {
  if (!order.customer?.name && !order.customer?.phone && !order.customer?.address) return null;
  return (
    <div style={{ borderTop: '1px dashed black', marginTop: '4px', paddingTop: '4px' }}>
      <p style={{ ...getStyleCSS(rs.customerDetails, { size: 13, align: 'center', bold: true }), marginBottom: '3px' }}>Customer Details</p>
      <div style={{ ...getStyleCSS(rs.customerDetails, { size: 12, align: 'left', bold: true }), lineHeight: 1.8 }}>
        {order.customer?.name && <div>Name: {order.customer.name}</div>}
        {order.customer?.phone && <div>Phone: {order.customer.phone}</div>}
        {order.customer?.address && <div>Address: {order.customer.address}</div>}
      </div>
      <div style={{ borderBottom: '1px dashed black', marginTop: '4px' }} />
    </div>
  );
}

// ===== DESIGN 1: CLASSIC (original) =====
function ClassicReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, totalQty, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  return (
    <>
      <div className="text-center mb-2">
        {settings.logo && <img src={settings.logo} alt="Logo" className="object-contain mx-auto mb-1" style={{ width: `${logoW}px`, height: `${logoH}px` }} />}
        <h1 style={{ ...getStyleCSS(rs.restaurantName, { size: 20, align: 'center', bold: true }), letterSpacing: '2px', textTransform: 'uppercase', lineHeight: 1.2 }}>{settings.name}</h1>
        <p style={{ ...getStyleCSS(rs.address, { size: 13, align: 'center', bold: true }), marginTop: '4px', lineHeight: 1.4 }}>{settings.address}</p>
        <p style={{ ...getStyleCSS(rs.phone, { size: 13, align: 'center', bold: true }), marginTop: '3px', letterSpacing: '1px' }}>{settings.phone1}{settings.phone2 ? ` | ${settings.phone2}` : ''}</p>
      </div>
      <OrderTypeHeader order={order} dateStr={dateStr} timeStr={timeStr} />
      <div style={{ textAlign: 'center', padding: '4px 0', margin: '2px 0', borderTop: '2px solid black', borderBottom: '2px solid black' }}>
        <span style={{ ...getStyleCSS(rs.orderId, { size: 16, align: 'center', bold: true }), letterSpacing: '2px' }}>ORDER # {order.orderNumber}</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '4px', fontSize: '12px' }}>
        <thead><tr>
          <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 800 }}>Description</th>
          <th style={{ ...cellStyle, textAlign: 'right', fontWeight: 800, width: '55px' }}>Rate</th>
          <th style={{ ...cellStyle, textAlign: 'center', fontWeight: 800, width: '32px' }}>Qty</th>
          <th style={{ ...cellStyle, textAlign: 'right', fontWeight: 800, width: '60px' }}>Amount</th>
        </tr></thead>
        <tbody>
          {order.items.map(item => (
            <tr key={item.id}>
              <td style={{ ...cellStyle, ...getStyleCSS(rs.items, { size: 12, align: 'left', bold: true }) }}>{item.name.toUpperCase()}{item.note && <div style={{ fontSize: '9px', fontWeight: 600, color: '#333' }}>↳ {item.note}</div>}</td>
              <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 700 }}>{item.price.toFixed(2)}</td>
              <td style={{ ...cellStyle, textAlign: 'center', fontWeight: 700 }}>{item.quantity.toFixed(2)}</td>
              <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 700 }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <TotalsTable order={order} totalQty={totalQty} rs={rs} bordered />
      <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', padding: '4px 0', borderBottom: '1px solid black' }}>RUPEES {numberToWords(Math.round(order.grandTotal))} ONLY</div>
      <div style={{ padding: '5px 0', letterSpacing: '2px', ...getStyleCSS(rs.status, { size: 16, align: 'center', bold: true }) }}><StatusBadge status={order.status} /></div>
      {settings.receiptFooter && (<><div style={{ borderTop: '1px dashed black' }} /><p style={{ ...getStyleCSS(rs.footer, { size: 12, align: 'center', bold: true }), padding: '4px 0', whiteSpace: 'pre-line', lineHeight: 1.3 }}>{settings.receiptFooter}</p></>)}
      {order.cashierName && <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, padding: '3px 0', borderTop: '1px dashed black' }}>Processed By: {order.cashierName}</div>}
      <PaymentBlock order={order} />
      <VisitAgainBlock rs={rs} settings={settings} />
      <BrandFooter settings={settings} rs={rs} />
      <div style={{ borderTop: '1px dashed black' }} />
      <QRSection settings={settings} qrData={qrData} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== DESIGN 2: MODERN BRANDED =====
function ModernReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, totalQty, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  return (
    <>
      <div style={{ textAlign: 'center', borderBottom: '3px double black', paddingBottom: '6px', marginBottom: '6px' }}>
        {settings.logo && <img src={settings.logo} alt="Logo" className="object-contain mx-auto mb-1" style={{ width: `${logoW}px`, height: `${logoH}px` }} />}
        <h1 style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '3px', textTransform: 'uppercase', color: '#000' }}>{settings.name}</h1>
        <p style={{ fontSize: '11px', fontWeight: 600, color: '#333', marginTop: '2px' }}>{settings.address}</p>
        <p style={{ fontSize: '11px', fontWeight: 600, color: '#333' }}>{settings.phone1}{settings.phone2 ? ` • ${settings.phone2}` : ''}</p>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, color: '#000', padding: '3px 0' }}>
        <span>{dateStr} {timeStr}</span>
        <span style={{ textTransform: 'uppercase', background: '#000', color: '#fff', padding: '1px 6px', fontSize: '10px' }}>{order.orderType}</span>
      </div>
      <OrderTypeHeader order={order} dateStr={dateStr} timeStr={timeStr} />
      <div style={{ background: '#000', color: '#fff', textAlign: 'center', padding: '4px', fontSize: '14px', fontWeight: 800, letterSpacing: '2px', margin: '4px 0' }}>ORDER #{order.orderNumber}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
        <thead><tr style={{ borderBottom: '2px solid #000' }}>
          <th style={{ textAlign: 'left', padding: '3px 2px', fontWeight: 800 }}>ITEM</th>
          <th style={{ textAlign: 'center', padding: '3px 2px', fontWeight: 800, width: '30px' }}>QTY</th>
          <th style={{ textAlign: 'right', padding: '3px 2px', fontWeight: 800, width: '55px' }}>AMOUNT</th>
        </tr></thead>
        <tbody>
          {order.items.map(item => (
            <tr key={item.id} style={{ borderBottom: '1px dotted #999' }}>
              <td style={{ padding: '3px 2px', fontWeight: 600, color: '#000' }}>{item.name}{item.note && <div style={{ fontSize: '9px', color: '#666' }}>  {item.note}</div>}</td>
              <td style={{ textAlign: 'center', padding: '3px 2px', fontWeight: 600 }}>{item.quantity}</td>
              <td style={{ textAlign: 'right', padding: '3px 2px', fontWeight: 700 }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ borderTop: '2px solid #000', marginTop: '4px', paddingTop: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 600 }}><span>Subtotal ({totalQty} items)</span><span>{order.subtotal.toFixed(2)}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 600 }}><span>Discount</span><span>-{order.discount.toFixed(2)}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 600 }}><span>Tax</span><span>{order.tax.toFixed(2)}</span></div>}
        {order.serviceCharge > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 600 }}><span>Service ({order.serviceChargePercent}%)</span><span>{order.serviceCharge.toFixed(2)}</span></div>}
      </div>
      <div style={{ background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', padding: '5px 6px', fontSize: '16px', fontWeight: 800, margin: '4px 0' }}>
        <span>TOTAL</span><span>{money(order.grandTotal.toFixed(2))}</span>
      </div>
      <div style={{ textAlign: 'center', fontSize: '10px', fontWeight: 600, color: '#333', padding: '2px 0' }}>RUPEES {numberToWords(Math.round(order.grandTotal))} ONLY</div>
      <div style={{ textAlign: 'center', padding: '4px 0', fontSize: '14px', fontWeight: 800, letterSpacing: '1px' }}><StatusBadge status={order.status} /></div>
      {settings.receiptFooter && <p style={{ textAlign: 'center', fontSize: '11px', fontWeight: 600, padding: '3px 0', borderTop: '1px dashed #999', whiteSpace: 'pre-line' }}>{settings.receiptFooter}</p>}
      {order.cashierName && <div style={{ textAlign: 'center', fontSize: '10px', fontWeight: 600, color: '#666' }}>Cashier: {order.cashierName}</div>}
      <PaymentBlock order={order} />
      <VisitAgainBlock rs={rs} settings={settings} />
      <BrandFooter settings={settings} rs={rs} />
      <QRSection settings={settings} qrData={qrData} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== DESIGN 3: COMPACT MINI (paper saver) =====
function CompactReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { totalQty, dateStr, timeStr } = useReceiptData(order, settings);
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '3px' }}>
        <h1 style={{ fontSize: '14px', fontWeight: 800, color: '#000' }}>{settings.name}</h1>
        <p style={{ fontSize: '9px', color: '#333' }}>{settings.address} | {settings.phone1}</p>
      </div>
      <div style={{ fontSize: '9px', fontWeight: 700, color: '#000', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '2px 0' }}>
        <span>#{order.orderNumber}</span><span>{dateStr}</span><span>{timeStr}</span>
      </div>
      {order.items.map(item => (
        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 600, padding: '1px 0', borderBottom: '1px dotted #ccc', color: '#000' }}>
          <span style={{ flex: 1 }}>{item.name} x{item.quantity}</span>
          <span>{item.lineTotal.toFixed(0)}</span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid #000', marginTop: '2px', paddingTop: '2px' }}>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontWeight: 600 }}><span>Disc</span><span>-{order.discount.toFixed(0)}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontWeight: 600 }}><span>Tax</span><span>{order.tax.toFixed(0)}</span></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 800, borderTop: '2px solid #000', padding: '3px 0', color: '#000' }}>
          <span>TOTAL ({totalQty})</span><span>{money(order.grandTotal.toFixed(0))}</span>
        </div>
      </div>
      <div style={{ textAlign: 'center', fontSize: '10px', fontWeight: 700, padding: '2px 0' }}><StatusBadge status={order.status} /></div>
      {order.cashierName && <div style={{ textAlign: 'center', fontSize: '8px', color: '#666' }}>By: {order.cashierName}</div>}
      <PaymentBlock order={order} />
      <VisitAgainBlock rs={{ visitAgain: settings.receiptStyles?.visitAgain }} settings={settings} />
      <BrandFooter settings={settings} rs={{ marketingFooter: settings.receiptStyles?.marketingFooter }} />
      {(settings.qrEnabled !== false && settings.qrMode === 'custom' && settings.customQrImage) && (
        <div style={{ textAlign: 'center', padding: '3px 0' }}>
          <img src={settings.customQrImage} alt="QR" style={{ height: '50px', width: '50px', margin: '0 auto' }} />
        </div>
      )}
    </>
  );
}

// ===== DESIGN 4: LUXURY VIP =====
function LuxuryReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, totalQty, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  return (
    <>
      <div style={{ textAlign: 'center', borderBottom: '2px solid #000', paddingBottom: '8px', marginBottom: '6px' }}>
        <div style={{ border: '2px solid #000', padding: '6px', marginBottom: '4px' }}>
          {settings.logo && <img src={settings.logo} alt="Logo" className="object-contain mx-auto mb-1" style={{ width: `${logoW}px`, height: `${logoH}px` }} />}
          <h1 style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '4px', textTransform: 'uppercase', color: '#000', fontFamily: 'Georgia, serif' }}>{settings.name}</h1>
        </div>
        <p style={{ fontSize: '11px', fontWeight: 700, fontStyle: 'italic', color: '#333', marginTop: '3px' }}>{settings.address}</p>
        <p style={{ fontSize: '12px', fontWeight: 700, color: '#000', letterSpacing: '2px' }}>☎ {settings.phone1}{settings.phone2 ? ` | ${settings.phone2}` : ''}</p>
      </div>

      <OrderTypeHeader order={order} dateStr={dateStr} timeStr={timeStr} />

      <div style={{ border: '2px solid #000', textAlign: 'center', padding: '5px', margin: '4px 0' }}>
        <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '3px', color: '#333' }}>— ORDER —</div>
        <div style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '3px', color: '#000' }}>#{order.orderNumber}</div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginTop: '4px' }}>
        <thead><tr style={{ borderTop: '2px solid #000', borderBottom: '2px solid #000' }}>
          <th style={{ textAlign: 'left', padding: '4px 3px', fontWeight: 800, fontFamily: 'Georgia, serif' }}>Item</th>
          <th style={{ textAlign: 'right', padding: '4px 3px', fontWeight: 800, width: '40px' }}>Rate</th>
          <th style={{ textAlign: 'center', padding: '4px 3px', fontWeight: 800, width: '28px' }}>Qty</th>
          <th style={{ textAlign: 'right', padding: '4px 3px', fontWeight: 800, width: '50px' }}>Total</th>
        </tr></thead>
        <tbody>
          {order.items.map(item => (
            <tr key={item.id} style={{ borderBottom: '1px solid #ddd' }}>
              <td style={{ padding: '4px 3px', fontWeight: 700, color: '#000', fontFamily: 'Georgia, serif' }}>{item.name}{item.note && <div style={{ fontSize: '8px', fontStyle: 'italic', color: '#666' }}>{item.note}</div>}</td>
              <td style={{ textAlign: 'right', padding: '4px 3px', fontWeight: 600 }}>{item.price.toFixed(0)}</td>
              <td style={{ textAlign: 'center', padding: '4px 3px', fontWeight: 600 }}>{item.quantity}</td>
              <td style={{ textAlign: 'right', padding: '4px 3px', fontWeight: 700 }}>{item.lineTotal.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ borderTop: '2px solid #000', marginTop: '4px', paddingTop: '4px', fontSize: '11px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}><span>Subtotal ({totalQty} items)</span><span>{order.subtotal.toFixed(2)}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}><span>Discount</span><span>-{order.discount.toFixed(2)}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}><span>Tax</span><span>{order.tax.toFixed(2)}</span></div>}
        {order.serviceCharge > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}><span>Service ({order.serviceChargePercent}%)</span><span>{order.serviceCharge.toFixed(2)}</span></div>}
      </div>

      <div style={{ border: '3px double #000', textAlign: 'center', padding: '6px', margin: '6px 0' }}>
        <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '3px', color: '#666' }}>GRAND TOTAL</div>
        <div style={{ fontSize: '20px', fontWeight: 800, color: '#000', fontFamily: 'Georgia, serif' }}>{money(order.grandTotal.toFixed(2))}</div>
        <div style={{ fontSize: '9px', fontWeight: 600, color: '#333', marginTop: '2px' }}>RUPEES {numberToWords(Math.round(order.grandTotal))} ONLY</div>
      </div>

      <div style={{ textAlign: 'center', padding: '4px 0', fontSize: '16px', fontWeight: 800, letterSpacing: '2px' }}><StatusBadge status={order.status} /></div>

      {settings.receiptFooter && (<div style={{ borderTop: '1px solid #000', padding: '4px 0', textAlign: 'center', fontSize: '11px', fontWeight: 600, fontStyle: 'italic', whiteSpace: 'pre-line' }}>{settings.receiptFooter}</div>)}
      {order.cashierName && <div style={{ textAlign: 'center', fontSize: '10px', fontWeight: 600, padding: '2px 0', color: '#666' }}>Served by: {order.cashierName}</div>}
      <PaymentBlock order={order} />
      <VisitAgainBlock rs={rs} settings={settings} />
      <BrandFooter settings={settings} rs={rs} />

      <div style={{ borderTop: '2px solid #000', marginTop: '4px' }} />
      <div style={{ borderTop: '1px dashed black' }} />
      <QRSection settings={settings} qrData={qrData} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== TOTALS TABLE (used by Classic) =====
function TotalsTable({ order, totalQty, rs, bordered }: { order: Order; totalQty: number; rs: any; bordered?: boolean }) {
  const cs = bordered ? cellStyle : { padding: '3px 5px', color: '#000' };
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0', ...getStyleCSS(rs.totals, { size: 12, align: 'right', bold: true }) }}>
      <tbody>
        <tr><td style={{ ...cs, fontWeight: 700 }}>Items: {totalQty}</td><td style={{ ...cs, textAlign: 'right', fontWeight: 800 }}>Sub Total</td><td style={{ ...cs, textAlign: 'right', fontWeight: 800, width: '80px' }}>{order.subtotal.toFixed(2)}</td></tr>
        {order.discount > 0 && <tr><td colSpan={2} style={{ ...cs, textAlign: 'right', fontWeight: 700 }}>Discount</td><td style={{ ...cs, textAlign: 'right', fontWeight: 700 }}>-{order.discount.toFixed(2)}</td></tr>}
        {order.tax > 0 && <tr><td colSpan={2} style={{ ...cs, textAlign: 'right', fontWeight: 700 }}>Tax</td><td style={{ ...cs, textAlign: 'right', fontWeight: 700 }}>{order.tax.toFixed(2)}</td></tr>}
        {order.serviceCharge > 0 && <tr><td colSpan={2} style={{ ...cs, textAlign: 'right', fontWeight: 700 }}>Service ({order.serviceChargePercent}%)</td><td style={{ ...cs, textAlign: 'right', fontWeight: 700 }}>{order.serviceCharge.toFixed(2)}</td></tr>}
        <tr><td colSpan={2} style={{ border: '2px solid black', padding: '4px 5px', textAlign: 'right', ...getStyleCSS(rs.totals, { size: 14, bold: true }) }}>Grand Total</td><td style={{ border: '2px solid black', padding: '4px 5px', textAlign: 'right', ...getStyleCSS(rs.totals, { size: 14, bold: true }) }}>{order.grandTotal.toFixed(2)}</td></tr>
      </tbody>
    </table>
  );
}

// ===== DESIGN 5: EXECUTIVE (premium corporate) =====
function ExecutiveReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, totalQty, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  const monogram = (settings.name || 'R').trim().charAt(0).toUpperCase();
  return (
    <>
      <div style={{ borderTop: '4px solid #000', borderBottom: '1px solid #000', padding: '6px 0', marginBottom: '6px', textAlign: 'center' }}>
        {settings.logo
          ? <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 4px' }} />
          : <div style={{ width: '40px', height: '40px', border: '2px solid #000', margin: '0 auto 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 900, fontFamily: 'Georgia, serif' }}>{monogram}</div>}
        <h1 style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '6px', textTransform: 'uppercase', color: '#000' }}>{settings.name}</h1>
        <div style={{ fontSize: '8px', letterSpacing: '4px', textTransform: 'uppercase', color: '#444', marginTop: '2px' }}>— Executive Invoice —</div>
        <p style={{ fontSize: '10px', fontWeight: 600, color: '#222', marginTop: '4px' }}>{settings.address}</p>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#000' }}>Tel: {settings.phone1}{settings.phone2 ? ` / ${settings.phone2}` : ''}</p>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 700, padding: '3px 4px', background: '#000', color: '#fff', marginBottom: '4px' }}>
        <span>INVOICE #{order.orderNumber}</span>
        <span style={{ textTransform: 'uppercase' }}>{order.orderType}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 600, padding: '2px 0', borderBottom: '1px solid #000', marginBottom: '4px' }}>
        <span>Date: {dateStr}</span><span>Time: {timeStr}</span>
      </div>
      <OrderTypeHeader order={order} dateStr={dateStr} timeStr={timeStr} />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginTop: '4px' }}>
        <thead><tr style={{ borderBottom: '2px solid #000' }}>
          <th style={{ textAlign: 'left', padding: '4px 2px', fontWeight: 900, textTransform: 'uppercase', fontSize: '9px', letterSpacing: '1px' }}>Description</th>
          <th style={{ textAlign: 'center', padding: '4px 2px', fontWeight: 900, fontSize: '9px', width: '30px' }}>QTY</th>
          <th style={{ textAlign: 'right', padding: '4px 2px', fontWeight: 900, fontSize: '9px', width: '45px' }}>RATE</th>
          <th style={{ textAlign: 'right', padding: '4px 2px', fontWeight: 900, fontSize: '9px', width: '55px' }}>AMOUNT</th>
        </tr></thead>
        <tbody>
          {order.items.map((item, i) => (
            <tr key={item.id} style={{ background: i % 2 === 1 ? '#f4f4f4' : '#fff' }}>
              <td style={{ padding: '4px 2px', fontWeight: 700, color: '#000' }}>{item.name}{item.note && <div style={{ fontSize: '8px', fontStyle: 'italic', color: '#555' }}>{item.note}</div>}</td>
              <td style={{ textAlign: 'center', padding: '4px 2px', fontWeight: 700 }}>{item.quantity}</td>
              <td style={{ textAlign: 'right', padding: '4px 2px', fontWeight: 600 }}>{item.price.toFixed(2)}</td>
              <td style={{ textAlign: 'right', padding: '4px 2px', fontWeight: 800 }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ borderTop: '2px solid #000', marginTop: '6px', padding: '4px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 600, padding: '1px 0' }}><span>Subtotal ({totalQty} items)</span><span>{order.subtotal.toFixed(2)}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 600 }}><span>Discount</span><span>-{order.discount.toFixed(2)}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 600 }}><span>Tax</span><span>{order.tax.toFixed(2)}</span></div>}
        {order.serviceCharge > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 600 }}><span>Service ({order.serviceChargePercent}%)</span><span>{order.serviceCharge.toFixed(2)}</span></div>}
      </div>
      <div style={{ background: '#000', color: '#fff', padding: '6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '2px' }}>GRAND TOTAL</span>
        <span style={{ fontSize: '17px', fontWeight: 900 }}>{money(order.grandTotal.toFixed(2))}</span>
      </div>
      <div style={{ textAlign: 'center', fontSize: '9px', fontWeight: 600, padding: '3px 0', borderBottom: '1px solid #000' }}>RUPEES {numberToWords(Math.round(order.grandTotal))} ONLY</div>
      <div style={{ textAlign: 'center', padding: '5px 0', fontSize: '14px', fontWeight: 900, letterSpacing: '3px' }}><StatusBadge status={order.status} /></div>
      {settings.receiptFooter && <p style={{ textAlign: 'center', fontSize: '10px', fontWeight: 600, padding: '3px 0', borderTop: '1px dashed #000', whiteSpace: 'pre-line', fontStyle: 'italic' }}>{settings.receiptFooter}</p>}
      {order.cashierName && <div style={{ textAlign: 'center', fontSize: '9px', fontWeight: 600, color: '#444' }}>Served by: {order.cashierName}</div>}
      <div style={{ borderTop: '2px solid #000', marginTop: '4px' }}>
        <PaymentBlock order={order} />
      <VisitAgainBlock rs={rs} settings={settings} />
      </div>
      <BrandFooter settings={settings} rs={rs} />
      <QRSection settings={settings} qrData={qrData} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== DESIGN 6: ROYAL (fine dining with ornaments) =====
function RoyalReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, totalQty, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  const ornament = '✦ ❖ ✦ ❖ ✦ ❖ ✦ ❖ ✦ ❖ ✦';
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '6px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '4px', color: '#000' }}>{ornament}</div>
        {settings.logo && <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '6px auto 4px' }} />}
        <h1 style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '3px', fontFamily: 'Georgia, "Times New Roman", serif', color: '#000', marginTop: '4px' }}>{settings.name}</h1>
        <div style={{ fontSize: '8px', letterSpacing: '5px', textTransform: 'uppercase', color: '#555', marginTop: '3px' }}>est. fine dining</div>
        <p style={{ fontSize: '10px', fontStyle: 'italic', color: '#222', marginTop: '4px' }}>{settings.address}</p>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#000' }}>☎ {settings.phone1}{settings.phone2 ? ` ✦ ${settings.phone2}` : ''}</p>
        <div style={{ fontSize: '10px', letterSpacing: '4px', color: '#000', marginTop: '4px' }}>{ornament}</div>
      </div>
      <OrderTypeHeader order={order} dateStr={dateStr} timeStr={timeStr} />
      <div style={{ textAlign: 'center', padding: '6px 0', borderTop: '1px solid #000', borderBottom: '1px solid #000', margin: '4px 0' }}>
        <div style={{ fontSize: '8px', letterSpacing: '5px', color: '#555', textTransform: 'uppercase' }}>— Order No —</div>
        <div style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'Georgia, serif', letterSpacing: '4px', color: '#000' }}>{order.orderNumber}</div>
      </div>
      <div style={{ marginTop: '4px' }}>
        {order.items.map((item, i) => (
          <div key={item.id} style={{ padding: '4px 0', borderBottom: i < order.items.length - 1 ? '1px dotted #999' : 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'Georgia, serif', color: '#000', flex: 1 }}>{item.name}</span>
              <span style={{ fontSize: '11px', fontWeight: 800, fontFamily: 'Georgia, serif' }}>{money(item.lineTotal.toFixed(2))}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#555', fontStyle: 'italic' }}>
              <span>{item.quantity} × {item.price.toFixed(2)}</span>
              {item.note && <span>↳ {item.note}</span>}
            </div>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid #000', marginTop: '6px', padding: '4px 0', fontSize: '11px', fontFamily: 'Georgia, serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}><span>Subtotal ({totalQty})</span><span>{order.subtotal.toFixed(2)}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Discount</span><span>-{order.discount.toFixed(2)}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tax</span><span>{order.tax.toFixed(2)}</span></div>}
        {order.serviceCharge > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Service ({order.serviceChargePercent}%)</span><span>{order.serviceCharge.toFixed(2)}</span></div>}
      </div>
      <div style={{ textAlign: 'center', border: '3px double #000', padding: '8px', margin: '4px 0', fontFamily: 'Georgia, serif' }}>
        <div style={{ fontSize: '9px', letterSpacing: '4px', color: '#555' }}>✦ GRAND TOTAL ✦</div>
        <div style={{ fontSize: '22px', fontWeight: 800, color: '#000', marginTop: '3px' }}>{money(order.grandTotal.toFixed(2))}</div>
        <div style={{ fontSize: '8px', fontStyle: 'italic', color: '#444', marginTop: '3px' }}>{numberToWords(Math.round(order.grandTotal))} Rupees Only</div>
      </div>
      <div style={{ textAlign: 'center', padding: '4px 0', fontSize: '14px', fontWeight: 800, letterSpacing: '3px' }}><StatusBadge status={order.status} /></div>
      {settings.receiptFooter && <div style={{ borderTop: '1px solid #000', padding: '4px 0', textAlign: 'center', fontSize: '10px', fontStyle: 'italic', whiteSpace: 'pre-line', fontFamily: 'Georgia, serif' }}>{settings.receiptFooter}</div>}
      {order.cashierName && <div style={{ textAlign: 'center', fontSize: '9px', color: '#555', fontStyle: 'italic' }}>Served by {order.cashierName}</div>}
      <div style={{ textAlign: 'center', padding: '8px 0', marginTop: '4px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '4px', color: '#000' }}>{ornament}</div>
        <PaymentBlock order={order} />
      <VisitAgainBlock rs={rs} settings={settings} />
        <div style={{ fontSize: '10px', letterSpacing: '4px', color: '#000', marginTop: '4px' }}>{ornament}</div>
      </div>
      <BrandFooter settings={settings} rs={rs} />
      <QRSection settings={settings} qrData={qrData} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== DESIGN 7: BISTRO (friendly café) =====
function BistroReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, totalQty, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  const wave = '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~';
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '4px' }}>
        {settings.logo && <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 4px' }} />}
        <h1 style={{ fontSize: '20px', fontWeight: 900, color: '#000', fontFamily: '"Comic Sans MS", "Trebuchet MS", sans-serif' }}>{settings.name}</h1>
        <div style={{ fontSize: '10px', fontWeight: 600, color: '#444', marginTop: '2px' }}>♥ good food, good mood ♥</div>
        <p style={{ fontSize: '10px', color: '#222', marginTop: '3px' }}>{settings.address}</p>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#000' }}>☏ {settings.phone1}{settings.phone2 ? ` • ${settings.phone2}` : ''}</p>
      </div>
      <div style={{ fontSize: '9px', textAlign: 'center', letterSpacing: '2px' }}>{wave}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, padding: '4px 0' }}>
        <span>Order #{order.orderNumber}</span>
        <span style={{ background: '#000', color: '#fff', padding: '1px 8px', borderRadius: '10px', fontSize: '9px', textTransform: 'uppercase' }}>{order.orderType}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#444', paddingBottom: '4px' }}>
        <span>{dateStr}</span><span>{timeStr}</span>
      </div>
      <OrderTypeHeader order={order} dateStr={dateStr} timeStr={timeStr} />
      <div style={{ fontSize: '9px', textAlign: 'center', letterSpacing: '2px' }}>{wave}</div>
      <div style={{ marginTop: '4px' }}>
        {order.items.map(item => (
          <div key={item.id} style={{ padding: '4px 0', borderBottom: '1px dashed #bbb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 700, color: '#000' }}>
              <span style={{ flex: 1 }}>★ {item.name}</span>
              <span>{item.lineTotal.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#666', paddingLeft: '12px' }}>
              <span>{item.quantity} × {money(item.price.toFixed(2))}</span>
              {item.note && <span>“{item.note}”</span>}
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: '9px', textAlign: 'center', letterSpacing: '2px', marginTop: '4px' }}>{wave}</div>
      <div style={{ padding: '4px 0', fontSize: '11px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal ({totalQty})</span><span>{order.subtotal.toFixed(2)}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>♥ Discount</span><span>-{order.discount.toFixed(2)}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tax</span><span>{order.tax.toFixed(2)}</span></div>}
        {order.serviceCharge > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Service ({order.serviceChargePercent}%)</span><span>{order.serviceCharge.toFixed(2)}</span></div>}
      </div>
      <div style={{ border: '2px dashed #000', padding: '6px', textAlign: 'center', borderRadius: '8px' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, color: '#444' }}>YOUR TOTAL</div>
        <div style={{ fontSize: '20px', fontWeight: 900, color: '#000' }}>{money(order.grandTotal.toFixed(2))}</div>
      </div>
      <div style={{ textAlign: 'center', padding: '4px 0', fontSize: '13px', fontWeight: 800 }}><StatusBadge status={order.status} /></div>
      {settings.receiptFooter && <p style={{ textAlign: 'center', fontSize: '10px', fontWeight: 600, padding: '3px 0', whiteSpace: 'pre-line' }}>{settings.receiptFooter}</p>}
      {order.cashierName && <div style={{ textAlign: 'center', fontSize: '9px', color: '#666' }}>♥ {order.cashierName}</div>}
      <div style={{ textAlign: 'center', padding: '6px 0' }}>
        <PaymentBlock order={order} />
      <VisitAgainBlock rs={rs} settings={settings} />
      </div>
      <BrandFooter settings={settings} rs={rs} />
      <QRSection settings={settings} qrData={qrData} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}


// ===== DESIGN 8: HERITAGE (vintage ledger) =====
function HeritageReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, totalQty, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  const rule = '═══════════════════════════════';
  return (
    <>
      <div style={{ textAlign: 'center', padding: '6px', border: '1px solid #000', marginBottom: '6px', fontFamily: 'Georgia, "Times New Roman", serif' }}>
        {settings.logo && <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 4px' }} />}
        <div style={{ display: 'inline-block', border: '2px solid #000', padding: '4px 14px', textTransform: 'uppercase' }}>
          <div style={{ fontSize: '7px', letterSpacing: '4px', color: '#444' }}>Established</div>
          <h1 style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '3px', color: '#000', margin: 0 }}>{settings.name}</h1>
          <div style={{ fontSize: '7px', letterSpacing: '4px', color: '#444' }}>Since · Always</div>
        </div>
        <p style={{ fontSize: '10px', fontStyle: 'italic', color: '#222', marginTop: '5px' }}>{settings.address}</p>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#000' }}>Tel · {settings.phone1}{settings.phone2 ? ` · ${settings.phone2}` : ''}</p>
      </div>
      <OrderTypeHeader order={order} dateStr={dateStr} timeStr={timeStr} />
      <div style={{ textAlign: 'center', fontSize: '10px', color: '#000', letterSpacing: '2px' }}>{rule}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'Georgia, serif', padding: '4px 0', fontSize: '12px', fontWeight: 700 }}>
        <span>Folio №</span><span>{order.orderNumber}</span>
      </div>
      <div style={{ textAlign: 'center', fontSize: '10px', color: '#000', letterSpacing: '2px' }}>{rule}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginTop: '4px', fontFamily: 'Georgia, serif' }}>
        <thead><tr style={{ borderBottom: '1px solid #000' }}>
          <th style={{ textAlign: 'left', padding: '3px 2px', fontWeight: 800, fontStyle: 'italic' }}>Particulars</th>
          <th style={{ textAlign: 'center', padding: '3px 2px', fontWeight: 800, width: '30px', fontStyle: 'italic' }}>Qty</th>
          <th style={{ textAlign: 'right', padding: '3px 2px', fontWeight: 800, width: '55px', fontStyle: 'italic' }}>Amount</th>
        </tr></thead>
        <tbody>
          {order.items.map(item => (
            <tr key={item.id} style={{ borderBottom: '1px dotted #888' }}>
              <td style={{ padding: '3px 2px', fontWeight: 700, color: '#000' }}>{item.name}{item.note && <div style={{ fontSize: '8px', fontStyle: 'italic', color: '#666' }}>— {item.note}</div>}</td>
              <td style={{ textAlign: 'center', padding: '3px 2px' }}>{item.quantity}</td>
              <td style={{ textAlign: 'right', padding: '3px 2px', fontWeight: 700 }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ borderTop: '1px solid #000', marginTop: '4px', padding: '4px 0', fontFamily: 'Georgia, serif', fontSize: '11px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal ({totalQty})</span><span>{order.subtotal.toFixed(2)}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Discount</span><span>-{order.discount.toFixed(2)}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tax</span><span>{order.tax.toFixed(2)}</span></div>}
        {order.serviceCharge > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Service ({order.serviceChargePercent}%)</span><span>{order.serviceCharge.toFixed(2)}</span></div>}
      </div>
      <div style={{ border: '2px solid #000', padding: '6px', textAlign: 'center', fontFamily: 'Georgia, serif', margin: '4px 0' }}>
        <div style={{ fontSize: '9px', letterSpacing: '3px', color: '#444', textTransform: 'uppercase' }}>Sum Total</div>
        <div style={{ fontSize: '20px', fontWeight: 800, color: '#000' }}>{money(order.grandTotal.toFixed(2))}</div>
        <div style={{ fontSize: '8px', fontStyle: 'italic', color: '#444', marginTop: '2px' }}>{numberToWords(Math.round(order.grandTotal))} Rupees Only</div>
      </div>
      <div style={{ textAlign: 'center', padding: '4px 0', fontSize: '13px', fontWeight: 800, letterSpacing: '3px' }}><StatusBadge status={order.status} /></div>
      {settings.receiptFooter && <p style={{ textAlign: 'center', fontSize: '10px', fontStyle: 'italic', padding: '3px 0', borderTop: '1px solid #000', whiteSpace: 'pre-line', fontFamily: 'Georgia, serif' }}>{settings.receiptFooter}</p>}
      {order.cashierName && <div style={{ textAlign: 'center', fontSize: '9px', color: '#555', fontStyle: 'italic' }}>Clerk · {order.cashierName}</div>}
      <PaymentBlock order={order} />
      <VisitAgainBlock rs={rs} settings={settings} />
      <BrandFooter settings={settings} rs={rs} />
      <QRSection settings={settings} qrData={qrData} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== DESIGN 9: METRO (transit ticket) =====
function MetroReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, totalQty, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  return (
    <>
      <div style={{ background: '#000', color: '#fff', padding: '6px 8px', textAlign: 'center', marginBottom: '4px' }}>
        {settings.logo && <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 4px', filter: 'invert(1)' }} />}
        <h1 style={{ fontSize: '20px', fontWeight: 900, letterSpacing: '6px', textTransform: 'uppercase', margin: 0 }}>{settings.name}</h1>
        <div style={{ fontSize: '8px', letterSpacing: '5px', marginTop: '2px', opacity: 0.85 }}>· · · TICKET · · ·</div>
      </div>
      <div style={{ fontSize: '10px', fontWeight: 700, color: '#000', textAlign: 'center', padding: '2px 0' }}>{settings.address}</div>
      <div style={{ fontSize: '10px', fontWeight: 700, color: '#000', textAlign: 'center' }}>{settings.phone1}{settings.phone2 ? ` / ${settings.phone2}` : ''}</div>
      <OrderTypeHeader order={order} dateStr={dateStr} timeStr={timeStr} />
      <div style={{ display: 'flex', margin: '4px 0', border: '2px solid #000' }}>
        <div style={{ flex: 1, padding: '4px 6px', borderRight: '2px dashed #000' }}>
          <div style={{ fontSize: '8px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase' }}>Ticket №</div>
          <div style={{ fontSize: '18px', fontWeight: 900, color: '#000' }}>#{order.orderNumber}</div>
        </div>
        <div style={{ flex: 1, padding: '4px 6px', textAlign: 'right' }}>
          <div style={{ fontSize: '8px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase' }}>Issued</div>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#000' }}>{dateStr}</div>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#000' }}>{timeStr}</div>
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginTop: '4px' }}>
        <thead><tr style={{ background: '#000', color: '#fff' }}>
          <th style={{ textAlign: 'left', padding: '3px 4px', fontWeight: 800, textTransform: 'uppercase', fontSize: '9px', letterSpacing: '1px' }}>Item</th>
          <th style={{ textAlign: 'center', padding: '3px 4px', fontWeight: 800, fontSize: '9px', width: '30px' }}>Qty</th>
          <th style={{ textAlign: 'right', padding: '3px 4px', fontWeight: 800, fontSize: '9px', width: '55px' }}>Fare</th>
        </tr></thead>
        <tbody>
          {order.items.map((item, i) => (
            <tr key={item.id} style={{ borderBottom: '1px solid #000', background: i % 2 ? '#f0f0f0' : '#fff' }}>
              <td style={{ padding: '3px 4px', fontWeight: 700, color: '#000', textTransform: 'uppercase' }}>{item.name}{item.note && <div style={{ fontSize: '8px', textTransform: 'none', color: '#555' }}>{item.note}</div>}</td>
              <td style={{ textAlign: 'center', padding: '3px 4px', fontWeight: 700 }}>{item.quantity}</td>
              <td style={{ textAlign: 'right', padding: '3px 4px', fontWeight: 800 }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ borderTop: '2px solid #000', marginTop: '4px', padding: '4px 0', fontSize: '11px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>Subtotal ({totalQty})</span><span>{order.subtotal.toFixed(2)}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>Discount</span><span>-{order.discount.toFixed(2)}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>Tax</span><span>{order.tax.toFixed(2)}</span></div>}
        {order.serviceCharge > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>Service ({order.serviceChargePercent}%)</span><span>{order.serviceCharge.toFixed(2)}</span></div>}
      </div>
      <div style={{ background: '#000', color: '#fff', padding: '6px 8px', display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
        <span style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '3px', textTransform: 'uppercase' }}>Total Fare</span>
        <span style={{ fontSize: '18px', fontWeight: 900 }}>{money(order.grandTotal.toFixed(2))}</span>
      </div>
      <div style={{ textAlign: 'center', padding: '4px 0', fontSize: '14px', fontWeight: 900, letterSpacing: '4px' }}><StatusBadge status={order.status} /></div>
      {settings.receiptFooter && <p style={{ textAlign: 'center', fontSize: '10px', fontWeight: 700, padding: '3px 0', borderTop: '1px dashed #000', whiteSpace: 'pre-line', textTransform: 'uppercase', letterSpacing: '1px' }}>{settings.receiptFooter}</p>}
      {order.cashierName && <div style={{ textAlign: 'center', fontSize: '9px', fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: '2px' }}>Agent · {order.cashierName}</div>}
      <PaymentBlock order={order} />
      <VisitAgainBlock rs={rs} settings={settings} />
      <BrandFooter settings={settings} rs={rs} />
      <QRSection settings={settings} qrData={qrData} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== DESIGN 10: SHAHENSHAH STYLE (boxed dhaba look) =====
function ShahenshahReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, totalQty, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  const box: React.CSSProperties = { border: '1px solid #000', padding: '4px 6px', color: '#000' };
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '4px' }}>
        {settings.logo && <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 4px' }} />}
        <h1 style={{ fontSize: '28px', fontWeight: 900, color: '#000', letterSpacing: '2px', margin: 0, lineHeight: 1.1 }}>{settings.name}</h1>
        {settings.address && <p style={{ fontSize: '13px', fontWeight: 700, color: '#000', marginTop: '4px', lineHeight: 1.3 }}>{settings.address}</p>}
        <p style={{ fontSize: '14px', fontWeight: 800, color: '#000', marginTop: '3px', letterSpacing: '1px' }}>{settings.phone1}{settings.phone2 ? ` | ${settings.phone2}` : ''}</p>
      </div>

      {/* Top info box: Date | Time | Cashier */}
      <div style={{ ...box, display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, marginTop: '4px' }}>
        <span>{dateStr}</span>
        <span>{timeStr}</span>
        {order.cashierName && <span>Cashier: {order.cashierName}</span>}
      </div>

      {/* Second info box: Chq# | Table | Cover/Type */}
      <div style={{ ...box, borderTop: 'none', display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700 }}>
        <span>Chq#: {String(order.orderNumber).padStart(6, '0')}</span>
        <span>Table#: {order.tableName || (order.orderType === 'takeaway' ? 'T/A' : order.orderType === 'delivery' ? 'DLV' : '-')}</span>
        <span>Items: {totalQty}</span>
      </div>

      {/* Third info box: Cover | Waiter */}
      {(order.waiterName || order.customer?.name) && (
        <div style={{ ...box, borderTop: 'none', display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700 }}>
          <span>{order.customer?.name ? `Cust: ${order.customer.name}` : `Cover: 1`}</span>
          <span>{order.waiterName ? `SER: ${order.waiterName}` : (order.riderName ? `RIDER: ${order.riderName}` : '')}</span>
        </div>
      )}

      <div style={{ height: '6px' }} />

      {/* Items table — same compartment style as the reference */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead><tr>
          <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 800 }}>Description</th>
          <th style={{ ...cellStyle, textAlign: 'right', fontWeight: 800, width: '55px' }}>Rate</th>
          <th style={{ ...cellStyle, textAlign: 'center', fontWeight: 800, width: '40px' }}>Qty</th>
          <th style={{ ...cellStyle, textAlign: 'right', fontWeight: 800, width: '65px' }}>Amount</th>
        </tr></thead>
        <tbody>
          {order.items.map(item => (
            <tr key={item.id}>
              <td style={{ ...cellStyle, fontWeight: 700, textTransform: 'uppercase' }}>{item.name}{item.note && <div style={{ fontSize: '9px', fontWeight: 600, color: '#333', textTransform: 'none' }}>↳ {item.note}</div>}</td>
              <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 700 }}>{item.price.toFixed(2)}</td>
              <td style={{ ...cellStyle, textAlign: 'center', fontWeight: 700 }}>{item.quantity.toFixed(2)}</td>
              <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 700 }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals block with bordered Items / Sub Total / Grand Total */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0', fontSize: '12px' }}>
        <tbody>
          <tr>
            <td style={{ ...cellStyle, fontWeight: 800 }}>Items: {totalQty}</td>
            <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 800 }}>Sub Total</td>
            <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 800, width: '80px' }}>{order.subtotal.toFixed(2)}</td>
          </tr>
          {order.discount > 0 && <tr><td colSpan={2} style={{ ...cellStyle, textAlign: 'right', fontWeight: 700 }}>Discount</td><td style={{ ...cellStyle, textAlign: 'right', fontWeight: 700 }}>-{order.discount.toFixed(2)}</td></tr>}
          {order.tax > 0 && <tr><td colSpan={2} style={{ ...cellStyle, textAlign: 'right', fontWeight: 700 }}>Tax</td><td style={{ ...cellStyle, textAlign: 'right', fontWeight: 700 }}>{order.tax.toFixed(2)}</td></tr>}
          {order.serviceCharge > 0 && <tr><td colSpan={2} style={{ ...cellStyle, textAlign: 'right', fontWeight: 700 }}>Service ({order.serviceChargePercent}%)</td><td style={{ ...cellStyle, textAlign: 'right', fontWeight: 700 }}>{order.serviceCharge.toFixed(2)}</td></tr>}
          <tr>
            <td colSpan={2} style={{ ...cellStyle, textAlign: 'right', fontWeight: 900, fontSize: '14px' }}>Grand Total</td>
            <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 900, fontSize: '14px' }}>{order.grandTotal.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', padding: '5px 2px', lineHeight: 1.3 }}>
        RUPEES {numberToWords(Math.round(order.grandTotal))} ONLY
      </div>

      <div style={{ padding: '4px 0', letterSpacing: '2px', textAlign: 'center', fontSize: '14px', fontWeight: 800 }}><StatusBadge status={order.status} /></div>

      {settings.receiptFooter && (<><div style={{ borderTop: '1px dashed black' }} /><p style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, padding: '4px 0', whiteSpace: 'pre-line', lineHeight: 1.3 }}>{settings.receiptFooter}</p></>)}
      <PaymentBlock order={order} />
      <VisitAgainBlock rs={rs} settings={settings} />
      <BrandFooter settings={settings} rs={rs} />
      <div style={{ borderTop: '1px dashed black' }} />
      <QRSection settings={settings} qrData={qrData} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== DESIGN 11: TASTE BISTRO (chef hat header + bordered items) =====
function TasteBistroReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, totalQty, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '4px' }}>
        {settings.logo
          ? <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 2px' }} />
          : <div style={{ fontSize: '26px', lineHeight: 1, margin: '0 0 2px' }}>👨‍🍳</div>}
        <h1 style={{ fontSize: '22px', fontWeight: 900, color: '#000', letterSpacing: '3px', textTransform: 'uppercase', margin: 0 }}>{settings.name}</h1>
        <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '4px', color: '#000', marginTop: '2px' }}>— RESTAURANT —</div>
        {settings.address && <p style={{ fontSize: '11px', fontWeight: 700, color: '#000', marginTop: '4px', lineHeight: 1.3 }}>{settings.address}</p>}
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#000', marginTop: '2px' }}>Tel: {settings.phone1}{settings.phone2 ? ` | ${settings.phone2}` : ''}</p>
      </div>

      <div style={{ borderTop: '1px dashed #000', borderBottom: '1px dashed #000', padding: '4px 0', margin: '4px 0' }}>
        <StandardInfoRows order={order} labelWidth={75} fontSize={11} />
      </div>


      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginTop: '4px' }}>
        <thead><tr style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>
          <th style={{ textAlign: 'left', padding: '4px 3px', fontWeight: 800 }}>Item</th>
          <th style={{ textAlign: 'center', padding: '4px 3px', fontWeight: 800, width: '40px' }}>Qty</th>
          <th style={{ textAlign: 'right', padding: '4px 3px', fontWeight: 800, width: '70px' }}>Amount</th>
        </tr></thead>
        <tbody>
          {order.items.map(item => (
            <tr key={item.id} style={{ borderBottom: '1px solid #ddd' }}>
              <td style={{ padding: '4px 3px', fontWeight: 700, color: '#000' }}>{item.name}{item.note && <div style={{ fontSize: '9px', fontWeight: 600, color: '#555' }}>↳ {item.note}</div>}</td>
              <td style={{ textAlign: 'center', padding: '4px 3px', fontWeight: 700 }}>{item.quantity}</td>
              <td style={{ textAlign: 'right', padding: '4px 3px', fontWeight: 700 }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ borderTop: '1px dashed #000', marginTop: '4px', paddingTop: '4px', fontSize: '12px', fontWeight: 700 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{order.subtotal.toFixed(2)}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Discount</span><span>-{order.discount.toFixed(2)}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tax</span><span>{order.tax.toFixed(2)}</span></div>}
        {order.serviceCharge > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Service Charge ({order.serviceChargePercent}%)</span><span>{order.serviceCharge.toFixed(2)}</span></div>}
      </div>

      <div style={{ background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', padding: '6px 8px', margin: '4px 0', fontSize: '16px', fontWeight: 900 }}>
        <span>Total</span><span>{order.grandTotal.toFixed(2)}</span>
      </div>

      <div style={{ textAlign: 'center', fontSize: '10px', fontWeight: 700, padding: '2px 0' }}>RUPEES {numberToWords(Math.round(order.grandTotal))} ONLY</div>
      <div style={{ textAlign: 'center', padding: '3px 0', fontSize: '13px', fontWeight: 800, letterSpacing: '2px' }}><StatusBadge status={order.status} /></div>

      <QRSection settings={settings} qrData={qrData} />
      {settings.receiptFooter && <p style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, padding: '3px 0', borderTop: '1px dashed #000', whiteSpace: 'pre-line' }}>{settings.receiptFooter}</p>}
      <PaymentBlock order={order} />
      <VisitAgainBlock rs={rs} settings={settings} />
      <BrandFooter settings={settings} rs={rs} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== DESIGN 12: FOOD PALACE (circle cloche + clean minimal) =====
function FoodPalaceReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, totalQty, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '4px' }}>
        {settings.logo
          ? <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 4px', borderRadius: '50%' }} />
          : <div style={{ width: '54px', height: '54px', border: '2px solid #000', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 4px', fontSize: '26px' }}>🍽</div>}
        <h1 style={{ fontSize: '22px', fontWeight: 900, color: '#000', letterSpacing: '2px', textTransform: 'uppercase', margin: 0 }}>{settings.name}</h1>
        <div style={{ width: '40px', height: '1px', background: '#000', margin: '4px auto' }} />
        <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '4px', color: '#000' }}>RESTAURANT</div>
        {settings.address && <p style={{ fontSize: '11px', fontWeight: 700, color: '#000', marginTop: '6px', lineHeight: 1.3 }}>{settings.address}</p>}
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#000', marginTop: '2px' }}>Tel: {settings.phone1}{settings.phone2 ? ` | ${settings.phone2}` : ''}</p>
      </div>

      <div style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '5px 0', margin: '5px 0' }}>
        <StandardInfoRows order={order} labelWidth={75} fontSize={11} />
      </div>


      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead><tr style={{ borderBottom: '1px solid #000' }}>
          <th style={{ textAlign: 'left', padding: '4px 3px', fontWeight: 800 }}>Item</th>
          <th style={{ textAlign: 'center', padding: '4px 3px', fontWeight: 800, width: '40px' }}>Qty</th>
          <th style={{ textAlign: 'right', padding: '4px 3px', fontWeight: 800, width: '70px' }}>Amount</th>
        </tr></thead>
        <tbody>
          {order.items.map(item => (
            <tr key={item.id}>
              <td style={{ padding: '3px', fontWeight: 700, color: '#000' }}>{item.name}{item.note && <div style={{ fontSize: '9px', fontWeight: 600, color: '#555' }}>↳ {item.note}</div>}</td>
              <td style={{ textAlign: 'center', padding: '3px', fontWeight: 700 }}>{item.quantity}</td>
              <td style={{ textAlign: 'right', padding: '3px', fontWeight: 700 }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ borderTop: '1px solid #000', marginTop: '4px', paddingTop: '4px', fontSize: '12px', fontWeight: 700 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal ({totalQty})</span><span>{order.subtotal.toFixed(2)}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Discount</span><span>-{order.discount.toFixed(2)}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tax</span><span>{order.tax.toFixed(2)}</span></div>}
        {order.serviceCharge > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Service Charge ({order.serviceChargePercent}%)</span><span>{order.serviceCharge.toFixed(2)}</span></div>}
      </div>

      <div style={{ borderTop: '2px solid #000', display: 'flex', justifyContent: 'space-between', padding: '6px 2px', marginTop: '4px', fontSize: '18px', fontWeight: 900, color: '#000' }}>
        <span>Total</span><span>{order.grandTotal.toFixed(2)}</span>
      </div>

      <div style={{ textAlign: 'center', fontSize: '10px', fontWeight: 700, padding: '2px 0' }}>RUPEES {numberToWords(Math.round(order.grandTotal))} ONLY</div>
      <div style={{ textAlign: 'center', padding: '3px 0', fontSize: '13px', fontWeight: 800, letterSpacing: '2px' }}><StatusBadge status={order.status} /></div>

      <QRSection settings={settings} qrData={qrData} />
      {settings.receiptFooter && <p style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, padding: '3px 0', whiteSpace: 'pre-line' }}>{settings.receiptFooter}</p>}
      <PaymentBlock order={order} />
      <VisitAgainBlock rs={rs} settings={settings} />
      <BrandFooter settings={settings} rs={rs} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== DESIGN 13: SPICE HOUSE (crossed cutlery + dotted rows) =====
function SpiceHouseReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, totalQty, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '4px' }}>
        {settings.logo
          ? <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 2px' }} />
          : <div style={{ fontSize: '22px', letterSpacing: '4px' }}>🍴✕🥄</div>}
        <h1 style={{ fontSize: '22px', fontWeight: 900, color: '#000', letterSpacing: '3px', fontFamily: 'Georgia, serif', margin: '4px 0 0' }}>{settings.name.toUpperCase()}</h1>
        <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '6px', color: '#000', marginTop: '2px', borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '2px 0', display: 'inline-block', minWidth: '120px' }}>RESTAURANT</div>
        {settings.address && <p style={{ fontSize: '11px', fontWeight: 700, color: '#000', marginTop: '6px', lineHeight: 1.3 }}>{settings.address}</p>}
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#000', marginTop: '2px' }}>Tel: {settings.phone1}{settings.phone2 ? ` | ${settings.phone2}` : ''}</p>
      </div>

      <div style={{ borderTop: '1px dashed #000', borderBottom: '1px dashed #000', padding: '4px 0', margin: '5px 0' }}>
        <StandardInfoRows order={order} labelWidth={75} fontSize={11} />
      </div>


      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead><tr style={{ borderBottom: '1px solid #000' }}>
          <th style={{ textAlign: 'left', padding: '4px 3px', fontWeight: 800 }}>Item</th>
          <th style={{ textAlign: 'center', padding: '4px 3px', fontWeight: 800, width: '40px' }}>Qty</th>
          <th style={{ textAlign: 'right', padding: '4px 3px', fontWeight: 800, width: '70px' }}>Amount</th>
        </tr></thead>
        <tbody>
          {order.items.map(item => (
            <tr key={item.id}>
              <td style={{ padding: '3px', fontWeight: 700, color: '#000', borderBottom: '1px dotted #999' }}>
                <span style={{ display: 'inline-block' }}>{item.name}</span>
                <span style={{ color: '#999', margin: '0 4px' }}>……………</span>
                {item.note && <div style={{ fontSize: '9px', fontWeight: 600, color: '#555' }}>↳ {item.note}</div>}
              </td>
              <td style={{ textAlign: 'center', padding: '3px', fontWeight: 700, borderBottom: '1px dotted #999' }}>{item.quantity}</td>
              <td style={{ textAlign: 'right', padding: '3px', fontWeight: 700, borderBottom: '1px dotted #999' }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ borderTop: '1px dashed #000', marginTop: '4px', paddingTop: '4px', fontSize: '12px', fontWeight: 700 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal ({totalQty})</span><span>{order.subtotal.toFixed(2)}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Discount</span><span>-{order.discount.toFixed(2)}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tax</span><span>{order.tax.toFixed(2)}</span></div>}
        {order.serviceCharge > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Service Charge ({order.serviceChargePercent}%)</span><span>{order.serviceCharge.toFixed(2)}</span></div>}
      </div>

      <div style={{ border: '2px solid #000', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', padding: '6px 10px', margin: '6px 0', fontSize: '17px', fontWeight: 900, color: '#000' }}>
        <span>Total</span><span>{order.grandTotal.toFixed(2)}</span>
      </div>

      <div style={{ textAlign: 'center', fontSize: '10px', fontWeight: 700, padding: '2px 0' }}>RUPEES {numberToWords(Math.round(order.grandTotal))} ONLY</div>
      <div style={{ textAlign: 'center', padding: '3px 0', fontSize: '13px', fontWeight: 800, letterSpacing: '2px' }}><StatusBadge status={order.status} /></div>

      <QRSection settings={settings} qrData={qrData} />
      {settings.receiptFooter && <p style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, padding: '3px 0', whiteSpace: 'pre-line' }}>{settings.receiptFooter}</p>}
      <PaymentBlock order={order} />
      <VisitAgainBlock rs={rs} settings={settings} />
      <BrandFooter settings={settings} rs={rs} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

function numberToWords(num: number): string {
  if (num === 0) return 'ZERO';
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
  const convert = (n: number): string => {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 ? ' ' + convert(n % 100) : '');
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' THOUSAND' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' LAKH' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' CRORE' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
  };
  return convert(num);
}

// ===== DESIGN: TAIMOOR CUSTOMER RECEIPT (clean table, like reference) =====
function TaimoorReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, totalQty, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  const cleanFont = "'Helvetica Neue', 'Segoe UI', Arial, sans-serif";
  const dashed = '1px dashed #000';
  return (
    <div style={{ fontFamily: cleanFont, color: '#000' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '6px' }}>
        {settings.logo && (
          <img src={settings.logo} alt="" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 4px', display: 'block' }} />
        )}
        <div style={{ fontSize: '20px', fontWeight: 900, letterSpacing: '4px', fontFamily: "'Georgia', serif" }}>
          {settings.name || ''}
        </div>
        {settings.address && <div style={{ fontSize: '9px', marginTop: '2px' }}>{settings.address}</div>}
        {(settings.phone1 || settings.phone2) && (
          <div style={{ fontSize: '9px' }}>{settings.phone1}{settings.phone2 ? ` | ${settings.phone2}` : ''}</div>
        )}
      </div>

      <div style={{ borderTop: dashed, margin: '4px 0' }} />

      {/* Title */}
      <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 900, letterSpacing: '1px', margin: '6px 0' }}>
        CUSTOMER RECEIPT
      </div>

      {/* Standardized info grid */}
      <div style={{ marginBottom: '6px' }}>
        <StandardInfoGrid order={order} labelWidth={70} fontSize={11} />
      </div>


      <div style={{ borderTop: dashed, margin: '4px 0 6px' }} />

      {/* Items table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #000' }}>
            <th style={{ padding: '4px 3px', width: '20px', textAlign: 'left', fontWeight: 700 }}>#</th>
            <th style={{ padding: '4px 3px', textAlign: 'left', fontWeight: 700 }}>Item Name</th>
            <th style={{ padding: '4px 3px', width: '28px', textAlign: 'center', fontWeight: 700 }}>Qty</th>
            <th style={{ padding: '4px 3px', width: '50px', textAlign: 'right', fontWeight: 700 }}>Rate</th>
            <th style={{ padding: '4px 3px', width: '58px', textAlign: 'right', fontWeight: 700 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, i) => (
            <tr key={item.id} style={{ borderBottom: '1px dotted #999' }}>
              <td style={{ padding: '5px 3px', verticalAlign: 'top' }}>{i + 1}</td>
              <td style={{ padding: '5px 3px', fontWeight: 600, wordBreak: 'break-word' }}>
                {item.name}
                {item.note && <div style={{ fontSize: '9px', color: '#555', fontStyle: 'italic' }}>↳ {item.note}</div>}
              </td>
              <td style={{ padding: '5px 3px', textAlign: 'center' }}>{item.quantity}</td>
              <td style={{ padding: '5px 3px', textAlign: 'right' }}>{item.price.toFixed(2)}</td>
              <td style={{ padding: '5px 3px', textAlign: 'right', fontWeight: 700 }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ borderTop: '1px solid #000', marginTop: '4px', paddingTop: '4px', fontSize: '11px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
          <span>Subtotal</span><span>{order.subtotal.toFixed(2)}</span>
        </div>
        {order.discount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span>Discount</span><span>-{order.discount.toFixed(2)}</span>
          </div>
        )}
        {order.serviceCharge > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span>Service Charge{order.serviceChargePercent ? ` (${order.serviceChargePercent}%)` : ''}</span>
            <span>{order.serviceCharge.toFixed(2)}</span>
          </div>
        )}
        {order.tax > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span>Sales Tax{(order as any).taxPercent ? ` (${(order as any).taxPercent}%)` : ''}</span>
            <span>{order.tax.toFixed(2)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0 2px', borderTop: '1px solid #000', marginTop: '3px', fontSize: '13px', fontWeight: 900 }}>
          <span>TOTAL</span><span>{order.grandTotal.toFixed(2)}</span>
        </div>
      </div>

      <div style={{ padding: '5px 0', textAlign: 'center', fontSize: '11px', fontWeight: 700 }}>
        <StatusBadge status={order.status} />
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', marginTop: '6px' }}>
        <PraFiscalBlock order={order} settings={settings} />
        <div style={{ fontSize: '11px', fontWeight: 700 }}>{`--- ${settings.thankYouText || 'Thank You'} ---`}</div>
        <div style={{ fontSize: '10px', marginTop: '2px' }}>We Hope to See You Again!</div>
      </div>

      <div style={{ borderTop: dashed, margin: '8px 0 4px' }} />

      <div style={{ textAlign: 'center', fontSize: '9px' }}>
        Printed: {dateStr} {timeStr}
      </div>

      {settings.receiptFooter && (
        <div style={{ textAlign: 'center', fontSize: '10px', marginTop: '6px', whiteSpace: 'pre-line' }}>
          {settings.receiptFooter}
        </div>
      )}

      <PaymentBlock order={order} />
      <BrandFooter settings={settings} rs={rs} />
      <QRSection settings={settings} qrData={qrData} />
      <CustomerDetailsSection order={order} rs={rs} />
    </div>
  );
}

// ===== DESIGN 1: TABLE STYLE (classic bordered, dashed separators) =====
function Design1TableReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  const dashed = '1px dashed #000';
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '4px' }}>
        {settings.logo && <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 4px' }} />}
        <h1 style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '3px', textTransform: 'uppercase', color: '#000' }}>{settings.name}</h1>
        <p style={{ fontSize: '10px', fontWeight: 600, color: '#333', marginTop: '2px' }}>{settings.address}</p>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#000' }}>{settings.phone1}{settings.phone2 ? ` | ${settings.phone2}` : ''}</p>
      </div>
      <div style={{ borderTop: dashed, margin: '4px 0' }} />
      <StandardInfoGrid order={order} labelWidth={85} fontSize={11} />

      <div style={{ borderTop: dashed, margin: '4px 0' }} />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginTop: '4px' }}>
        <thead><tr style={{ borderBottom: '1px solid #000' }}>
          <th style={{ textAlign: 'left', padding: '3px 2px', fontWeight: 800, width: '20px' }}>#</th>
          <th style={{ textAlign: 'left', padding: '3px 2px', fontWeight: 800 }}>Item Name</th>
          <th style={{ textAlign: 'center', padding: '3px 2px', fontWeight: 800, width: '30px' }}>Qty</th>
          <th style={{ textAlign: 'right', padding: '3px 2px', fontWeight: 800, width: '50px' }}>Rate</th>
          <th style={{ textAlign: 'right', padding: '3px 2px', fontWeight: 800, width: '55px' }}>Amount</th>
        </tr></thead>
        <tbody>
          {order.items.map((item, i) => (
            <tr key={item.id} style={{ borderBottom: '1px dotted #999' }}>
              <td style={{ padding: '3px 2px' }}>{i + 1}</td>
              <td style={{ padding: '3px 2px', fontWeight: 600 }}>{item.name}{item.note && <div style={{ fontSize: '9px', color: '#555' }}>↳ {item.note}</div>}</td>
              <td style={{ textAlign: 'center', padding: '3px 2px' }}>{item.quantity}</td>
              <td style={{ textAlign: 'right', padding: '3px 2px' }}>{item.price.toFixed(2)}</td>
              <td style={{ textAlign: 'right', padding: '3px 2px', fontWeight: 700 }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ borderTop: '1px solid #000', marginTop: '4px', paddingTop: '4px', fontSize: '11px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Subtotal</span><span>{order.subtotal.toFixed(2)}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Discount</span><span>-{order.discount.toFixed(2)}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Tax (5%)</span><span>{order.tax.toFixed(2)}</span></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderTop: '1px solid #000', marginTop: '2px', fontSize: '13px', fontWeight: 900 }}><span>TOTAL</span><span>{order.grandTotal.toFixed(2)}</span></div>
      </div>
      <div style={{ borderTop: dashed, margin: '4px 0' }} />
      <div style={{ fontSize: '11px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Total Received</span><span>{(order.cashReceived || order.grandTotal).toFixed(2)}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Cash</span><span>{(order.cashReceived || order.grandTotal).toFixed(2)}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Change</span><span>{Math.max(0, (order.cashReceived || 0) - order.grandTotal).toFixed(2)}</span></div>
      </div>
      <div style={{ borderTop: dashed, margin: '4px 0' }} />
      <div style={{ textAlign: 'center', padding: '4px 0' }}>
        <PraFiscalBlock order={order} settings={settings} />
        <div style={{ fontSize: '11px', fontWeight: 700 }}>{`--- ${settings.thankYouText || 'Thank You'} ---`}</div>
        <div style={{ fontSize: '10px', marginTop: '2px' }}>{`${settings.visitAgainText || 'Thank you for visiting'} ${settings.name}`}</div>
        <div style={{ fontSize: '10px' }}>We hope to see you again!</div>
      </div>
      <PaymentStatusBlock order={order} settings={settings} />
      <QRSection settings={settings} qrData={qrData} />
      <BrandFooter settings={settings} rs={rs} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== DESIGN 2: BOX STYLE (boxed info, bordered items, dark change bar) =====
function Design2BoxReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '4px' }}>
        {settings.logo && <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 4px' }} />}
        <h1 style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '3px', textTransform: 'uppercase', color: '#000' }}>{settings.name}</h1>
        <p style={{ fontSize: '10px', fontWeight: 600, color: '#333', marginTop: '2px' }}>{settings.address}</p>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#000' }}>{settings.phone1}{settings.phone2 ? ` | ${settings.phone2}` : ''}</p>
      </div>
      <div style={{ border: '1px solid #000', padding: '6px', marginBottom: '4px' }}>
        <StandardInfoGrid order={order} labelWidth={80} fontSize={11} />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginTop: '4px' }}>
        <thead><tr style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>
          <th style={{ textAlign: 'left', padding: '3px 2px', fontWeight: 800 }}>Item Name</th>
          <th style={{ textAlign: 'center', padding: '3px 2px', fontWeight: 800, width: '30px' }}>Qty</th>
          <th style={{ textAlign: 'right', padding: '3px 2px', fontWeight: 800, width: '50px' }}>Rate</th>
          <th style={{ textAlign: 'right', padding: '3px 2px', fontWeight: 800, width: '55px' }}>Amount</th>
        </tr></thead>
        <tbody>
          {order.items.map(item => (
            <tr key={item.id}>
              <td style={{ padding: '3px 2px', fontWeight: 600 }}>{item.name}{item.note && <div style={{ fontSize: '9px', color: '#555' }}>↳ {item.note}</div>}</td>
              <td style={{ textAlign: 'center', padding: '3px 2px' }}>{item.quantity}</td>
              <td style={{ textAlign: 'right', padding: '3px 2px' }}>{item.price.toFixed(2)}</td>
              <td style={{ textAlign: 'right', padding: '3px 2px', fontWeight: 700 }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ borderTop: '1px solid #000', marginTop: '4px', paddingTop: '4px', fontSize: '11px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Subtotal</span><span>{order.subtotal.toFixed(2)}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Discount</span><span>-{order.discount.toFixed(2)}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Tax (5%)</span><span>{order.tax.toFixed(2)}</span></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderTop: '1px solid #000', marginTop: '2px', fontSize: '13px', fontWeight: 900 }}><span>TOTAL</span><span>{order.grandTotal.toFixed(2)}</span></div>
      </div>
      <div style={{ fontSize: '11px', marginTop: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Total Received</span><span>{(order.cashReceived || order.grandTotal).toFixed(2)}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Cash</span><span>{(order.cashReceived || order.grandTotal).toFixed(2)}</span></div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px', background: '#000', color: '#fff', fontSize: '12px', fontWeight: 800, marginTop: '2px' }}>
        <span>Change</span>
        <span>{Math.max(0, (order.cashReceived || 0) - order.grandTotal).toFixed(2)}</span>
      </div>
      <div style={{ textAlign: 'center', padding: '6px 0', marginTop: '4px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700 }}>THANK YOU</div>
        <div style={{ fontSize: '10px', marginTop: '2px' }}>FOR YOUR VISIT</div>
      </div>
      <PaymentStatusBlock order={order} settings={settings} />
      <QRSection settings={settings} qrData={qrData} />
      <BrandFooter settings={settings} rs={rs} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== DESIGN 3: MODERN STYLE (black banner, icon info, 3-col totals) =====
function Design3ModernReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '4px' }}>
        {settings.logo && <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 4px' }} />}
        <h1 style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '3px', textTransform: 'uppercase', color: '#000' }}>{settings.name}</h1>
        <p style={{ fontSize: '10px', fontWeight: 600, color: '#333', marginTop: '2px' }}>{settings.address}</p>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#000' }}>{settings.phone1}{settings.phone2 ? ` | ${settings.phone2}` : ''}</p>
      </div>
      <div style={{ background: '#000', color: '#fff', textAlign: 'center', padding: '5px', fontSize: '13px', fontWeight: 900, letterSpacing: '2px', margin: '4px 0' }}>
        CUSTOMER RECEIPT
      </div>
      <div style={{ marginBottom: '4px' }}>
        <StandardInfoGrid order={order} labelWidth={70} fontSize={11} />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginTop: '4px' }}>
        <thead><tr style={{ borderBottom: '1px solid #000' }}>
          <th style={{ textAlign: 'left', padding: '3px 2px', fontWeight: 800 }}>ITEM NAME</th>
          <th style={{ textAlign: 'center', padding: '3px 2px', fontWeight: 800, width: '30px' }}>QTY</th>
          <th style={{ textAlign: 'right', padding: '3px 2px', fontWeight: 800, width: '60px' }}>AMOUNT</th>
        </tr></thead>
        <tbody>
          {order.items.map(item => (
            <tr key={item.id} style={{ borderBottom: '1px dotted #999' }}>
              <td style={{ padding: '3px 2px', fontWeight: 600 }}>{item.name}{item.note && <div style={{ fontSize: '9px', color: '#555' }}>↳ {item.note}</div>}</td>
              <td style={{ textAlign: 'center', padding: '3px 2px' }}>{item.quantity}</td>
              <td style={{ textAlign: 'right', padding: '3px 2px', fontWeight: 700 }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', margin: '6px 0', border: '1px solid #000', padding: '6px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '10px', fontWeight: 700 }}>SUBTOTAL</div>
          <div style={{ fontSize: '12px', fontWeight: 900 }}>{order.subtotal.toFixed(2)}</div>
        </div>
        <div style={{ textAlign: 'center', borderLeft: '1px solid #000', borderRight: '1px solid #000' }}>
          <div style={{ fontSize: '10px', fontWeight: 700 }}>DISCOUNT</div>
          <div style={{ fontSize: '12px', fontWeight: 900 }}>{order.discount > 0 ? `-${order.discount.toFixed(2)}` : '0.00'}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '10px', fontWeight: 700 }}>TAX (5%)</div>
          <div style={{ fontSize: '12px', fontWeight: 900 }}>{order.tax > 0 ? order.tax.toFixed(2) : '0.00'}</div>
        </div>
      </div>
      <div style={{ background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', padding: '6px 8px', fontSize: '16px', fontWeight: 900, margin: '4px 0' }}>
        <span>TOTAL</span><span>{order.grandTotal.toFixed(2)}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', margin: '4px 0', border: '1px solid #000', padding: '6px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '9px', fontWeight: 700 }}>RECEIVED</div>
          <div style={{ fontSize: '11px', fontWeight: 900 }}>{(order.cashReceived || order.grandTotal).toFixed(2)}</div>
        </div>
        <div style={{ textAlign: 'center', borderLeft: '1px solid #000', borderRight: '1px solid #000' }}>
          <div style={{ fontSize: '9px', fontWeight: 700 }}>PAYMENT</div>
          <div style={{ fontSize: '11px', fontWeight: 900 }}>{order.paymentMethod === 'cash' ? 'Cash' : order.paymentMethod || 'Cash'}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '9px', fontWeight: 700 }}>CHANGE</div>
          <div style={{ fontSize: '11px', fontWeight: 900 }}>{Math.max(0, (order.cashReceived || 0) - order.grandTotal).toFixed(2)}</div>
        </div>
      </div>
      <div style={{ textAlign: 'center', padding: '6px 0' }}>
        <PraFiscalBlock order={order} settings={settings} />
        <div style={{ fontSize: '11px', fontWeight: 700 }}>{settings.thankYouText || 'Thank You For Visiting!'}</div>
        <div style={{ fontSize: '10px', marginTop: '2px' }}>We Hope To See You Again</div>
      </div>
      <PaymentStatusBlock order={order} settings={settings} />
      <QRSection settings={settings} qrData={qrData} />
      <BrandFooter settings={settings} rs={rs} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== DESIGN 4: COMPACT STYLE (ultra compact, short labels) =====
function Design4CompactReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '3px' }}>
        {settings.logo && <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 3px' }} />}
        <h1 style={{ fontSize: '16px', fontWeight: 900, letterSpacing: '2px', textTransform: 'uppercase', color: '#000' }}>{settings.name}</h1>
        <p style={{ fontSize: '9px', fontWeight: 600, color: '#333' }}>{settings.address}</p>
        <p style={{ fontSize: '9px', fontWeight: 700, color: '#000' }}>{settings.phone1}{settings.phone2 ? ` | ${settings.phone2}` : ''}</p>
      </div>
      <div style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '3px 0', margin: '3px 0' }}>
        <StandardInfoGrid order={order} labelWidth={55} fontSize={10} />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', marginTop: '3px' }}>
        <thead><tr style={{ borderBottom: '1px solid #000' }}>
          <th style={{ textAlign: 'left', padding: '2px', fontWeight: 800 }}>Item</th>
          <th style={{ textAlign: 'center', padding: '2px', fontWeight: 800, width: '24px' }}>Qty</th>
          <th style={{ textAlign: 'right', padding: '2px', fontWeight: 800, width: '50px' }}>Amt</th>
        </tr></thead>
        <tbody>
          {order.items.map(item => (
            <tr key={item.id} style={{ borderBottom: '1px dotted #ccc' }}>
              <td style={{ padding: '2px', fontWeight: 600 }}>{item.name}</td>
              <td style={{ textAlign: 'center', padding: '2px' }}>{item.quantity}</td>
              <td style={{ textAlign: 'right', padding: '2px', fontWeight: 700 }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ borderTop: '1px solid #000', marginTop: '3px', paddingTop: '3px', fontSize: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}><span>Sub Total</span><span>{order.subtotal.toFixed(2)}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}><span>Disc</span><span>-{order.discount.toFixed(2)}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}><span>Tax</span><span>{order.tax.toFixed(2)}</span></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderTop: '1px solid #000', marginTop: '2px', fontSize: '12px', fontWeight: 900 }}><span>TOTAL</span><span>{order.grandTotal.toFixed(2)}</span></div>
      </div>
      <div style={{ fontSize: '10px', marginTop: '3px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}><span>Received</span><span>{(order.cashReceived || order.grandTotal).toFixed(2)}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}><span>Cash</span><span>{(order.cashReceived || order.grandTotal).toFixed(2)}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}><span>Change</span><span>{Math.max(0, (order.cashReceived || 0) - order.grandTotal).toFixed(2)}</span></div>
      </div>
      <div style={{ textAlign: 'center', padding: '4px 0', marginTop: '3px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700 }}>{settings.thankYouText || 'Thank You!'}</div>
        <div style={{ fontSize: '10px', marginTop: '2px' }}>{settings.visitAgainText || 'Visit Again'}</div>
      </div>
      <PaymentStatusBlock order={order} settings={settings} />
      <QRSection settings={settings} qrData={qrData} />
      <BrandFooter settings={settings} rs={rs} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== DESIGN 5: DELIVERY STYLE (delivery banner, driver info) =====
function Design5DeliveryReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '4px' }}>
        {settings.logo && <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 4px' }} />}
        <h1 style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '3px', textTransform: 'uppercase', color: '#000' }}>{settings.name}</h1>
        <p style={{ fontSize: '10px', fontWeight: 600, color: '#333', marginTop: '2px' }}>{settings.address}</p>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#000' }}>{settings.phone1}{settings.phone2 ? ` | ${settings.phone2}` : ''}</p>
      </div>
      <div style={{ background: '#000', color: '#fff', textAlign: 'center', padding: '5px', fontSize: '13px', fontWeight: 900, letterSpacing: '2px', margin: '4px 0' }}>
        DELIVERY RECEIPT
      </div>
      <div style={{ marginBottom: '4px' }}>
        <StandardInfoGrid order={order} labelWidth={70} fontSize={11} />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginTop: '4px' }}>
        <thead><tr style={{ borderBottom: '1px solid #000' }}>
          <th style={{ textAlign: 'left', padding: '3px 2px', fontWeight: 800 }}>Item Name</th>
          <th style={{ textAlign: 'center', padding: '3px 2px', fontWeight: 800, width: '30px' }}>Qty</th>
          <th style={{ textAlign: 'right', padding: '3px 2px', fontWeight: 800, width: '60px' }}>Amount</th>
        </tr></thead>
        <tbody>
          {order.items.map(item => (
            <tr key={item.id} style={{ borderBottom: '1px dotted #999' }}>
              <td style={{ padding: '3px 2px', fontWeight: 600 }}>{item.name}{item.note && <div style={{ fontSize: '9px', color: '#555' }}>↳ {item.note}</div>}</td>
              <td style={{ textAlign: 'center', padding: '3px 2px' }}>{item.quantity}</td>
              <td style={{ textAlign: 'right', padding: '3px 2px', fontWeight: 700 }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ borderTop: '1px solid #000', marginTop: '4px', paddingTop: '4px', fontSize: '11px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Subtotal</span><span>{order.subtotal.toFixed(2)}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Discount</span><span>-{order.discount.toFixed(2)}</span></div>}
        {order.serviceCharge > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Delivery Charge</span><span>{order.serviceCharge.toFixed(2)}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Tax (5%)</span><span>{order.tax.toFixed(2)}</span></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderTop: '1px solid #000', marginTop: '2px', fontSize: '13px', fontWeight: 900 }}><span>TOTAL</span><span>{order.grandTotal.toFixed(2)}</span></div>
      </div>
      <div style={{ fontSize: '11px', marginTop: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Received</span><span>{(order.cashReceived || order.grandTotal).toFixed(2)}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Cash</span><span>{(order.cashReceived || order.grandTotal).toFixed(2)}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Change</span><span>{Math.max(0, (order.cashReceived || 0) - order.grandTotal).toFixed(2)}</span></div>
      </div>
      <div style={{ textAlign: 'center', padding: '6px 0', marginTop: '4px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700 }}>{settings.thankYouText || 'Thank You For Your Order!'}</div>
        <div style={{ fontSize: '10px', marginTop: '2px' }}>We Will Seree You Again</div>
      </div>
      <PaymentStatusBlock order={order} settings={settings} />
      <QRSection settings={settings} qrData={qrData} />
      <BrandFooter settings={settings} rs={rs} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== DESIGN: SERO — Sleek minimal customer receipt =====
function SeroReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, totalQty, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  return (
    <>
      <div style={{ textAlign: 'center', paddingBottom: '6px', borderBottom: '1px solid #000' }}>
        {settings.logo && <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 4px' }} />}
        <div style={{ ...getStyleCSS(rs.restaurantName, { size: 18, align: 'center', bold: true }), letterSpacing: '3px', textTransform: 'uppercase' }}>{settings.name}</div>
        <div style={{ ...getStyleCSS(rs.address, { size: 11, align: 'center', bold: false }), marginTop: '3px' }}>{settings.address}</div>
        <div style={{ ...getStyleCSS(rs.phone, { size: 11, align: 'center', bold: true }), marginTop: '2px' }}>☎ {settings.phone1}{settings.phone2 ? ` · ${settings.phone2}` : ''}</div>
      </div>

      <div style={{ borderTop: '1px dashed #000' }} />
      <div style={{ padding: '4px' }}>
        <StandardInfoGrid order={order} labelWidth={60} fontSize={11} />
      </div>


      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '4px', fontSize: '12px' }}>
        <thead>
          <tr style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>
            <th style={{ textAlign: 'left', padding: '4px', fontWeight: 800 }}>ITEM</th>
            <th style={{ textAlign: 'center', padding: '4px', fontWeight: 800, width: '30px' }}>QTY</th>
            <th style={{ textAlign: 'right', padding: '4px', fontWeight: 800, width: '55px' }}>RATE</th>
            <th style={{ textAlign: 'right', padding: '4px', fontWeight: 800, width: '60px' }}>AMT</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map(item => (
            <tr key={item.id} style={{ borderBottom: '1px dotted #666' }}>
              <td style={{ padding: '3px 4px', fontWeight: 700 }}>{item.name}{item.note && <div style={{ fontSize: '9px', fontWeight: 500 }}>↳ {item.note}</div>}</td>
              <td style={{ padding: '3px 4px', textAlign: 'center', fontWeight: 700 }}>{item.quantity}</td>
              <td style={{ padding: '3px 4px', textAlign: 'right' }}>{item.price.toFixed(0)}</td>
              <td style={{ padding: '3px 4px', textAlign: 'right', fontWeight: 700 }}>{item.lineTotal.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: '6px', fontSize: '12px', padding: '0 4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Items / Qty</span><span>{order.items.length} / {totalQty}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Subtotal</span><span>{money(order.subtotal.toFixed(0))}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Discount</span><span>- {money(order.discount.toFixed(0))}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Tax</span><span>{money(order.tax.toFixed(0))}</span></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', marginTop: '4px', border: '2px solid #000', fontSize: '15px', fontWeight: 900, letterSpacing: '1px' }}>
          <span>TOTAL</span><span>{money(order.grandTotal.toFixed(0))}</span>
        </div>
      </div>

      <PaymentBlock order={order} />
      <div style={{ textAlign: 'center', padding: '6px 4px', fontSize: '11px', fontWeight: 700, letterSpacing: '2px', borderTop: '1px dashed #000' }}>
        — THANK YOU —
      </div>
      <div style={{ textAlign: 'center', fontSize: '10px', padding: '0 4px' }}>Please visit again</div>
      <PaymentStatusBlock order={order} settings={settings} />
      <QRSection settings={settings} qrData={qrData} />
      <BrandFooter settings={settings} rs={rs} />
    </>
  );
}

// ===== DESIGN: BERO — Bold contrast customer receipt =====
function BeroReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, totalQty, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  return (
    <>
      <div style={{ border: '2px solid #000', padding: '6px 4px', textAlign: 'center' }}>
        {settings.logo && <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 4px' }} />}
        <div style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '3px', textTransform: 'uppercase' }}>{settings.name}</div>
        <div style={{ fontSize: '10px', marginTop: '3px' }}>{settings.address}</div>
        <div style={{ fontSize: '10px', marginTop: '2px', fontWeight: 700 }}>☎ {settings.phone1}{settings.phone2 ? ` · ${settings.phone2}` : ''}</div>
      </div>

      <div style={{ borderLeft: '2px solid #000', borderRight: '2px solid #000', borderBottom: '2px solid #000', padding: '6px 4px' }}>
        <StandardInfoGrid order={order} labelWidth={70} fontSize={11} />
      </div>


      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '6px', fontSize: '12px' }}>
        <thead>
          <tr style={{ borderTop: '2px solid #000', borderBottom: '2px solid #000' }}>
            <th style={{ textAlign: 'center', padding: '4px 2px', width: '22px', fontWeight: 800 }}>#</th>
            <th style={{ textAlign: 'left', padding: '4px', fontWeight: 800 }}>ITEM</th>
            <th style={{ textAlign: 'center', padding: '4px 2px', width: '30px', fontWeight: 800 }}>QTY</th>
            <th style={{ textAlign: 'right', padding: '4px', width: '60px', fontWeight: 800 }}>AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, idx) => (
            <tr key={item.id} style={{ borderBottom: '1px dotted #666' }}>
              <td style={{ padding: '4px 2px', textAlign: 'center', fontWeight: 800 }}>{idx + 1}</td>
              <td style={{ padding: '4px', fontWeight: 700 }}>
                {item.name}
                <div style={{ fontSize: '9px' }}>@ {money(item.price.toFixed(0))}</div>
                {item.note && <div style={{ fontSize: '9px', fontWeight: 600 }}>※ {item.note}</div>}
              </td>
              <td style={{ padding: '4px 2px', textAlign: 'center', fontWeight: 900 }}>{item.quantity}</td>
              <td style={{ padding: '4px', textAlign: 'right', fontWeight: 800 }}>{item.lineTotal.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: '6px', border: '1px solid #000', padding: '4px 6px', fontSize: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Total Items</span><span>{order.items.length} ({totalQty} qty)</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{money(order.subtotal.toFixed(0))}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Discount</span><span>- {money(order.discount.toFixed(0))}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tax</span><span>{money(order.tax.toFixed(0))}</span></div>}
      </div>
      <div style={{ border: '2px solid #000', padding: '8px', marginTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', fontWeight: 900, letterSpacing: '2px' }}>GRAND TOTAL</span>
        <span style={{ fontSize: '18px', fontWeight: 900 }}>{money(order.grandTotal.toFixed(0))}</span>
      </div>

      <PaymentBlock order={order} />
      <div style={{ textAlign: 'center', padding: '8px 4px 4px', fontSize: '13px', fontWeight: 900, letterSpacing: '3px', borderTop: '1px dashed #000', marginTop: '4px' }}>★ THANK YOU ★</div>
      <div style={{ textAlign: 'center', fontSize: '10px', marginBottom: '4px' }}>We look forward to seeing you again</div>
      <PaymentStatusBlock order={order} settings={settings} />
      <QRSection settings={settings} qrData={qrData} />
      <BrandFooter settings={settings} rs={rs} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== DESIGN: KOT STYLE — Customer receipt mirroring KOT layout (chef hat, info grid, Qty/Note table) =====
function KotStyleReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, totalQty, logoW, logoH, qrData } = useReceiptData(order, settings);
  const specialNote = (order as any).note || (order as any).orderNote || '';
  return (
    <>
      {/* Header with chef hat / logo */}
      <div style={{ textAlign: 'center', padding: '4px 0 6px' }}>
        {settings.logo ? (
          <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 2px' }} />
        ) : (
          <div style={{ fontSize: '28px', lineHeight: 1, margin: '0 0 2px' }}>👨‍🍳</div>
        )}
        <div style={{ ...getStyleCSS(rs.restaurantName, { size: 22, align: 'center', bold: true }), letterSpacing: '4px', textTransform: 'uppercase', fontFamily: "'Georgia', serif" }}>{settings.name}</div>
        <div style={{ fontSize: '10px', letterSpacing: '2px', marginTop: '2px' }}>— RESTAURANT —</div>
        {settings.address && <div style={{ ...getStyleCSS(rs.address, { size: 10, align: 'center', bold: false }), marginTop: '3px' }}>{settings.address}</div>}
        {(settings.phone1 || settings.phone2) && (
          <div style={{ fontSize: '10px', marginTop: '2px', fontWeight: 700 }}>☎ {settings.phone1}{settings.phone2 ? ` · ${settings.phone2}` : ''}</div>
        )}
      </div>

      <div style={{ borderTop: '1px dashed #000', margin: '2px 0' }} />

      {/* Title */}
      <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 900, letterSpacing: '2px', padding: '4px 0' }}>
        CUSTOMER RECEIPT
      </div>

      {/* Info grid (Date/Time/Order/Invoice/Type/Table/Waiter/Rider) */}
      <div style={{ padding: '2px 4px' }}>
        <StandardInfoGrid order={order} labelWidth={70} fontSize={11} />
      </div>

      <div style={{ borderTop: '1px dashed #000', margin: '2px 0' }} />

      {/* Items table with bordered cells: # / Item / Qty / Note */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '4px', fontSize: '11px' }}>
        <thead>
          <tr>
            <th style={{ border: '1px solid #000', padding: '4px 2px', width: '22px', fontWeight: 800 }}>#</th>
            <th style={{ border: '1px solid #000', padding: '4px', textAlign: 'left', fontWeight: 800 }}>Item Name</th>
            <th style={{ border: '1px solid #000', padding: '4px 2px', width: '32px', fontWeight: 800 }}>Qty</th>
            <th style={{ border: '1px solid #000', padding: '4px 2px', width: '60px', fontWeight: 800 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, idx) => (
            <tr key={item.id}>
              <td style={{ border: '1px solid #000', padding: '4px 2px', textAlign: 'center', fontWeight: 700 }}>{idx + 1}</td>
              <td style={{ border: '1px solid #000', padding: '4px', fontWeight: 700 }}>
                {item.name}
                {item.note && <div style={{ fontSize: '9px', fontWeight: 500 }}>↳ {item.note}</div>}
              </td>
              <td style={{ border: '1px solid #000', padding: '4px 2px', textAlign: 'center', fontWeight: 700 }}>{item.quantity}</td>
              <td style={{ border: '1px solid #000', padding: '4px', textAlign: 'right', fontWeight: 700 }}>{item.lineTotal.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ marginTop: '6px', fontSize: '12px', padding: '0 4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Items / Qty</span><span>{order.items.length} / {totalQty}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Subtotal</span><span>{money(order.subtotal.toFixed(0))}</span></div>
        {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Discount</span><span>- {money(order.discount.toFixed(0))}</span></div>}
        {order.tax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Tax</span><span>{money(order.tax.toFixed(0))}</span></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', marginTop: '4px', border: '2px solid #000', fontSize: '14px', fontWeight: 900, letterSpacing: '1px' }}>
          <span>GRAND TOTAL</span><span>{money(order.grandTotal.toFixed(0))}</span>
        </div>
      </div>

      <PaymentBlock order={order} />

      {/* Special Notes box */}
      {specialNote && (
        <div style={{ border: '1px solid #000', padding: '6px 8px', marginTop: '6px', fontSize: '11px' }}>
          <span style={{ fontWeight: 800 }}>Special Notes : </span>
          <span>{specialNote}</span>
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '12px' }}>{`— ${settings.thankYouText || 'Thank You'} —`}</div>
      <div style={{ textAlign: 'center', fontSize: '10px', marginTop: '2px' }}>Please visit again</div>

      <PaymentStatusBlock order={order} settings={settings} />
      <QRSection settings={settings} qrData={qrData} />
      <BrandFooter settings={settings} rs={rs} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}

// ===== DESIGN: KOT CLASSIC (uploaded reference — chef hat + cloche, dashed dividers, dotted item rows) =====
// All visible text uses editable receiptStyles tokens, so the user can change font, size, alignment, and weight
// for every block from Settings → Receipt → Text Styles. Restaurant name / address / phone / footer / thankyou /
// visit-again text are all pulled from settings (no hardcoded "Restaurant" or static text).
function KotClassicReceipt({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  const tableLabel = order.tableName || (order as any).tableLabel || '—';
  const pax = (order as any).pax || (order as any).guests || order.items.reduce((s, i) => s + i.quantity, 0);
  const dashed = '------------------------------------------------';
  const dotted = '................................................';

  const labelRow = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', gap: 6, ...getStyleCSS(rs.orderId, { size: 12, align: 'left', bold: false }) }}>
      <span style={{ minWidth: 70 }}>{label}</span>
      <span>:</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );

  return (
    <>
      {/* Header: chef-hat logo (uses uploaded restaurant logo if set) + restaurant name */}
      <div style={{ textAlign: 'center', paddingBottom: 4 }}>
        {settings.logo
          ? <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 4px' }} />
          : <div style={{ fontSize: 36, lineHeight: 1, margin: '2px 0' }}>👨‍🍳</div>}
        <h1 style={{ ...getStyleCSS(rs.restaurantName, { size: 22, align: 'center', bold: true }), letterSpacing: 2, lineHeight: 1.1, margin: 0 }}>
          {settings.name || 'Restaurant'}
        </h1>
        {settings.address && (
          <p style={{ ...getStyleCSS(rs.address, { size: 11, align: 'center', bold: false }), letterSpacing: 1, margin: '2px 0 0' }}>
            — {settings.address} —
          </p>
        )}
        {(settings.phone1 || settings.phone2) && (
          <p style={{ ...getStyleCSS(rs.phone, { size: 11, align: 'center', bold: false }), margin: '2px 0 0' }}>
            {[settings.phone1, settings.phone2].filter(Boolean).join(' • ')}
          </p>
        )}
      </div>

      <div style={{ textAlign: 'center', letterSpacing: 1, fontSize: 11, color: '#000' }}>{dashed}</div>

      {/* CUSTOMER RECEIPT title */}
      <div style={{ textAlign: 'center', padding: '6px 0' }}>
        <span style={{ ...getStyleCSS(rs.status, { size: 16, align: 'center', bold: true }), letterSpacing: 1 }}>
          CUSTOMER RECEIPT
        </span>
      </div>

      {/* Info grid — two columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px', padding: '2px 0' }}>
        {labelRow('Order No', order.orderNumber)}
        {labelRow('Date', dateStr)}
        {labelRow('Time', timeStr)}
        {labelRow('Table No', tableLabel)}
        {labelRow('Order Type', getOrderTypeLabel(order))}
        {labelRow('Pax', pax)}
        {order.waiterName && labelRow('Waiter', order.waiterName)}
      </div>

      <div style={{ textAlign: 'center', letterSpacing: 1, fontSize: 11, color: '#000' }}>{dashed}</div>

      {/* Items table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', margin: '4px 0' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #000' }}>
            <th style={{ ...getStyleCSS(rs.items, { size: 12, align: 'left', bold: true }), padding: '4px 2px', width: 18 }}>#</th>
            <th style={{ ...getStyleCSS(rs.items, { size: 12, align: 'left', bold: true }), padding: '4px 2px' }}>Item Name</th>
            <th style={{ ...getStyleCSS(rs.items, { size: 12, align: 'center', bold: true }), padding: '4px 2px', width: 32 }}>Qty</th>
            <th style={{ ...getStyleCSS(rs.items, { size: 12, align: 'right', bold: true }), padding: '4px 2px', width: 55 }}>Rate</th>
            <th style={{ ...getStyleCSS(rs.items, { size: 12, align: 'right', bold: true }), padding: '4px 2px', width: 60 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((it, idx) => (
            <tr key={it.id}>
              <td colSpan={5} style={{ padding: 0 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '18px 1fr 32px 55px 60px', alignItems: 'center', padding: '4px 2px' }}>
                  <span style={{ ...getStyleCSS(rs.items, { size: 12, align: 'left', bold: false }) }}>{idx + 1}</span>
                  <span style={{ ...getStyleCSS(rs.items, { size: 12, align: 'left', bold: false }) }}>
                    {it.name}
                    {it.note && <div style={{ fontSize: 9, color: '#333' }}>↳ {it.note}</div>}
                  </span>
                  <span style={{ ...getStyleCSS(rs.items, { size: 12, align: 'center', bold: false }) }}>{it.quantity}</span>
                  <span style={{ ...getStyleCSS(rs.items, { size: 12, align: 'right', bold: false }) }}>{it.price.toFixed(2)}</span>
                  <span style={{ ...getStyleCSS(rs.items, { size: 12, align: 'right', bold: false }) }}>{it.lineTotal.toFixed(2)}</span>
                </div>
                {idx < order.items.length - 1 && (
                  <div style={{ textAlign: 'center', fontSize: 9, color: '#777', lineHeight: 1, letterSpacing: 1 }}>{dotted}</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ borderTop: '1px solid #000', margin: '2px 0' }} />

      {/* Totals */}
      <div style={{ ...getStyleCSS(rs.totals, { size: 12, align: 'left', bold: false }), padding: '2px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
          <span>Subtotal</span><span>{order.subtotal.toFixed(2)}</span>
        </div>
        {order.serviceCharge > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span>Service Charge {order.serviceChargePercent ? `(${order.serviceChargePercent}%)` : ''}</span>
            <span>{order.serviceCharge.toFixed(2)}</span>
          </div>
        )}
        {order.tax > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span>Sales Tax {settings.taxAmount ? `(${settings.taxAmount}%)` : ''}</span>
            <span>{order.tax.toFixed(2)}</span>
          </div>
        )}
        {order.discount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span>Discount{order.discountTitle ? ` (${order.discountTitle})` : ''}</span>
            <span>-{order.discount.toFixed(2)}</span>
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '6px 0', margin: '2px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', ...getStyleCSS(rs.totals, { size: 16, align: 'left', bold: true }) }}>
          <span>TOTAL</span><span>{order.grandTotal.toFixed(2)}</span>
        </div>
      </div>

      <PaymentBlock order={order} />

      {/* Thank you + visit again — editable from settings */}
      <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
        <p style={{ ...getStyleCSS(rs.footer, { size: 12, align: 'center', bold: false }), margin: 0 }}>
          --- {settings.thankYouText || 'Thank You'} ---
        </p>
        <p style={{ ...getStyleCSS(rs.visitAgain, { size: 12, align: 'center', bold: false }), margin: '2px 0 0' }}>
          {settings.visitAgainText || 'We Hope to See You Again!'}
        </p>
      </div>

      <div style={{ textAlign: 'center', letterSpacing: 1, fontSize: 11, color: '#000' }}>{dashed}</div>

      <div style={{ textAlign: 'center', ...getStyleCSS(rs.footer, { size: 10, align: 'center', bold: false }), padding: '4px 0' }}>
        Printed: {dateStr} {timeStr}
      </div>

      {settings.receiptFooter && (
        <p style={{ ...getStyleCSS(rs.footer, { size: 11, align: 'center', bold: false }), whiteSpace: 'pre-line', padding: '4px 0', margin: 0 }}>
          {settings.receiptFooter}
        </p>
      )}

      <PaymentStatusBlock order={order} settings={settings} />
      <QRSection settings={settings} qrData={qrData} />
      <BrandFooter settings={settings} rs={rs} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}


// ===== PRE RECEIPT (Maliks style) =====
// Logo → name → address → phone, "PRE RECEIPT" band, boxed invoice/date grid,
// order-type band, token/table/waiter rows, Qty|Description|Rate|Amount table,
// exclusive-tax totals block and a signature/footer line.
function PreReceiptTemplate({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const { rs, dateStr, timeStr, logoW, logoH, qrData } = useReceiptData(order, settings);
  const printed = new Date();
  const printedDate = printed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const printedTime = printed.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const line = '1px solid #000';
  const row = (label: string, value: React.ReactNode) => (
    <tr>
      <td style={{ border: line, padding: '2px 4px', fontWeight: 700, width: '45%' }}>{label}</td>
      <td style={{ border: line, padding: '2px 4px', fontWeight: 700 }}>{value}</td>
    </tr>
  );
  const taxPct = (settings as any).taxRate ?? (settings as any).taxPercent;
  const taxLabel = taxPct ? `${taxPct}%` : '';
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 4 }}>
        {settings.logo && <img src={settings.logo} alt="Logo" style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 2px' }} />}
        <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: 1, color: '#000' }}>{settings.name}</div>
        {settings.address && <div style={{ fontSize: 10, fontWeight: 600, color: '#000' }}>{settings.address}</div>}
        <div style={{ fontSize: 10, fontWeight: 700, color: '#000' }}>
          {[settings.phone1, settings.phone2].filter(Boolean).join(' | ')}
        </div>
      </div>

      <div style={{ border: line, textAlign: 'center', fontWeight: 900, fontSize: 13, letterSpacing: 2, padding: '2px 0', margin: '4px 0' }}>
        PRE RECEIPT
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5, color: '#000' }}>
        <tbody>
          {row('Invoice #', order.orderNumber)}
          {row('Print Date', `${printedDate}   ${printedTime}`)}
          {row('Order Date', `${dateStr}   ${timeStr}`)}
        </tbody>
      </table>

      <div style={{ border: line, borderTop: 'none', textAlign: 'center', fontWeight: 900, fontSize: 12, letterSpacing: 2, padding: '2px 0' }}>
        {getOrderTypeLabel(order).toUpperCase()}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5, color: '#000' }}>
        <tbody>
          {(order.tokenLabel || order.tokenNumber) ? row('Token No', order.tokenLabel || order.tokenNumber) : null}
          {order.tableName ? row('Table #', order.tableName) : null}
          {(order as any).guestCount ? row('No Of Person', (order as any).guestCount) : null}
          {order.waiterName ? row('Waiter', order.waiterName) : null}
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5, marginTop: 4, color: '#000' }}>
        <thead>
          <tr>
            <th style={{ borderBottom: line, textAlign: 'left', padding: '2px 0', width: 26 }}>Qty</th>
            <th style={{ borderBottom: line, textAlign: 'left', padding: '2px 0' }}>Description</th>
            <th style={{ borderBottom: line, textAlign: 'right', padding: '2px 0', width: 42 }}>Rate</th>
            <th style={{ borderBottom: line, textAlign: 'right', padding: '2px 0', width: 56 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map(item => (
            <tr key={item.id}>
              <td style={{ padding: '2px 0', fontWeight: 700 }}>{item.quantity.toFixed(2)}</td>
              <td style={{ padding: '2px 0', fontWeight: 700 }}>
                {item.name}
                {item.note && <div style={{ fontSize: 9 }}>({item.note})</div>}
              </td>
              <td style={{ padding: '2px 0', textAlign: 'right' }}>{item.price.toFixed(0)}</td>
              <td style={{ padding: '2px 0', textAlign: 'right', fontWeight: 700 }}>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ borderTop: line, marginTop: 4, paddingTop: 3, fontSize: 11, color: '#000' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
          <span>Amount {taxLabel ? '(Exclusive Tax)' : ''}</span><span>{order.subtotal.toFixed(2)}</span>
        </div>
        {order.discount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}><span>Discount</span><span>-{order.discount.toFixed(2)}</span></div>
        )}
        {order.tax > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}><span>Tax {taxLabel}</span><span>{order.tax.toFixed(2)}</span></div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: line, borderBottom: line, marginTop: 3, padding: '3px 0', fontSize: 13, fontWeight: 900 }}>
          <span>Total Amount</span><span>{order.grandTotal.toFixed(2)}</span>
        </div>
      </div>

      <div style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 700, padding: '6px 0 2px', color: '#000' }}>
        {`!! ${settings.thankYouText || 'Please Join us Again Thanks'} !!`}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, color: '#000' }}>
        <tbody>
          <tr>
            <td style={{ borderTop: line, padding: '2px 0', fontWeight: 700 }}>User</td>
            <td style={{ borderTop: line, padding: '2px 0', textAlign: 'right' }}>{order.cashierName || '—'}</td>
          </tr>
          <tr>
            <td style={{ padding: '2px 0', fontWeight: 700 }}>Counter</td>
            <td style={{ padding: '2px 0', textAlign: 'right' }}>{(settings as any).counterName || settings.name}</td>
          </tr>
        </tbody>
      </table>

      <PraFiscalBlock order={order} settings={settings} />
      <PaymentStatusBlock order={order} settings={settings} />
      <QRSection settings={settings} qrData={qrData} />
      <BrandFooter settings={settings} rs={rs} />
      <CustomerDetailsSection order={order} rs={rs} />
    </>
  );
}
