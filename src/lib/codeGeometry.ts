// ============================================================
// CODE GEOMETRY — QR modules and barcode bars in whole printer dots.
//
// Shared by the rendered bill (components/ReceiptCodes.tsx draws it as SVG)
// and the raw ESC/POS bill (printing/codeRaster.ts sends it as a bitmap), so
// a code prints the same size on every route. A thermal head marks dots
// 0.125mm apart (203 DPI); a module of 2.4 dots prints as 2 or 3 at random
// and a scanner misreads it, so everything here is whole dots.
//
// A thermal head also spreads its heat: every dark area prints about a dot
// wider than drawn, so the narrow white gaps close up and the code stops
// scanning (the darker the printer, the worse). From 4-dot modules and 3-dot
// bars up, dark areas are drawn a dot short on their right (and a QR's lower)
// edge — the printed code then comes out at its true size. Tested against
// simulated print spread of -0.5 to +1.5 dots and phone-camera blur.
// ============================================================
import QRCode from 'qrcode';
import { encodeBarcode, QUIET_ZONE_MODULES, type LinearBarcode } from '@/lib/linearBarcode';
import type { BarcodeSize, ReceiptCodesConfig } from '@/lib/receiptCodes';

/** Printer dots per mm (203 DPI). */
export const DOTS_PER_MM = 8;
/** Blank modules around a QR — the paper around it adds the rest. */
const QR_QUIET = 2;
/** Narrow bar width in dots for each barcode size. */
export const BAR_DOTS: Record<BarcodeSize, number> = { small: 2, medium: 3, large: 4 };
/** QR modules this many dots or more get their dark edges trimmed for ink spread. */
const QR_TRIM_FROM = 4;
/** Bars this many dots or more print a dot narrower, their spaces a dot wider. */
const BAR_TRIM_FROM = 3;
/** Every QR module is at least this many dots when the bill text fits (see qrByteBudget). */
const QR_SAFE_DOTS = 5;
// Byte-mode capacity at error correction M, QR versions 1-15.
const QR_BYTES_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412];
const BAR_HEIGHT_MM: Record<BarcodeSize, number> = { small: 8, medium: 10, large: 13 };

// ------------------------------------------------------------ geometry
export interface QrLayout {
  modules: number;
  dotsPerModule: number;
  widthMm: number;
  path: string;
  version: number;
  /** Symbol size in modules (without the blank border) and its dark modules, row by row. */
  size: number;
  quiet: number;
  dark: (row: number, col: number) => boolean;
  /** Dots trimmed off dark edges for ink spread (0 or 1). */
  trimDots: number;
  /** Whether printer dot (x, y) of the whole code, border included, is inked. */
  ink: (x: number, y: number) => boolean;
}

/**
 * The most bytes a QR can hold at `sizeMm` with every module still
 * QR_SAFE_DOTS dots wide — the budget for the bill text it carries.
 */
export function qrByteBudget(sizeMm: number, maxMm: number): number {
  const modules = Math.floor((Math.min(sizeMm, maxMm) * DOTS_PER_MM) / QR_SAFE_DOTS) - QR_QUIET * 2;
  let bytes = QR_BYTES_M[0];
  QR_BYTES_M.forEach((b, i) => { if (17 + 4 * (i + 1) <= modules) bytes = b; });
  return bytes;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** QR modules sized to whole printer dots, as close to `sizeMm` as possible. */
export function qrLayout(value: string, sizeMm: number, maxMm: number): QrLayout | null {
  let qr: ReturnType<typeof QRCode.create>;
  try {
    qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  } catch {
    return null; // too much data for any QR: nothing is better than garbage
  }
  const size = qr.modules.size;
  const total = size + QR_QUIET * 2;
  const target = Math.min(sizeMm, maxMm);
  let dots = Math.max(2, Math.floor((target * DOTS_PER_MM) / total));
  while (dots > 2 && (total * dots) / DOTS_PER_MM > maxMm) dots--;
  if ((total * 2) / DOTS_PER_MM > maxMm) return null;
  const data = qr.modules.data;
  const dark = (r: number, c: number) => r >= 0 && c >= 0 && r < size && c < size && !!data[r * size + c];
  const trimDots = dots >= QR_TRIM_FROM ? 1 : 0;
  // A dark module's last dot column is left white when the module to its
  // right is white, its last dot row when the module below is: each dark
  // area shrinks a dot on its right and lower edge, nothing inside it.
  const ink = (x: number, y: number) => {
    const c = Math.floor(x / dots) - QR_QUIET;
    const r = Math.floor(y / dots) - QR_QUIET;
    if (!dark(r, c)) return false;
    if (trimDots && x % dots === dots - 1 && !dark(r, c + 1)) return false;
    if (trimDots && y % dots === dots - 1 && !dark(r + 1, c)) return false;
    return true;
  };
  // One path in module units, horizontal runs merged: small markup, crisp
  // edges. A run is split where its lower trim changes; the trims are
  // fractions of a module that land on whole dots.
  const t = trimDots / dots;
  let path = '';
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!dark(y, x)) { x++; continue; }
      let end = x;
      while (dark(y, end + 1)) end++;
      for (let s = x; s <= end;) {
        const cut = t > 0 && !dark(y + 1, s);
        let e = s;
        while (e < end && (t > 0 && !dark(y + 1, e + 1)) === cut) e++;
        const w = r3(e - s + 1 - (e === end ? t : 0));
        const h = r3(1 - (cut ? t : 0));
        path += `M${s + QR_QUIET} ${y + QR_QUIET}h${w}v${h}h-${w}z`;
        s = e + 1;
      }
      x = end + 1;
    }
  }
  return {
    modules: total, dotsPerModule: dots, widthMm: (total * dots) / DOTS_PER_MM, path, version: qr.version,
    size, quiet: QR_QUIET, dark, trimDots, ink,
  };
}

export interface BarcodeLayout {
  barcode: LinearBarcode;
  /** Bar/space widths in printer dots. */
  elements: number[];
  /** Narrow bar width in dots. */
  dotsPerModule: number;
  /** Blank on each side inside the image, in dots (the paper margin adds the rest). */
  quietDots: number;
  widthDots: number;
  widthMm: number;
  heightMm: number;
  /** True when Code 39 was too wide for the paper and Code 128 carries the text instead. */
  fellBack: boolean;
}

/**
 * Element widths in dots for a narrow bar of `x` dots. Code 39's wide
 * elements use 2.5:1 (2 → 5 dots, 3 → 7, 4 → 10): inside the format's
 * 2:1–3:1 range and a sixth narrower than 3:1 — Code 39 is a wide code.
 * From 3-dot bars up every bar is a dot narrower and every space a dot
 * wider, so the bars print at their true width once the ink spreads.
 */
export function barcodeDots(barcode: LinearBarcode, x: number): number[] {
  const wide = x === 3 ? 7 : Math.round(x * 2.5);
  const drawn = barcode.format === 'code39'
    ? barcode.widths.map(w => (w === 1 ? x : wide))
    : barcode.widths.map(w => w * x);
  if (x < BAR_TRIM_FROM) return drawn;
  return drawn.map((w, i) => (i % 2 === 0 ? w - 1 : w + 1));
}

/**
 * Bars sized to whole printer dots: the chosen bar width, narrower if the
 * slip needs it, never under 2 dots. The paper's margins supply the blank a
 * scanner needs beside the bars, so the image keeps only what fits. Code 39
 * too wide for the paper falls back to Code 128, which carries the same text
 * in about half the width — a code that prints beats one that does not.
 */
export function barcodeLayout(format: ReceiptCodesConfig['barcode']['format'], value: string, size: BarcodeSize, maxMm: number): BarcodeLayout | null {
  let barcode: LinearBarcode;
  try {
    barcode = encodeBarcode(format, value);
  } catch {
    return format === 'code39' ? fallBack(value, size, maxMm) : null;
  }
  const maxDots = Math.floor(maxMm * DOTS_PER_MM);
  for (let x = BAR_DOTS[size]; x >= 2; x--) {
    const elements = barcodeDots(barcode, x);
    const bars = elements.reduce((a, b) => a + b, 0);
    if (bars > maxDots) continue;
    const quietDots = Math.max(0, Math.min(QUIET_ZONE_MODULES * x, Math.floor((maxDots - bars) / 2)));
    const widthDots = bars + quietDots * 2;
    return {
      barcode, elements, dotsPerModule: x, quietDots, widthDots,
      widthMm: widthDots / DOTS_PER_MM, heightMm: BAR_HEIGHT_MM[size], fellBack: false,
    };
  }
  return format === 'code39' ? fallBack(value, size, maxMm) : null;
}

function fallBack(value: string, size: BarcodeSize, maxMm: number): BarcodeLayout | null {
  const l = barcodeLayout('code128', value, size, maxMm);
  return l ? { ...l, fellBack: true } : null;
}

