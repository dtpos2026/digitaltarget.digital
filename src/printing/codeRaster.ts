// ============================================================
// QR & BARCODE ON THE RAW BILL — Fast Billing Mode and "Raw text" printers.
//
// The raw bill is ESC/POS text: no page is rendered, so the codes the
// designed bill draws as SVG were simply missing — the QR "never generated".
// Here they are drawn straight into printer dots and sent as GS v 0 images,
// the same command the image route prints every designed bill with, in
// bands of 128 rows (small image buffers drop taller ones). Sizes come from
// codeGeometry, so a code is the same size on every route.
// ============================================================
import type { Order, RestaurantSettings } from '@/lib/types';
import {
  barcodeValueFor, maxCodeWidthMm, qrCaption, qrValueFor, readReceiptCodes, type CodePosition,
} from '@/lib/receiptCodes';
import { barcodeLayout, qrLayout, DOTS_PER_MM } from '@/lib/codeGeometry';

const GS = 0x1d;
/** Rows per GS v 0 command (see RASTER_BAND_ROWS in electron/escposRaster.cjs). */
export const CODE_BAND_ROWS = 128;

export interface Bitmap {
  width: number;
  height: number;
  /** Packed rows, MSB first, 1 = ink. */
  rowBytes: number;
  data: Uint8Array;
}

function blank(width: number, height: number): Bitmap {
  const rowBytes = Math.ceil(width / 8);
  return { width, height, rowBytes, data: new Uint8Array(rowBytes * height) };
}
function ink(b: Bitmap, x: number, y: number) {
  if (x < 0 || y < 0 || x >= b.width || y >= b.height) return;
  b.data[y * b.rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
}

/** GS v 0 commands for a bitmap, in bands of at most CODE_BAND_ROWS rows. */
export function rasterCommands(b: Bitmap): number[] {
  const out: number[] = [];
  for (let y0 = 0; y0 < b.height; y0 += CODE_BAND_ROWS) {
    const rows = Math.min(CODE_BAND_ROWS, b.height - y0);
    out.push(GS, 0x76, 0x30, 0x00, b.rowBytes & 0xff, (b.rowBytes >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff);
    const band = b.data.subarray(y0 * b.rowBytes, (y0 + rows) * b.rowBytes);
    for (let i = 0; i < band.length; i++) out.push(band[i]);
  }
  return out;
}

/** The QR as a bitmap `areaDots` wide with the code centred, or null. */
export function qrBitmap(value: string, sizeMm: number, maxMm: number, areaDots: number): Bitmap | null {
  const l = qrLayout(value, sizeMm, maxMm);
  if (!l) return null;
  const side = l.modules * l.dotsPerModule;
  const b = blank(Math.max(areaDots, side), side);
  const left = Math.floor((b.width - side) / 2);
  // Dot by dot from the shared layout, ink-spread trim included.
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) if (l.ink(x, y)) ink(b, left + x, y);
  return b;
}

/** The barcode as a bitmap `areaDots` wide with the bars centred, or null. */
export function barcodeBitmap(format: 'code128' | 'code39', value: string, size: 'small' | 'medium' | 'large', maxMm: number, areaDots: number): { bitmap: Bitmap; text: string } | null {
  const l = barcodeLayout(format, value, size, maxMm);
  if (!l) return null;
  const height = Math.round(l.heightMm * DOTS_PER_MM);
  const b = blank(Math.max(areaDots, l.widthDots), height);
  let x = Math.floor((b.width - l.widthDots) / 2) + l.quietDots;
  l.elements.forEach((w, i) => {
    if (i % 2 === 0) for (let dx = 0; dx < w; dx++) for (let y = 0; y < height; y++) ink(b, x + dx, y);
    x += w;
  });
  return { bitmap: b, text: l.barcode.text };
}

export interface CodeBlock {
  /** GS v 0 commands for the code. */
  raster: number[];
  /** Human-readable line under a barcode. */
  text?: string;
  caption?: string;
}

/**
 * The shop's codes for one position on the raw bill, ready to print.
 * Empty when neither code is switched on there.
 */
export function rawCodeBlocks(order: Order, settings: RestaurantSettings, position: CodePosition, areaDots: number): CodeBlock[] {
  const cfg = readReceiptCodes(settings);
  const maxMm = Math.min(maxCodeWidthMm(settings), areaDots / DOTS_PER_MM);
  const out: CodeBlock[] = [];
  if (cfg.qr.enabled && cfg.qr.position === position) {
    const value = qrValueFor(order, settings, cfg);
    const b = value ? qrBitmap(value, cfg.qr.sizeMm, maxMm, areaDots) : null;
    if (b) out.push({ raster: rasterCommands(b), caption: qrCaption(cfg) });
  }
  if (cfg.barcode.enabled && cfg.barcode.position === position) {
    const value = barcodeValueFor(order, cfg, settings);
    const r = value ? barcodeBitmap(cfg.barcode.format, value, cfg.barcode.size, maxMm, areaDots) : null;
    if (r) {
      out.push({
        raster: rasterCommands(r.bitmap),
        ...(cfg.barcode.showText ? { text: r.text } : {}),
        ...(cfg.barcode.caption.trim() ? { caption: cfg.barcode.caption.trim() } : {}),
      });
    }
  }
  return out;
}
