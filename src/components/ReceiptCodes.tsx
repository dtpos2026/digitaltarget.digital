// ============================================================
// RECEIPT QR & BARCODE — drawn on the bill (Settings → Receipt → QR & Barcode).
//
// ReceiptPreview wraps every design in <ReceiptCodesProvider>; the codes then
// appear wherever a <ReceiptCodesSlot> for their position sits:
//   above  — top of the slip, before the shop's header
//   footer — the template's own QR spot, with its thank-you lines
//   below  — the very end of the slip
// With both switches off nothing renders and the bill is exactly as before.
//
// Printed sizes are whole printer dots. A thermal head marks dots 0.125mm
// apart (203 DPI); a QR module or barcode bar of 2.4 dots prints as 2 or 3
// at random and a scanner misreads it. Modules and bars here are whole dots
// (lib/codeGeometry, ink-spread trim included), in mm, so the image route
// and the Windows driver both land on the dot grid.
// ============================================================
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Order, RestaurantSettings } from '@/lib/types';
import {
  barcodeValueFor, maxCodeWidthMm, qrCaption, qrValueFor, readReceiptCodes,
  type CodePosition, type ReceiptCodesConfig,
} from '@/lib/receiptCodes';
import { barcodeLayout, qrLayout, type BarcodeLayout, type QrLayout } from '@/lib/codeGeometry';

export { maxCodeWidthMm };
export { DOTS_PER_MM, barcodeDots, barcodeLayout, qrLayout, type BarcodeLayout, type QrLayout } from '@/lib/codeGeometry';

// ------------------------------------------------------------ context
interface CodesCtx {
  order: Order;
  settings: RestaurantSettings;
  cfg: ReceiptCodesConfig;
  /** Receipt zoom (Settings → receipt scale): sizes are divided by it so the printed size is exact. */
  zoom: number;
  branch?: string;
}
const Ctx = createContext<CodesCtx | null>(null);

export function ReceiptCodesProvider({ order, settings, zoom = 1, branch, children }: {
  order: Order; settings: RestaurantSettings; zoom?: number; branch?: string; children: ReactNode;
}) {
  const cfg = useMemo(() => readReceiptCodes(settings), [settings]);
  const value = useMemo(() => ({ order, settings, cfg, zoom: zoom > 0 ? zoom : 1, branch }), [order, settings, cfg, zoom, branch]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The codes' settings for the bill being drawn, or null outside a receipt. */
export function useReceiptCodes(): CodesCtx | null {
  return useContext(Ctx);
}

// ------------------------------------------------------------ drawing
const mm = (v: number, zoom: number) => `${Math.round((v / zoom) * 1000) / 1000}mm`;

export function QrCode({ layout, zoom = 1, label = 'QR code' }: { layout: QrLayout; zoom?: number; label?: string }) {
  return (
    <svg
      viewBox={`0 0 ${layout.modules} ${layout.modules}`}
      width={mm(layout.widthMm, zoom)}
      height={mm(layout.widthMm, zoom)}
      style={{ display: 'block', margin: '0 auto', width: mm(layout.widthMm, zoom), height: mm(layout.widthMm, zoom), background: '#fff' }}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      data-dots-per-module={layout.dotsPerModule}
    >
      <rect width={layout.modules} height={layout.modules} fill="#fff" />
      <path d={layout.path} fill="#000" />
    </svg>
  );
}

export function Barcode({ layout, showText, zoom = 1 }: { layout: BarcodeLayout; showText: boolean; zoom?: number }) {
  // Drawn in printer dots: one viewBox unit is one dot.
  const bars: ReactNode[] = [];
  let x = layout.quietDots;
  layout.elements.forEach((w, i) => {
    if (i % 2 === 0) bars.push(<rect key={i} x={x} y={0} width={w} height={1} fill="#000" />);
    x += w;
  });
  return (
    <div>
      <svg
        viewBox={`0 0 ${layout.widthDots} 1`}
        preserveAspectRatio="none"
        width={mm(layout.widthMm, zoom)}
        height={mm(layout.heightMm, zoom)}
        style={{ display: 'block', margin: '0 auto', width: mm(layout.widthMm, zoom), height: mm(layout.heightMm, zoom), background: '#fff' }}
        shapeRendering="crispEdges"
        role="img"
        aria-label={`Barcode ${layout.barcode.text}`}
        data-dots-per-module={layout.dotsPerModule}
      >
        <rect width={layout.widthDots} height={1} fill="#fff" />
        {bars}
      </svg>
      {showText && (
        <div style={{ fontFamily: "'Lucida Console','Consolas','Courier New',monospace", fontSize: '11px', fontWeight: 700, letterSpacing: '2px', marginTop: '1px' }}>
          {layout.barcode.text}
        </div>
      )}
    </div>
  );
}

/**
 * The shop's QR and/or barcode for one position. Renders nothing when neither
 * is switched on for it (or outside a receipt).
 */
export function ReceiptCodesSlot({ position }: { position: CodePosition }) {
  const ctx = useReceiptCodes();
  const qrOn = !!ctx && ctx.cfg.qr.enabled && ctx.cfg.qr.position === position;
  const barOn = !!ctx && ctx.cfg.barcode.enabled && ctx.cfg.barcode.position === position;
  const qr = useMemo(() => {
    if (!ctx || !qrOn) return null;
    const value = qrValueFor(ctx.order, ctx.settings, ctx.cfg, ctx.branch);
    return value ? qrLayout(value, ctx.cfg.qr.sizeMm, maxCodeWidthMm(ctx.settings)) : null;
  }, [ctx, qrOn]);
  const bar = useMemo(() => {
    if (!ctx || !barOn) return null;
    const value = barcodeValueFor(ctx.order, ctx.cfg, ctx.settings);
    return value ? barcodeLayout(ctx.cfg.barcode.format, value, ctx.cfg.barcode.size, maxCodeWidthMm(ctx.settings)) : null;
  }, [ctx, barOn]);
  if (!ctx || (!qr && !bar)) return null;
  const caption = (t: string) => t
    ? <div style={{ fontSize: '11px', fontWeight: 700, marginTop: '2px', lineHeight: 1.25 }}>{t}</div>
    : null;
  return (
    <div className="dt-receipt-codes" data-position={position} style={{ textAlign: 'center', padding: '4px 0', background: '#fff', color: '#000' }}>
      {qr && (
        <div style={{ padding: '2px 0' }}>
          <QrCode layout={qr} zoom={ctx.zoom} />
          {caption(qrCaption(ctx.cfg))}
        </div>
      )}
      {bar && (
        <div style={{ padding: '4px 0 2px' }}>
          <Barcode layout={bar} showText={ctx.cfg.barcode.showText} zoom={ctx.zoom} />
          {caption(ctx.cfg.barcode.caption.trim())}
        </div>
      )}
    </div>
  );
}
