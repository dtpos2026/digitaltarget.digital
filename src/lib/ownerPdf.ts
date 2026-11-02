// ============================================================
// OWNER APP — PDFs to share (v1.86.0): one bill (OWN-07 "Share receipt") and the sales report (OWN-11 "Export").
// Branded with the restaurant's header (lib/pdfBrand.ts). Shared through the phone's share sheet where the browser
// can share files, otherwise downloaded.
// ============================================================
import type { Order } from './types';
import { drawPdfFooter, drawPdfHeader } from './pdfBrand';
import { orderCharges, orderTimeline, orderTitle, presetLabel, type SalesReport, type RangePreset } from './ownerApp';

type Money = (n: number) => string;

const fmtWhen = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''; };

/** One bill as an A5 PDF: items, charges, total, payments and what happened to it. */
export async function orderPdf(o: Order, money: Money): Promise<Blob> {
  const { default: JsPDF } = await import('jspdf');
  const doc = new JsPDF({ unit: 'mm', format: 'a5' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  let y = drawPdfHeader(doc, { title: `Bill #${o.orderNumber}`, subtitle: fmtWhen(o.createdAt) });
  const line = (left: string, right = '', bold = false) => {
    if (y > H - 16) { doc.addPage(); y = 14; }
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(left, 10, y, { maxWidth: W - 50 });
    if (right) doc.text(right, W - 10, y, { align: 'right' });
    y += 6;
  };
  doc.setFontSize(10);
  line(orderTitle(o), '', true);
  if (o.customer?.name) line(`Customer: ${o.customer.name}${o.customer.phone ? ` · ${o.customer.phone}` : ''}`);
  y += 2;
  for (const it of o.items || []) line(`${it.quantity} × ${it.name}`, money(Number(it.lineTotal || 0)));
  doc.setDrawColor(220); doc.line(10, y - 3, W - 10, y - 3); y += 2;
  for (const c of orderCharges(o)) line(c.label, money(c.amount));
  doc.setFontSize(12); line('Total', money(Number(o.grandTotal || 0)), true); doc.setFontSize(10);
  const events = orderTimeline(o);
  if (events.length) {
    y += 3; line('What happened', '', true);
    for (const e of events) line(`${fmtWhen(e.at)}  ${e.label}${e.who ? ` — ${e.who}` : ''}`);
  }
  drawPdfFooter(doc);
  return doc.output('blob');
}

/** The sales report of a period as an A4 PDF: total against the period before, the series, the best sellers. */
export async function salesReportPdf(r: SalesReport, preset: RangePreset, money: Money, branchName?: string): Promise<Blob> {
  const { default: JsPDF } = await import('jspdf');
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  let y = drawPdfHeader(doc, { title: `Sales — ${presetLabel(preset)}`, subtitle: branchName || 'All branches' });
  const row = (a: string, b = '', c = '', bold = false) => {
    if (y > H - 16) { doc.addPage(); y = 16; }
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(a, 14, y, { maxWidth: W - 90 });
    if (b) doc.text(b, W - 60, y, { align: 'right' });
    if (c) doc.text(c, W - 14, y, { align: 'right' });
    y += 6.5;
  };
  doc.setFontSize(11);
  row('Money taken', money(r.total), '', true);
  row('Bills', String(r.bills));
  row('Period before', money(r.prevTotal), r.pct === null ? 'no comparison' : `${r.pct > 0 ? '+' : ''}${r.pct}%`);
  y += 4; row('Period', 'Money taken', '', true);
  for (const p of r.bars) row(p.label, money(p.value));
  y += 4; row('Top items', 'Sold', 'Amount', true);
  for (const t of r.top) row(t.name, String(t.qty), money(t.amount));
  drawPdfFooter(doc);
  return doc.output('blob');
}

/** Opens the phone's share sheet with the file where the browser allows it; otherwise downloads it. */
export async function shareOrDownload(blob: Blob, filename: string, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title });
      return 'shared';
    }
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
