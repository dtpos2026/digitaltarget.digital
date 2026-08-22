// ============================================================
// v1.14.0 — Barcode & Label Manager (retail / minimart)
//
// Three jobs on one screen, because in a shop they happen together:
//   • SCAN     — camera or USB scanner, to find or assign a code
//   • GENERATE — create an internal code for loose/own-packed items
//   • PRINT    — a sheet of shelf labels with barcode, name and price
//
// The camera scanner is loaded lazily: html5-qrcode is a sizeable
// dependency and most restaurant tenants never open this page.
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Camera, CameraOff, Printer, Wand2, ScanLine, QrCode } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { QRCodeSVG } from 'qrcode.react';
import { getMenuItems, saveMenuItem, getSettings } from '@/lib/store';
import { money } from '@/lib/currency';
import {
  validateCode, generateInternalCode, expandLabels, labelPageCount,
  LABEL_SHEET_DEFAULT, parseWeightBarcode,
  type LabelItem,
} from '@/lib/barcode';
import type { MenuItem } from '@/lib/types';

export default function BarcodeManagerPage() {
  const [items, setItems] = useState<MenuItem[]>(() => getMenuItems());
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<string>('');
  const [copies, setCopies] = useState<Record<string, number>>({});
  const scannerRef = useRef<any>(null);

  const settings = useMemo(() => getSettings(), []);
  const refresh = () => setItems(getMenuItems());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i =>
      i.name.toLowerCase().includes(q) || (i.barcode || '').toLowerCase().includes(q));
  }, [items, query]);

  const withCode = items.filter(i => !!i.barcode).length;

  // ---------- camera scanning ----------
  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;

    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;
        const scanner = new Html5Qrcode('barcode-reader');
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },     // rear camera on phones
          { fps: 10, qrbox: { width: 250, height: 150 } },
          (decoded: string) => handleScan(decoded),
          () => { /* per-frame misses are normal; stay quiet */ },
        );
      } catch (e: any) {
        if (!cancelled) {
          toast.error(`Could not open the camera: ${e?.message || e}`);
          setScanning(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        s.stop().then(() => s.clear()).catch(() => { /* already stopped */ });
        scannerRef.current = null;
      }
    };
  }, [scanning]);

  const handleScan = (raw: string) => {
    const check = validateCode(raw);
    setLastScan(check.normalized);

    // A scale label carries the weight inside the barcode.
    const weight = parseWeightBarcode(check.normalized);
    if (weight.isWeightBarcode) {
      toast.info(`Weight label: ${weight.grams}g (item ${weight.itemCode})`);
      return;
    }
    if (!check.ok) { toast.error(check.error || 'Invalid code'); return; }

    const hit = items.find(i => i.barcode === check.normalized);
    if (hit) toast.success(`Found: ${hit.name}`);
    else toast.warning('No item has this code — assign it to an item below');
  };

  const assign = (item: MenuItem, code: string) => {
    const check = validateCode(code);
    if (!check.ok) { toast.error(check.error || 'Invalid code'); return; }
    const clash = items.find(i => i.barcode === check.normalized && i.id !== item.id);
    if (clash) {
      // Two items sharing a code means one scans as the other — refuse.
      toast.error(`This code is already assigned to "${clash.name}"`);
      return;
    }
    saveMenuItem({ ...item, barcode: check.normalized });
    refresh();
    toast.success(`${item.name} → ${check.normalized}`);
  };

  const printLabels = () => {
    const labels: LabelItem[] = items
      .filter(i => i.barcode && (copies[i.id] || 0) > 0)
      .map(i => ({ name: i.name, code: i.barcode!, price: i.price, copies: copies[i.id] }));
    const expanded = expandLabels(labels);
    if (expanded.length === 0) { toast.error('Enter a copy count against an item first'); return; }

    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { toast.error('The popup was blocked'); return; }

    // Render each barcode to an SVG string up-front; the print window has
    // no bundler, so nothing can be imported inside it.
    const cells = expanded.map(l => {
      let svg = '';
      try {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        JsBarcode(el, l.code, {
          format: /^\d{13}$/.test(l.code) ? 'EAN13' : 'CODE128',
          width: 1.6, height: 40, fontSize: 12, margin: 2, displayValue: true,
        });
        svg = el.outerHTML;
      } catch {
        svg = `<div style="font:11px monospace">${l.code}</div>`;
      }
      return `<div class="lbl">
        ${LABEL_SHEET_DEFAULT.showName ? `<div class="nm">${escapeHtml(l.name)}</div>` : ''}
        <div class="bc">${svg}</div>
        ${LABEL_SHEET_DEFAULT.showPrice && l.price != null ? `<div class="pr">${money(l.price)}</div>` : ''}
      </div>`;
    }).join('');

    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Labels</title>
<style>
  @page { margin: 8mm; }
  body { font-family: system-ui, sans-serif; margin: 0; }
  .sheet { display: grid; grid-template-columns: repeat(${LABEL_SHEET_DEFAULT.columns}, 1fr); gap: 3mm; }
  .lbl { border: 1px dashed #bbb; padding: 2mm; text-align: center;
         height: ${LABEL_SHEET_DEFAULT.labelHeightMm}mm; display: flex;
         flex-direction: column; justify-content: center; align-items: center;
         page-break-inside: avoid; }
  .nm { font-size: 10px; font-weight: 700; margin-bottom: 1mm;
        max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pr { font-size: 12px; font-weight: 800; margin-top: 1mm; }
  .bc svg { max-width: 100%; }
</style></head><body>
  <div class="sheet">${cells}</div>
  <script>window.onload = () => window.print();</script>
</body></html>`);
    w.document.close();
    toast.success(`${expanded.length} labels — ${labelPageCount(expanded.length, LABEL_SHEET_DEFAULT)} page(s)`);
  };

  if (!settings.barcodeEnabled) {
    return (
      <div className="p-4 lg:p-6">
        <Card className="p-6 max-w-xl">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ScanLine className="h-5 w-5" /> Barcode & Labels
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            Ye module abhi OFF hai. <b>Module Management</b> me
            "🏷️ Barcode / SKU" ON karein.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-4xl">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ScanLine className="h-5 w-5" /> Barcode &amp; Labels
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Scan kar ke item dhoondein, code assign karein, aur shelf labels print karein.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">
          {withCode} / {items.length} items have codes
        </Badge>
      </div>

      {/* Scanner */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">Scanner</h3>
          <Button size="sm" variant={scanning ? 'destructive' : 'default'}
            onClick={() => setScanning(v => !v)}>
            {scanning ? <><CameraOff className="h-3.5 w-3.5 mr-1" /> Stop</>
                      : <><Camera className="h-3.5 w-3.5 mr-1" /> Camera Scan</>}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          USB scanner keyboard ki tarah kaam karta hai — wo POS ki search me
          seedha chalta hai. Camera un devices ke liye hai jinke sath scanner nahi.
        </p>
        <div id="barcode-reader" className={scanning ? 'rounded-lg overflow-hidden border' : 'hidden'} />
        <div>
          <Label className="text-xs">Ya code type / paste karein</Label>
          <div className="flex gap-2">
            <Input
              value={lastScan}
              onChange={e => setLastScan(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleScan(lastScan); }}
              placeholder="5901234123457"
            />
            <Button variant="outline" onClick={() => handleScan(lastScan)}>Find</Button>
          </div>
          {lastScan && (
            <div className="mt-2 flex items-center gap-3">
              <QRCodeSVG value={lastScan} size={64} level="M" />
              <span className="text-[10px] text-muted-foreground">
                <QrCode className="h-3 w-3 inline mr-1" />
                Is code ka QR — customer app ya stock sheet me use ho sakta hai
              </span>
            </div>
          )}
        </div>
      </Card>

      {/* Items */}
      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold">Items</h3>
          <Button size="sm" variant="outline" onClick={printLabels}>
            <Printer className="h-3.5 w-3.5 mr-1" /> Print Labels
          </Button>
        </div>
        <Input placeholder="Item ya code dhoondein…" value={query}
          onChange={e => setQuery(e.target.value)} />

        <div className="max-h-[26rem] overflow-auto space-y-1">
          {filtered.map(it => (
            <div key={it.id} className="flex items-center gap-2 border rounded px-2 py-1.5">
              <span className="flex-1 min-w-0">
                <span className="text-sm font-medium truncate block">{it.name}</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {it.barcode || 'no code'}
                </span>
              </span>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]"
                title="Generate a new internal code for this item"
                onClick={() => assign(it, generateInternalCode())}>
                <Wand2 className="h-3 w-3 mr-1" /> Generate
              </Button>
              {lastScan && (
                <Button size="sm" variant="outline" className="h-7 text-[11px]"
                  onClick={() => assign(it, lastScan)}>
                  Assign scanned
                </Button>
              )}
              <Input
                type="number"
                className="h-7 w-16 text-xs"
                placeholder="0"
                value={copies[it.id] ?? ''}
                onChange={e => setCopies({ ...copies, [it.id]: Number(e.target.value) || 0 })}
                title="How many labels to print"
              />
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground italic py-4 text-center">No items found.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
