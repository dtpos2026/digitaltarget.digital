// ============================================================
// TANDOOR TOKEN SLIP — roti/naan ka alag token, bill ke sath.
// Proven printNode pipeline use karta hai (wohi jo Test Print /
// works on every printer). Only token-category items.
// ============================================================
import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Order, RestaurantSettings } from '@/lib/types';
import { getMenuItems } from '@/lib/store';
import { printNode } from '@/printing';
import { printDirect } from '@/printing/directPrint';
import { resolvePrintMode } from '@/printing/printMode';
import { resolveSlipMargin } from '@/lib/slipMargins';
import { loadPrintMargins } from '@/lib/printMargins';
import { loadPrinterSettings, resolvePrinterForRole } from '@/lib/printerSettings';
import { getDeviceId } from '@/lib/tenant';
import { appendTokenEntry } from '@/lib/tokenLedger';
import { tokenSlipInnerHtml, type TokenTemplate } from '@/lib/tokenSlip';
import { getTokenLines, getTokenLinesDetailed } from '@/lib/tokenRules';
import { issueToken, findTokenForOrder } from '@/lib/tokenRecords';
import { buildDepartmentStubs } from '@/lib/tokenDepartments';

interface Props {
  order: Order;
  settings: RestaurantSettings;
  autoPrint?: boolean;
  onAutoPrintComplete?: (r: { success: boolean; error?: string }) => void;
  /** Called the moment the auto-print actually starts (the print host's start watchdog). */
  onAutoPrintStart?: () => void;
  printerOverride?: string;
}

/** Order ke woh items jo token category ke hain (qty > 0). */
export function getTokenItems(order: Order, settings: RestaurantSettings) {
  // Category rules AND individual item rules, applied together.
  return getTokenLines(order, settings, getMenuItems());
}

export default function TokenReceipt({ order, settings, autoPrint = false, onAutoPrintComplete, onAutoPrintStart, printerOverride }: Props) {
  const portalRef = useRef<HTMLDivElement | null>(null);
  const firedRef = useRef(false);
  const items = useMemo(() => getTokenItems(order, settings), [order, settings]);
  // The same lines with each item's note and price, for the slip designs that print them.
  const detailedItems = useMemo(() => getTokenLinesDetailed(order, settings, getMenuItems()), [order, settings]);
  // Resolved before printing so the slip carries the right number and, for a
  // second print of the same order, the REPRINT marking.
  // Detachable stubs — only when the shop turned Department Token mode on.
  // Off, this is undefined and the slip prints exactly as it always has.
  const departmentStubs = useMemo(
    () => buildDepartmentStubs(order, settings),
    [order, settings],
  );
  const tokenMeta = useMemo(() => {
    try {
      const existing = findTokenForOrder(order.id);
      if (existing) return { tokenNumber: existing.tokenNumber, isReprint: true };
    } catch { /* store not ready — fall back to the order number */ }
    return { tokenNumber: order.orderNumber ?? '', isReprint: false };
  }, [order]);
  const totalPieces = items.reduce((s, i) => s + i.qty, 0);
  const paperWidth = ((settings as any).paperSize as '58mm' | '80mm') || '80mm';

  useEffect(() => {
    if (!autoPrint || firedRef.current) return;
    firedRef.current = true;
    let started = false;
    const run = async () => {
      started = true;
      try { onAutoPrintStart?.(); } catch { /* host gone */ }
      try {
        if (items.length === 0) {
          onAutoPrintComplete?.({ success: true, error: 'no token items — skipped' });
          return;
        }
        const el = portalRef.current;
        if (!el) { onAutoPrintComplete?.({ success: false, error: 'token portal missing' }); return; }
        // Printer: override → role 'token' → role 'kitchen' → legacy settings
        let printerName: string | undefined = printerOverride;
        let tokenCfg: any = undefined;
        try {
          const pset = await loadPrinterSettings();
          const dev = getDeviceId();
          const tok: any = resolvePrinterForRole(pset, 'token' as any, dev);
          const kit: any = resolvePrinterForRole(pset, 'kitchen', dev);
          tokenCfg = tok || kit;
          if (!printerName && tokenCfg && (tokenCfg.connection || 'system') === 'system' && tokenCfg.printerName) {
            printerName = tokenCfg.printerName;
          }
        } catch {}
        if (!printerName) printerName = (settings as any).tokenPrinter || (settings as any).kotPrinter || (settings as any).defaultPrinter || undefined;

        // ===== PRINT PATH ORDER: RAW -> rendered RAW -> driver -> error =====
        // The token printer's own print mode decides the order, the same way
        // it does for the receipt and the KOT, so one setting governs every
        // slip instead of receipts alone.
        const tokenPrintMode = resolvePrintMode({ printerConfig: tokenCfg, settings });
        if (tokenPrintMode === 'raw' && !(tokenCfg?.connection === 'lan' && tokenCfg?.lanHost)) {
          try {
            const direct = await printDirect({
              slip: 'token',
              settings,
              token: {
                orderNumber: tokenMeta.tokenNumber,
                items: items.map(i => ({ name: i.name, qty: i.qty })),
                restaurantName: (settings as any).name,
                when: new Date(),
              },
              copies: tokenCfg?.copies || 1,
              printerOverride: printerName,
              billNumber: String(order.orderNumber ?? ''),
            });
            if (direct.success) {
              console.info('[DT-Print] token path=raw-escpos', { printer: direct.printerName, ms: direct.durationMs });
              try { issueToken({ order, settings, source: 'auto' }); } catch (e) { console.warn('[token] record failed', e); }
              try { appendTokenEntry({ orderNumber: order.orderNumber, items, source: 'auto' }); } catch {}
              onAutoPrintComplete?.({ success: true });
              return;
            }
            console.warn('[DT-Print] raw token unavailable, falling back to the rendered path:', direct.error);
          } catch (e: any) {
            console.warn('[DT-Print] raw token threw, falling back to the rendered path:', e?.message || e);
          }
        }

        const deviceMargins = loadPrintMargins();
        const res = await printNode(el, {
          paperWidth, printerName, silent: true, copies: 1,
          printMode: tokenPrintMode as any,
          compact: !!(settings as any).receiptCompactMode,
          compactFontSize: (settings as any).receiptCompactFontSize,
          compactLineHeight: (settings as any).receiptCompactLineHeight,
          autoCut: settings.autoCut !== false,
          // Device margins are the last fallback, exactly as they are for
          // the receipt and the KOT. Leaving them out here meant a shop that
          // set this machine's margins saw every slip move but the token.
          marginLeftMm: resolveSlipMargin('token', tokenCfg?.leftMarginMm, tokenCfg?.rightMarginMm, deviceMargins.left, deviceMargins.right).left,
          marginRightMm: resolveSlipMargin('token', tokenCfg?.leftMarginMm, tokenCfg?.rightMarginMm, deviceMargins.left, deviceMargins.right).right,
          contentWidthMm: tokenCfg?.printWidthMm,
        });
        if (res.success) {
          // The token's business record. issueToken returns the EXISTING
          // record when this order already has one, so printing again from
          // Retrieve bumps its reprint count instead of inventing a second
          // token — and therefore never a second token sale.
          try { issueToken({ order, settings, source: 'auto' }); } catch (e) { console.warn('[token] record failed', e); }
          // Legacy day-register, kept so existing reports keep working.
          try { appendTokenEntry({ orderNumber: order.orderNumber, items, source: 'auto' }); } catch {}
        }
        onAutoPrintComplete?.(res);
      } catch (e: any) {
        onAutoPrintComplete?.({ success: false, error: e?.message || String(e) });
      }
    };
    const t = setTimeout(run, 0);
    // Only an unmount (the host dropped the job) cancels a print not yet started.
    return () => { if (!started) { clearTimeout(t); firedRef.current = false; } };
  }, [autoPrint]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={portalRef}
      className="receipt-print-portal"
      aria-hidden="true"
      style={{ position: 'fixed', left: '-10000px', top: 0, visibility: 'hidden' }}
    >
      <div
        className="print-receipt bg-white text-black"
        data-paper-size={paperWidth}
        style={{ width: paperWidth, fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: '#000', background: '#fff' }}
        dangerouslySetInnerHTML={{ __html: tokenSlipInnerHtml(
          {
            // The token's own number, which restarts daily — not the bill
            // number. An existing record means this is a reprint of it.
            orderNumber: tokenMeta.tokenNumber,
            billNumber: order.orderNumber ?? '',
            reprint: tokenMeta.isReprint,
            items: detailedItems.length === items.length ? detailedItems : items,
            orderType: order.orderType,
            // `restaurantName` was never a settings field — the shop's name
            // lives in `name`, so the token header printed empty.
            restaurantName: (settings as any).name ?? (settings as any).restaurantName,
            logo: (settings as any).logo,
            tableName: order.tableName || order.tableLabel,
            customerName: order.customer?.name,
            departments: departmentStubs,
            when: new Date((order as any).updatedAt || order.createdAt || Date.now()),
          },
          ((settings as any).tokenTemplate as TokenTemplate) || 'standard',
          (settings as any).tokenShowTotal !== false,
        ) }}
      />
    </div>,
    document.body,
  );
}
