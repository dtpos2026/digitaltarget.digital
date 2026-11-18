// The four buttons every report-like screen carries (v1.116.2): Print (A4), PDF, POS (thermal receipt) and JPG — the set the older
// reports have always had, with one layout behind them (lib/reportExport.ts). The page hands over a function that builds the report
// from what is on screen right now, so the print always matches the screen.
import { useState } from 'react';
import { FileDown, Image as ImageIcon, Printer, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getSettings } from '@/lib/store';
import { brandFrom, downloadBlob, a4Html, posHtml, printHtml, reportJpg, reportPdf, safeFile, type ReportDoc } from '@/lib/reportExport';
import { getThemePrimaryRgb } from '@/lib/pdfBrand';

const hex = ([r, g, b]: number[]) => `#${[r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')}`;

export default function ReportActions({ build, disabled, pos: withPos = true }: { build: () => ReportDoc | null; disabled?: boolean; /** false for a wide grid that has no sensible thermal-receipt form */ pos?: boolean }) {
  const [busy, setBusy] = useState<'pdf' | 'jpg' | null>(null);
  const prepare = () => {
    const doc = build();
    if (!doc || doc.rows.length === 0) { toast.error('Nothing to print yet'); return null; }
    const s = getSettings();
    let primary = '#800020';
    try { primary = hex(getThemePrimaryRgb()); } catch { /* the default band colour */ }
    return { doc, s, brand: brandFrom(s, primary), now: new Date() };
  };
  const print = () => { const p = prepare(); if (p && !printHtml(a4Html(p.doc, p.brand, p.now))) toast.error('The browser blocked the print window — allow pop-ups and try again'); };
  const pos = () => { const p = prepare(); if (p && !printHtml(posHtml(p.doc, p.brand, p.s, p.now))) toast.error('The browser blocked the print window — allow pop-ups and try again'); };
  const pdf = async () => {
    const p = prepare(); if (!p) return;
    setBusy('pdf');
    try { downloadBlob(await reportPdf(p.doc, p.now), `${safeFile(p.doc.filename)}.pdf`); toast.success('PDF saved'); }
    catch { toast.error('Could not make the PDF on this device'); } finally { setBusy(null); }
  };
  const jpg = async () => {
    const p = prepare(); if (!p) return;
    setBusy('jpg');
    try { downloadBlob(await reportJpg(p.doc, p.brand, p.now), `${safeFile(p.doc.filename)}.jpg`); toast.success('Image saved'); }
    catch { toast.error('Could not make the image on this device'); } finally { setBusy(null); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-report-actions>
      <Button size="sm" variant="outline" onClick={print} disabled={disabled} data-report-print><Printer className="mr-1 h-3.5 w-3.5" /> Print</Button>
      <Button size="sm" variant="outline" onClick={() => void pdf()} disabled={disabled || busy !== null} data-report-pdf><FileDown className="mr-1 h-3.5 w-3.5" /> PDF</Button>
      {withPos && <Button size="sm" variant="outline" onClick={pos} disabled={disabled} title="Thermal receipt, as POS Summary" data-report-pos><Receipt className="mr-1 h-3.5 w-3.5" /> POS</Button>}
      <Button size="sm" variant="outline" onClick={() => void jpg()} disabled={disabled || busy !== null} data-report-jpg><ImageIcon className="mr-1 h-3.5 w-3.5" /> JPG</Button>
    </div>
  );
}
