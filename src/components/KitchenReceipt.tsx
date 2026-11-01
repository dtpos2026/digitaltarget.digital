import { useCallback, useEffect, useMemo, useRef } from 'react';
import { DEVELOPER_CREDIT } from '@/lib/displayTemplates';
import { createPortal } from 'react-dom';
import { spacingNodeProps } from '@/lib/textSpacing';
import { Order, RestaurantSettings, ReceiptTextStyle } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { isElectron, printReceiptNative } from '@/lib/electron';
import { fastPrintHtml, isFastPrintAvailable } from '@/printing/fastPrint';
import { printDirect } from '@/printing/directPrint';
import { resolvePrintMode } from '@/printing/printMode';
import { resolveSlipMargin } from '@/lib/slipMargins';
import { beginThermalPrintDomSession, getEffectiveReceiptMargins, getThermalPaperWidthMicrons, getThermalPrintJobHeightMm, shouldUsePrinterDefaultPageSize, waitForThermalPrintLayout } from '@/lib/thermal-print';
import { StandardInfoGrid, StandardInfoRows, getOrderTypeLabel } from '@/lib/standardOrderInfo';
import { variantNote } from '@/lib/billLabels';

interface Props {
  order: Order;
  settings: RestaurantSettings;
  showPrintButton?: boolean;
  autoPrint?: boolean;
  autoPrintDelayMs?: number;
  noPrintPortal?: boolean; // when combined with receipt, skip own portal
  onAutoPrintComplete?: (result: { success: boolean; error?: string }) => void;
  /** Called the moment the auto-print actually starts (the print host's start watchdog). */
  onAutoPrintStart?: () => void;
  /** Render only newly-added items with an ORDER UPDATED banner. */
  updateMode?: boolean;
  /** Queue-resolved printer (job.printerId) — station routing ki top priority. */
  printerOverride?: string;
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

/**
 * KOT par dikhne wali "quantity".
 *
 * v1.0.38: weight items (crab, fish, sabzi) ki quantity hamesha 1 hoti hai
 * aur asal wazan `weightGrams` me chhupa hota tha — kitchen ko slip par
 * "1" nazar aata tha jo bilkul bekaar hai. Ab weight lines par seedha
 * "1.250 KG" chhapta hai.
 */
export function kotQtyLabel(item: { quantity?: number; pricingType?: string; weightGrams?: number }): string {
  if (item?.pricingType === 'weight' && item.weightGrams && item.weightGrams > 0) {
    return `${(item.weightGrams / 1000).toFixed(3)} KG`;
  }
  // Guard: quantity kabhi undefined/null/0/NaN ho to bhi KOT par khali na chhape
  // (blank qty = kitchen confusion). Har KOT item ka kam se kam 1 hota hai.
  const q = Number(item?.quantity);
  return Number.isFinite(q) && q > 0 ? String(q) : '1';
}
const URDU_FONTS = ['Aseer Unicode', 'AA Sameer Armaa', 'Jameel Noori Nastaleeq', 'Jameel Noori Nastaleeq Regular'];

function applyPrinterMarginVars(rootEl: HTMLElement | null, cfg: any, fallback: { top: number; right: number; bottom: number; left: number }) {
  if (!rootEl) return;
  // OLD-POS GEOMETRY: explicit pageSize me page pehle hi TOP se shuru hota
  // — turning topFeedMm into CSS padding used to push the content down
  // (a large top gap). topFeed is now only used for LAN/ESC-POS feed-lines.
  const top = fallback.top; // device margin (default 0) — NOT printer topFeed
  const right = Number.isFinite(Number(cfg?.rightMarginMm)) ? Number(cfg.rightMarginMm) : fallback.right;
  // bottomFeed = tear-off room; capped at 12mm otherwise a long blank tail forms
  const bottom = Math.min(12, Number.isFinite(Number(cfg?.bottomFeedMm)) ? Number(cfg.bottomFeedMm) : fallback.bottom);
  const left = Number.isFinite(Number(cfg?.leftMarginMm)) ? Number(cfg.leftMarginMm) : fallback.left;
  const positive = (n: number) => `${Math.max(0, n)}mm`;
  const offset = (n: number) => `${Math.min(0, n)}mm`;
  rootEl.style.setProperty('--dt-print-padding-top', positive(top));
  rootEl.style.setProperty('--dt-print-padding-right', positive(right));
  rootEl.style.setProperty('--dt-print-padding-bottom', positive(bottom));
  rootEl.style.setProperty('--dt-print-padding-left', positive(left));
  rootEl.style.setProperty('--dt-print-offset-top', offset(top));
  rootEl.style.setProperty('--dt-print-offset-right', offset(right));
  rootEl.style.setProperty('--dt-print-offset-bottom', offset(bottom));
  rootEl.style.setProperty('--dt-print-offset-left', offset(left));
  if (cfg?.printWidthMm) rootEl.style.setProperty('--dt-print-content-width', `${cfg.printWidthMm}mm`);
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

export default function KitchenReceipt({ order: rawOrder, settings, showPrintButton = true, autoPrint = false, autoPrintDelayMs = 120, noPrintPortal = false, onAutoPrintComplete, onAutoPrintStart, updateMode = false, diffItemIds, diffDeltas, cancelDeltas, cancelNames, printerOverride }: Props) {
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
    // FIX: printer cfg + padding measurement se PEHLE (footer page-2 spill fix)
    let hoistedKitchenCfg: any = undefined;
    try {
      const { loadPrinterSettings, resolvePrinterForRole } = await import('@/lib/printerSettings');
      const { getDeviceId } = await import('@/lib/tenant');
      hoistedKitchenCfg = resolvePrinterForRole(await loadPrinterSettings(), 'kitchen', getDeviceId());
    } catch {}

    // ===== FAST PATH (v1.0.41) =====
    // ===== PRINT PATH ORDER: RAW -> rendered RAW -> driver -> error =====
    // The kitchen printer's own print mode decides the order, exactly as it
    // does for the customer receipt. Before this the setting applied to
    // receipts only, so a printer set to Raw ESC/POS still had its KOT
    // rendered, and one set to driver-only still had every KOT pushed at the
    // RAW path first and fail.
    const kotPrintMode = resolvePrintMode({ printerConfig: hoistedKitchenCfg, settings });

    if (kotPrintMode === 'raw' && isElectron() && settings.silentPrint
        && !(hoistedKitchenCfg?.connection === 'lan' && hoistedKitchenCfg?.lanHost)) {
      try {
        const direct = await printDirect({
          slip: 'kot',
          order,
          settings,
          kot: {
            updateMode: !!updateMode,
            diffDeltas: diffDeltas as any,
            cancelDeltas: cancelDeltas as any,
            cancelNames: cancelNames as any,
          },
          copies: hoistedKitchenCfg?.copies || 1,
          printerOverride:
            printerOverride
            || (((hoistedKitchenCfg?.connection || 'system') === 'system' && hoistedKitchenCfg?.printerName)
              ? hoistedKitchenCfg.printerName : undefined),
          billNumber: String(order.orderNumber ?? ''),
        });
        if (direct.success) {
          console.info('[DT-Print] KOT path=raw-escpos', { printer: direct.printerName, ms: direct.durationMs });
          return { success: true };
        }
        console.warn('[DT-Print] raw KOT unavailable, falling back to the rendered path:', direct.error);
      } catch (e: any) {
        console.warn('[DT-Print] raw KOT threw, falling back to the rendered path:', e?.message || e);
      }
    }

    // Rendered fast path: the kitchen slip's HTML goes to a hidden print
    // window and returns at once, so the POS screen never enters print mode
    // and the cashier can start the next bill immediately. On failure the
    // older window path below runs.
    if (isElectron() && settings.silentPrint && isFastPrintAvailable()
        && !(hoistedKitchenCfg?.connection === 'lan' && hoistedKitchenCfg?.lanHost)) {
      const fastRoot = (printRef.current || measureEl) as HTMLElement | null;
      applyPrinterMarginVars(fastRoot, hoistedKitchenCfg, margins);
      const fallbackOn = settings.kotFallbackToReceipt !== false;
      const fastTarget = printerOverride
        || (((hoistedKitchenCfg?.connection || 'system') === 'system' && hoistedKitchenCfg?.printerName)
          ? hoistedKitchenCfg.printerName
          : (settings.kotPrinter || (fallbackOn ? (settings.defaultPrinter || '') : '')));
      const fastArgs = {
        html: fastRoot?.outerHTML || '',
        paperWidth: paperWidth as any,
        compact: !!(settings as any).receiptCompactMode,
        compactFontSize: (settings as any).receiptCompactFontSize,
        compactLineHeight: (settings as any).receiptCompactLineHeight,
        printerName: fastTarget || undefined,
        pageWidthMicrons: getThermalPaperWidthMicrons(paperWidth),
        usePrinterDefaultPageSize,
        autoCut: settings.autoCut !== false,
        // Same geometry rules as the customer receipt: kitchen printer
        // calibration first, otherwise the device's Left/Right margins.
        // Per-slip margin, then the printer's calibration, then the device
        // default. A KOT is torn off and spiked, so its right edge often needs
        // a different margin from the bill's.
        marginLeftMm: resolveSlipMargin('kot', hoistedKitchenCfg?.leftMarginMm, hoistedKitchenCfg?.rightMarginMm, margins.left, margins.right).left,
        marginRightMm: resolveSlipMargin('kot', hoistedKitchenCfg?.leftMarginMm, hoistedKitchenCfg?.rightMarginMm, margins.left, margins.right).right,
        contentWidthMm: hoistedKitchenCfg?.printWidthMm,
        // Driver mode keeps the hidden worker; only the raster is skipped.
        preferDriver: kotPrintMode === 'driver',
        // The printer's "Bottom (mm)" = extra paper before the cut.
        extraFeedMm: hoistedKitchenCfg?.bottomFeedMm,
      };
      const fast = await fastPrintHtml(fastArgs);
      if (fast.success) {
        try {
          const cashPrinter = settings.defaultPrinter || '';
          if (settings.kotMirrorToReceiptPrinter === true && cashPrinter && cashPrinter !== fastTarget) {
            await fastPrintHtml({ ...fastArgs, printerName: cashPrinter });
          }
        } catch (e) { console.warn('[KOT mirror] failed', e); }
        return { success: true };
      }
      console.warn('[DT-Print] fast KOT path unavailable, using window print:', fast.error);
    }

    const measureSessionCleanup = beginThermalPrintDomSession(printRef.current || measureEl, paperWidth, undefined, settings);
    applyPrinterMarginVars(printRef.current || measureEl, hoistedKitchenCfg, margins);
    await waitForThermalPrintLayout();

    // ROOT FIX: custom height band — Test-Print pipeline jaisa (raster
    // drivers pe blank-job masla; tafseel ReceiptPreview me)
    const heightMm: number | undefined = undefined;
    const widthMicrons = getThermalPaperWidthMicrons(paperWidth);
    const heightMicrons = heightMm ? heightMm * 1000 : undefined;
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

    const fallbackEnabled = settings.kotFallbackToReceipt !== false;
    const kitchenCfg: any = hoistedKitchenCfg; // measure phase se reuse
    const resolvedPrinter = printerOverride
      || (((kitchenCfg?.connection || 'system') === 'system' && kitchenCfg?.printerName)
        ? kitchenCfg.printerName
        : (settings.kotPrinter || (fallbackEnabled ? (settings.defaultPrinter || '') : '')));

    if (isElectron() && settings.silentPrint && kitchenCfg?.connection === 'lan' && kitchenCfg.lanHost) {
      const api: any = (window as any).electronAPI;
      if (!api?.printLanEscpos) return { success: false, error: 'LAN print not available' };
      const root = printRef.current || measureEl;
      const cleanup = beginThermalPrintDomSession(root, paperWidth, heightMm, settings);
      try {
        applyPrinterMarginVars(root, kitchenCfg, margins);
        await waitForThermalPrintLayout();
        const { buildEscposFromHtml } = await import('@/printing/escpos');
        const bytes = buildEscposFromHtml((root as HTMLElement)?.outerHTML || '', {
          paperWidth: (kitchenCfg.paperSize || paperWidth) as '58mm' | '80mm',
          autoCut: kitchenCfg.autoCut !== false,
          beep: kitchenCfg.beep === true,
          topFeedLines: Math.max(0, Math.round(Math.max(0, kitchenCfg.topFeedMm || 0) / 3)),
          bottomFeedLines: Math.max(3, Math.round(Math.max(0, kitchenCfg.bottomFeedMm || 0) / 3) + 3),
        });
        const copies = Math.max(1, kitchenCfg.copies || 1);
        for (let i = 0; i < copies; i++) {
          const r = await api.printLanEscpos({ host: kitchenCfg.lanHost, port: kitchenCfg.lanPort || 9100, data: bytes });
          if (!r?.success) return { success: false, error: r?.error || 'LAN print failed' };
        }
        return { success: true };
      } finally {
        cleanup();
      }
    }

    if (isElectron() && settings.silentPrint) {
      if (!settings.kotPrinter && !fallbackEnabled) {
        return { success: false, error: 'KOT printer not configured' };
      }
      const printRoot = printRef.current || measureEl;
      const nativePrintCleanup = beginThermalPrintDomSession(printRoot, paperWidth, heightMm, settings);
      // ===== FREEZE FIX (white stuck screen after KOT) =====
      // This whole block runs with the POS in print mode: the print CSS hides
      // every element except the slip, so the screen is white with the KOT in
      // the corner. The cleanup below used to be a bare call AFTER the await
      // — so anything that threw (a rejected IPC invoke, a printer that never
      // answered) skipped it and left the POS white until the app was
      // restarted. try/finally guarantees the screen always comes back.
      try {
      applyPrinterMarginVars(printRoot, kitchenCfg, margins);
      // Blank-KOT guard: wait for the injected print CSS to lay out and paint.
      // waitForThermalPrintLayout now waits on frames + webfonts instead of a
      // flat 150ms sleep, so this is both faster and more reliable.
      await waitForThermalPrintLayout();
      const result = await printReceiptNative({
        printerName: resolvedPrinter,
        silent: true,
        pageWidthMicrons: widthMicrons,
        pageHeightMicrons: usePrinterDefaultPageSize ? undefined : heightMicrons,
        usePrinterDefaultPageSize,
        autoCut: settings.autoCut !== false,
        cutMode: settings.cutMode || 'full',
        driverType: settings.printerDriverType || 'escpos',
        dpi: 203,
        paperLabel: paperWidth,
        topFeedMm: kitchenCfg?.topFeedMm ?? margins.top,
        bottomFeedMm: kitchenCfg?.bottomFeedMm ?? margins.bottom,
        leftMarginMm: kitchenCfg?.leftMarginMm ?? margins.left,
        rightMarginMm: kitchenCfg?.rightMarginMm ?? margins.right,
      });

      // ===== Mirror copy on Cash/Receipt printer (verification) =====
      // When the user has kotMirrorToReceiptPrinter ON and the defaultPrinter is
      // different from the KOT printer — an extra KOT copy is also printed on the
      // receipt printer so the user can verify the KOT is being generated.
      try {
        const mirrorOn = settings.kotMirrorToReceiptPrinter === true;
        const cashPrinter = settings.defaultPrinter || '';
        if (mirrorOn && cashPrinter && cashPrinter !== resolvedPrinter) {
          await printReceiptNative({
            printerName: cashPrinter,
            silent: true,
            pageWidthMicrons: widthMicrons,
            pageHeightMicrons: usePrinterDefaultPageSize ? undefined : heightMicrons,
            usePrinterDefaultPageSize,
            autoCut: settings.autoCut !== false,
            cutMode: settings.cutMode || 'full',
            driverType: settings.printerDriverType || 'escpos',
            dpi: 203,
          });
        }
      } catch (e) { console.warn('[KOT mirror] failed', e); }

      if (!result.success) {
        // Do NOT fall back to window.print() here. Silent mode means an
        // unattended counter: a modal print dialog would block the POS until
        // someone dismissed it, which is the printer failure freezing the
        // till. Report the failure instead — the print queue retries, and the
        // bill is already saved.
        console.warn('[DT-Print] KOT native print failed:', result.error);
      }
      return result;
      } finally {
        nativePrintCleanup();
      }
    } else {
      browserPrint();
      return { success: true };
    }
  }, [paperWidth, settings, usePrinterDefaultPageSize, margins, printerOverride]);


  // Once per mount; a re-render (the print host's header clock) must never
  // cancel it — see the same effect in ReceiptPreview.
  const handlePrintRef = useRef(handlePrint);
  handlePrintRef.current = handlePrint;
  const onAutoPrintCompleteRef = useRef(onAutoPrintComplete);
  onAutoPrintCompleteRef.current = onAutoPrintComplete;
  const onAutoPrintStartRef = useRef(onAutoPrintStart);
  onAutoPrintStartRef.current = onAutoPrintStart;
  useEffect(() => {
    if (!autoPrint || autoPrintDone.current) return;
    autoPrintDone.current = true;
    let started = false;
    const t = setTimeout(() => {
      started = true;
      try { onAutoPrintStartRef.current?.(); } catch { /* host gone */ }
      handlePrintRef.current()
        .then((result) => onAutoPrintCompleteRef.current?.(result))
        .catch((err) => onAutoPrintCompleteRef.current?.({ success: false, error: err?.message || String(err) }));
    }, Math.max(0, autoPrintDelayMs));
    // Only an unmount (the host dropped the job) cancels a print not yet started.
    return () => {
      if (!started) { clearTimeout(t); autoPrintDone.current = false; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount, by design
  }, [autoPrint]);

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
      <div className="print-black-box" style={{ textAlign: 'center', border: '2px solid #000', color: '#000', fontWeight: 900, background: 'transparent', padding: '6px 4px', marginBottom: '6px' }}>
        <div style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '3px' }}>★ KOT ★</div>
        <div style={{ fontSize: '10px', fontWeight: 600 }}>{settings.name || ''}</div>
      </div>
      <div style={{ border: '2px solid #000', padding: '4px', marginBottom: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 900 }}>
          <span>#{order.orderNumber}</span>
          <span className="print-black-box" style={{ textTransform: 'uppercase', border: '2px solid #000', color: '#000', fontWeight: 900, background: 'transparent', padding: '1px 8px', fontSize: '11px' }}>
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
            <span style={{ fontWeight: 800, fontSize: '14px', flex: 1, minWidth: 0 }}>
              {/* v1.0.38b: qty ko NAAM ke aage plain bold text me bhi dikhao —
                  taake agar dayein taraf ka box printer par clip/hide ho jaye
                  tab bhi kitchen ko quantity nazar aaye. */}
              <span style={{ fontWeight: 900 }}>{kotQtyLabel(item)} × </span>{item.name}
              {item.note && <div style={{ fontSize: '9px', fontStyle: 'italic' }}>→ {item.note}</div>}
            </span>
            <span className="print-black-box" style={{ fontWeight: 900, fontSize: '20px', border: '2px solid #000', color: '#000', background: 'transparent', padding: '2px 10px', minWidth: '40px', textAlign: 'center', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {kotQtyLabel(item)}
            </span>
          </div>
        ))}
      </div>
      <div className="print-black-box" style={{ border: '2px solid #000', color: '#000', background: 'transparent', padding: '4px', textAlign: 'center', fontWeight: 900, fontSize: '13px' }}>
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
            <span style={{ fontWeight: 800, fontSize: '13px' }}>×{kotQtyLabel(item)}</span>
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
            padding: '4px 0', borderBottom: i < order.items.length - 1 ? '1px dotted #ddd' : 'none',
          }}>
            <span style={{ fontSize: '12px', fontWeight: 600, flex: 1 }}>
              {i + 1}. {item.name}
              {item.note && <div style={{ fontSize: '8px', fontStyle: 'italic', color: '#888' }}>↳ {item.note}</div>}
            </span>
            <span style={{ fontWeight: 800, fontSize: '14px', background: '#f0f0f0', padding: '1px 8px', borderRadius: '3px', minWidth: '30px', textAlign: 'center' }}>
              {kotQtyLabel(item)}
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
          padding: '4px 0', borderBottom: i < order.items.length - 1 ? '1px dotted #999' : 'none',
        }}>
          <span style={{ fontWeight: 700, fontSize: '13px', flex: 1 }}>
            {i + 1}. {item.name}
            {item.note && <div style={{ fontSize: '9px', fontStyle: 'italic', color: '#555' }}>📝 {item.note}</div>}
          </span>
          <span className="print-black-box" style={{ fontWeight: 900, fontSize: '16px', border: '2px solid #000', color: '#000', background: 'transparent', padding: '2px 8px', borderRadius: '4px', minWidth: '32px', textAlign: 'center' }}>
            x{kotQtyLabel(item)}
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
      <div className="print-black-box" style={{ border: '2px solid #000', color: '#000', fontWeight: 900, background: 'transparent', padding: '8px 4px', textAlign: 'center', marginBottom: '6px' }}>
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
            <div className="print-black-box" style={{ border: '2px solid #000', color: '#000', background: 'transparent', minWidth: '40px', minHeight: '40px', padding: '0 5px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', fontWeight: 900, marginRight: '8px', flexShrink: 0 }}>
              {kotQtyLabel(item)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '15px', fontWeight: 900, lineHeight: 1.1, textTransform: 'uppercase' }}>{item.name}</div>
              {item.note && <div style={{ fontSize: '11px', fontWeight: 700, fontStyle: 'italic', color: '#000', marginTop: '2px', padding: '2px 4px', background: '#eee' }}>⚠ {item.note}</div>}
            </div>
          </div>
        ))}
      </div>
      <div className="print-black-box" style={{ border: '2px solid #000', color: '#000', background: 'transparent', textAlign: 'center', padding: '6px', fontWeight: 900, fontSize: '14px', letterSpacing: '2px' }}>
        TOTAL: {totalItems} ITEMS · {order.items.length} LINES
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
        <div className="print-black-box" style={{ flex: 1, border: '2px solid #000', color: '#000', fontWeight: 900, background: 'transparent', padding: '2px 4px', textAlign: 'center', textTransform: 'uppercase' }}>{order.orderType}</div>
        {order.tableName && <div className="print-black-box" style={{ flex: 1, border: '2px solid #000', color: '#000', fontWeight: 900, background: 'transparent', padding: '2px 4px', textAlign: 'center' }}>T: {order.tableName}</div>}
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
                <span className="print-black-box" style={{ fontSize: '8px', border: '2px solid #000', color: '#000', background: 'transparent', padding: '0 4px', fontWeight: 700, letterSpacing: '1px' }}>{station}</span>
                {item.note && <span style={{ fontSize: '9px', fontStyle: 'italic', color: '#555' }}>· {item.note}</span>}
              </div>
            </div>
            <span style={{ minWidth: '32px', textAlign: 'right', fontWeight: 900, fontSize: '14px', whiteSpace: 'nowrap' }}>×{kotQtyLabel(item)}</span>
          </div>
        );
      })}
      <div style={{ borderTop: '2px solid #000', marginTop: '4px', padding: '3px 0', display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 800 }}>
        <span>Lines: {order.items.length}</span><span>Total Qty: {totalItems}</span>
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
                <td style={{ border, padding: '4px 3px', textAlign: 'center', fontWeight: 700 }}>{kotQtyLabel(item)}</td>
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
          {/* One small developer credit, the same line the raw KOT and the
              display screens carry. The ticket's branding is the shop's —
              its logo and name are at the top. */}
          {settings.kotShowDeveloperCredit !== false && (
            <div style={{ fontSize: '8px', marginTop: '3px', color: '#555' }}>{DEVELOPER_CREDIT}</div>
          )}
        </div>
      </div>
    );
  };

  // DT Retail "Kitchen Order" slip: a black title bar, the order type and table
  // in a heavy frame, then big quantities the line can read across the pass.
  const renderDtrKitchen = () => {
    const typeText = order.orderType === 'dining' ? 'DINE-IN'
      : order.orderType === 'takeaway' ? 'TAKEAWAY'
      : order.orderType === 'delivery' ? 'DELIVERY'
      : String(order.orderType || 'ORDER').toUpperCase();
    const tableRaw = String(order.tableName || order.tableLabel || '').trim();
    const tableText = tableRaw ? (/^\d+$/.test(tableRaw) ? `Table ${tableRaw}` : tableRaw) : '';
    const orderText = `ORD-${String(order.orderNumber ?? '').padStart(6, '0')}`;
    const customerName = showCustomer ? String(order.customer?.name || '').trim() : '';
    return (
      <div style={{ color: '#000' }}>
        <div className="dt-reverse" style={{ background: '#000', color: '#fff', textAlign: 'center', fontWeight: 900, letterSpacing: 4, fontSize: 13, padding: '4px 4px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>KITCHEN ORDER</div>
        <div style={{ border: '3px solid #000', textAlign: 'center', padding: '4px 4px', margin: '5px 0' }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{typeText}</div>
          {tableText && <div style={{ fontWeight: 900, fontSize: 24, lineHeight: 1.1 }}>{tableText}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12 }}>
          <span style={{ fontWeight: 900 }}>{orderText}</span>
          {showDateTime && <span>{date} {time}</span>}
        </div>
        {customerName && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12 }}>
            <span>Customer</span><span style={{ textAlign: 'right' }}>{customerName}</span>
          </div>
        )}
        {showWaiter && order.waiterName && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12 }}>
            <span>Waiter</span><span>{order.waiterName}</span>
          </div>
        )}
        {showRider && order.riderName && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12 }}>
            <span>Rider</span><span>{order.riderName}</span>
          </div>
        )}
        <div style={{ borderTop: '3px solid #000', margin: '5px 0 2px' }} />
        {order.items.map((item, i) => (
          <div key={item.id} className="item-row" style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, padding: '5px 0',
            borderBottom: i < order.items.length - 1 ? '1px dashed #000' : undefined,
          }}>
            <span style={{ width: '1.8em', flex: 'none', fontWeight: 900, fontSize: 22, lineHeight: 1 }}>{kotQtyLabel(item)}</span>
            <span style={{ flex: 1, minWidth: 0, fontWeight: 800, fontSize: 14, lineHeight: 1.2, wordBreak: 'break-word' }}>
              {item.name}{variantNote(item as any) ? ` (${variantNote(item as any)})` : ''}
              {showNotes && item.note && (
                <span style={{ display: 'inline-block', marginLeft: 6, border: '1px solid #000', padding: '0 4px', fontWeight: 400, fontSize: 11 }}>* {item.note}</span>
              )}
            </span>
          </div>
        ))}
        <div style={{ borderTop: '1px dashed #000', marginTop: 2 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 13, padding: '3px 0' }}>
          <span>Items: {order.items.length}</span><span>Qty: {totalItems}</span>
        </div>
        {order.cashierName && <div style={{ textAlign: 'center', fontSize: 11 }}>Cashier: {order.cashierName}</div>}
      </div>
    );
  };

  // FIX (client): ORDER REMARKS should print on every design — previously
  // order.notes only rendered on 2 designs, so instructions like "serve later"
  // would disappear. This block is universal and thermal-safe (border + bold).
  const remarksBlock = (showNotes && (order.notes || (order as any).specialNote)) ? (
    <div style={{
      border: '3px double #000', padding: '4px 5px', margin: '5px 0',
      fontWeight: 900, fontSize: '13px', color: '#000', textTransform: 'uppercase',
    }}>
      <div style={{ fontSize: '10px', borderBottom: '1px dashed #000', marginBottom: '2px' }}>ORDER REMARKS</div>
      {order.notes || (order as any).specialNote}
    </div>
  ) : null;

  const baseBody = design === 'bold' ? renderBold()
    : design === 'minimal' ? renderMinimal()
    : design === 'elegant' ? renderElegant()
    : design === 'vip-chef' ? renderVipChef()
    : design === 'station' ? renderStation()
    : design === 'taimoor1' ? renderTaimoor(1)
    : design === 'taimoor2' ? renderTaimoor(2)
    : design === 'dtr-kitchen' ? renderDtrKitchen()
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
      <div className="print-black-box" style={{
        color: '#000', fontWeight: 900, background: 'transparent', padding: '6px 4px', textAlign: 'center', border: '3px double #000',
      }}>
        <div style={{ fontSize: '16px', fontWeight: 900, letterSpacing: '3px' }}>★ ORDER UPDATED ★</div>
        <div style={{ fontSize: '10px', fontWeight: 700, marginTop: '2px' }}>Order #{rawOrder.orderNumber} — KOT changes only</div>
      </div>

      {/* Annotated change list */}
      <div style={{ border: '2px solid #000', marginTop: '6px', padding: '4px' }}>
        {updateInfo?.newItems.map(n => (
          <div key={'new-' + n.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px dashed #000' }}>
            <span style={{ flex: 1, fontSize: '12px', fontWeight: 800 }}>
              <span className="print-black-box" style={{ border: '2px solid #000', color: '#000', fontWeight: 900, background: 'transparent', padding: '1px 4px', fontSize: '9px', marginRight: '4px', letterSpacing: '1px' }}>NEW ITEM</span>
              {n.name}
              {n.note && <div style={{ fontSize: '9px', fontStyle: 'italic' }}>↳ {n.note}</div>}
            </span>
            <span style={{ fontWeight: 900, fontSize: '14px' }}>×{n.qty}</span>
          </div>
        ))}
        {updateInfo?.extraItems.map(e => (
          <div key={'ex-' + e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px dashed #000' }}>
            <span style={{ flex: 1, fontSize: '12px', fontWeight: 800 }}>
              <span className="print-black-box" style={{ border: '2px solid #000', color: '#000', fontWeight: 900, background: 'transparent', padding: '1px 4px', fontSize: '9px', marginRight: '4px', letterSpacing: '1px' }}>EXTRA QTY</span>
              {e.name}
              <div style={{ fontSize: '9px', color: '#000' }}>was {e.oldQty} → now {e.newQty} (cook +{e.qty})</div>
            </span>
            <span style={{ fontWeight: 900, fontSize: '14px' }}>+{e.qty}</span>
          </div>
        ))}
        {updateInfo?.cancelled.map(c => (
          <div key={'ca-' + c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px dashed #000' }}>
            <span style={{ flex: 1, fontSize: '12px', fontWeight: 800, textDecoration: 'line-through' }}>
              <span className="print-black-box" style={{ border: '2px solid #000', color: '#000', fontWeight: 900, background: 'transparent', padding: '1px 4px', fontSize: '9px', marginRight: '4px', letterSpacing: '1px', textDecoration: 'none', display: 'inline-block' }}>CANCELLED</span>
              {c.name}
            </span>
            <span style={{ fontWeight: 900, fontSize: '14px' }}>−{c.qty}</span>
          </div>
        ))}
        {updateInfo?.replaced.map((r, i) => (
          <div key={'rp-' + i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px dashed #000' }}>
            <span style={{ flex: 1, fontSize: '12px', fontWeight: 800 }}>
              <span className="print-black-box" style={{ border: '2px solid #000', color: '#000', fontWeight: 900, background: 'transparent', padding: '1px 4px', fontSize: '9px', marginRight: '4px', letterSpacing: '1px' }}>REPLACED</span>
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
        ⚠ Make only the changes above — do not remake the previous items
      </div>
    </div>
  ) : null;

  const receiptBody = (
    <>
      {updateBanner}
      {/* In update mode, skip the regular item list (banner already shows changes). */}
      {updateMode ? null : baseBody}
      {/* FIX (client): ORDER REMARKS on every design + update KOT too */}
      {remarksBlock}
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
    // FIX (client #9): KOT font is now variable — scales via Settings
    zoom: `${Math.max(80, Math.min(220, Number((settings as any).kotFontScale) || 100))}%`,
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
  // Settings → KOT → Text spacing (nothing when "As designed").
  const kotSpacing = spacingNodeProps(settings, 'kot');

  return (
    <>
      <div className="space-y-2">
        <div className="mx-auto w-fit max-w-full rounded-lg border bg-white p-3 shadow-sm">
          <div ref={previewRef} {...kotSpacing.attrs} style={{ ...wrapperStyle, ...kotSpacing.style }}>
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
          <div ref={printRef} className="receipt-paper print-receipt bg-white text-black" data-paper-size={paperWidth} data-kot-design={design} {...kotSpacing.attrs} style={{ ...wrapperStyle, ...kotSpacing.style }}>
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

  if (design === 'taimoor1' || design === 'taimoor2' || design === 'dtr-kitchen') return (
    <div style={{ paddingTop: '4mm' }}>
      <div style={{ borderTop: '1px dashed #000', marginBottom: '6px' }} />
      <KitchenReceipt order={order} settings={settings} showPrintButton={false} noPrintPortal />
    </div>
  );

  if (design === 'bold') return (
    <div style={{ paddingTop: '4mm' }}>
      <div style={{ borderTop: '3px dashed #000', marginBottom: '4px' }} />
      <div className="print-black-box" style={{ textAlign: 'center', border: '2px solid #000', color: '#000', fontWeight: 900, background: 'transparent', padding: '4px', marginBottom: '4px' }}>
        <div style={{ fontSize: '16px', fontWeight: 900, letterSpacing: '3px' }}>★ KOT ★</div>
      </div>
      <div style={{ border: '2px solid #000', padding: '3px', marginBottom: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 900 }}>
          <span>#{order.orderNumber}</span>
          <span className="print-black-box" style={{ textTransform: 'uppercase', border: '2px solid #000', color: '#000', fontWeight: 900, background: 'transparent', padding: '0 6px', fontSize: '10px' }}>{order.orderType}</span>
        </div>
        {order.tableName && <div style={{ fontSize: '12px', fontWeight: 900 }}>TABLE: {order.tableName}</div>}
      </div>
        {order.items.map(item => (
        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '2px solid #000' }}>
            <span style={{ ...getStyleCSS(rs.items, { size: 12, align: 'left', bold: true }) }}>{item.name}</span>
          <span className="print-black-box" style={{ fontWeight: 900, fontSize: '16px', border: '2px solid #000', color: '#000', background: 'transparent', padding: '0 8px' }}>{kotQtyLabel(item)}</span>
        </div>
      ))}
      <div className="print-black-box" style={{ border: '2px solid #000', color: '#000', background: 'transparent', padding: '3px', textAlign: 'center', fontWeight: 900, fontSize: '11px', marginTop: '4px' }}>
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
          <span style={{ fontWeight: 800, fontSize: '12px' }}>×{kotQtyLabel(item)}</span>
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
        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: i < order.items.length - 1 ? '1px dotted #ddd' : 'none' }}>
          <span style={{ ...getStyleCSS(rs.items, { size: 11, align: 'left', bold: true }) }}>{i + 1}. {item.name}</span>
          <span style={{ fontWeight: 800, fontSize: '12px', background: '#f0f0f0', padding: '0 6px', borderRadius: '2px' }}>{kotQtyLabel(item)}</span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid #000', paddingTop: '3px', fontSize: '9px', fontWeight: 700, marginTop: '3px' }}>Total: {totalItems} items</div>
      <div style={{ textAlign: 'center', marginTop: '4px', fontSize: '7px', color: '#aaa', letterSpacing: '2px', textTransform: 'uppercase' }}>— Kitchen Copy —</div>
    </div>
  );

  if (design === 'vip-chef') return (
    <div style={{ paddingTop: '4mm' }}>
      <div style={{ borderTop: '3px dashed #000', marginBottom: '4px' }} />
      <div className="print-black-box" style={{ border: '2px solid #000', color: '#000', fontWeight: 900, background: 'transparent', padding: '5px', textAlign: 'center', marginBottom: '4px' }}>
        <div style={{ fontSize: '9px', letterSpacing: '4px' }}>CHEF'S TICKET</div>
        <div style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '3px' }}>#{order.orderNumber}</div>
      </div>
      {order.tableName && <div style={{ fontSize: '12px', fontWeight: 900, marginBottom: '3px' }}>TABLE: {order.tableName}</div>}
      {order.items.map(item => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', borderBottom: '2px solid #000', padding: '4px 0' }}>
          <div className="print-black-box" style={{ border: '2px solid #000', color: '#000', background: 'transparent', minWidth: '32px', minHeight: '32px', padding: '0 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px', fontWeight: 900, marginRight: '6px', flexShrink: 0 }}>{kotQtyLabel(item)}</div>
          <div style={{ flex: 1 }}>
              <div style={{ ...getStyleCSS(rs.items, { size: 13, align: 'left', bold: true }), textTransform: 'uppercase' }}>{item.name}</div>
            {item.note && <div style={{ fontSize: '9px', fontWeight: 700, background: '#eee', padding: '1px 3px' }}>⚠ {item.note}</div>}
          </div>
        </div>
      ))}
      <div className="print-black-box" style={{ border: '2px solid #000', color: '#000', background: 'transparent', padding: '3px', textAlign: 'center', fontWeight: 900, fontSize: '12px', marginTop: '4px' }}>TOTAL: {totalItems}</div>
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
      {order.tableName && <div className="print-black-box" style={{ fontSize: '10px', fontWeight: 800, border: '2px solid #000', color: '#000', background: 'transparent', padding: '1px 4px', display: 'inline-block', marginBottom: '3px' }}>T: {order.tableName}</div>}
      {order.items.map((item, i) => {
        const lower = item.name.toLowerCase();
        const station = lower.match(/salad|cold|raita|chutney/) ? 'COLD' : lower.match(/drink|juice|tea|coffee|lassi/) ? 'BEVG' : lower.match(/dessert|kheer|ice|cake/) ? 'DESS' : 'HOT';
        return (
          <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', padding: '3px 0', borderBottom: '1px dotted #999' }}>
            <span style={{ width: '20px', fontWeight: 800, fontSize: '10px', textAlign: 'center' }}>{i + 1}</span>
            <div style={{ flex: 1, paddingLeft: '3px' }}>
              <div style={{ ...getStyleCSS(rs.items, { size: 11, align: 'left', bold: true }) }}>{item.name}</div>
              <span className="print-black-box" style={{ fontSize: '8px', border: '2px solid #000', color: '#000', background: 'transparent', padding: '0 4px', fontWeight: 700 }}>{station}</span>
            </div>
            <span style={{ minWidth: '28px', textAlign: 'right', fontWeight: 900, fontSize: '13px', whiteSpace: 'nowrap' }}>×{kotQtyLabel(item)}</span>
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
        <span className="print-black-box" style={{ textTransform: 'uppercase', border: '2px solid #000', color: '#000', fontWeight: 900, background: 'transparent', padding: '0 5px', fontSize: '9px', borderRadius: '2px' }}>{order.orderType}</span>
      </div>
      {showDateTime && <div style={{ fontSize: '9px', marginBottom: '2px' }}>{date} • {time}</div>}
      {order.tableName && <div style={{ fontSize: '11px', fontWeight: 800, marginBottom: '2px' }}>🪑 {order.tableName}</div>}
      {showWaiter && order.waiterName && <div style={{ fontSize: '9px', marginBottom: '2px' }}>👤 {order.waiterName}</div>}
      <div style={{ borderTop: '1px solid #000', marginTop: '2px', paddingTop: '3px' }}>
        {order.items.map((item, i) => (
          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px dotted #999' }}>
            <span style={{ ...getStyleCSS(rs.items, { size: 12, align: 'left', bold: true }) }}>{i + 1}. {item.name}</span>
            <span className="print-black-box" style={{ fontWeight: 900, fontSize: '14px', border: '2px solid #000', color: '#000', background: 'transparent', padding: '0 6px', borderRadius: '3px' }}>x{kotQtyLabel(item)}</span>
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
