/**
 * Client Agreement & Authorization PDF — Super Admin tool.
 *
 * Generates ONE branded PDF containing:
 *  - Digital Target header (logo + contact)
 *  - Approved Restaurant details
 *  - Approved Devices list for the tenant
 *  - Editable Agreement body (with 3-4 prebuilt templates)
 *  - HAFIZ MUHAMMAD TAIMOOR YOUNAS signature (uploaded once, kept in localStorage)
 *  - APPROVED stamp
 *
 * Signature & admin logo are stored as data URLs in localStorage so they
 * persist across PDF generations without a backend round-trip.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { FileDown, Upload, Stamp } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';
import dtLogo from '@/assets/digital-target-logo.png';

const SIG_KEY = 'dt-admin-signature-dataurl';
const STAMP_KEY = 'dt-admin-stamp-dataurl';
const CUSTOM_KEY = 'dt-admin-agreement-custom';

interface DeviceItem {
  deviceId: string;
  deviceName?: string;
  browser?: string;
  os?: string;
  approved?: boolean;
  ip?: string;
  city?: string;
  country?: string;
}

interface Restaurant {
  id: string;
  tenantId?: string;
  restaurantName?: string;
  email?: string;
  plan?: string;
  planExpiryAt?: any;
}

interface Props {
  open: boolean;
  onClose: () => void;
  restaurant: Restaurant | null;
  devices: DeviceItem[];
}

const TEMPLATES: { id: string; name: string; body: string }[] = [
  {
    id: 'standard',
    name: 'Standard Subscription Agreement',
    body:
`This agreement is made between Digital Target (Service Provider) and the Restaurant named above (Client) for the use of DT POS — a cloud-based restaurant management system.

1. The Client is granted a non-transferable license to use DT POS on the approved devices listed in this document.
2. The Service Provider will provide cloud sync, software updates, and technical support during the active subscription period.
3. The Client is responsible for keeping their account credentials, device codes and billing details up to date.
4. Any unauthorized device, data tampering or licence sharing will result in immediate suspension without refund.
5. Either party may terminate this agreement with 30 days written notice. Pre-paid subscription is non-refundable.

By signing below, both parties accept the terms outlined above.`
  },
  {
    id: 'trial',
    name: 'Free Trial Authorization',
    body:
`The Client is granted a complimentary trial license of DT POS for evaluation purposes only.

1. Trial period is limited to the duration approved by Digital Target.
2. During the trial, the Client may use all features on the approved devices below.
3. After expiry, the Client must subscribe to a paid plan to continue using the system; otherwise, access will be revoked automatically.
4. Trial data may be retained for 30 days after expiry and then permanently deleted.

By signing below, the Client accepts these trial terms.`
  },
  {
    id: 'device',
    name: 'Device Authorization Letter',
    body:
`This letter certifies that Digital Target has authorized the devices listed below for use with the DT POS account of the Restaurant named above.

1. Only the listed devices may access live data of this account.
2. Any additional device will require fresh approval from Digital Target.
3. Lost or stolen devices must be reported within 24 hours so access can be revoked.
4. Digital Target reserves the right to remotely block any device that violates the usage policy.`
  },
  {
    id: 'support',
    name: 'Annual Support & Maintenance',
    body:
`Digital Target agrees to provide the following support to the Client for the agreed annual term:

1. Unlimited cloud sync, automatic data backup and software upgrades.
2. WhatsApp / phone support during business hours (10 AM – 10 PM, Pak time).
3. On-demand training sessions for staff (up to 2 per quarter).
4. Priority on-site visit for critical issues within Burewala city limits.

The Client agrees to pay the annual support fee in advance and to maintain a stable internet connection at all branches.`
  },
];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function ClientAgreementDialog({ open, onClose, restaurant, devices }: Props) {
  const [templateId, setTemplateId] = useState('standard');
  const [body, setBody] = useState('');
  const [signature, setSignature] = useState<string>('');
  const [stamp, setStamp] = useState<string>('');
  const sigInput = useRef<HTMLInputElement>(null);
  const stampInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    try { setSignature(localStorage.getItem(SIG_KEY) || ''); } catch {}
    try { setStamp(localStorage.getItem(STAMP_KEY) || ''); } catch {}
    const saved = localStorage.getItem(CUSTOM_KEY) || '';
    setBody(saved || TEMPLATES[0].body);
    setTemplateId(saved ? 'custom' : 'standard');
  }, [open]);

  const onPickTemplate = (id: string) => {
    setTemplateId(id);
    if (id === 'custom') {
      setBody(localStorage.getItem(CUSTOM_KEY) || '');
    } else {
      const t = TEMPLATES.find(x => x.id === id);
      if (t) setBody(t.body);
    }
  };

  const uploadSig = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const url = await fileToDataUrl(f);
    setSignature(url);
    localStorage.setItem(SIG_KEY, url);
    void import('@/lib/cloudDocs').then(m => m.mirrorValue(SIG_KEY, url));
    toast.success('Signature saved');
  };

  const uploadStamp = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const url = await fileToDataUrl(f);
    setStamp(url);
    localStorage.setItem(STAMP_KEY, url);
    void import('@/lib/cloudDocs').then(m => m.mirrorValue(STAMP_KEY, url));
    toast.success('Stamp saved');
  };

  const generate = () => {
    if (!restaurant) return;
    localStorage.setItem(CUSTOM_KEY, body);
    void import('@/lib/cloudDocs').then(m => m.mirrorValue(CUSTOM_KEY, body));

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const purple: [number, number, number] = [60, 9, 108];

    // Header band — Digital Target
    doc.setFillColor(...purple);
    doc.rect(0, 0, W, 30, 'F');
    try { doc.addImage(dtLogo, 'PNG', 10, 5, 20, 20); } catch {}
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text('Digital Target', 34, 13);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('Digital Marketing & POS Solutions  •  Burewala, Pakistan', 34, 19);
    doc.text('Phone: 0345-1873354  •  Email: digitaltarget.digital@gmail.com', 34, 24);
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text('CLIENT AUTHORIZATION & AGREEMENT', W - 10, 13, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(`Ref: DT-${(restaurant.id || '').slice(0, 6).toUpperCase()}-${new Date().getFullYear()}`, W - 10, 19, { align: 'right' });
    doc.text(`Issued: ${new Date().toLocaleDateString('en-PK')}`, W - 10, 24, { align: 'right' });
    doc.setTextColor(20, 20, 20);

    let y = 38;

    // Restaurant block
    const planLabel = restaurant.plan || 'trial';
    const expiry = restaurant.planExpiryAt
      ? (typeof restaurant.planExpiryAt === 'object' && restaurant.planExpiryAt?.seconds
          ? new Date(restaurant.planExpiryAt.seconds * 1000).toLocaleDateString('en-PK')
          : new Date(restaurant.planExpiryAt).toLocaleDateString('en-PK'))
      : '—';

    autoTable(doc, {
      startY: y,
      head: [['Approved Restaurant / Client', '']],
      body: [
        ['Restaurant Name', restaurant.restaurantName || '—'],
        ['Owner Email', restaurant.email || '—'],
        ['Tenant ID', restaurant.id],
        ['Subscription Plan', planLabel.toUpperCase()],
        ['Plan Expiry', expiry],
        ['Status', 'APPROVED ✓'],
      ],
      theme: 'grid',
      headStyles: { fillColor: purple, textColor: 255, fontStyle: 'bold' },
      styles: { fontSize: 9 },
      columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold' } },
      margin: { left: 10, right: 10 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Approved devices
    const approvedDevs = devices.filter(d => d.approved);
    autoTable(doc, {
      startY: y,
      head: [[`Approved Devices (${approvedDevs.length})`, 'OS / Browser', 'IP / Location']],
      body: approvedDevs.length
        ? approvedDevs.map(d => [
            d.deviceName || d.deviceId.slice(0, 12),
            [d.os, d.browser].filter(Boolean).join(' · ') || '—',
            [d.ip, [d.city, d.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || '—',
          ])
        : [['No approved devices yet', '—', '—']],
      theme: 'striped',
      headStyles: { fillColor: purple, textColor: 255 },
      styles: { fontSize: 8 },
      margin: { left: 10, right: 10 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    // Agreement body
    if (y > 200) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.setTextColor(...purple);
    doc.text('Terms & Conditions', 10, y);
    doc.setTextColor(20, 20, 20);
    y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(body, W - 20);
    lines.forEach((ln: string) => {
      if (y > H - 50) { doc.addPage(); y = 20; }
      doc.text(ln, 10, y);
      y += 5;
    });

    // Signature + stamp area
    if (y > H - 55) { doc.addPage(); y = 30; } else { y += 8; }
    const sigY = y;
    doc.setDrawColor(180);
    doc.line(15, sigY + 22, 85, sigY + 22);
    doc.line(W - 85, sigY + 22, W - 15, sigY + 22);

    if (signature) {
      try {
        const fmt = signature.includes('image/png') ? 'PNG' : 'JPEG';
        doc.addImage(signature, fmt, 20, sigY, 60, 22);
      } catch {}
    }
    if (stamp) {
      try {
        const fmt = stamp.includes('image/png') ? 'PNG' : 'JPEG';
        doc.addImage(stamp, fmt, W / 2 - 18, sigY - 4, 36, 30);
      } catch {}
    } else {
      // Default circular APPROVED stamp
      doc.setDrawColor(220, 38, 38); doc.setLineWidth(0.8);
      doc.circle(W / 2, sigY + 11, 14, 'S');
      doc.setTextColor(220, 38, 38); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text('APPROVED', W / 2, sigY + 9, { align: 'center' });
      doc.setFontSize(7);
      doc.text('DIGITAL TARGET', W / 2, sigY + 13, { align: 'center' });
      doc.setFontSize(6);
      doc.text(new Date().toLocaleDateString('en-PK'), W / 2, sigY + 17, { align: 'center' });
      doc.setTextColor(20, 20, 20); doc.setLineWidth(0.2);
    }

    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('HAFIZ MUHAMMAD TAIMOOR YOUNAS', 50, sigY + 28, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('Founder & CEO — Digital Target', 50, sigY + 32, { align: 'center' });

    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('Client Signature', W - 50, sigY + 28, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(restaurant.restaurantName || '', W - 50, sigY + 32, { align: 'center' });

    // Footer
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(7.5); doc.setTextColor(120);
      doc.text(
        `Digital Target  •  Burewala, Pakistan  •  0345-1873354  •  Page ${i} / ${pages}`,
        W / 2, H - 6, { align: 'center' }
      );
    }

    const safe = (restaurant.restaurantName || restaurant.id).replace(/[^a-z0-9]/gi, '_');
    doc.save(`DT-Agreement-${safe}-${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success('Agreement PDF generated');
  };

  if (!restaurant) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stamp className="h-5 w-5 text-violet-600" />
            Client Agreement — {restaurant.restaurantName || restaurant.email}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs font-semibold">Template</Label>
            <div className="flex gap-2 flex-wrap mt-1">
              {TEMPLATES.map(t => (
                <Button
                  key={t.id}
                  size="sm"
                  variant={templateId === t.id ? 'default' : 'outline'}
                  onClick={() => onPickTemplate(t.id)}
                  className="text-xs"
                >
                  {t.name}
                </Button>
              ))}
              <Button
                size="sm"
                variant={templateId === 'custom' ? 'default' : 'outline'}
                onClick={() => onPickTemplate('custom')}
                className="text-xs"
              >
                Custom (manual)
              </Button>
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold">Agreement Body (editable)</Label>
            <Textarea
              value={body}
              onChange={(e) => { setBody(e.target.value); setTemplateId('custom'); }}
              rows={12}
              className="font-mono text-xs mt-1"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Custom text auto-saved locally for next time.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="p-3">
              <Label className="text-xs font-semibold">Signature — HAFIZ MUHAMMAD TAIMOOR YOUNAS</Label>
              <div className="mt-2 h-20 border rounded flex items-center justify-center bg-muted/30">
                {signature
                  ? <img src={signature} alt="signature" className="max-h-full max-w-full" />
                  : <span className="text-xs text-muted-foreground">No signature uploaded</span>}
              </div>
              <input type="file" accept="image/*" ref={sigInput} className="hidden" onChange={uploadSig} />
              <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => sigInput.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1" /> Upload signature (PNG/JPG)
              </Button>
            </Card>

            <Card className="p-3">
              <Label className="text-xs font-semibold">Company Stamp (optional)</Label>
              <div className="mt-2 h-20 border rounded flex items-center justify-center bg-muted/30">
                {stamp
                  ? <img src={stamp} alt="stamp" className="max-h-full max-w-full" />
                  : <span className="text-xs text-muted-foreground">Default red "APPROVED" stamp will be used</span>}
              </div>
              <input type="file" accept="image/*" ref={stampInput} className="hidden" onChange={uploadStamp} />
              <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => stampInput.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1" /> Upload stamp
              </Button>
            </Card>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={generate} className="bg-violet-600 hover:bg-violet-700 text-white">
            <FileDown className="h-4 w-4 mr-1" /> Generate Agreement PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
