// Invoice preview/download dialog — A4 print + POS 80mm thermal + PNG/JPG/PDF download
import { useRef, useState, forwardRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Download, Receipt as ReceiptIcon, FileImage, FileText, Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Invoice, tsToDate, formatRs } from '@/lib/billing';
import { getPlan } from '@/lib/plans';
import dtLogo from '@/assets/digital-target-logo.png';
import A4Invoice from '@/components/A4Invoice';
import InvoiceVerifyBadge from '@/components/InvoiceVerifyBadge';
import { verifyUrl } from '@/lib/invoiceVerify';

interface Props {
  invoice: Invoice;
  restaurantName: string;
  email?: string;
  tenantId: string;
  onClose: () => void;
}

export default function InvoicePreviewDialog({ invoice, restaurantName, email, tenantId, onClose }: Props) {
  const [mode, setMode] = useState<'a4' | 'pos'>('a4');
  const a4Ref = useRef<HTMLDivElement>(null);
  const posRef = useRef<HTMLDivElement>(null);
  const planName = getPlan(invoice.planId).name;
  const issued = tsToDate(invoice.issuedAt)?.toLocaleDateString() || '';

  const downloadImage = async (ext: 'png' | 'jpg') => {
    const node = mode === 'a4' ? a4Ref.current : posRef.current;
    if (!node) return;
    try {
      // v1.51.0 — html2canvas (196 KB) and jspdf (392 KB) loaded with this
      // dialog, so merely OPENING an invoice preview pulled 588 KB the viewer
      // may never use. Loaded at the click that needs them.
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(node, {
        scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
      });
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      const data = canvas.toDataURL(mime, 0.95);
      const link = document.createElement('a');
      link.download = `${invoice.number}-${mode === 'pos' ? 'pos80' : 'a4'}.${ext}`;
      link.href = data;
      link.click();
      toast.success(`Downloaded ${link.download}`);
    } catch (e: any) {
      toast.error(e?.message || 'Image export failed');
    }
  };

  const downloadPdf = async () => {
    const node = mode === 'a4' ? a4Ref.current : posRef.current;
    if (!node) return;
    const tId = toast.loading('Generating PDF…');
    try {
      const { default: html2canvas } = await import('html2canvas');
      const { default: jsPDF } = await import('jspdf');
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const pdf = mode === 'pos'
        ? new jsPDF({ unit: 'mm', format: [80, Math.max(297, (canvas.height / canvas.width) * 80)] })
        : new jsPDF({ unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (canvas.height / canvas.width) * imgW;
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 0) {
        position = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH);
        heightLeft -= pageH;
      }
      pdf.save(`${invoice.number}-${mode === 'pos' ? 'pos80' : 'a4'}.pdf`);
      toast.success('PDF downloaded', { id: tId });
    } catch (e: any) {
      toast.error(e?.message || 'PDF export failed', { id: tId });
    }
  };

  const printNode = () => {
    const node = mode === 'a4' ? a4Ref.current : posRef.current;
    if (!node) return;
    const w = window.open('', '_blank', `width=${mode === 'pos' ? 380 : 820},height=900`);
    if (!w) { toast.error('Popup blocked'); return; }
    const css = mode === 'pos' ? POS_CSS : A4_CSS;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${invoice.number}</title><style>${css}</style></head><body>${node.outerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 350);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptIcon className="h-5 w-5 text-violet-600" />
            Invoice {invoice.number}
          </DialogTitle>
        </DialogHeader>

        {/* Mode + actions */}
        <div className="flex flex-wrap gap-2 items-center border-b pb-3">
          <div className="inline-flex p-1 bg-muted/60 rounded-lg border">
            <button
              onClick={() => setMode('a4')}
              className={`px-3 py-1 text-xs font-bold uppercase rounded-md ${mode === 'a4' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
            >A4 Invoice</button>
            <button
              onClick={() => setMode('pos')}
              className={`px-3 py-1 text-xs font-bold uppercase rounded-md ${mode === 'pos' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
            >POS 80mm</button>
          </div>
          <div className="ml-auto flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              data-testid="copy-verify-link"
              title="The address the QR code on the invoice opens"
              onClick={async () => {
                const url = verifyUrl(invoice.id);
                try { await navigator.clipboard.writeText(url); toast.success('Verification link copied'); }
                catch { window.prompt('Copy the verification link', url); }
              }}
            >
              <LinkIcon className="h-4 w-4 mr-1" /> Verify link
            </Button>
            <Button size="sm" variant="outline" onClick={printNode}>
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
            <Button size="sm" className="bg-rose-600 hover:bg-rose-700 text-white" onClick={downloadPdf}>
              <FileText className="h-4 w-4 mr-1" /> PDF
            </Button>
            <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white" onClick={() => downloadImage('png')}>
              <FileImage className="h-4 w-4 mr-1" /> PNG
            </Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => downloadImage('jpg')}>
              <Download className="h-4 w-4 mr-1" /> JPG
            </Button>
          </div>
        </div>

        {/* Preview */}
        <div className="bg-zinc-100 dark:bg-zinc-900 p-4 flex justify-center overflow-x-auto">
          {mode === 'a4' ? (
            <A4Invoice ref={a4Ref} invoice={invoice} restaurantName={restaurantName} email={email} tenantId={tenantId} planName={planName} issued={issued} />
          ) : (
            <POSInvoice ref={posRef} invoice={invoice} restaurantName={restaurantName} email={email} tenantId={tenantId} planName={planName} issued={issued} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============ A4 Invoice ============
// ============ POS 80mm Receipt ============
const POSInvoice = (() => {
  const Comp = (props: any, ref: any) => {
    const { invoice, restaurantName, email, tenantId, planName, issued } = props;
    return (
      <div ref={ref} style={{
        width: 302, // 80mm @ ~96dpi
        background: '#fff', color: '#000',
        padding: '14px 12px', fontFamily: "'Courier New', 'Consolas', monospace",
        fontSize: 13, fontWeight: 700, lineHeight: 1.45,
        boxShadow: '0 4px 20px rgba(0,0,0,.1)', position: 'relative',
      }}>
        {invoice.status === 'paid' && (
          <div style={{
            position: 'absolute', top: 110, right: 10, transform: 'rotate(-18deg)',
            border: '4px solid #16a34a', color: '#16a34a',
            borderRadius: '50%', width: 90, height: 90,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 900, fontSize: 22, fontFamily: 'system-ui, sans-serif',
            opacity: 0.9, pointerEvents: 'none', zIndex: 5,
          }}>PAID</div>
        )}
        {/* Logo + brand */}
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{ width: 56, height: 56, margin: '0 auto 6px', borderRadius: 8, background: '#3c096c', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <img src={dtLogo} alt="DT" style={{ width: 46, height: 46, objectFit: 'contain' }} crossOrigin="anonymous" />
          </div>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#3c096c', letterSpacing: -0.3, fontFamily: 'system-ui, sans-serif' }}>DIGITAL TARGET</div>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, color: '#222', fontWeight: 800 }}>DT POS · Restaurant System</div>
          <div style={{ fontSize: 11, marginTop: 3, fontWeight: 700 }}>Taimoor Younas</div>
          <div style={{ fontSize: 11, fontWeight: 700 }}>📞 0345-1873354</div>
        </div>

        <Divider />

        <div style={{ textAlign: 'center', fontSize: 15, fontWeight: 900, letterSpacing: 1 }}>SUBSCRIPTION INVOICE</div>
        <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 800, marginTop: 2 }}>{invoice.number}</div>
        <div style={{ textAlign: 'center', fontSize: 11, color: '#222', fontWeight: 700 }}>{issued}</div>

        <Divider />

        {invoice.ownerName && <Row k="Owner" v={invoice.ownerName} />}
        <Row k="Client" v={restaurantName} />
        {invoice.clientPhone && <Row k="Phone" v={invoice.clientPhone} />}
        <Row k="Plan" v={`${planName} (${invoice.months}mo)`} />
        {typeof invoice.approvedDevices === 'number' && <Row k="Devices" v={String(invoice.approvedDevices)} />}
        <Row k="Status" v={invoice.status.toUpperCase()} />

        <Divider />

        <div style={{ display: 'flex', fontWeight: 700, fontSize: 11, paddingBottom: 4, borderBottom: '1px dashed #000' }}>
          <span style={{ flex: 1 }}>DESCRIPTION</span>
          <span style={{ width: 70, textAlign: 'right' }}>AMOUNT</span>
        </div>
        {invoice.setupFee && invoice.setupFee > 0 ? (
          <div style={{ display: 'flex', padding: '6px 0', fontSize: 11, borderBottom: '1px dotted #999' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>One-Time Setup Fee</div>
              {invoice.packageName && <div style={{ fontSize: 9, color: '#666' }}>{invoice.packageName}</div>}
            </div>
            <div style={{ width: 70, textAlign: 'right', fontWeight: 700 }}>{formatRs(invoice.setupFee)}</div>
          </div>
        ) : null}
        <div style={{ display: 'flex', padding: '6px 0', fontSize: 11 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{invoice.packageName || `${planName} Plan`}</div>
            <div style={{ fontSize: 10, color: '#444' }}>
              {invoice.monthlyFee
                ? `${formatRs(invoice.monthlyFee)} × ${invoice.months} mo`
                : `${invoice.months} month subscription`}
            </div>
            {invoice.notes && <div style={{ fontSize: 9, color: '#666', fontStyle: 'italic' }}>{invoice.notes}</div>}
          </div>
          <div style={{ width: 70, textAlign: 'right', fontWeight: 700 }}>
            {formatRs(invoice.monthlyFee ? invoice.monthlyFee * invoice.months : (invoice.amount - (invoice.setupFee || 0)))}
          </div>
        </div>

        <Divider />

        <PosLine k="Subtotal" v={formatRs(invoice.amount)} />
        {invoice.discount ? <PosLine k="Discount" v={`-${formatRs(invoice.discount)}`} /> : null}
        {invoice.tax ? <PosLine k="Tax" v={formatRs(invoice.tax)} /> : null}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTop: '2px solid #000', fontWeight: 900, fontSize: 16 }}>
          <span>TOTAL</span><span>{formatRs(invoice.total)}</span>
        </div>

        <Divider />

        {invoice.id && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
            <InvoiceVerifyBadge invoiceId={invoice.id} size={110} compact />
          </div>
        )}

        <div style={{ textAlign: 'center', fontSize: 10, marginTop: 8 }}>
          <div style={{ fontWeight: 700, color: '#3c096c', fontSize: 11 }}>Thank you for your business!</div>
          <div style={{ marginTop: 4 }}>For renewal contact</div>
          <div style={{ fontWeight: 700 }}>0345-1873354</div>
          <div style={{ marginTop: 8, fontSize: 8, color: '#666' }}>UID: {tenantId.slice(0, 18)}…</div>
          <div style={{ fontSize: 8, color: '#666', marginTop: 8 }}>──── Powered by Digital Target ────</div>
        </div>
      </div>
    );
  };
  return forwardRef(Comp);
})();

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
      <span>{label}:</span><span>{value}</span>
    </div>
  );
}
function Divider() { return <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />; }
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0', fontWeight: 700 }}>
      <span style={{ fontWeight: 800 }}>{k}:</span>
      <span style={{ textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word', fontWeight: 700 }}>{v}</span>
    </div>
  );
}
function PosLine({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0', fontWeight: 700 }}>
      <span>{k}:</span><span>{v}</span>
    </div>
  );
}

const A4_CSS = `body { margin: 0; padding: 20px; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } @media print { body { padding: 0; } }`;
const POS_CSS = `@page { size: 80mm auto; margin: 0; } body { margin: 0; padding: 0; background: #fff; width: 80mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-weight: 700; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } @media print { body > div { box-shadow: none !important; } }`;
