import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Order, RestaurantSettings, ReceiptTextStyle } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { isElectron, printReceiptNative } from '@/lib/electron';
import { resolveLocalPrinterForRole, getLocalPrinterSettings } from '@/lib/localPrinterSettings';
import { resolvePageHeight } from '@/lib/printPageStrategy';
import { appendPrintLog } from '@/lib/printLog';
import { beginThermalPrintDomSession, getEffectiveReceiptMargins, getThermalPaperWidthMicrons, getThermalPrintJobHeightMm, shouldUsePrinterDefaultPageSize, waitForThermalPrintLayout, waitForPrintAssets, hasPrintableContent } from '@/lib/thermal-print';
import { StandardInfoGrid, StandardInfoRows, getOrderTypeLabel } from '@/lib/standardOrderInfo';

interface Props {
  order: Order;
  settings: RestaurantSettings;
  showPrintButton?: boolean;
  autoPrint?: boolean;
  autoPrintDelayMs?: number;
  noPrintPortal?: boolean; // when combined with receipt, skip own portal
  onAutoPrintComplete?: (result: { success: boolean; error?: string }) => void;
  /** Render only newly-added items with an ORDER UPDATED banner. */
  updateMode?: boolean;
  /** Restrict displayed items to this set of cart line IDs (with delta qty). */
  diffItemIds?: string[];
  /** Per-line delta quantities to print (used when updateMode is true). */
  diffDeltas?: Record<string, number>;
  /** Per-line cancelled quantities (positive numbers) printed as CANCELLED entries. */
  cancelDeltas?: Record<string, number>;
  /** Map of itemId -> name for cancelled lines that may have been fully removed from the cart. */
  cancelNames?: Record<string, string>;
}

const defaultStyle: ReceiptTextStyle = { font: 'default', size: 12, align: 'center', bold: true };
const URDU_FONTS = ['Aseer Unicode', 'AA Sameer Armaa', 'Jameel Noori Nastaleeq', 'Jameel Noori Nastaleeq Regular'];

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

export default function KitchenReceipt({ order: rawOrder, settings, showPrintButton = true, autoPrint = false, autoPrintDelayMs = 300, noPrintPortal = false, onAutoPrintComplete, updateMode = false, diffItemIds, diffDeltas, cancelDeltas, cancelNames }: Props) {
  // ===== KOT diff: when updateMode is true, render only new/added items with adjusted quantities.
  //       This ensures Kitchen does NOT re-cook items that were already on a previous KOT.
  const order = useMemo(() => {
    if (!updateMode) return rawOrder;
    const idSet = diffItemIds ? new Set(diffItemIds) : null;
    const items = (rawOrder.items || [])
      .map(it => {
        if (idSet && !idSet.has(it.id)) return null;
        const delta = diffDeltas?.[it.id] ?? (it.quantity - (it.printedQty || 0));
        if (delta <= 0) return null;
        return { ...it, quantity: delta };
      })
      .filter(Boolean) as typeof rawOrder.items;
    return { ...rawOrder, items };
  }, [rawOrder, updateMode, diffItemIds, diffDeltas]);

  const previewRef = useRef<HTMLDivElement | null>(null);
  const printRef = useRef<HTMLDivElement | null>(null);
  const autoPrintDone = useRef(false);
  const paperWidth = settings.paperSize || '80mm';
  const scalePercent = Math.max(50, Math.min(200, settings.receiptScale || 100));
  const scaleFactor = scalePercent / 100;
  const design = settings.kotDesign || 'classic';
  const showLogo = settings.kotShowLogo !== false;
  const showAddress = settings.kotShowAddress !== false;
  const showPhone = settings.kotShowPhone !== false;
  const showCustomer = settings.kotShowCustomer !== false;
  const showWaiter = settings.kotShowWaiter !== false;
  const showRider = settings.kotShowRider !== false;
  const showNotes = settings.kotShowNotes !== false;
  const showDateTime = settings.kotShowDateTime !== false;
  const showCustomerAddress = settings.kotShowCustomerAddress !== false;
  const customerAddress = order.customer?.fullAddress || order.customer?.address || '';
  const margins = getEffectiveReceiptMargins(settings);
  const usePrinterDefaultPageSize = shouldUsePrinterDefaultPageSize(settings);

  const handlePrint = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    const measureEl = printRef.current || previewRef.current;
    const measureSessionCleanup = beginThermalPrintDomSession(printRef.current || measureEl, paperWidth, undefined, settings);
    await waitForThermalPrintLayout();
    // Blank-Receipt Fix: fonts + logo must be painted before measuring/printing.
    await waitForPrintAssets(measureEl);
    await waitForThermalPrintLayout();

    if (!hasPrintableContent(measureEl)) {
      measureSessionCleanup();
      console.warn('[DT-Print] KOT content empty — print skipped');
      return { success: false, error: 'KOT content empty — print skipped' };
    }

    const heightMm = getThermalPrintJobHeightMm(measureEl, settings);
    const widthMicrons = getThermalPaperWidthMicrons(paperWidth);
    const pageStrategy = resolvePageHeight(heightMm);
    const heightMicrons = pageStrategy.pageHeightMicrons;
    measureSessionCleanup();

    const browserPrint = () => {
      const cleanup = beginThermalPrintDomSession(printRef.current || measureEl, paperWidth, heightMm, settings);
      const cleanupAfterPrint = () => {
        cleanup();
        window.removeEventListener('afterprint', cleanupAfterPrint);
      };
      window.addEventListener('afterprint', cleanupAfterPrint, { once: true });
      window.print();
    };

    // ===== v1.2.3: LAN / Network KOT printer support =====
    // Previously ONLY customer receipts knew about LAN printers. A KOT
    // assigned to a LAN printer had no Windows printerName, so the job
    // silently fell back to the DEFAULT (cash) printer — kitchen slips
    // came out at the counter. Now the 'kitchen' role routes to its LAN
    // printer first, and on LAN failure we do NOT print on the cash
    // printer unless the user explicitly enabled the fallback setting.
    try {
      const { printPortalViaLan } = await import('@/printing/lanPrint');
      const lanPortal = (printRef.current || measureEl) as HTMLElement | null;
      const lanSession = beginThermalPrintDomSession(lanPortal, paperWidth, heightMm, settings);
      let lanResult: { handled: boolean; success: boolean; error?: string };
      try {
        await waitForThermalPrintLayout();
        lanResult = await printPortalViaLan('kitchen', lanPortal, paperWidth as any);
      } finally {
        lanSession();
      }
      if (lanResult.handled) {
        if (lanResult.success) return { success: true };
        console.warn('[DT-Print] KOT LAN print failed:', lanResult.error);
        if (settings.kotFallbackToReceipt === true) {
          // user explicitly wants a fallback slip — continue to system path below
        } else {
          return { success: false, error: lanResult.error || 'KOT LAN print failed' };
        }
      }
    } catch (e: any) {
      console.warn('[DT-Print] KOT LAN routing error, using system path:', e?.message || e);
    }

    const fallbackEnabled = settings.kotFallbackToReceipt !== false;
    // Prefer LOCAL per-device printer (fixes multi-device issue where each PC
    // has a different physical printer). Fall back to cloud kotPrinter setting.
    const localKot = resolveLocalPrinterForRole('kot');
    const localSilent = getLocalPrinterSettings().silentPrint;
    const resolvedPrinter = (localKot?.printerName) || settings.kotPrinter || (fallbackEnabled ? (settings.defaultPrinter || '') : '');

    if (isElectron() && (localSilent || settings.silentPrint)) {
      if (!resolvedPrinter && !fallbackEnabled) {
        return { success: false, error: 'KOT printer not configured on this device' };
      }
      const nativePrintCleanup = beginThermalPrintDomSession(printRef.current || measureEl, paperWidth, heightMm, settings);
      let result: any;
      try {
        // Blank-Receipt Fix: allow print-session CSS to apply before rasterizing.
        await waitForThermalPrintLayout();
        result = await printReceiptNative({
          printerName: resolvedPrinter,
          silent: true,
          pageWidthMicrons: widthMicrons,
          pageHeightMicrons: heightMicrons,
          usePrinterDefaultPageSize: pageStrategy.usePrinterDefaultPageSize,
          autoCut: settings.autoCut !== false,
          cutMode: settings.cutMode || 'full',
          driverType: settings.printerDriverType || 'escpos',
          dpi: 203,
        });

        // ===== Mirror copy on Cash/Receipt printer (verification) =====
        // Jab user ne kotMirrorToReceiptPrinter ON kiya ho aur defaultPrinter alag
        // ho KOT printer se — to ek extra KOT copy receipt printer pe bhi nikalti hai
        // taake user verify kar sake KOT generate ho raha hai.
        try {
          const mirrorOn = settings.kotMirrorToReceiptPrinter === true;
          const cashPrinter = settings.defaultPrinter || '';
          if (mirrorOn && cashPrinter && cashPrinter !== resolvedPrinter) {
            await printReceiptNative({
              printerName: cashPrinter,
              silent: true,
              pageWidthMicrons: widthMicrons,
              pageHeightMicrons: heightMicrons,
              usePrinterDefaultPageSize,
              autoCut: settings.autoCut !== false,
              cutMode: settings.cutMode || 'full',
              driverType: settings.printerDriverType || 'escpos',
              dpi: 203,
            });
          }
        } catch (e) { console.warn('[KOT mirror] failed', e); }

      } finally {
        // WHITE-SCREEN FIX: cleanup runs even if the IPC/print throws.
        nativePrintCleanup();
      }
      if (!result.success) browserPrint();
      return result;
    } else {
      browserPrint();
      return { success: true };
    }
  }, [paperWidth, settings, usePrinterDefaultPageSize]);


  useEffect(() => {
    if (!autoPrint || autoPrintDone.current) return;
    autoPrintDone.current = true;
    const t = setTimeout(() => {
      const startedAt = Date.now();
      const log = (result: { success: boolean; error?: string }) => {
        try {
          const localKot = resolveLocalPrinterForRole('kot');
          appendPrintLog({
            printType: 'kitchen',
            stage: 'print',
            status: result.success ? 'success' : 'failed',
            billNumber: String(order.orderNumber ?? order.id ?? ''),
            printerName: localKot?.printerName || settings.kotPrinter || settings.defaultPrinter || '(browser dialog)',
            error: result.error,
            ms: Date.now() - startedAt,
          });
        } catch {}
      };
      handlePrint()
        .then((result) => { log(result); onAutoPrintComplete?.(result); })
        .catch((err) => {
          const result = { success: false, error: err?.message || String(err) };
          log(result);
          onAutoPrintComplete?.(result);
        });
    }, Math.max(0, autoPrintDelayMs));
    return () => clearTimeout(t);
  }, [autoPrint, autoPrintDelayMs, handlePrint, onAutoPrintComplete, order, settings]);


  const now = new Date(order.createdAt);
  const time = now.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('en-PK');
  const totalItems = order.items.reduce((s, i) => s + i.quantity, 0);

  const renderClassic = () => (
    <>
      <div style={{ textAlign: 'center', borderBottom: '2px dashed #000', paddingBottom: '4px', marginBottom: '6px' }}>
        <div style={{ fontSize: '16px', fontWeight: 900, letterSpacing: '2px' }}>🍳 KITCHEN ORDER</div>
        {showLogo && settings.logo && (
          <img src={settings.logo} alt="" style={{ maxWidth: '50px', maxHeight: '30px', margin: '4px auto', display: 'block' }} />
        )}
        <div style={{ fontSize: '11px', fontWeight: 700 }}>{settings.name || ''}</div>
        {showAddress && settings.address && <div style={{ fontSize: '9px' }}>{settings.address}</div>}
        {showPhone && settings.phone1 && <div style={{ fontSize: '9px' }}>📞 {settings.phone1}</div>}
      </div>
      {renderOrderInfo()}
      {renderItems()}
      {renderFooter()}
    </>
  );

  const renderBold = () => (
    <>
      <div style={{ textAlign: 'center', background: '#000', color: '#fff', padding: '6px 4px', marginBottom: '6px' }}>
        <div style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '3px' }}>★ KOT ★</div>
        <div style={{ fontSize: '10px', fontWeight: 600 }}>{settings.name || ''}</div>
      </div>
      <div style={{ border: '2px solid #000', padding: '4px', marginBottom: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 900 }}>
          <span>#{order.orderNumber}</span>
          <span style={{ textTransform: 'uppercase', background: '#000', color: '#fff', padding: '1px 8px', fontSize: '11px' }}>
            {order.orderType}
          </span>
        </div>
        {showDateTime && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginTop: '2px' }}>
            <span>{date}</span><span>{time}</span>
          </div>
        )}
        {order.tableName && <div style={{ fontSize: '13px', fontWeight: 900, marginTop: '2px' }}>TABLE: {order.tableName}</div>}
        {showWaiter && order.waiterName && <div style={{ fontSize: '10px' }}>Waiter: {order.waiterName}</div>}
        {showCustomerAddress && customerAddress && <div style={{ fontSize: '10px', fontWeight: 700, marginTop: '2px' }}>📍 {customerAddress}</div>}
      </div>
      <div style={{ marginBottom: '6px' }}>
        {order.items.map((item, i) => (
          <div key={item.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '5px 0', borderBottom: '2px solid #000',
          }}>
            <span style={{ fontWeight: 800, fontSize: '14px', flex: 1 }}>
              {item.name}
              {item.note && <div style={{ fontSize: '9px', fontStyle: 'italic' }}>→ {item.note}</div>}
            </span>
            <span style={{ fontWeight: 900, fontSize: '20px', background: '#000', color: '#fff', padding: '2px 10px', minWidth: '40px', textAlign: 'center' }}>
              {item.quantity}
            </span>
          </div>
        ))}
      </div>
      <div style={{ background: '#000', color: '#fff', padding: '4px', textAlign: 'center', fontWeight: 900, fontSize: '13px' }}>
        TOTAL: {totalItems} ITEMS
      </div>
      {showNotes && order.notes && (
        <div style={{ marginTop: '4px', border: '2px solid #000', padding: '4px', fontSize: '10px', fontWeight: 800 }}>
          ⚠ {order.notes}
        </div>
      )}
      <div style={{ textAlign: 'center', marginTop: '4px', fontSize: '9px', fontWeight: 700 }}>— KITCHEN COPY —</div>
    </>
  );

  const renderMinimal = () => (
    <>
      <div style={{ borderBottom: '1px solid #000', paddingBottom: '3px', marginBottom: '5px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '14px', fontWeight: 800 }}>KOT #{order.orderNumber}</span>
          <span style={{ fontSize: '10px', background: '#eee', padding: '1px 6px', textTransform: 'uppercase' }}>{order.orderType}</span>
        </div>
        {showDateTime && <div style={{ fontSize: '9px', color: '#666' }}>{date} {time}</div>}
        {order.tableName && <div style={{ fontSize: '11px', fontWeight: 700 }}>{order.tableName}</div>}
      </div>
      <div style={{ marginBottom: '5px' }}>
        {order.items.map((item, i) => (
          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px dotted #ccc' }}>
            <span style={{ fontSize: '12px' }}>
              {item.name}
              {item.note && <span style={{ fontSize: '9px', color: '#888' }}> ({item.note})</span>}
            </span>
            <span style={{ fontWeight: 800, fontSize: '13px' }}>×{item.quantity}</span>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid #000', paddingTop: '3px', fontSize: '10px', display: 'flex', justifyContent: 'space-between' }}>
        <span>Items: {totalItems}</span>
        {showWaiter && order.waiterName && <span>{order.waiterName}</span>}
      </div>
    </>
  );

  const renderElegant = () => (
    <>
      <div style={{ textAlign: 'center', paddingBottom: '6px', marginBottom: '6px', borderBottom: '1px solid #000' }}>
        {showLogo && settings.logo && (
          <img src={settings.logo} alt="" style={{ maxWidth: '40px', maxHeight: '25px', margin: '0 auto 3px', display: 'block' }} />
        )}
        <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '4px', textTransform: 'uppercase', color: '#555' }}>Kitchen Order Ticket</div>
        <div style={{ fontSize: '12px', fontWeight: 700, marginTop: '2px' }}>{settings.name || ''}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px', padding: '3px 0', borderBottom: '1px solid #ddd' }}>
        <span style={{ fontWeight: 700 }}>Order #{order.orderNumber}</span>
        <span style={{ fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', fontSize: '9px', background: '#f5f5f5', padding: '1px 6px' }}>{order.orderType}</span>
      </div>
      {showDateTime && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#777', marginBottom: '4px' }}>
          <span>{date}</span><span>{time}</span>
        </div>
      )}
      {order.tableName && <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '2px' }}>⬡ {order.tableName}</div>}
      {showWaiter && order.waiterName && <div style={{ fontSize: '9px', color: '#555', marginBottom: '4px' }}>Served by: {order.waiterName}</div>}
      {showCustomer && order.customer?.name && (
        <div style={{ fontSize: '9px', color: '#555', marginBottom: '4px' }}>
          Guest: {order.customer.name} {order.customer.phone ? `• ${order.customer.phone}` : ''}
        </div>
      )}
      {showCustomerAddress && customerAddress && (
        <div style={{ fontSize: '10px', fontWeight: 700, color: '#000', marginBottom: '4px' }}>📍 {customerAddress}</div>
      )}
      <div style={{ marginBottom: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontWeight: 700, borderBottom: '1px solid #000', paddingBottom: '2px', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '1px' }}>
          <span>Item</span><span>Qty</span>
        </div>
        {order.items.map((item, i) => (
          <div key={item.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '4px 0', borderBottom: i < order.items?.length || 0 - 1 ? '1px dotted #ddd' : 'none',
          }}>
            <span style={{ fontSize: '12px', fontWeight: 600, flex: 1 }}>
              {i + 1}. {item.name}
              {item.note && <div style={{ fontSize: '8px', fontStyle: 'italic', color: '#888' }}>↳ {item.note}</div>}
            </span>
            <span style={{ fontWeight: 800, fontSize: '14px', background: '#f0f0f0', padding: '1px 8px', borderRadius: '3px', minWidth: '30px', textAlign: 'center' }}>
              {item.quantity}
            </span>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid #000', paddingTop: '4px', display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
        <span style={{ fontWeight: 700 }}>Total: {totalItems} items</span>
        {showRider && order.riderName && <span>Rider: {order.riderName}{order.riderPhone ? ` (${order.riderPhone})` : ''}</span>}
      </div>
      {showNotes && order.notes && (
        <div style={{ marginTop: '4px', padding: '3px 4px', border: '1px solid #ddd', borderRadius: '3px', fontSize: '9px' }}>
          Note: {order.notes}
        </div>
      )}
      <div style={{ textAlign: 'center', marginTop: '6px', fontSize: '8px', color: '#aaa', letterSpacing: '2px', textTransform: 'uppercase' }}>
        — Kitchen Copy —
      </div>
    </>
  );

  const renderOrderInfo = () => (
    <div style={{ borderBottom: '1px dashed #000', paddingBottom: '4px', marginBottom: '6px' }}>
      <StandardInfoRows order={order} labelWidth={75} fontSize={11} opts={{ includeCustomerAddress: showCustomerAddress }} />
    </div>
  );


  const renderItems = () => (
    <div style={{ marginBottom: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '11px', borderBottom: '1px solid #000', paddingBottom: '2px', marginBottom: '4px' }}>
        <span>ITEM</span><span>QTY</span>
      </div>
      {order.items.map((item, i) => (
        <div key={item.id} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '4px 0', borderBottom: i < order.items?.length || 0 - 1 ? '1px dotted #999' : 'none',
        }}>
          <span style={{ fontWeight: 700, fontSize: '13px', flex: 1 }}>
            {i + 1}. {item.name}
            {item.note && <div style={{ fontSize: '9px', fontStyle: 'italic', color: '#555' }}>📝 {item.note}</div>}
          </span>
          <span style={{ fontWeight: 900, fontSize: '16px', background: '#000', color: '#fff', padding: '2px 8px', borderRadius: '4px', minWidth: '32px', textAlign: 'center' }}>
            x{item.quantity}
          </span>
        </div>
      ))}
    </div>
  );

  const renderFooter = () => (
    <>
      <div style={{ borderTop: '2px dashed #000', paddingTop: '4px', textAlign: 'center' }}>
        <div style={{ fontSize: '12px', fontWeight: 800 }}>Total Items: {totalItems}</div>
      </div>
      {showNotes && order.notes && (
        <div style={{ marginTop: '4px', padding: '4px', border: '1px solid #000', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>
          📝 NOTE: {order.notes}
        </div>
      )}
      <div style={{ textAlign: 'center', marginTop: '6px', fontSize: '9px', borderTop: '1px dashed #000', paddingTop: '4px' }}>
        <div style={{ fontWeight: 700 }}>— KITCHEN COPY —</div>
      </div>
      {settings.marketingFooter?.trim() && (
        <div style={{ textAlign: 'center', marginTop: '4px', paddingTop: '4px', borderTop: '1px dashed #000', fontSize: '9px', fontWeight: 700, whiteSpace: 'pre-line', lineHeight: 1.3 }}>
          {settings.marketingFooter}
        </div>
      )}
    </>
  );

  const renderVipChef = () => (
    <>
      <div style={{ background: '#000', color: '#fff', padding: '8px 4px', textAlign: 'center', marginBottom: '6px' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '5px' }}>CHEF'S TICKET</div>
        <div style={{ fontSize: '24px', fontWeight: 900, letterSpacing: '4px', marginTop: '2px' }}>#{order.orderNumber}</div>
        <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', marginTop: '2px' }}>{order.orderType}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'stretch', marginBottom: '6px', gap: '4px' }}>
        {showDateTime && (
          <div style={{ flex: 1, border: '2px solid #000', padding: '4px', textAlign: 'center' }}>
            <div style={{ fontSize: '8px', letterSpacing: '2px', color: '#555' }}>FIRED AT</div>
            <div style={{ fontSize: '16px', fontWeight: 900 }}>{time}</div>
            <div style={{ fontSize: '8px' }}>{date}</div>
          </div>
        )}
        {order.tableName && (
          <div style={{ flex: 1, border: '2px solid #000', padding: '4px', textAlign: 'center' }}>
            <div style={{ fontSize: '8px', letterSpacing: '2px', color: '#555' }}>TABLE</div>
            <div style={{ fontSize: '18px', fontWeight: 900 }}>{order.tableName}</div>
          </div>
        )}
      </div>
      {showWaiter && order.waiterName && <div style={{ fontSize: '10px', fontWeight: 700, marginBottom: '4px' }}>SERVER: {order.waiterName}</div>}
      <div style={{ marginBottom: '6px' }}>
        {order.items.map((item, i) => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', borderBottom: '2px solid #000', padding: '6px 0' }}>
            <div style={{ background: '#000', color: '#fff', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', fontWeight: 900, marginRight: '8px', flexShrink: 0 }}>
              {item.quantity}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '15px', fontWeight: 900, lineHeight: 1.1, textTransform: 'uppercase' }}>{item.name}</div>
              {item.note && <div style={{ fontSize: '11px', fontWeight: 700, fontStyle: 'italic', color: '#000', marginTop: '2px', padding: '2px 4px', background: '#eee' }}>⚠ {item.note}</div>}
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: '#000', color: '#fff', textAlign: 'center', padding: '6px', fontWeight: 900, fontSize: '14px', letterSpacing: '2px' }}>
        TOTAL: {totalItems} ITEMS · {order.items?.length || 0} LINES
      </div>
      {showNotes && order.notes && (
        <div style={{ marginTop: '4px', border: '3px solid #000', padding: '5px', fontSize: '12px', fontWeight: 800, background: '#fffbcc' }}>
          ⚠ SPECIAL: {order.notes}
        </div>
      )}
      <div style={{ textAlign: 'center', marginTop: '6px', fontSize: '9px', letterSpacing: '4px', fontWeight: 700 }}>— CHEF COPY —</div>
    </>
  );

  const renderStation = () => (
    <>
      <div style={{ border: '2px solid #000', padding: '4px', marginBottom: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 900 }}>KOT #{order.orderNumber}</div>
            <div style={{ fontSize: '9px', color: '#555' }}>{settings.name}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '16px', fontWeight: 900 }}>{time}</div>
            <div style={{ fontSize: '8px' }}>{date}</div>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '4px', fontSize: '9px', fontWeight: 700, marginBottom: '4px' }}>
        <div style={{ flex: 1, background: '#000', color: '#fff', padding: '2px 4px', textAlign: 'center', textTransform: 'uppercase' }}>{order.orderType}</div>
        {order.tableName && <div style={{ flex: 1, background: '#000', color: '#fff', padding: '2px 4px', textAlign: 'center' }}>T: {order.tableName}</div>}
      </div>
      {showWaiter && order.waiterName && <div style={{ fontSize: '9px', marginBottom: '3px' }}>Server: {order.waiterName}</div>}
      {showRider && order.riderName && <div style={{ fontSize: '9px', marginBottom: '3px' }}>Rider: {order.riderName}{order.riderPhone ? ` (${order.riderPhone})` : ''}</div>}
      <div style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '3px 0', marginBottom: '4px', display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>
        <span style={{ width: '24px', textAlign: 'center' }}>#</span>
        <span style={{ flex: 1, paddingLeft: '4px' }}>Item / Station</span>
        <span style={{ width: '32px', textAlign: 'right' }}>Qty</span>
      </div>
      {order.items.map((item, i) => {
        const lower = item.name.toLowerCase();
        const station = lower.match(/salad|cold|raita|chutney/) ? 'COLD' : lower.match(/drink|juice|tea|coffee|lassi/) ? 'BEVG' : lower.match(/dessert|kheer|ice|cake/) ? 'DESS' : 'HOT';
        return (
          <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', padding: '4px 0', borderBottom: '1px dotted #999' }}>
            <span style={{ width: '24px', fontWeight: 800, fontSize: '11px', textAlign: 'center' }}>{i + 1}</span>
            <div style={{ flex: 1, paddingLeft: '4px' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, lineHeight: 1.2 }}>{item.name}</div>
              <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                <span style={{ fontSize: '8px', background: '#000', color: '#fff', padding: '0 4px', fontWeight: 700, letterSpacing: '1px' }}>{station}</span>
                {item.note && <span style={{ fontSize: '9px', fontStyle: 'italic', color: '#555' }}>· {item.note}</span>}
              </div>
            </div>
            <span style={{ width: '32px', textAlign: 'right', fontWeight: 900, fontSize: '14px' }}>×{item.quantity}</span>
          </div>
        );
      })}
      <div style={{ borderTop: '2px solid #000', marginTop: '4px', padding: '3px 0', display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 800 }}>
        <span>Lines: {order.items?.length || 0}</span><span>Total Qty: {totalItems}</span>
      </div>
      {showNotes && order.notes && (
        <div style={{ marginTop: '3px', padding: '3px 4px', border: '1px dashed #000', fontSize: '9px', fontWeight: 700 }}>NOTE: {order.notes}</div>
      )}
      <div style={{ textAlign: 'center', marginTop: '4px', fontSize: '8px', fontWeight: 700, letterSpacing: '3px' }}>— STATION COPY —</div>
    </>
  );

  const renderTaimoor = (variant: 1 | 2) => {
    const cleanFont = "'Helvetica Neue', 'Segoe UI', Arial, sans-serif";
    const dashed = '1px dashed #000';
    const border = '1px solid #000';
    return (
      <div style={{ fontFamily: cleanFont, color: '#000' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '6px' }}>
          {showLogo && settings.logo && (
            <img src={settings.logo} alt="" style={{ maxWidth: '60px', maxHeight: '60px', margin: '0 auto 4px', display: 'block', objectFit: 'contain' }} />
          )}
          <div style={{ fontSize: '20px', fontWeight: 900, letterSpacing: '4px', fontFamily: "'Georgia', serif" }}>
            {settings.name || ''}
          </div>
          {showAddress && settings.address && <div style={{ fontSize: '9px', marginTop: '2px' }}>{settings.address}</div>}
          {showPhone && settings.phone1 && <div style={{ fontSize: '9px' }}>{settings.phone1}</div>}
        </div>

        <div style={{ borderTop: dashed, margin: '4px 0' }} />

        {/* Title */}
        <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 900, letterSpacing: '1px', margin: '6px 0' }}>
          KITCHEN ORDER TOKEN
        </div>

        {/* Standardized info grid */}
        <div style={{ marginBottom: '6px' }}>
          <StandardInfoGrid order={order} labelWidth={60} fontSize={11} opts={{ includeCustomer: variant === 2, includeCustomerAddress: showCustomerAddress }} />
        </div>


        <div style={{ borderTop: dashed, margin: '4px 0 6px' }} />

        {/* Items table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ border, padding: '4px 3px', width: '24px', fontWeight: 700 }}>#</th>
              <th style={{ border, padding: '4px 5px', textAlign: 'left', fontWeight: 700 }}>Item Name</th>
              <th style={{ border, padding: '4px 3px', width: '34px', fontWeight: 700 }}>Qty</th>
              <th style={{ border, padding: '4px 3px', width: '50px', fontWeight: 700 }}>Note</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, i) => (
              <tr key={item.id}>
                <td style={{ border, padding: '4px 3px', textAlign: 'center' }}>{i + 1}</td>
                <td style={{ border, padding: '4px 5px', fontWeight: 700, wordBreak: 'break-word' }}>{item.name}</td>
                <td style={{ border, padding: '4px 3px', textAlign: 'center', fontWeight: 700 }}>{item.quantity}</td>
                <td style={{ border, padding: '4px 3px', textAlign: 'center', fontSize: '10px', wordBreak: 'break-word' }}>
                  {item.note || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Special Notes */}
        {showNotes && order.notes && (
          <div style={{ border, padding: '5px 6px', marginTop: '6px', fontSize: '11px' }}>
            <span style={{ fontWeight: 700 }}>Special Notes</span>
            <span style={{ margin: '0 6px' }}>:</span>
            <span>{order.notes}</span>
          </div>
        )}

        <div style={{ borderTop: dashed, margin: '8px 0 4px' }} />

        {/* Footer */}
        <div style={{ textAlign: 'center', fontSize: '11px' }}>
          <div style={{ fontWeight: 700 }}>{`— ${settings.kotThankYouText || 'Thank You'} —`}</div>
          {(settings.kotFooterNote ?? 'Please check the order before preparing') && (
            <div style={{ fontSize: '10px', marginTop: '2px' }}>{settings.kotFooterNote ?? 'Please check the order before preparing'}</div>
          )}
          {variant === 2 && (
            <div style={{ fontSize: '9px', marginTop: '4px', color: '#333' }}>
              Printed: {date} {time}
            </div>
          )}
        </div>
      </div>
    );
  };

  const baseBody = design === 'bold' ? renderBold()
    : design === 'minimal' ? renderMinimal()
    : design === 'elegant' ? renderElegant()
    : design === 'vip-chef' ? renderVipChef()
    : design === 'station' ? renderStation()
    : design === 'taimoor1' ? renderTaimoor(1)
    : design === 'taimoor2' ? renderTaimoor(2)
    : renderClassic();

  // ===== UPDATE KOT banner — printed when this is a follow-up KOT for an
  //       edited order. Annotates each line with NEW ITEM / EXTRA QTY / CANCELLED,
  //       lists ALREADY SENT items so the kitchen can verify, and prints a
  //       previous-KOT summary trail. =====
  const updateInfo = useMemo(() => {
    if (!updateMode) return null;
    const printedBefore: Record<string, number> = {};
    for (const it of rawOrder.items || []) printedBefore[it.id] = it.printedQty || 0;
    const newItems: Array<{ id: string; name: string; qty: number; note?: string }> = [];
    const extraItems: Array<{ id: string; name: string; qty: number; oldQty: number; newQty: number; note?: string }> = [];
    for (const id of diffItemIds || Object.keys(diffDeltas || {})) {
      const it = (rawOrder.items || []).find(x => x.id === id);
      if (!it) continue;
      const delta = diffDeltas?.[id] ?? (it.quantity - (it.printedQty || 0));
      if (delta <= 0) continue;
      const had = printedBefore[id] || 0;
      if (had === 0) newItems.push({ id, name: it.name, qty: delta, note: it.note });
      else extraItems.push({ id, name: it.name, qty: delta, oldQty: had, newQty: it.quantity, note: it.note });
    }
    const cancelled: Array<{ id: string; name: string; qty: number }> = [];
    for (const [id, qty] of Object.entries(cancelDeltas || {})) {
      const it = (rawOrder.items || []).find(x => x.id === id);
      const nm = it?.name || cancelNames?.[id] || id;
      cancelled.push({ id, name: nm, qty });
    }
    const alreadySent: Array<{ name: string; qty: number; note?: string }> = [];
    for (const it of rawOrder.items || []) {
      const sent = it.printedQty || 0;
      if (sent > 0) alreadySent.push({ name: it.name, qty: sent, note: it.note });
    }
    const prevKots = (rawOrder.kotRevisions || []).map(r => ({
      kotNo: r.kotNo,
      type: r.type,
      at: r.createdAt,
    }));
    // Phase-3: pair new items with cancelled items in same edit → REPLACED.
    // Heuristic: greedy 1-to-1 pairing in order, capped by the smaller list.
    const replaced: Array<{ oldName: string; newName: string; qty: number; note?: string }> = [];
    const pairCount = Math.min(newItems.length, cancelled.length);
    for (let i = 0; i < pairCount; i++) {
      const n = newItems[i];
      const c = cancelled[i];
      replaced.push({ oldName: c.name, newName: n.name, qty: Math.min(n.qty, c.qty), note: n.note });
    }
    if (pairCount > 0) {
      newItems.splice(0, pairCount);
      cancelled.splice(0, pairCount);
    }
    return { newItems, extraItems, cancelled, replaced, alreadySent, prevKots };
  }, [updateMode, rawOrder, diffItemIds, diffDeltas, cancelDeltas, cancelNames]);

  const fmtT = (iso?: string) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
  };

  const updateBanner = updateMode ? (
    <div style={{ marginBottom: '8px' }}>
      <div style={{
        background: '#000', color: '#fff', padding: '6px 4px', textAlign: 'center', border: '3px double #000',
      }}>
        <div style={{ fontSize: '16px', fontWeight: 900, letterSpacing: '3px' }}>★ ORDER UPDATED ★</div>
        <div style={{ fontSize: '10px', fontWeight: 700, marginTop: '2px' }}>Order #{rawOrder.orderNumber} — KOT changes only</div>
      </div>

      {/* Annotated change list */}
      <div style={{ border: '2px solid #000', marginTop: '6px', padding: '4px' }}>
        {updateInfo?.newItems.map(n => (
          <div key={'new-' + n.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px dashed #000' }}>
            <span style={{ flex: 1, fontSize: '12px', fontWeight: 800 }}>
              <span style={{ background: '#000', color: '#fff', padding: '1px 4px', fontSize: '9px', marginRight: '4px', letterSpacing: '1px' }}>NEW ITEM</span>
              {n.name}
              {n.note && <div style={{ fontSize: '9px', fontStyle: 'italic' }}>↳ {n.note}</div>}
            </span>
            <span style={{ fontWeight: 900, fontSize: '14px' }}>×{n.qty}</span>
          </div>
        ))}
        {updateInfo?.extraItems.map(e => (
          <div key={'ex-' + e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px dashed #000' }}>
            <span style={{ flex: 1, fontSize: '12px', fontWeight: 800 }}>
              <span style={{ background: '#000', color: '#fff', padding: '1px 4px', fontSize: '9px', marginRight: '4px', letterSpacing: '1px' }}>EXTRA QTY</span>
              {e.name}
              <div style={{ fontSize: '9px', color: '#000' }}>was {e.oldQty} → now {e.newQty} (cook +{e.qty})</div>
            </span>
            <span style={{ fontWeight: 900, fontSize: '14px' }}>+{e.qty}</span>
          </div>
        ))}
        {updateInfo?.cancelled.map(c => (
          <div key={'ca-' + c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px dashed #000' }}>
            <span style={{ flex: 1, fontSize: '12px', fontWeight: 800, textDecoration: 'line-through' }}>
              <span style={{ background: '#000', color: '#fff', padding: '1px 4px', fontSize: '9px', marginRight: '4px', letterSpacing: '1px', textDecoration: 'none', display: 'inline-block' }}>CANCELLED</span>
              {c.name}
            </span>
            <span style={{ fontWeight: 900, fontSize: '14px' }}>−{c.qty}</span>
          </div>
        ))}
        {updateInfo?.replaced.map((r, i) => (
          <div key={'rp-' + i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px dashed #000' }}>
            <span style={{ flex: 1, fontSize: '12px', fontWeight: 800 }}>
              <span style={{ background: '#000', color: '#fff', padding: '1px 4px', fontSize: '9px', marginRight: '4px', letterSpacing: '1px' }}>REPLACED</span>
              <span style={{ textDecoration: 'line-through' }}>{r.oldName}</span>
              <span style={{ margin: '0 4px' }}>→</span>
              <span>{r.newName}</span>
              {r.note && <div style={{ fontSize: '9px', fontStyle: 'italic' }}>↳ {r.note}</div>}
            </span>
            <span style={{ fontWeight: 900, fontSize: '14px' }}>×{r.qty}</span>
          </div>
        ))}
        {!updateInfo?.newItems.length && !updateInfo?.extraItems.length && !updateInfo?.cancelled.length && !updateInfo?.replaced.length && (
          <div style={{ fontSize: '10px', textAlign: 'center', padding: '2px 0' }}>No item changes</div>
        )}
      </div>

      {/* ===== v1.15.1 — the order remark was missing from update KOTs =====
          Client report: "Second time I ordered ice cream and put serve later.
          But kot doesn't print the remarks."

          Every FULL kitchen ticket template renders order.notes; this update
          banner rendered only per-item notes and dropped the order-level
          remark entirely. An update KOT prints on its own — the kitchen never
          sees the full ticket again — so "Serve Later" simply vanished and
          the ice cream went out with the burgers. */}
      {showNotes && rawOrder.notes && (
        <div style={{
          marginTop: '6px', padding: '4px', border: '3px double #000',
          fontSize: '12px', fontWeight: 900, textAlign: 'center', letterSpacing: '0.5px',
        }}>
          ⚠ NOTE: {rawOrder.notes}
        </div>
      )}

      {/* Already sent summary */}
      {updateInfo && updateInfo.alreadySent.length > 0 && (
        <div style={{ border: '1px solid #000', marginTop: '6px', padding: '4px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '2px', textAlign: 'center', borderBottom: '1px dashed #000', paddingBottom: '2px', marginBottom: '3px' }}>
            ✓ ALREADY SENT (do not re-cook)
          </div>
          {updateInfo.alreadySent.map((a, i) => (
            <div key={'as-' + i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', padding: '1px 0' }}>
              <span>{a.name}{a.note ? ` (${a.note})` : ''}</span>
              <span style={{ fontWeight: 700 }}>×{a.qty}</span>
            </div>
          ))}
        </div>
      )}

      {/* Previous KOT history */}
      {updateInfo && updateInfo.prevKots.length > 0 && (
        <div style={{ marginTop: '6px', fontSize: '9px', borderTop: '1px dashed #000', paddingTop: '3px' }}>
          <div style={{ fontWeight: 800, letterSpacing: '1px' }}>KOT HISTORY:</div>
          {updateInfo.prevKots.map(k => (
            <div key={'pk-' + k.kotNo} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>KOT #{k.kotNo} · {k.type}</span>
              <span>{fmtT(k.at)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: '9px', fontWeight: 700, marginTop: '4px', fontStyle: 'italic', textAlign: 'center' }}>
        ⚠ Cook only the changes above — do not re-cook the earlier items
      </div>
    </div>
  ) : null;

  const receiptBody = (
    <>
      {updateBanner}
      {/* In update mode, skip the regular item list (banner already shows changes). */}
      {updateMode ? null : baseBody}
    </>
  );


  const ks = settings.kotStyles || {};
  const ksItems = ks.items;
  const ksHeader = ks.header;
  const ksFooter = ks.footer;
  const kotFontFamily = ksItems?.font && ksItems.font !== 'default'
    ? `'${ksItems.font}', ${URDU_FONTS.includes(ksItems.font) ? 'serif' : 'sans-serif'}`
    : "Arial, 'Roboto Mono', 'Courier New', sans-serif";

  const wrapperStyle: React.CSSProperties = {
    width: paperWidth,
    maxWidth: paperWidth,
    background: '#fff',
    color: '#000',
    fontFamily: kotFontFamily,
    fontSize: ksItems?.size ? `${ksItems.size}px` : '13px',
    fontWeight: ksItems ? (ksItems.bold ? 800 : 600) : 700,
    lineHeight: 1.28,
    textAlign: ksItems?.align,
    direction: ksItems?.font && URDU_FONTS.includes(ksItems.font) ? 'rtl' : 'ltr',
    paddingTop: `${margins.top}mm`,
    paddingBottom: `${margins.bottom}mm`,
    paddingLeft: `${margins.left}mm`,
    paddingRight: `${margins.right}mm`,
    boxSizing: 'border-box',
    height: 'auto',
    minHeight: 0,
    overflow: 'visible',
  };

  const contentStyle: React.CSSProperties = {
    width: `${100 / scaleFactor}%`,
    zoom: scaleFactor,
    transformOrigin: 'top left',
  };

  return (
    <>
      <div className="space-y-2">
        <div className="mx-auto w-fit max-w-full rounded-lg border bg-white p-3 shadow-sm">
          <div ref={previewRef} style={wrapperStyle}>
            <div style={contentStyle}>{receiptBody}</div>
          </div>
        </div>
        {showPrintButton && (
          <Button onClick={handlePrint} variant="outline" className="w-full text-xs">
            <Printer className="h-3 w-3 mr-1" /> Print Kitchen Slip
          </Button>
        )}
      </div>
      {/* Print portal */}
      {!noPrintPortal && typeof document !== 'undefined' && createPortal(
        <div className="receipt-print-portal" aria-hidden="true">
          <div ref={printRef} className="receipt-paper print-receipt bg-white text-black" data-paper-size={paperWidth} style={wrapperStyle}>
            <div style={contentStyle}>{receiptBody}</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// Export just the KOT body for combined printing
export function KitchenReceiptBody({ order, settings }: { order: Order; settings: RestaurantSettings }) {
  const design = settings.kotDesign || 'classic';
  const rs = settings.receiptStyles || {};
  const showLogo = settings.kotShowLogo !== false;
  const showAddress = settings.kotShowAddress !== false;
  const showPhone = settings.kotShowPhone !== false;
  const showCustomer = settings.kotShowCustomer !== false;
  const showWaiter = settings.kotShowWaiter !== false;
  const showRider = settings.kotShowRider !== false;
  const showNotes = settings.kotShowNotes !== false;
  const showDateTime = settings.kotShowDateTime !== false;

  const now = new Date(order.createdAt);
  const time = now.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('en-PK');
  const totalItems = order.items.reduce((s, i) => s + i.quantity, 0);

  if (design === 'taimoor1' || design === 'taimoor2') return (
    <div style={{ paddingTop: '4mm' }}>
      <div style={{ borderTop: '1px dashed #000', marginBottom: '6px' }} />
      <KitchenReceipt order={order} settings={settings} showPrintButton={false} noPrintPortal />
    </div>
  );

  if (design === 'bold') return (
    <div style={{ paddingTop: '4mm' }}>
      <div style={{ borderTop: '3px dashed #000', marginBottom: '4px' }} />
      <div style={{ textAlign: 'center', background: '#000', color: '#fff', padding: '4px', marginBottom: '4px' }}>
        <div style={{ fontSize: '16px', fontWeight: 900, letterSpacing: '3px' }}>★ KOT ★</div>
      </div>
      <div style={{ border: '2px solid #000', padding: '3px', marginBottom: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 900 }}>
          <span>#{order.orderNumber}</span>
          <span style={{ textTransform: 'uppercase', background: '#000', color: '#fff', padding: '0 6px', fontSize: '10px' }}>{order.orderType}</span>
        </div>
        {order.tableName && <div style={{ fontSize: '12px', fontWeight: 900 }}>TABLE: {order.tableName}</div>}
      </div>
        {order.items.map(item => (
        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '2px solid #000' }}>
            <span style={{ ...getStyleCSS(rs.items, { size: 12, align: 'left', bold: true }) }}>{item.name}</span>
          <span style={{ fontWeight: 900, fontSize: '16px', background: '#000', color: '#fff', padding: '0 8px' }}>{item.quantity}</span>
        </div>
      ))}
      <div style={{ background: '#000', color: '#fff', padding: '3px', textAlign: 'center', fontWeight: 900, fontSize: '11px', marginTop: '4px' }}>
        TOTAL: {totalItems} ITEMS
      </div>
      <div style={{ textAlign: 'center', marginTop: '3px', fontSize: '8px', fontWeight: 700 }}>— KITCHEN COPY —</div>
    </div>
  );

  if (design === 'minimal') return (
    <div style={{ paddingTop: '4mm' }}>
      <div style={{ borderTop: '2px dashed #000', marginBottom: '4px' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 800, marginBottom: '3px' }}>
        <span>KOT #{order.orderNumber}</span>
        <span style={{ fontSize: '9px', background: '#eee', padding: '1px 4px', textTransform: 'uppercase' }}>{order.orderType}</span>
      </div>
      {order.tableName && <div style={{ fontSize: '10px', fontWeight: 700, marginBottom: '2px' }}>{order.tableName}</div>}
      {order.items.map(item => (
        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px dotted #ccc' }}>
          <span style={{ ...getStyleCSS(rs.items, { size: 11, align: 'left', bold: true }) }}>{item.name}</span>
          <span style={{ fontWeight: 800, fontSize: '12px' }}>×{item.quantity}</span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid #000', paddingTop: '2px', fontSize: '9px', marginTop: '2px' }}>Items: {totalItems}</div>
    </div>
  );

  if (design === 'elegant') return (
    <div style={{ paddingTop: '4mm' }}>
      <div style={{ borderTop: '1px solid #000', marginBottom: '4px' }} />
      <div style={{ textAlign: 'center', fontSize: '9px', letterSpacing: '3px', textTransform: 'uppercase', color: '#555', marginBottom: '3px' }}>Kitchen Order Ticket</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '3px' }}>
        <span style={{ fontWeight: 700 }}>Order #{order.orderNumber}</span>
        <span style={{ fontSize: '9px', background: '#f5f5f5', padding: '1px 4px', textTransform: 'uppercase' }}>{order.orderType}</span>
      </div>
      {order.tableName && <div style={{ fontSize: '10px', fontWeight: 700, marginBottom: '2px' }}>⬡ {order.tableName}</div>}
      {order.items.map((item, i) => (
        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: i < order.items?.length || 0 - 1 ? '1px dotted #ddd' : 'none' }}>
          <span style={{ ...getStyleCSS(rs.items, { size: 11, align: 'left', bold: true }) }}>{i + 1}. {item.name}</span>
          <span style={{ fontWeight: 800, fontSize: '12px', background: '#f0f0f0', padding: '0 6px', borderRadius: '2px' }}>{item.quantity}</span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid #000', paddingTop: '3px', fontSize: '9px', fontWeight: 700, marginTop: '3px' }}>Total: {totalItems} items</div>
      <div style={{ textAlign: 'center', marginTop: '4px', fontSize: '7px', color: '#aaa', letterSpacing: '2px', textTransform: 'uppercase' }}>— Kitchen Copy —</div>
    </div>
  );

  if (design === 'vip-chef') return (
    <div style={{ paddingTop: '4mm' }}>
      <div style={{ borderTop: '3px dashed #000', marginBottom: '4px' }} />
      <div style={{ background: '#000', color: '#fff', padding: '5px', textAlign: 'center', marginBottom: '4px' }}>
        <div style={{ fontSize: '9px', letterSpacing: '4px' }}>CHEF'S TICKET</div>
        <div style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '3px' }}>#{order.orderNumber}</div>
      </div>
      {order.tableName && <div style={{ fontSize: '12px', fontWeight: 900, marginBottom: '3px' }}>TABLE: {order.tableName}</div>}
      {order.items.map(item => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', borderBottom: '2px solid #000', padding: '4px 0' }}>
          <div style={{ background: '#000', color: '#fff', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px', fontWeight: 900, marginRight: '6px', flexShrink: 0 }}>{item.quantity}</div>
          <div style={{ flex: 1 }}>
              <div style={{ ...getStyleCSS(rs.items, { size: 13, align: 'left', bold: true }), textTransform: 'uppercase' }}>{item.name}</div>
            {item.note && <div style={{ fontSize: '9px', fontWeight: 700, background: '#eee', padding: '1px 3px' }}>⚠ {item.note}</div>}
          </div>
        </div>
      ))}
      <div style={{ background: '#000', color: '#fff', padding: '3px', textAlign: 'center', fontWeight: 900, fontSize: '12px', marginTop: '4px' }}>TOTAL: {totalItems}</div>
      <div style={{ textAlign: 'center', marginTop: '3px', fontSize: '8px', letterSpacing: '3px' }}>— CHEF COPY —</div>
    </div>
  );

  if (design === 'station') return (
    <div style={{ paddingTop: '4mm' }}>
      <div style={{ borderTop: '2px dashed #000', marginBottom: '4px' }} />
      <div style={{ border: '2px solid #000', padding: '3px', display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '12px', fontWeight: 900 }}>KOT #{order.orderNumber}</span>
        <span style={{ fontSize: '12px', fontWeight: 900 }}>{time}</span>
      </div>
      {order.tableName && <div style={{ fontSize: '10px', fontWeight: 800, background: '#000', color: '#fff', padding: '1px 4px', display: 'inline-block', marginBottom: '3px' }}>T: {order.tableName}</div>}
      {order.items.map((item, i) => {
        const lower = item.name.toLowerCase();
        const station = lower.match(/salad|cold|raita|chutney/) ? 'COLD' : lower.match(/drink|juice|tea|coffee|lassi/) ? 'BEVG' : lower.match(/dessert|kheer|ice|cake/) ? 'DESS' : 'HOT';
        return (
          <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', padding: '3px 0', borderBottom: '1px dotted #999' }}>
            <span style={{ width: '20px', fontWeight: 800, fontSize: '10px', textAlign: 'center' }}>{i + 1}</span>
            <div style={{ flex: 1, paddingLeft: '3px' }}>
              <div style={{ ...getStyleCSS(rs.items, { size: 11, align: 'left', bold: true }) }}>{item.name}</div>
              <span style={{ fontSize: '8px', background: '#000', color: '#fff', padding: '0 4px', fontWeight: 700 }}>{station}</span>
            </div>
            <span style={{ width: '28px', textAlign: 'right', fontWeight: 900, fontSize: '13px' }}>×{item.quantity}</span>
          </div>
        );
      })}
      <div style={{ borderTop: '2px solid #000', paddingTop: '2px', marginTop: '3px', fontSize: '9px', fontWeight: 800, textAlign: 'right' }}>Total: {totalItems}</div>
    </div>
  );

  // Classic
  return (
    <div style={{ paddingTop: '4mm' }}>
      <div style={{ borderTop: '2px dashed #000', marginBottom: '4px' }} />
      <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 900, letterSpacing: '2px', marginBottom: '4px' }}>🍳 KITCHEN ORDER</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 800, marginBottom: '2px' }}>
        <span>#{order.orderNumber}</span>
        <span style={{ textTransform: 'uppercase', background: '#000', color: '#fff', padding: '0 5px', fontSize: '9px', borderRadius: '2px' }}>{order.orderType}</span>
      </div>
      {showDateTime && <div style={{ fontSize: '9px', marginBottom: '2px' }}>{date} • {time}</div>}
      {order.tableName && <div style={{ fontSize: '11px', fontWeight: 800, marginBottom: '2px' }}>🪑 {order.tableName}</div>}
      {showWaiter && order.waiterName && <div style={{ fontSize: '9px', marginBottom: '2px' }}>👤 {order.waiterName}</div>}
      <div style={{ borderTop: '1px solid #000', marginTop: '2px', paddingTop: '3px' }}>
        {order.items.map((item, i) => (
          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px dotted #999' }}>
            <span style={{ ...getStyleCSS(rs.items, { size: 12, align: 'left', bold: true }) }}>{i + 1}. {item.name}</span>
            <span style={{ fontWeight: 900, fontSize: '14px', background: '#000', color: '#fff', padding: '0 6px', borderRadius: '3px' }}>x{item.quantity}</span>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '2px dashed #000', paddingTop: '3px', textAlign: 'center', fontSize: '11px', fontWeight: 800, marginTop: '3px' }}>
        Total: {totalItems} items
      </div>
      {showNotes && order.notes && (
        <div style={{ marginTop: '3px', border: '1px solid #000', padding: '3px', fontSize: '9px', fontWeight: 700 }}>📝 {order.notes}</div>
      )}
      <div style={{ textAlign: 'center', marginTop: '4px', fontSize: '8px', fontWeight: 700 }}>— KITCHEN COPY —</div>
    </div>
  );
}
