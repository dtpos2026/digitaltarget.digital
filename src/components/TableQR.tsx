// QR code preview + download/print for a dining table.
// QR payload: public order URL with tenant + table param so menu opens pre-tagged.
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getTenantId } from '@/lib/tenant';

interface Props {
  tableName: string;
  floorName?: string;
  size?: number;
}

export function buildTableOrderUrl(tableName: string, floorName?: string): string {
  const tid = getTenantId() || '';
  const origin = typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '';
  const params = new URLSearchParams();
  params.set('table', tableName);
  if (floorName) params.set('floor', floorName);
  // Hash-router public order URL
  return `${origin}#/order/${encodeURIComponent(tid)}?${params.toString()}`;
}

/** Public ordering URL for takeaway / delivery QR posters (no table). */
export function buildPublicOrderUrl(mode: 'takeaway' | 'delivery'): string {
  const tid = getTenantId() || '';
  const origin = typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '';
  return `${origin}#/order/${encodeURIComponent(tid)}?mode=${mode}`;
}

interface PublicQRProps { mode: 'takeaway' | 'delivery'; size?: number }
export function PublicOrderQR({ mode, size = 220 }: PublicQRProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState('');
  const [dataUrl, setDataUrl] = useState('');
  useEffect(() => {
    const u = buildPublicOrderUrl(mode);
    setUrl(u);
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, u, { width: size, margin: 1, color: { dark: '#111111', light: '#ffffff' } }).catch(() => {});
    }
    QRCode.toDataURL(u, { width: 600, margin: 2 }).then(setDataUrl).catch(() => {});
  }, [mode, size]);
  const label = mode === 'takeaway' ? '🛍 Takeaway / Self-Pickup' : '🛵 Home Delivery';
  const sub = mode === 'takeaway' ? 'Scan → Menu → Order → Pickup' : 'Scan → Menu → Order → Delivered to you';
  const download = () => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `QR-${mode}.png`;
    a.click();
  };
  const print = () => {
    if (!dataUrl) return;
    const w = window.open('', '_blank', 'width=420,height=600');
    if (!w) return;
    w.document.write(`
      <html><head><title>QR — ${label}</title>
      <style>body{font-family:system-ui,sans-serif;text-align:center;padding:24px;margin:0}
      h1{font-size:26px;margin:0 0 4px}h2{font-size:16px;margin:0 0 12px;color:#555}
      img{width:340px;height:340px}p{font-size:13px;color:#666;margin-top:8px}
      .frame{border:2px dashed #333;display:inline-block;padding:18px;border-radius:12px}</style>
      </head><body><div class="frame"><h1>${label}</h1><h2>${sub}</h2>
      <img src="${dataUrl}" /><p>Scan to view the menu and order for yourself</p></div>
      <script>window.onload=()=>{setTimeout(()=>{window.print();},300);}</script>
      </body></html>`);
    w.document.close();
  };
  return (
    <div className="space-y-3">
      <div className="flex justify-center">
        <div className="p-3 bg-white border-2 rounded-lg shadow-sm">
          <canvas ref={canvasRef} />
        </div>
      </div>
      <div className="text-center">
        <div className="font-bold text-sm">{label}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
        <div className="text-[10px] text-muted-foreground break-all mt-1">{url}</div>
      </div>
      <div className="flex gap-2">
        <Button onClick={download} variant="outline" size="sm" className="flex-1">
          <Download className="h-3.5 w-3.5 mr-1" /> Download PNG
        </Button>
        <Button onClick={print} size="sm" className="flex-1">
          <Printer className="h-3.5 w-3.5 mr-1" /> Print
        </Button>
      </div>
    </div>
  );
}

export default function TableQR({ tableName, floorName, size = 220 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState('');
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    const u = buildTableOrderUrl(tableName, floorName);
    setUrl(u);
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, u, { width: size, margin: 1, color: { dark: '#111111', light: '#ffffff' } }).catch(() => {});
    }
    QRCode.toDataURL(u, { width: 600, margin: 2 }).then(setDataUrl).catch(() => {});
  }, [tableName, floorName, size]);

  const download = () => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `QR-${tableName.replace(/\s+/g, '_')}.png`;
    a.click();
  };

  const print = () => {
    if (!dataUrl) return;
    const w = window.open('', '_blank', 'width=420,height=600');
    if (!w) return;
    w.document.write(`
      <html><head><title>QR — ${tableName}</title>
      <style>
        body{font-family:system-ui,sans-serif;text-align:center;padding:24px;margin:0}
        h1{font-size:28px;margin:0 0 4px}
        h2{font-size:18px;margin:0 0 12px;color:#555}
        img{width:340px;height:340px}
        p{font-size:13px;color:#666;margin-top:8px}
        .frame{border:2px dashed #333;display:inline-block;padding:18px;border-radius:12px}
      </style></head><body>
      <div class="frame">
        <h1>📱 Scan to Order</h1>
        <h2>${tableName}${floorName ? ' · ' + floorName : ''}</h2>
        <img src="${dataUrl}" />
        <p>View the menu, order yourself, or call a waiter</p>
      </div>
      <script>window.onload=()=>{setTimeout(()=>{window.print();},300);}</script>
      </body></html>
    `);
    w.document.close();
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-center">
        <div className="p-3 bg-white border-2 rounded-lg shadow-sm">
          <canvas ref={canvasRef} />
        </div>
      </div>
      <div className="text-center">
        <div className="font-bold text-sm">{tableName}{floorName ? ` · ${floorName}` : ''}</div>
        <div className="text-[10px] text-muted-foreground break-all mt-1">{url}</div>
      </div>
      <div className="flex gap-2">
        <Button onClick={download} variant="outline" size="sm" className="flex-1">
          <Download className="h-3.5 w-3.5 mr-1" /> Download PNG
        </Button>
        <Button onClick={print} size="sm" className="flex-1">
          <Printer className="h-3.5 w-3.5 mr-1" /> Print
        </Button>
      </div>
    </div>
  );
}
