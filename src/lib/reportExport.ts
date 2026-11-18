// ============================================================================
// Report export (v1.116.2) — Print, PDF, POS (thermal) and JPG for every report-like screen, in the style the older reports have always used.
//
// The older reports (Sales Report, Reports Center, the Owner app's bills) each wrote their own print window, PDF and POS-receipt
// layout. A screen that is new must offer the same four buttons and look the same, so the layout lives here once:
//   Print / PDF  the restaurant's logo, name, address and phones on top, the title and the period, a table with the theme-coloured head
//   POS          the thermal-receipt layout of "POS Summary": paper width, margins and scale from Settings, monospace, the marketing footer
//   JPG          the same page as an image, to send on WhatsApp
// A report is described once as a `ReportDoc` (title, columns, rows, totals) and every layout is made from that. Pure builders,
// no clock: the caller passes `now`. Text from the data is escaped, so an item called "Tom & Jerry <b>" prints as typed.
// ============================================================================
import type { RestaurantSettings } from '@/lib/types';

export interface ReportColumn { key: string; label: string; align?: 'left' | 'right' | 'center' }
export interface ReportDoc {
  title: string;
  /** the period or the day, under the title */
  subtitle?: string;
  /** small "label: value" lines under the subtitle (branch, who printed it) */
  meta?: { label: string; value: string }[];
  columns: ReportColumn[];
  rows: Record<string, string | number>[];
  /** the bottom line of the table, by column key */
  totals?: Record<string, string | number>;
  notes?: string[];
  /** file name without extension */
  filename: string;
}

export const esc = (s: unknown): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cell = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-PK') : String(v ?? ''));
export const safeFile = (s: string) => (s.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'report').slice(0, 80);

export interface Brand { name: string; address?: string; phones?: string; logo?: string; primaryHex: string }
export function brandFrom(s: Partial<RestaurantSettings>, primaryHex = '#800020'): Brand {
  return { name: s.name || 'Report', address: s.address || undefined, phones: [s.phone1, s.phone2].filter(Boolean).join(' | ') || undefined, logo: s.logo || undefined, primaryHex };
}

const safeLogo = (l?: string) => (l && /^(data:image\/|https?:\/\/)/i.test(l) ? l : '');

/** The body of the A4 page (used for the print window and, rasterised, for the JPG). */
export function a4Body(doc: ReportDoc, b: Brand, now: Date): string {
  const logo = safeLogo(b.logo);
  const head = logo
    ? `<div style="text-align:center;margin-bottom:10px"><img src="${esc(logo)}" style="max-height:60px;object-fit:contain" /><h1 style="margin:5px 0 2px;font-size:20px">${esc(b.name)}</h1><p style="margin:0;font-size:12px;color:#555">${esc(b.address || '')}</p><p style="margin:2px 0;font-size:12px">${esc(b.phones || '')}</p></div>`
    : `<h2 style="text-align:center;margin:0 0 2px">${esc(b.name)}</h2><p style="text-align:center;margin:0 0 6px;font-size:12px;color:#555">${esc([b.address, b.phones].filter(Boolean).join(' · '))}</p>`;
  const align = (c: ReportColumn) => `text-align:${c.align ?? 'left'}`;
  const th = doc.columns.map(c => `<th style="${align(c)};background:${esc(b.primaryHex)};color:#fff">${esc(c.label)}</th>`).join('');
  const body = doc.rows.map(r => `<tr>${doc.columns.map(c => `<td style="${align(c)}">${esc(cell(r[c.key]))}</td>`).join('')}</tr>`).join('');
  const foot = doc.totals ? `<tr style="font-weight:700;background:#f3f3f3">${doc.columns.map((c, i) => `<td style="${align(c)}">${esc(i === 0 && doc.totals![c.key] === undefined ? 'Total' : cell(doc.totals![c.key]))}</td>`).join('')}</tr>` : '';
  const meta = (doc.meta ?? []).map(m => `<span style="margin-right:14px"><b>${esc(m.label)}:</b> ${esc(m.value)}</span>`).join('');
  return `${head}
    <h3 style="text-align:center;margin:10px 0 5px">${esc(doc.title)}</h3>
    ${doc.subtitle ? `<p style="text-align:center;font-size:12px;color:#555;margin:0 0 4px">${esc(doc.subtitle)}</p>` : ''}
    ${meta ? `<p style="text-align:center;font-size:12px;margin:0 0 6px">${meta}</p>` : ''}
    <table><thead><tr>${th}</tr></thead><tbody>${body}${foot}</tbody></table>
    ${(doc.notes ?? []).map(n => `<p style="font-size:11px;color:#555;margin:4px 0">${esc(n)}</p>`).join('')}
    <p style="font-size:10px;color:#888;margin-top:10px">Printed ${esc(now.toLocaleString('en-PK'))}</p>`;
}

export const A4_CSS = 'body{font-family:Arial;padding:20px;font-size:13px;color:#000}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px}';

/** A complete A4 document for the print window. */
export function a4Html(doc: ReportDoc, b: Brand, now: Date): string {
  return `<html><head><title>${esc(doc.title)}</title><style>${A4_CSS}</style></head><body>${a4Body(doc, b, now)}</body></html>`;
}

type PosSettings = Pick<RestaurantSettings, 'paperSize' | 'receiptScale' | 'receiptMarginTop' | 'receiptMarginRight' | 'receiptMarginBottom' | 'receiptMarginLeft' | 'logoHeight' | 'marketingFooter'> & Partial<RestaurantSettings>;

/**
 * The thermal-receipt layout, the same as the Sales Report's "POS Summary": paper width, margins, scale and logo height come from
 * Settings → Receipt; the first column heads each entry and the other columns follow as "label  value" lines.
 */
export function posHtml(doc: ReportDoc, b: Brand, s: Partial<PosSettings>, now: Date): string {
  const paper = s.paperSize || '80mm';
  const scale = Math.max(50, Math.min(200, s.receiptScale || 100)) / 100;
  const logo = safeLogo(b.logo);
  const [first, ...rest] = doc.columns;
  const entries = doc.rows.map(r => `<div style="border-bottom:1px dotted #999;padding:4px 0;font-size:10px">
      <div style="display:flex;justify-content:space-between;font-weight:800"><span>${esc(cell(r[first.key]))}</span><span>${esc(cell(r[rest[rest.length - 1]?.key ?? first.key] ?? ''))}</span></div>
      ${rest.slice(0, -1).map(c => `<div style="display:flex;justify-content:space-between"><span>${esc(c.label)}</span><span>${esc(cell(r[c.key]))}</span></div>`).join('')}
    </div>`).join('');
  const totals = doc.totals ? `<div style="border-top:2px solid #000;margin-top:4px;padding-top:4px;font-size:12px;font-weight:800">${rest.filter(c => doc.totals![c.key] !== undefined).map(c => `<div style="display:flex;justify-content:space-between"><span>Total ${esc(c.label)}</span><span>${esc(cell(doc.totals![c.key]))}</span></div>`).join('')}</div>` : '';
  const footer = s.marketingFooter?.trim() ? `<div style="margin-top:8px;padding-top:6px;border-top:1px dashed #000;text-align:center;font-size:10px;font-weight:700;white-space:pre-line;line-height:1.35">${esc(s.marketingFooter).replace(/\n/g, '<br/>')}</div>` : '';
  const content = `<div style="font-family:'Lucida Console','Consolas','Courier New',monospace;color:#000;background:#fff;padding:${s.receiptMarginTop ?? 0}mm ${s.receiptMarginRight ?? 3}mm ${s.receiptMarginBottom ?? 0}mm ${s.receiptMarginLeft ?? 3}mm;box-sizing:border-box;">
    ${logo ? `<div style="text-align:center;margin-bottom:6px"><img src="${esc(logo)}" style="max-height:${s.logoHeight || 60}px;max-width:100%;object-fit:contain" /></div>` : ''}
    <div style="text-align:center;margin-bottom:6px"><div style="font-size:18px;font-weight:800">${esc(b.name)}</div><div style="font-size:11px">${esc(b.address || '')}</div><div style="font-size:11px">${esc(b.phones || '')}</div></div>
    <div style="text-align:center;border-top:2px solid #000;border-bottom:2px solid #000;padding:4px 0;margin-bottom:6px;font-size:14px;font-weight:800">${esc(doc.title.toUpperCase())}</div>
    ${doc.subtitle ? `<div style="font-size:11px;margin-bottom:3px">${esc(doc.subtitle)}</div>` : ''}
    ${(doc.meta ?? []).map(m => `<div style="font-size:11px;display:flex;justify-content:space-between"><span>${esc(m.label)}:</span><span>${esc(m.value)}</span></div>`).join('')}
    <div style="margin-top:6px">${entries}</div>${totals}${footer}
    <div style="font-size:9px;text-align:center;margin-top:6px">${esc(now.toLocaleString('en-PK'))}</div>
  </div>`;
  return `<html><head><title>${esc(doc.title)}</title><style>@page{size:${paper} auto;margin:0}html,body{margin:0;padding:0;width:${paper};background:#fff}body{font-family:Arial,sans-serif;font-weight:700;color:#000}.report-scale{width:${100 / scale}%;zoom:${scale};transform-origin:top left}</style></head><body><div class="report-scale">${content}</div></body></html>`;
}

/** CSV with quoted cells, the totals as the last line. */
export function reportCsv(doc: ReportDoc): string {
  const q = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [doc.columns.map(c => q(c.label)).join(','), ...doc.rows.map(r => doc.columns.map(c => q(r[c.key])).join(','))];
  if (doc.totals) lines.push(doc.columns.map((c, i) => q(doc.totals![c.key] ?? (i === 0 ? 'Total' : ''))).join(','));
  return lines.join('\n');
}

// ---- the browser side: print window, PDF, JPG, download -----------------------------------------------------------

/** Opens the document in a print window; false when the browser blocked the window. */
export function printHtml(html: string): boolean {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  try { w.print(); } catch { /* the window stays open for a manual print */ }
  return true;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** A4 PDF with the branded header band and footer of every other PDF in the software (lib/pdfBrand.ts). */
export async function reportPdf(doc: ReportDoc, now: Date): Promise<Blob> {
  const [{ default: JsPDF }, { default: autoTable }, brand] = await Promise.all([import('jspdf'), import('jspdf-autotable'), import('@/lib/pdfBrand')]);
  const pdf = new JsPDF({ unit: 'mm', format: 'a4' });
  const y0 = brand.drawPdfHeader(pdf, { title: doc.title, subtitle: doc.subtitle });
  const [r, g, b] = brand.getThemePrimaryRgb();
  const meta = (doc.meta ?? []).map(m => `${m.label}: ${m.value}`).join('   ');
  let y = y0;
  if (meta) { pdf.setFontSize(9); pdf.text(meta, 10, y + 2, { maxWidth: 190 }); y += 7; }
  autoTable(pdf, {
    startY: y, head: [doc.columns.map(c => c.label)], body: doc.rows.map(row => doc.columns.map(c => cell(row[c.key]))),
    foot: doc.totals ? [doc.columns.map((c, i) => (doc.totals![c.key] !== undefined ? cell(doc.totals![c.key]) : i === 0 ? 'Total' : ''))] : undefined,
    headStyles: { fillColor: [r, g, b], textColor: 255 }, footStyles: { fillColor: [243, 243, 243], textColor: 20, fontStyle: 'bold' }, styles: { fontSize: 9 },
    columnStyles: Object.fromEntries(doc.columns.map((c, i) => [i, { halign: c.align ?? 'left' }])),
    margin: { left: 10, right: 10 },
  });
  const after = (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  let ny = after + 6;
  pdf.setFontSize(8);
  for (const n of doc.notes ?? []) { pdf.text(n, 10, ny, { maxWidth: 190 }); ny += 5; }
  pdf.text(`Printed ${now.toLocaleString('en-PK')}`, 10, ny + 2);
  brand.drawPdfFooter(pdf);
  return pdf.output('blob');
}

/** The A4 page as a JPG image (for WhatsApp). The page is drawn off screen first, then removed. */
export async function reportJpg(doc: ReportDoc, b: Brand, now: Date): Promise<Blob> {
  const { default: html2canvas } = await import('html2canvas');
  const node = document.createElement('div');
  node.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff;color:#000;font-family:Arial;padding:20px;font-size:13px';
  node.innerHTML = `<style>table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px}</style>${a4Body(doc, b, now)}`;
  document.body.appendChild(node);
  try {
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    return await new Promise<Blob>((res, rej) => canvas.toBlob(bl => (bl ? res(bl) : rej(new Error('The image could not be made'))), 'image/jpeg', 0.92));
  } finally { node.remove(); }
}
