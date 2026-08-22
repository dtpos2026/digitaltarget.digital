// Printer Calibration — per-printer margin/feed offsets + a ruler test strip.
// Part of the Printing Center module. Uses the ONE central print service.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Ruler, Printer, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  loadPrinterSettings, savePrinterSettings,
  type PrinterConfig, type PrinterSettingsDoc,
} from '@/lib/printerSettings';
import { printNode } from '@/printing';

const num = (v: string, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

export default function PrinterCalibrationCard() {
  const [doc, setDoc] = useState<PrinterSettingsDoc>({ printers: [] });
  const [selectedId, setSelectedId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const portalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPrinterSettings().then((d) => {
      setDoc(d);
      setSelectedId((prev) => prev || d.printers[0]?.id || '');
    }).catch(() => {});
  }, []);

  const printer: PrinterConfig | undefined = useMemo(
    () => doc.printers.find((p) => p.id === selectedId),
    [doc, selectedId],
  );

  const patch = (fields: Partial<PrinterConfig>) => {
    if (!printer) return;
    setDoc((d) => ({
      ...d,
      printers: d.printers.map((p) => (p.id === printer.id ? { ...p, ...fields } : p)),
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await savePrinterSettings(doc);
      toast.success('Calibration saved');
    } catch (e: any) {
      toast.error(e?.message || 'Could not save calibration');
    } finally { setSaving(false); }
  };

  const printStrip = async () => {
    const el = portalRef.current;
    if (!el) return;
    const res = await printNode(el, {
      paperWidth: (printer?.paperSize as any) || '80mm',
      printerName: printer?.printerName,
      copies: 1,
    });
    if (!res.success) toast.error(res.error || 'Calibration strip failed to print');
    else toast.success('Calibration strip sent');
  };

  const widthMm = printer?.printWidthMm || (printer?.paperSize === '58mm' ? 58 : 80);
  const ticks = Array.from({ length: Math.floor(widthMm / 5) + 1 }, (_, i) => i * 5);

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-bold flex items-center gap-2"><Ruler className="h-4 w-4" /> Printer Calibration</h3>
        <Badge variant="outline">{printer ? `${printer.paperSize} · ${printer.role}` : 'No printer selected'}</Badge>
      </div>

      {doc.printers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Add a printer in the Printers tab first, then calibrate it here.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {doc.printers.map((p) => (
              <Button
                key={p.id}
                size="sm"
                variant={p.id === selectedId ? 'default' : 'outline'}
                onClick={() => setSelectedId(p.id)}
              >
                {p.name || p.printerName || 'Printer'}
              </Button>
            ))}
          </div>

          {printer && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">Left margin (mm)</Label>
                  <Input type="number" step="0.5" value={printer.leftMarginMm ?? 0}
                    onChange={(e) => patch({ leftMarginMm: num(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">Right margin (mm)</Label>
                  <Input type="number" step="0.5" value={printer.rightMarginMm ?? 0}
                    onChange={(e) => patch({ rightMarginMm: num(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">Top feed (mm)</Label>
                  <Input type="number" step="0.5" value={printer.topFeedMm ?? 0}
                    onChange={(e) => patch({ topFeedMm: num(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">Bottom feed (mm)</Label>
                  <Input type="number" step="0.5" value={printer.bottomFeedMm ?? 0}
                    onChange={(e) => patch({ bottomFeedMm: num(e.target.value) })} />
                </div>
              </div>

              <div className="rounded border p-3 bg-muted/40">
                <div className="text-xs text-muted-foreground mb-2">Live preview ({widthMm}mm)</div>
                <div
                  className="bg-background border mx-auto"
                  style={{ width: `${widthMm * 3}px`, paddingTop: `${(printer.topFeedMm || 0) * 3}px`, paddingBottom: `${(printer.bottomFeedMm || 0) * 3}px`, paddingLeft: `${(printer.leftMarginMm || 0) * 3}px`, paddingRight: `${(printer.rightMarginMm || 0) * 3}px` }}
                >
                  <div className="border border-dashed text-[10px] text-center py-2 font-mono">CONTENT AREA</div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={saving}>
                  <Save className="h-4 w-4 mr-1" /> Save calibration
                </Button>
                <Button size="sm" variant="outline" onClick={printStrip}>
                  <Printer className="h-4 w-4 mr-1" /> Print ruler strip
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {/* Hidden print portal — the ruler strip */}
      <div ref={portalRef} className="receipt-print-portal" aria-hidden>
        <div style={{
          fontFamily: 'monospace',
          color: '#000',
          paddingTop: `${printer?.topFeedMm || 0}mm`,
          paddingBottom: `${printer?.bottomFeedMm || 0}mm`,
          paddingLeft: `${printer?.leftMarginMm || 0}mm`,
          paddingRight: `${printer?.rightMarginMm || 0}mm`,
        }}>
          <div style={{ fontWeight: 700, textAlign: 'center', fontSize: '12px' }}>CALIBRATION STRIP</div>
          <div style={{ fontSize: '10px', textAlign: 'center' }}>{printer?.name || ''} · {widthMm}mm</div>
          <div style={{ borderTop: '1px solid #000', margin: '2mm 0' }} />
          {ticks.map((t) => (
            <div key={t} style={{ fontSize: '9px', display: 'flex', gap: '2mm' }}>
              <span style={{ width: '10mm' }}>{t}mm</span>
              <span>{'|'.repeat(Math.max(1, Math.round(t / 5)) )}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #000', margin: '2mm 0' }} />
          <div style={{ fontSize: '10px' }}>Left edge should start exactly here →</div>
          <div style={{ fontSize: '10px' }}>End of strip. No extra blank paper below.</div>
        </div>
      </div>
    </Card>
  );
}
