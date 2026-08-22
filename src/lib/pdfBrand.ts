/**
 * Shared branded PDF header utility.
 * Draws restaurant logo + name + address + phone with the active theme color.
 * Use across all admin/report PDFs so every export carries restaurant identity.
 */
import type jsPDF from 'jspdf';
import { getSettings } from '@/lib/store';

/** Convert "H S% L%" CSS HSL token → [r,g,b] 0-255 */
function hslStrToRgb(hsl: string): [number, number, number] {
  const m = hsl.trim().match(/(-?[\d.]+)\s+(-?[\d.]+)%\s+(-?[\d.]+)%/);
  if (!m) return [124, 58, 237]; // purple fallback
  let h = parseFloat(m[1]) / 360;
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

/** Returns the active theme primary color as RGB tuple. */
export function getThemePrimaryRgb(): [number, number, number] {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--primary');
    if (v) return hslStrToRgb(v);
  } catch {}
  return [124, 58, 237];
}

export interface PdfHeaderOpts {
  /** Report title shown under restaurant name */
  title?: string;
  /** Optional period / subtitle */
  subtitle?: string;
  /** Custom restaurant name (fallback to settings.name) */
  brandName?: string;
}

/**
 * Draw a branded header band at the top of `doc`.
 * Returns the Y (mm) where body content should begin.
 */
export function drawPdfHeader(doc: jsPDF, opts: PdfHeaderOpts = {}): number {
  const s = getSettings();
  const W = doc.internal.pageSize.getWidth();
  const [r, g, b] = getThemePrimaryRgb();
  const isMm = doc.internal.scaleFactor > 2; // mm has sf≈2.83, pt has 1

  const u = (mm: number) => (isMm ? mm : mm * 2.83465);
  const bandH = u(26);

  // Band
  doc.setFillColor(r, g, b);
  doc.rect(0, 0, W, bandH, 'F');

  // Logo (left)
  const logo = s.appLogo || s.logo || '';
  const logoSize = u(18);
  const padX = u(8);
  let textX = padX;
  if (logo && /^data:image\//i.test(logo)) {
    try {
      const fmt = logo.includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(logo, fmt, padX, u(4), logoSize, logoSize);
      textX = padX + logoSize + u(4);
    } catch {}
  }

  // Restaurant name
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isMm ? 15 : 18);
  const name = opts.brandName || s.name || 'DT POS';
  doc.text(name, textX, u(10));

  // Address + phone line
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isMm ? 8.5 : 10);
  const addr = s.address || '';
  const phones = [s.phone1, s.phone2].filter(Boolean).join(' • ');
  if (addr) doc.text(addr, textX, u(15), { maxWidth: W - textX - padX });
  if (phones) doc.text(`Phone: ${phones}`, textX, u(20));

  // Title (right side)
  if (opts.title) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(isMm ? 11 : 13);
    doc.text(opts.title, W - padX, u(11), { align: 'right' });
  }
  if (opts.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(isMm ? 8 : 9);
    doc.text(opts.subtitle, W - padX, u(17), { align: 'right' });
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isMm ? 7.5 : 9);
  doc.text(`Generated: ${new Date().toLocaleString()}`, W - padX, u(22), { align: 'right' });

  doc.setTextColor(20, 20, 20);
  return isMm ? 32 : 32 * 2.83465;
}

/** Draw branded footer (page X / Y + powered by) on every page. */
export function drawPdfFooter(doc: jsPDF, poweredBy = 'Powered by Digital Target — DT POS') {
  const total = doc.getNumberOfPages();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`${poweredBy}  •  Page ${i} / ${total}`, W / 2, H - 6, { align: 'center' });
  }
  doc.setTextColor(0, 0, 0);
}
